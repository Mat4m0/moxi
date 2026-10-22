// Main-thread side: start a worker from runtime + plugin text, apply op batches to per-root trees, RPC helpers.
import { Worker } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OP = { CREATE: 1, CREATE_TEXT: 2, INSERT: 3, REMOVE: 4, SET_PROP: 5, SET_EVENT: 6, SET_TEXT: 7, SET_ELEMENT_TEXT: 8, RESET: 9 };

export function workerSource({ plugin, mode = "prod", rendererMode = "rooted", hold = false, shareModule = false }) {
  const read = (p) => readFileSync(join(root, p), "utf8");
  return [
    read("src/worker-prelude.cjs"),
    `globalThis.__moxiRendererMode = ${JSON.stringify(rendererMode)};`,
    `globalThis.__moxiHold = ${hold};`,
    `globalThis.__moxiShareModule = ${shareModule};`,
    read(`dist/runtime-api1.${mode}.js`),
    "const __moxiBoot = __moxiRuntime.boot;",
    `__moxiBoot(function plugin(__moxi) {\n${read(`dist/plugins/${plugin}.factory.js`)}\n});`,
  ].join("\n");
}

class Tree {
  constructor() {
    this.nodes = new Map([[0, { id: 0, tag: "#root", props: {}, events: {}, children: [], parent: null }]]);
    this.errors = [];
  }
  get(id) {
    const n = this.nodes.get(id);
    if (!n) this.errors.push(`unknown node ${id}`);
    return n;
  }
  detach(n) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    n.parent = null;
  }
  drop(n) {
    for (const c of n.children) this.drop(c);
    this.nodes.delete(n.id);
  }
  apply(ops) {
    for (let i = 0; i < ops.length; ) {
      switch (ops[i]) {
        case OP.CREATE:
          this.nodes.set(ops[i + 1], { id: ops[i + 1], tag: ops[i + 2], props: {}, events: {}, children: [], parent: null });
          i += 3;
          break;
        case OP.CREATE_TEXT:
          this.nodes.set(ops[i + 1], { id: ops[i + 1], tag: "#text", text: ops[i + 2], props: {}, events: {}, children: [], parent: null });
          i += 3;
          break;
        case OP.INSERT: {
          const p = this.get(ops[i + 1]), c = this.get(ops[i + 2]);
          if (p && c) {
            this.detach(c);
            const a = ops[i + 3] ? this.get(ops[i + 3]) : null;
            const at = a ? p.children.indexOf(a) : p.children.length;
            p.children.splice(at, 0, c);
            c.parent = p;
          }
          i += 4;
          break;
        }
        case OP.REMOVE: {
          const n = this.get(ops[i + 1]);
          if (n) {
            this.detach(n);
            this.drop(n);
          }
          i += 2;
          break;
        }
        case OP.SET_PROP: {
          const n = this.get(ops[i + 1]);
          if (n) n.props[ops[i + 2]] = ops[i + 3];
          i += 4;
          break;
        }
        case OP.SET_EVENT: {
          const n = this.get(ops[i + 1]);
          if (n) {
            if (ops[i + 3]) n.events[ops[i + 2]] = ops[i + 3];
            else delete n.events[ops[i + 2]];
          }
          i += 4;
          break;
        }
        case OP.SET_TEXT: {
          const n = this.get(ops[i + 1]);
          if (n) n.text = ops[i + 2];
          i += 3;
          break;
        }
        case OP.SET_ELEMENT_TEXT: {
          const n = this.get(ops[i + 1]);
          if (n) {
            for (const c of n.children) this.drop(c);
            n.children = [];
            n.elText = ops[i + 2];
          }
          i += 3;
          break;
        }
        case OP.RESET: {
          const rootNode = this.nodes.get(0);
          for (const c of rootNode.children) this.drop(c);
          rootNode.children = [];
          i += 1;
          break;
        }
        default:
          this.errors.push(`bad op ${ops[i]} at ${i}`);
          return;
      }
    }
  }
  walk(fn, n = this.nodes.get(0)) {
    fn(n);
    for (const c of n.children) this.walk(fn, c);
  }
  // visible strings in tree order: `text` props of ui-* elements and text nodes
  texts() {
    const out = [];
    this.walk((n) => {
      if (n.props.text !== undefined && n.props.text !== null) out.push(String(n.props.text));
      else if (n.tag === "#text" && n.text) out.push(n.text);
      else if (n.elText) out.push(n.elText);
    });
    return out;
  }
  button(label) {
    let sign = 0;
    this.walk((n) => {
      if (n.tag === "ui-button" && n.props.label === label) sign = n.events.press ?? 0;
    });
    return sign;
  }
  count() {
    return this.nodes.size - 1;
  }
}

export class Pb6Worker {
  constructor(opts) {
    this.trees = new Map(); // "sid/root" -> Tree
    this.batches = [];
    this.errors = [];
    this.uncaught = [];
    this.consoleErrors = [];
    this.consoleWarns = [];
    this.batchTimes = [];
    this.exited = null;
    this.waiters = new Map();
    this.nextWait = 1;
    this.worker = new Worker(workerSource(opts), {
      eval: true,
      workerData: { emulateChromium: opts.emulateChromium ?? true, skipScopeStop: opts.skipScopeStop ?? false, light: opts.light ?? false },
    });
    this.readyP = new Promise((res) => (this.onReady = res));
    this.worker.on("message", (m) => this.onMessage(m));
    this.worker.on("error", (e) => (this.uncaught.push(`worker error event: ${e?.message ?? e}`), (this.exited = "error")));
    this.worker.on("exit", (code) => {
      this.exited ??= `exit ${code}`;
      for (const w of this.waiters.values()) w.rej(new Error(`worker exited (${this.exited}) while waiting`));
      this.waiters.clear();
    });
  }
  onMessage(m) {
    switch (m.t) {
      case "ready":
        this.onReady();
        break;
      case "ops": {
        const key = `${m.sid}/${m.root}`;
        let tree = this.trees.get(key);
        if (!tree) this.trees.set(key, (tree = new Tree()));
        tree.apply(m.ops);
        this.batches.push({ sid: m.sid, root: m.root, seq: m.seq, n: m.ops.length });
        this.batchTimes.push({ sid: m.sid, root: m.root, at: performance.now() });
        break;
      }
      case "error":
        this.errors.push(m);
        break;
      case "console":
        this.consoleErrors.push(m.text);
        break;
      case "console-warn":
        this.consoleWarns.push(m.text);
        break;
      case "uncaught":
      case "unhandled":
        this.uncaught.push(`${m.t}: ${m.message}`);
        break;
      default: {
        const key = m.t === "synced" ? `sync${m.id}` : m.t === "heap" ? `heap${m.tag}` : m.t;
        const w = this.waiters.get(key);
        if (w) {
          this.waiters.delete(key);
          w.res(m);
        }
      }
    }
  }
  wait(key) {
    return new Promise((res, rej) => this.waiters.set(key, { res, rej }));
  }
  post(m) {
    this.worker.postMessage(m);
  }
  ready() {
    return this.readyP;
  }
  async sync() {
    const id = this.nextWait++;
    const p = this.wait(`sync${id}`);
    this.post({ t: "sync", id });
    await p;
  }
  async heap(tag = "h") {
    const p = this.wait(`heap${tag}`);
    this.post({ t: "heap", tag });
    return p;
  }
  async weak() {
    const p = this.wait("weak");
    this.post({ t: "weak" });
    return p;
  }
  async counters() {
    const p = this.wait("counters");
    this.post({ t: "counters" });
    return p;
  }
  async open(sid, facts) {
    this.post({ t: "open", sid, facts });
    await this.sync();
  }
  async fact(sid, id, value) {
    this.post({ t: "fact", sid, id, value });
    await this.sync();
  }
  async close(sid) {
    this.post({ t: "close", sid });
    await this.sync();
    for (const k of [...this.trees.keys()]) if (k.startsWith(`${sid}/`)) this.trees.delete(k);
  }
  // several messages delivered in one worker task (one scheduler flush)
  multi(msgs) {
    this.post({ t: "multi", msgs });
  }
  tree(sid, root = "cmd:main") {
    return this.trees.get(`${sid}/${root}`);
  }
  texts(sid, root = "cmd:main") {
    return this.tree(sid, root)?.texts() ?? [];
  }
  // press a button by label; resolves after the flush it causes
  async press(sid, label, root = "cmd:main") {
    const sign = this.tree(sid, root)?.button(label) ?? 0;
    if (!sign) throw new Error(`no button ${label} in ${sid}/${root}`);
    this.post({ t: "event", sid, root, sign, payload: null });
    await this.sync();
  }
  batchesFor(sid) {
    return this.batches.filter((b) => b.sid === sid);
  }
  async terminate() {
    await this.worker.terminate();
  }
}
