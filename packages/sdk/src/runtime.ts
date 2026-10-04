import { createSurfaces, type Callback } from "./surfaces.ts";
import { shallowRef, stop, type ReactiveEffectRunner } from "@vue/reactivity";
import type { Observed, Slice } from "./game.ts";
import type { View } from "./nodes.ts";
import type { Manifest, ToHost, ToPlugin, RequestOp } from "./protocol.ts";

import type { PluginContext, Setup, Doc } from "./index.ts";

export type Port = { post(msg: ToHost): void; listen(handler: (msg: ToPlugin) => void): void };

export function startRuntime(port: Port, setup: Setup) {
  const abort = new AbortController();
  const effects: ReactiveEffectRunner[] = [];
  const slices = new Map<Slice, ReturnType<typeof shallowRef<Observed<unknown>>>>();
  const pending = new Map<number, (value: unknown) => void>();
  const docs = new Map<
    string,
    { ref: ReturnType<typeof shallowRef<unknown>>; generation: number }
  >();
  const commandHandlers = new Map<
    string,
    { kind: "view"; render: () => View } | { kind: "action"; run: () => unknown }
  >();
  const queryHandlers: Parameters<PluginContext["hub"]["query"]>[0][] = [];
  const settings = shallowRef<Record<string, number | boolean>>({});
  let manifest!: Manifest;
  let activation: string | null = null; // one fresh player action, consumed by one game action
  let reqSeq = 0;
  let queryAbort: AbortController | null = null;

  const post = (msg: ToHost) => port.post(msg);

  function request<T>(op: RequestOp, args: unknown, useActivation = false): Promise<T> {
    const reqId = ++reqSeq;
    const token = useActivation ? activation : null;
    if (useActivation) activation = null;
    post({ t: "request", reqId, op, args, activation: token });
    return new Promise((resolve) => pending.set(reqId, resolve as (v: unknown) => void));
  }

  const { watchRender, wireItems, mountView, callbacks, views } = createSurfaces(post, effects);

  async function guarded<T>(fn: () => T | Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      post({ t: "error", message: err.message, stack: err.stack });
      return undefined;
    }
  }

  function slice<T>(name: Slice): () => Observed<T> {
    return () => {
      let ref = slices.get(name);
      if (!ref) {
        ref = shallowRef<Observed<unknown>>({ ok: false, reason: "loading" });
        slices.set(name, ref);
        post({ t: "subscribe", slice: name }); // the host publishes only what someone reads
      }
      return ref.value as Observed<T>;
    };
  }

  const ctx: PluginContext = {
    get manifest() {
      return manifest;
    },
    signal: abort.signal,
    game: {
      player: slice("player"),
      target: slice("target"),
      map: slice("map"),
      loadBuild: (build) => request("game.loadBuild", build, true),
      travel: (to) => request("game.travel", to, true),
    },
    settings: () => settings.value,
    hub: {
      items(render) {
        watchRender(render, (items) => {
          const cbs = new Map<string, Callback>();
          callbacks.set("items", cbs);
          post({ t: "items", items: wireItems(items, cbs) });
        });
      },
      query(handler) {
        queryHandlers.push(handler);
      },
    },
    commands: {
      view(id, render) {
        commandHandlers.set(id, { kind: "view", render });
      },
      action(id, run) {
        commandHandlers.set(id, { kind: "action", run });
      },
    },
    hud: {
      widget(id, render) {
        watchRender(render, (node) => post({ t: "hud", id, node }));
      },
    },
    storage: {
      doc<T>(name: string, initial: () => T): Doc<T> {
        let ref = docs.get(name);
        if (!ref) {
          ref = { ref: shallowRef<unknown>(initial()), generation: 0 };
          docs.set(name, ref);
          void request<unknown>("doc.read", { name }).then((stored) => {
            if (r.generation === 0 && stored !== null && stored !== undefined) r.ref.value = stored;
          });
        }
        const r = ref;
        return {
          value: () => r.ref.value as T,
          async set(next) {
            r.generation++;
            r.ref.value = next;
            await request("doc.write", { name, value: next });
          },
        };
      },
    },
    ui: { toast: (toast) => void request("toast", toast) },
  };

  async function invoke(surface: string, target: string, args: unknown[] = []) {
    const cb = callbacks.get(surface)?.get(target);
    // Identity, not position: an action whose item vanished or changed is refused.
    if (!cb)
      return post({ t: "error", message: `stale action ${target}: the item changed or vanished` });
    if (cb.kind === "push") {
      mountView(String(args[0]), cb.fn);
    } else {
      await guarded(() => cb.fn(...args));
    }
  }

  port.listen(async (msg) => {
    switch (msg.t) {
      case "init":
        manifest = msg.manifest;
        settings.value = msg.settings;
        await guarded(() => setup(ctx));
        post({ t: "ready" });
        break;
      case "slice": {
        const ref = slices.get(msg.slice);
        if (ref) ref.value = msg.value;
        break;
      }
      case "command": {
        activation = msg.activation;
        const handler = commandHandlers.get(msg.id);
        if (handler?.kind === "view") mountView(msg.viewId, handler.render);
        else if (handler) await guarded(handler.run);
        else post({ t: "error", message: `command ${msg.id} has no handler` });
        post({ t: "commandDone", opId: msg.opId });
        break;
      }
      case "invoke":
        activation = msg.activation;
        await invoke(msg.viewId, msg.target, msg.args);
        break;
      case "closeView":
        views.get(msg.viewId)?.effect.stop();
        views.delete(msg.viewId);
        callbacks.delete(msg.viewId);
        break;
      case "query": {
        queryAbort?.abort();
        const ac = (queryAbort = new AbortController());
        const results = await Promise.all(
          queryHandlers.map((h) => guarded(() => h(msg.text, msg.scope, ac.signal))),
        );
        if (ac.signal.aborted) return; // a newer query replaced this one
        const cbs = new Map<string, Callback>();
        callbacks.set("q", cbs);
        post({
          t: "queryResult",
          reqId: msg.reqId,
          items: wireItems(
            results.flatMap((items) => items ?? []),
            cbs,
          ),
        });
        break;
      }
      case "result":
        pending.get(msg.reqId)?.(msg.value);
        pending.delete(msg.reqId);
        break;
      case "doc": {
        const ref = docs.get(msg.name);
        if (ref) {
          ref.generation++;
          ref.ref.value = msg.value;
        }
        break;
      }
      case "settings":
        settings.value = msg.values;
        break;
      case "ping":
        post({ t: "pong", seq: msg.seq });
        break;
    }
  });

  return () => {
    abort.abort();
    effects.forEach((e) => stop(e));
  };
}
