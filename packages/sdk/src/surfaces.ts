import { effect, type ReactiveEffectRunner } from "@vue/reactivity";
import type { Action, HubItem, ListItem, View } from "./nodes.ts";
import type { ToHost, WireAction, WireItem, WireView } from "./protocol.ts";

export type Callback =
  | { kind: "run"; fn: (...args: unknown[]) => unknown }
  | { kind: "push"; fn: () => View };

export function createSurfaces(post: (message: ToHost) => void, effects: ReactiveEffectRunner[]) {
  const callbacks = new Map<string, Map<string, Callback>>();
  const views = new Map<string, ReactiveEffectRunner>();
  function watchRender<T>(render: () => T, send: (value: T) => void): ReactiveEffectRunner {
    let queued = false;
    const run = () => {
      let value: T;
      try {
        value = render();
      } catch (e) {
        // A broken render keeps the previous tree on screen and reports why.
        const err = e instanceof Error ? e : new Error(String(e));
        return post({ t: "error", message: err.message, stack: err.stack });
      }
      send(value);
    };
    const runner: ReactiveEffectRunner = effect(run, {
      scheduler: () => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          runner();
        });
      },
    });
    effects.push(runner);
    return runner;
  }

  function wireActions(
    actions: readonly Action[],
    itemId: string,
    into: Map<string, Callback>,
  ): WireAction[] {
    return actions.map((a) => {
      const { id, title, icon, shortcut, style, confirm } = a;
      const base = { id, title, icon, shortcut, style, confirm };
      if ("copy" in a) return { ...base, kind: "copy", copy: a.copy };
      if ("run" in a) {
        into.set(`${itemId}/${id}`, { kind: "run", fn: a.run });
        return { ...base, kind: "run" };
      }
      into.set(`${itemId}/${id}`, { kind: "push", fn: a.push });
      return { ...base, kind: "push" };
    });
  }

  function wireItems(
    items: readonly (ListItem | HubItem)[],
    into: Map<string, Callback>,
  ): WireItem[] {
    return items.map((item) => ({ ...item, actions: wireActions(item.actions, item.id, into) }));
  }

  function wireView(view: View, into: Map<string, Callback>): WireView {
    if (view.type === "list") {
      if (view.onSearch) {
        const search = view.onSearch;
        into.set("$search", {
          kind: "run",
          fn: (text) => {
            if (typeof text !== "string") throw new Error("Expected search text");
            return search(text);
          },
        });
      }
      return {
        type: "list",
        title: view.title,
        placeholder: view.placeholder,
        loading: view.loading,
        empty: view.empty,
        filter: view.filter ?? (view.onSearch ? "plugin" : "host"),
        items: wireItems(view.items, into),
      };
    }
    if (view.type === "detail") {
      return {
        type: "detail",
        title: view.title,
        blocks: view.blocks,
        actions: wireActions(view.actions, "$detail", into),
      };
    }
    into.set("$submit", {
      kind: "run",
      fn: (values) => {
        if (typeof values !== "object" || values === null) throw new Error("Expected form values");
        const fields: Record<string, string | boolean> = {};
        for (const [key, value] of Object.entries(values)) {
          if (typeof value !== "string" && typeof value !== "boolean")
            throw new Error("Expected a text or toggle value");
          fields[key] = value;
        }
        return view.submit.run(fields);
      },
    });
    return { type: "form", title: view.title, fields: view.fields, submitTitle: view.submit.title };
  }

  function mountView(viewId: string, render: () => View) {
    views.get(viewId)?.effect.stop();
    views.set(
      viewId,
      watchRender(render, (v) => {
        const cbs = new Map<string, Callback>();
        callbacks.set(viewId, cbs); // a new render replaces old callbacks: stale ids cannot run
        post({ t: "view", viewId, view: wireView(v, cbs) });
      }),
    );
  }

  return { watchRender, wireItems, mountView, callbacks, views };
}
