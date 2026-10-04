import { parseManifest } from "./manifest.ts";
import type { Setup } from "./index.ts";
import { startRuntime } from "./runtime.ts";
import type { ActionResult, Observed, Slice } from "./game.ts";
import type { HudNode } from "./nodes.ts";
import type { ToHost, ToPlugin, WireItem, WireView } from "./protocol.ts";

type GameScript = Partial<Record<Slice, Observed<unknown>>>;

export async function createTestHost(
  value: unknown,
  setup: Setup,
  opts: {
    game?: GameScript;
    actionResult?: ActionResult;
    documents?: Record<string, unknown>;
    documentReadDelay?: number;
  } = {},
) {
  const manifest = parseManifest(value);
  let toPlugin!: (msg: ToPlugin) => void;
  const game: GameScript = { ...opts.game };
  const subscribed = new Set<Slice>();
  const docs = new Map<string, unknown>(Object.entries(opts.documents ?? {}));
  const state: {
    items: WireItem[];
    hud: Record<string, HudNode | null>;
    views: Record<string, WireView>;
    actions: { op: string; args: unknown; activated: boolean }[];
    toasts: unknown[];
    errors: string[];
  } = {
    items: [],
    hud: {},
    views: {},
    actions: [],
    toasts: [],
    errors: [],
  };
  const waiting = new Map<number, () => void>();
  const queries = new Map<number, (items: WireItem[]) => void>();
  let seq = 0;
  const tokens = new Set<string>();

  const onHost = (msg: ToHost) => {
    switch (msg.t) {
      case "subscribe":
        subscribed.add(msg.slice);
        push(msg.slice);
        break;
      case "items":
        state.items = msg.items;
        break;
      case "hud":
        state.hud[msg.id] = msg.node;
        break;
      case "view":
        state.views[msg.viewId] = msg.view;
        break;
      case "error":
        state.errors.push(msg.message);
        break;
      case "commandDone":
        waiting.get(msg.opId)?.();
        break;
      case "queryResult":
        queries.get(msg.reqId)?.(msg.items);
        break;
      case "request": {
        let value: unknown;
        if (msg.op === "game.loadBuild" || msg.op === "game.travel") {
          const activated = !!msg.activation && tokens.delete(msg.activation);
          state.actions.push({ op: msg.op, args: msg.args, activated });
          value = activated
            ? (opts.actionResult ?? { status: "done" })
            : { status: "refused", reason: "needs-user-action", message: "" };
        } else if (msg.op === "doc.read" || msg.op === "doc.write") {
          const args = msg.args;
          if (
            typeof args !== "object" ||
            args === null ||
            !("name" in args) ||
            typeof args.name !== "string"
          )
            throw new Error("Expected a document name");
          if (msg.op === "doc.read") value = docs.get(args.name) ?? null;
          else if ("value" in args) docs.set(args.name, args.value);
        } else if (msg.op === "toast") state.toasts.push(msg.args);
        const reply = () => toPlugin({ t: "result", reqId: msg.reqId, value });
        if (msg.op === "doc.read" && opts.documentReadDelay)
          setTimeout(reply, opts.documentReadDelay);
        else queueMicrotask(reply);
        break;
      }
    }
  };
  const push = (slice: Slice) =>
    toPlugin({ t: "slice", slice, value: game[slice] ?? { ok: false, reason: "loading" } });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  startRuntime(
    {
      post: (m) => queueMicrotask(() => onHost(structuredClone(m))),
      listen: (h) => (toPlugin = h),
    },
    setup,
  );
  toPlugin({
    t: "init",
    manifest,
    settings: Object.fromEntries((manifest.settings ?? []).map((s) => [s.key, s.default])),
  });
  await flush();

  const grant = () => {
    const t = `t${++seq}`;
    tokens.add(t);
    return t;
  };

  return {
    state,
    async setGame(next: GameScript) {
      Object.assign(game, next);
      for (const s of subscribed) push(s);
      await flush();
    },
    async command(id: string): Promise<{ viewId: string; view: WireView } | null> {
      const opId = ++seq,
        viewId = `view:${opId}`;
      const done = new Promise<void>((r) => waiting.set(opId, r));
      toPlugin({ t: "command", opId, id, viewId, activation: grant() });
      await done;
      await flush();
      return state.views[viewId] ? { viewId, view: state.views[viewId] } : null;
    },
    async choose(surface: string, itemId: string, actionId: string, args?: unknown[]) {
      toPlugin({
        t: "invoke",
        viewId: surface,
        target: `${itemId}/${actionId}`,
        activation: grant(),
        args,
      });
      await flush();
      await flush();
    },
    async query(text: string, scope: string | null = null): Promise<WireItem[]> {
      const reqId = ++seq;
      const result = new Promise<WireItem[]>((r) => queries.set(reqId, r));
      toPlugin({ t: "query", reqId, text, scope });
      return result;
    },
  };
}
