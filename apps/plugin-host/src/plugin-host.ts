import { type DocumentChange, type DocumentRef, type Json } from "@moxi/contracts";
import type { DocumentPort } from "./documents.ts";
import { emptyHubState, parseManifest } from "@moxi/sdk/host";
import { pluginLimits, readWorkerMessage, type WorkerMessage } from "./worker-messages.ts";
import type { HostPort, HubState, HubToast, ToPlugin, WireItem } from "@moxi/sdk/host";
import type { ActionResult, Observed, Slice } from "@moxi/sdk";

export type PluginWorker = {
  postMessage(message: ToPlugin): void;
  listen(handler: (message: unknown) => void, onError: (message: string) => void): void;
  terminate(): void;
};
type Running = {
  worker: PluginWorker;
  lastPong: number;
  ready: Promise<boolean>;
  settleReady: (ready: boolean) => void;
  tokens: Map<string, number>;
  query?: { reqId: number; resolve: (items: WireItem[]) => void };
  views: Set<string>;
  messages: number[];
  commands: Map<number, { resolve: () => void; viewId: string }>;
  documents: Map<string, { value: Json; revision: number }>;
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
  private unsubscribeDocuments: () => void;
  private watchdog: ReturnType<typeof setInterval>;

  constructor(
    private port: HostPort,
    private createWorker: (script: string, id: string) => PluginWorker,
    private documents: DocumentPort,
    private scheduleFrame: (callback: () => void) => void = (callback) => {
      requestAnimationFrame(callback);
    },
  ) {
    this.unsubscribeDocuments = documents.onChange((change) => this.documentChanged(change));
    port.onClose?.(() => this.dispose());
    port.listen((message) => {
      if (this.disposed) return;
      switch (message.t) {
        case "openHub":
          this.hubOpen = true;
          this.hubSession++;
          this.queryGen++;
          this.cancelQueries();
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
          this.cancelQueries();
          this.state.queryResults = {};
          this.state.queryFor = null;
          for (const viewId of Object.keys(this.state.views)) this.closeView(viewId);
          for (const r of this.running.values()) r.views.clear();
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
          {
            const r = this.running.get(message.pluginId);
            if (!r) break;
            if (
              !message.viewId.startsWith(`view:${message.pluginId}:`) ||
              this.state.views[message.viewId] ||
              r.views.has(message.viewId)
            )
              break;
            if (r.views.size >= pluginLimits.views) {
              this.crashPlugin(message.pluginId, "Opened too many views");
              break;
            }
            r.views.add(message.viewId);
            this.invoke(message.pluginId, message.surface, message.target, [message.viewId]);
          }
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

  /** `off` holds the plugin ids the player switched off in Tools; those start disabled. */
  register(manifest: unknown, script: string, bytes: number, off: ReadonlySet<string> = new Set()) {
    const parsed = parseManifest(manifest);
    if (this.state.plugins[parsed.id]) throw new Error(`Duplicate plugin ${parsed.id}`);
    this.state.plugins[parsed.id] = {
      manifest: parsed,
      script,
      bytes,
      enabled: !off.has(parsed.id),
      status: "stopped",
      items: [],
      hud: {},
      subscriptions: [],
      settings: Object.fromEntries((parsed.settings ?? []).map((s) => [s.key, s.default])),
    };
    this.changed();
    if (!off.has(parsed.id) && parsed.activation.includes("game"))
      void this.ensureStarted(parsed.id);
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
      views: new Set(),
      messages: [],
      commands: new Map(),
      documents: new Map(),
    };
    this.running.set(id, entry);
    worker.listen(
      (value) => {
        // An old worker cannot restore UI or resolve a replacement worker's requests.
        if (this.running.get(id) !== entry) return;
        const now = performance.now();
        while (entry.messages.length && now - entry.messages[0]! >= 1000) entry.messages.shift();
        if (entry.messages.length >= pluginLimits.messagesPerSecond) {
          this.crashPlugin(id, "Sent too many messages in one second");
          return;
        }
        entry.messages.push(now);
        const message = readWorkerMessage(value);
        if (!message) {
          this.crashPlugin(id, "Sent an invalid or oversized message");
          return;
        }
        entry.lastPong = now;
        if (message.t === "ready") {
          p.status = "running";
          p.startMs = Math.round(performance.now() - t0);
          settleReady(true);
        }
        void this.onMessage(id, entry, message).catch(() => {
          if (this.running.get(id) === entry) this.crashPlugin(id, "Could not handle its message");
        });
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
    if (r) this.settleQuery(r);
    for (const command of r?.commands.values() ?? []) command.resolve();
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
      // Runtime only: the player's Tools switch is not changed, and switching the plugin on
      // again from there clears this.
      if (recent.length >= 3) p.enabled = false;
    }
    this.changed();
  }

  private crashPlugin(id: string, reason: string) {
    this.log(`${this.state.plugins[id]!.manifest.name}: ${reason}`, "error");
    this.stopPlugin(id, reason);
  }
  private settleQuery(r: Running) {
    const query = r.query;
    delete r.query;
    query?.resolve([]);
  }
  private cancelQueries() {
    for (const r of this.running.values()) this.settleQuery(r);
  }

  /** The player switched a plugin on or off in Tools. */
  setEnabled(id: string, enabled: boolean) {
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

  private async onMessage(id: string, r: Running, message: WorkerMessage) {
    const p = this.state.plugins[id]!;
    switch (message.t) {
      case "subscribe":
        if (!p.subscriptions.includes(message.slice)) p.subscriptions.push(message.slice);
        this.publish(id, message.slice);
        break;
      case "items":
        if (!this.acceptItems(id, message.items.length, "items")) return;
        p.items = message.items;
        break;
      case "hud":
        if (
          message.node !== null &&
          !Object.hasOwn(p.hud, message.id) &&
          Object.keys(p.hud).length >= pluginLimits.hudWidgets
        ) {
          this.crashPlugin(id, "Created too many HUD widgets");
          return;
        }
        if (message.node === null) delete p.hud[message.id];
        else p.hud = { ...p.hud, [message.id]: message.node };
        break;
      case "view":
        if (!message.viewId.startsWith(`view:${id}:`)) {
          this.crashPlugin(id, "Tried to change a view it does not own");
          return;
        }
        // A render in flight when its view closes must not revive it or crash the worker.
        if (!r.views.has(message.viewId)) return;
        if (
          !this.acceptItems(
            id,
            message.view.type === "list" ? message.view.items.length : 0,
            message.viewId,
          )
        )
          return;
        this.state.views[message.viewId] = { pluginId: id, view: message.view };
        break;
      case "commandDone": {
        const command = r.commands.get(message.opId);
        if (command) {
          if (!this.state.views[command.viewId]) r.views.delete(command.viewId);
          r.commands.delete(message.opId);
          command.resolve();
        }
        break;
      }
      case "queryResult":
        if (r.query?.reqId === message.reqId) {
          if (!this.acceptItems(id, message.items.length, "query")) return;
          const query = r.query;
          delete r.query;
          query.resolve(message.items);
        }
        break;
      case "error":
        this.log(`${p.manifest.name}: ${message.message}`, "error");
        break;
      case "request": {
        let value: unknown;
        if (message.op === "game.loadBuild" || message.op === "game.travel")
          value = await this.gameAction(id, r, message.op, message.args, message.activation);
        else if (message.op === "doc.read" || message.op === "doc.write") {
          const ref: DocumentRef = {
            plugin: id,
            scope: "global",
            account: null,
            name: message.args.name,
          };
          try {
            if (message.op === "doc.read") {
              const stored = await this.documents.read(ref);
              // Hydrate through the reply; only document changes are pushed.
              if (stored) this.cacheDocument(r, ref.name, stored);
              value = r.documents.get(ref.name)?.value ?? null;
            } else {
              if (!r.documents.has(ref.name)) {
                const stored = await this.documents.read(ref);
                if (stored) this.cacheDocument(r, ref.name, stored);
              }
              const result = await this.documents.write({
                ref,
                value: message.args.value,
                expectedRevision: r.documents.get(ref.name)?.revision ?? 0,
              });
              if (!result.ok) {
                const current = await this.documents.read(ref);
                if (current) this.documentChanged({ ref, ...current });
                this.log(`${p.manifest.name}: the document changed in another session`, "refused");
              }
            }
          } catch {
            this.log(`${p.manifest.name}: the document could not be saved or read`, "error");
            value = null;
          }
        } else if (message.op === "toast") this.toast(p.manifest.name, message.args);
        if (this.running.get(id) === r) this.send(id, { t: "result", reqId: message.reqId, value });
        break;
      }
    }
    if (message.t !== "pong") this.changed();
  }

  private acceptItems(id: string, incoming: number, surface: string) {
    const p = this.state.plugins[id]!;
    let total = incoming;
    if (surface !== "items") total += p.items.length;
    if (surface !== "query") total += this.state.queryResults[id]?.length ?? 0;
    for (const [viewId, entry] of Object.entries(this.state.views)) {
      if (entry.pluginId === id && viewId !== surface && entry.view.type === "list")
        total += entry.view.items.length;
    }
    if (total <= pluginLimits.items) return true;
    this.crashPlugin(id, "Published too many items");
    return false;
  }

  private cacheDocument(r: Running, name: string, stored: { value: Json; revision: number }) {
    if (stored.revision < (r.documents.get(name)?.revision ?? 0)) return false;
    r.documents.set(name, stored);
    return true;
  }

  private documentChanged(change: DocumentChange) {
    if (this.disposed || change.ref.scope !== "global") return;
    const r = this.running.get(change.ref.plugin);
    if (
      !r ||
      !this.cacheDocument(r, change.ref.name, { value: change.value, revision: change.revision })
    )
      return;
    this.send(change.ref.plugin, { t: "doc", name: change.ref.name, value: change.value });
  }

  private async runCommand(id: string, commandId: string): Promise<string | null> {
    const session = this.hubSession;
    if (!(await this.ensureStarted(id)) || session !== this.hubSession || !this.hubOpen)
      return null;
    const r = this.running.get(id);
    if (!r) return null;
    const opId = ++this.seq;
    const viewId = this.issueView(id, r);
    if (!viewId) return null;
    const done = new Promise<void>((resolve) => r.commands.set(opId, { resolve, viewId }));
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
  private issueView(id: string, r: Running) {
    if (r.views.size >= pluginLimits.views) {
      this.crashPlugin(id, "Opened too many views");
      return null;
    }
    const viewId = `view:${id}:${++this.seq}`;
    r.views.add(viewId);
    return viewId;
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
    for (const [id, r] of this.running) {
      if (r.views.delete(viewId)) this.send(id, { t: "closeView", viewId });
    }
    const view = this.state.views[viewId];
    if (!view) return;
    delete this.state.views[viewId];
    this.changed();
  }
  async query(text: string, scope: string | null) {
    const gen = ++this.queryGen;
    this.cancelQueries();
    this.state.queryResults = {};
    this.state.queryFor = null;
    this.changed();
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
          r.query = { reqId, resolve };
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
    this.unsubscribeDocuments();
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
