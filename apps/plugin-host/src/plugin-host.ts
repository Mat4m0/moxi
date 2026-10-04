import { emptyHubState, parseManifest } from "@moxi/sdk/host";
import type { HostPort, HubState, HubToast, ToHost, ToPlugin, WireItem } from "@moxi/sdk/host";
import type { ActionResult, Observed, Slice } from "@moxi/sdk";

export type PluginWorker = {
  postMessage(message: ToPlugin): void;
  listen(handler: (message: ToHost) => void, onError: (message: string) => void): void;
  terminate(): void;
};
type Running = {
  worker: PluginWorker;
  lastPong: number;
  ready: Promise<boolean>;
  settleReady: (ready: boolean) => void;
  tokens: Map<string, number>;
  requests: Map<number, (items: WireItem[]) => void>;
  commands: Map<number, () => void>;
};

export class PluginHost {
  readonly state: HubState = emptyHubState();
  private running = new Map<string, Running>();
  private crashes = new Map<string, number[]>();
  private actions = new Map<
    number,
    { pluginId: string; resolve: (result: ActionResult) => void }
  >();
  private busy = new Set<string>();
  private seq = 0;
  private queryGen = 0;
  private hubOpen = false;
  private hubSession = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private facts: Record<Slice, Observed<unknown>> = {
    player: { ok: false, reason: "not-in-game" },
    target: { ok: false, reason: "not-in-game" },
    map: { ok: false, reason: "not-in-game" },
  };
  private disposed = false;
  private frame: (() => void) | undefined;
  private watchdog: ReturnType<typeof setInterval>;

  constructor(
    private port: HostPort,
    private createWorker: (script: string, id: string) => PluginWorker,
    private documents: Pick<Storage, "getItem" | "setItem">,
    private scheduleFrame: (callback: () => void) => void = (callback) => {
      requestAnimationFrame(callback);
    },
  ) {
    port.onClose?.(() => this.dispose());
    port.listen((message) => {
      if (this.disposed) return;
      switch (message.t) {
        case "openHub":
          this.hubOpen = true;
          this.hubSession++;
          this.queryGen++;
          this.state.queryResults = {};
          this.state.queryFor = null;
          for (const p of Object.values(this.state.plugins))
            if (p.enabled && p.manifest.activation.includes("hub"))
              void this.ensureStarted(p.manifest.id);
          this.changed();
          break;
        case "closeHub":
          this.hubOpen = false;
          this.hubSession++;
          this.queryGen++;
          this.state.queryResults = {};
          this.state.queryFor = null;
          for (const viewId of Object.keys(this.state.views)) this.closeView(viewId);
          this.changed();
          break;
        case "query":
          void this.query(message.text, message.scope);
          break;
        case "command":
          void this.runCommand(message.pluginId, message.commandId).then((viewId) =>
            this.port.post({ t: "commandResult", requestId: message.requestId, viewId }),
          );
          break;
        case "invoke":
          this.invoke(
            message.pluginId,
            message.surface,
            message.target,
            message.args,
            message.grant,
          );
          break;
        case "pushView":
          this.invoke(message.pluginId, message.surface, message.target, [message.viewId]);
          break;
        case "closeView":
          this.closeView(message.viewId);
          break;
        case "enabled":
          this.setEnabled(message.pluginId, message.enabled);
          break;
        case "setting":
          this.state.plugins[message.pluginId]!.settings[message.key] = message.value;
          this.send(message.pluginId, {
            t: "settings",
            values: { ...this.state.plugins[message.pluginId]!.settings },
          });
          this.changed();
          break;
        case "toast":
          this.toast(message.plugin, message.toast);
          break;
        case "facts":
          this.facts = message.values;
          for (const [id, p] of Object.entries(this.state.plugins))
            if (p.status === "running")
              for (const slice of p.subscriptions) this.publish(id, slice);
          break;
        case "actionResult":
          this.actions.get(message.requestId)?.resolve(message.result);
          break;
      }
    });
    this.watchdog = setInterval(() => {
      const now = performance.now();
      for (const [id, r] of this.running) {
        if (now - r.lastPong > 2500) {
          const name = this.state.plugins[id]!.manifest.name;
          this.log(`${name} stopped responding and was stopped`, "error");
          this.toast("Hub", {
            title: `${name} stopped`,
            message: "It stopped responding. The game was not affected.",
            tone: "danger",
          });
          this.stopPlugin(id, "Stopped responding");
        } else r.worker.postMessage({ t: "ping", seq: ++this.seq });
      }
    }, 1000);
  }

  private changed() {
    if (this.disposed || this.frame) return;
    const frame = () => {
      this.frame = undefined;
      if (this.disposed) return;
      const plugins = Object.fromEntries(
        Object.entries(this.state.plugins).map(([id, p]) => {
          const { script: _script, bytes: _bytes, subscriptions: _subscriptions, ...visible } = p;
          return [id, visible];
        }),
      );
      this.port.post({ t: "state", state: { ...this.state, plugins } });
    };
    this.frame = frame;
    this.scheduleFrame(frame);
  }
  private log(text: string, tone: "info" | "refused" | "error" = "info") {
    this.state.log.unshift({ at: Date.now(), text, tone });
    this.state.log.length = Math.min(this.state.log.length, 40);
    this.changed();
  }
  private toast(plugin: string, toast: HubToast) {
    const id = ++this.seq;
    this.state.toasts.push({ id, plugin, ...toast });
    this.changed();
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.state.toasts = this.state.toasts.filter((t) => t.id !== id);
      this.changed();
    }, 3800);
    this.timers.add(timer);
  }

  register(manifest: unknown, script: string, bytes: number) {
    const parsed = parseManifest(manifest);
    if (this.state.plugins[parsed.id]) throw new Error(`Duplicate plugin ${parsed.id}`);
    this.state.plugins[parsed.id] = {
      manifest: parsed,
      script,
      bytes,
      enabled: true,
      status: "stopped",
      items: [],
      hud: {},
      subscriptions: [],
      settings: Object.fromEntries((parsed.settings ?? []).map((s) => [s.key, s.default])),
    };
    this.changed();
    if (parsed.activation.includes("game")) void this.ensureStarted(parsed.id);
  }

  ensureStarted(id: string): Promise<boolean> {
    const p = this.state.plugins[id];
    if (!p?.enabled) return Promise.resolve(false);
    const current = this.running.get(id);
    if (current) return current.ready;
    p.status = "starting";
    p.crashReason = undefined;
    const t0 = performance.now();
    const worker = this.createWorker(p.script, id);
    let settleReady: (ready: boolean) => void = () => {};
    const ready = new Promise<boolean>((resolve) => {
      settleReady = resolve;
    });
    const entry: Running = {
      worker,
      lastPong: t0,
      ready,
      settleReady,
      tokens: new Map(),
      requests: new Map(),
      commands: new Map(),
    };
    this.running.set(id, entry);
    worker.listen(
      (message) => {
        // An old worker cannot restore UI or resolve a replacement worker's requests.
        if (this.running.get(id) !== entry) return;
        entry.lastPong = performance.now();
        if (message.t === "ready") {
          p.status = "running";
          p.startMs = Math.round(performance.now() - t0);
          settleReady(true);
        }
        void this.onMessage(id, entry, message);
      },
      (message) => {
        if (this.running.get(id) === entry) this.log(`${p.manifest.name}: ${message}`, "error");
      },
    );
    this.send(id, { t: "init", manifest: p.manifest, settings: { ...p.settings } });
    this.changed();
    return ready;
  }

  stopPlugin(id: string, reason?: string) {
    const r = this.running.get(id);
    const p = this.state.plugins[id];
    if (!p) return;
    this.running.delete(id);
    r?.worker.terminate();
    r?.settleReady(false);
    for (const resolve of r?.requests.values() ?? []) resolve([]);
    for (const resolve of r?.commands.values() ?? []) resolve();
    for (const action of this.actions.values())
      if (action.pluginId === id)
        action.resolve({ status: "failed", message: "The plugin stopped." });
    p.items = [];
    p.hud = {};
    p.subscriptions = [];
    for (const [viewId, v] of Object.entries(this.state.views))
      if (v.pluginId === id) delete this.state.views[viewId];
    delete this.state.queryResults[id];
    p.status = reason ? "crashed" : "stopped";
    p.crashReason = reason;
    if (reason) {
      const recent = (this.crashes.get(id) ?? []).filter((at) => Date.now() - at < 600000);
      recent.push(Date.now());
      this.crashes.set(id, recent);
      if (recent.length >= 3) p.enabled = false;
    }
    this.changed();
  }

  private setEnabled(id: string, enabled: boolean) {
    const p = this.state.plugins[id];
    if (!p) return;
    p.enabled = enabled;
    if (!enabled) this.stopPlugin(id);
    else {
      this.crashes.delete(id);
      if (p.manifest.activation.includes("game")) void this.ensureStarted(id);
      this.changed();
    }
  }
  private send(id: string, message: ToPlugin) {
    this.running.get(id)?.worker.postMessage(message);
  }
  private grantActivation(id: string) {
    const token = crypto.randomUUID();
    const tokens = this.running.get(id)?.tokens;
    if (tokens) {
      for (const [old, at] of tokens) if (performance.now() - at > 3000) tokens.delete(old);
      tokens.set(token, performance.now());
    }
    return token;
  }
  private publish(id: string, slice: Slice) {
    const p = this.state.plugins[id]!;
    const value: Observed<unknown> = p.manifest.permissions.includes(`game.${slice}`)
      ? this.facts[slice]
      : { ok: false, reason: "not-permitted" };
    this.send(id, { t: "slice", slice, value });
  }

  private async gameAction(
    id: string,
    r: Running,
    op: "game.loadBuild" | "game.travel",
    args: unknown,
    token: string | null,
  ): Promise<ActionResult> {
    const p = this.state.plugins[id]!;
    const refuse = (
      reason: "not-permitted" | "needs-user-action" | "busy",
      message: string,
    ): ActionResult => {
      this.log(`Refused ${op} from ${p.manifest.name}: ${reason}`, "refused");
      return { status: "refused", reason, message };
    };
    const permission = op === "game.loadBuild" ? "game.builds.load" : "game.travel";
    const issued = token ? r.tokens.get(token) : undefined;
    if (token) r.tokens.delete(token);
    if (!p.manifest.permissions.includes(permission))
      return refuse("not-permitted", `${p.manifest.name} did not declare ${permission}.`);
    if (issued === undefined || performance.now() - issued > 3000)
      return refuse(
        "needs-user-action",
        "Game actions must start from your own click or key press.",
      );
    if (this.busy.has(op)) return refuse("busy", "Another request of this kind is running.");
    this.busy.add(op);
    const requestId = ++this.seq;
    try {
      const result = await new Promise<ActionResult>((resolve) => {
        this.actions.set(requestId, { pluginId: id, resolve });
        this.port.post({ t: "gameAction", requestId, op, args });
      });
      if (result.status === "done") {
        this.state.gameActions.unshift(
          `${new Date().toLocaleTimeString()} ${op} by ${p.manifest.name}`,
        );
        this.log(`${op} from ${p.manifest.name}: done`);
      } else if (result.status === "refused")
        this.log(`Refused ${op} from ${p.manifest.name}: ${result.reason}`, "refused");
      return result;
    } finally {
      this.actions.delete(requestId);
      this.busy.delete(op);
    }
  }

  private async onMessage(id: string, r: Running, message: ToHost) {
    const p = this.state.plugins[id]!;
    switch (message.t) {
      case "subscribe":
        if (!p.subscriptions.includes(message.slice)) p.subscriptions.push(message.slice);
        this.publish(id, message.slice);
        break;
      case "items":
        p.items = message.items;
        break;
      case "hud":
        p.hud[message.id] = message.node;
        break;
      case "view":
        this.state.views[message.viewId] = { pluginId: id, view: message.view };
        break;
      case "commandDone":
        r.commands.get(message.opId)?.();
        r.commands.delete(message.opId);
        break;
      case "queryResult":
        r.requests.get(message.reqId)?.(message.items);
        r.requests.delete(message.reqId);
        break;
      case "error":
        this.log(`${p.manifest.name}: ${message.message}`, "error");
        break;
      case "request": {
        let value: unknown;
        if (message.op === "game.loadBuild" || message.op === "game.travel")
          value = await this.gameAction(id, r, message.op, message.args, message.activation);
        else if (message.op === "doc.read" || message.op === "doc.write") {
          const args = message.args;
          if (
            !args ||
            typeof args !== "object" ||
            !("name" in args) ||
            typeof args.name !== "string"
          )
            throw new Error("Invalid document request");
          const key = `moxi:doc:${id}:${args.name}`;
          if (message.op === "doc.read") {
            const raw = this.documents.getItem(key);
            value = raw ? JSON.parse(raw) : null;
          } else if ("value" in args) this.documents.setItem(key, JSON.stringify(args.value));
        } else if (message.op === "toast") {
          const args = message.args;
          if (
            args &&
            typeof args === "object" &&
            "title" in args &&
            typeof args.title === "string"
          ) {
            const toast: HubToast = { title: args.title };
            if ("message" in args && typeof args.message === "string") toast.message = args.message;
            if (
              "tone" in args &&
              (args.tone === "positive" || args.tone === "danger" || args.tone === "default")
            )
              toast.tone = args.tone;
            this.toast(p.manifest.name, toast);
          }
        }
        if (this.running.get(id) === r) this.send(id, { t: "result", reqId: message.reqId, value });
        break;
      }
    }
    if (message.t !== "pong") this.changed();
  }

  private async runCommand(id: string, commandId: string): Promise<string | null> {
    const session = this.hubSession;
    if (!(await this.ensureStarted(id)) || session !== this.hubSession || !this.hubOpen)
      return null;
    const r = this.running.get(id);
    if (!r) return null;
    const opId = ++this.seq;
    const viewId = `view:${id}:${opId}`;
    const done = new Promise<void>((resolve) => r.commands.set(opId, resolve));
    this.send(id, {
      t: "command",
      opId,
      id: commandId,
      viewId,
      activation: this.grantActivation(id),
    });
    await done;
    if (session !== this.hubSession || !this.hubOpen) {
      this.closeView(viewId);
      return null;
    }
    return this.state.views[viewId] ? viewId : null;
  }
  private invoke(id: string, surface: string, target: string, args?: unknown[], grant = true) {
    this.send(id, {
      t: "invoke",
      viewId: surface,
      target,
      activation: grant ? this.grantActivation(id) : "",
      args,
    });
  }
  private closeView(viewId: string) {
    const view = this.state.views[viewId];
    if (!view) return;
    this.send(view.pluginId, { t: "closeView", viewId });
    delete this.state.views[viewId];
    this.changed();
  }
  private async query(text: string, scope: string | null) {
    const gen = ++this.queryGen;
    const ids = Object.values(this.state.plugins)
      .filter((p) => p.enabled && p.manifest.activation.includes("hub"))
      .map((p) => p.manifest.id);
    await Promise.all(
      ids.map(async (id) => {
        if (!(await this.ensureStarted(id)) || gen !== this.queryGen || !this.hubOpen) return;
        const r = this.running.get(id);
        if (!r) return;
        const reqId = ++this.seq;
        const items = await new Promise<WireItem[]>((resolve) => {
          r.requests.set(reqId, resolve);
          this.send(id, { t: "query", reqId, text, scope });
        });
        if (gen === this.queryGen && this.hubOpen && this.running.get(id) === r) {
          if (this.state.queryFor?.text !== text || this.state.queryFor.scope !== scope) {
            this.state.queryResults = {};
            this.state.queryFor = { text, scope };
          }
          this.state.queryResults[id] = items;
          this.changed();
        }
      }),
    );
  }
  dispose() {
    if (this.disposed) return;
    this.hubOpen = false;
    this.hubSession++;
    this.queryGen++;
    clearInterval(this.watchdog);
    for (const timer of this.timers) clearTimeout(timer);
    for (const id of this.running.keys()) this.stopPlugin(id);
    this.state.views = {};
    this.state.toasts = [];
    this.state.queryResults = {};
    this.state.queryFor = null;
    this.disposed = true;
  }
}
