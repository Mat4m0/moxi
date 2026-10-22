// Flat-ops custom renderer for @vue/runtime-core (R7 3.2 recipe), extended for several sessions in one realm.
//
// mode "rooted": a node belongs to the root it is attached to; ops go to that root's own buffer and ids,
//                event signs and handlers are per root. This is the "batch per (session, root)" fix.
// mode "global": one buffer, one id counter and one handler table for the whole worker, as in R7's
//                renderer. Kept only as the naive baseline that shows what the shared scheduler does to it.
//
// Detached nodes emit nothing. A subtree is serialized in one go when it is inserted into an attached
// parent, so the root of every op is known when the op is written.
import { createRenderer, queuePostFlushCb } from "@vue/runtime-core";

export const OP = {
  CREATE: 1,
  CREATE_TEXT: 2,
  INSERT: 3,
  REMOVE: 4,
  SET_PROP: 5,
  SET_EVENT: 6,
  SET_TEXT: 7,
  SET_ELEMENT_TEXT: 8,
  RESET: 9, // host drops the whole root tree; a full snapshot follows
};

class RNode {
  constructor(kind, tag, text) {
    this.kind = kind; // "el" | "text"
    this.tag = tag;
    this.text = text;
    this.parent = null;
    this.children = [];
    this.root = null; // owning Root while attached
    this.id = 0;
    this.props = {};
    this.events = null; // name -> { fn, sign }
    this.elText = null;
  }
}

class Root {
  constructor(sid, name, buffer) {
    this.sid = sid;
    this.name = name;
    this.buffer = buffer ?? this; // the Root whose ids, signs, handlers and ops this root uses
    this.nextId = 1;
    this.nextSign = 1;
    this.handlers = new Map(); // sign -> { fn, sign }
    this.ops = [];
    this.dirty = false;
    this.discard = false; // session closing: drop ops
    this.held = false; // a render error happened in this flush: keep the host's last good tree
    this.stale = false; // the host's tree is behind the shadow tree: next send is a full snapshot
    this.seq = 0;
    this.triggerSid = null;
    this.node = null; // container node
  }
}

export function createOpsRenderer({ mode = "rooted", holdOnError = false, post }) {
  const globalBuffer = mode === "global" ? new Root(null, "global", null) : null;
  const dirty = new Set();
  let scheduled = false;

  const bufferOf = (root) => (globalBuffer ?? root).buffer;

  function mark(root) {
    const b = bufferOf(root);
    if (globalBuffer && b.triggerSid === null) b.triggerSid = root.sid;
    if (!b.dirty) {
      b.dirty = true;
      dirty.add(b);
    }
    if (!scheduled) {
      scheduled = true;
      queuePostFlushCb(flushAll);
    }
  }

  function push(root, ...ops) {
    const b = bufferOf(root);
    for (const o of ops) b.ops.push(o);
    mark(root);
  }

  function emitTree(node, out) {
    if (node.kind === "text") {
      out.push(OP.CREATE_TEXT, node.id, node.text);
      return;
    }
    out.push(OP.CREATE, node.id, node.tag);
    for (const k of Object.keys(node.props)) out.push(OP.SET_PROP, node.id, k, node.props[k]);
    if (node.events) for (const name of Object.keys(node.events)) out.push(OP.SET_EVENT, node.id, name, node.events[name].sign);
    if (node.elText !== null) out.push(OP.SET_ELEMENT_TEXT, node.id, node.elText);
    for (const c of node.children) {
      emitTree(c, out);
      out.push(OP.INSERT, node.id, c.id, 0);
    }
  }

  function flushAll() {
    scheduled = false;
    for (const b of dirty) {
      b.dirty = false;
      let ops = b.ops;
      b.ops = [];
      const triggerSid = b.triggerSid;
      b.triggerSid = null;
      if (b.discard) continue;
      if (b.held) {
        // Vue replaced the failed component with a comment; the host keeps its last good tree instead.
        b.held = false;
        b.stale = true;
        continue;
      }
      if (ops.length === 0) continue;
      if (b.stale) {
        ops = [OP.RESET];
        for (const c of b.node.children) {
          emitTree(c, ops);
          ops.push(OP.INSERT, 0, c.id, 0);
        }
        b.stale = false;
      }
      post({ t: "ops", sid: globalBuffer ? triggerSid : b.sid, root: b.name, seq: ++b.seq, ops });
    }
    dirty.clear();
  }

  function registerEvent(node, name, ev) {
    const b = bufferOf(node.root);
    ev.sign = b.nextSign++;
    b.handlers.set(ev.sign, ev);
    push(node.root, OP.SET_EVENT, node.id, name, ev.sign);
  }

  function materialize(node, root) {
    const b = bufferOf(root);
    node.root = root;
    node.id = b.nextId++;
    if (node.kind === "text") {
      push(root, OP.CREATE_TEXT, node.id, node.text);
      return;
    }
    push(root, OP.CREATE, node.id, node.tag);
    for (const k of Object.keys(node.props)) push(root, OP.SET_PROP, node.id, k, node.props[k]);
    if (node.events) for (const name of Object.keys(node.events)) registerEvent(node, name, node.events[name]);
    if (node.elText !== null) push(root, OP.SET_ELEMENT_TEXT, node.id, node.elText);
    for (const c of node.children) {
      materialize(c, root);
      push(root, OP.INSERT, node.id, c.id, 0);
    }
  }

  function dematerialize(node) {
    const b = bufferOf(node.root);
    if (node.events) for (const name of Object.keys(node.events)) b.handlers.delete(node.events[name].sign);
    for (const c of node.children) dematerialize(c);
    node.root = null;
    node.id = 0;
  }

  const nodeOps = {
    createElement: (tag) => new RNode("el", tag),
    createText: (text) => new RNode("text", null, text),
    createComment: () => new RNode("text", null, ""),
    setText(n, text) {
      n.text = text;
      if (n.root) push(n.root, OP.SET_TEXT, n.id, text);
    },
    setElementText(el, text) {
      for (const c of el.children) {
        if (c.root) dematerialize(c);
        c.parent = null;
      }
      el.children = [];
      el.elText = text;
      if (el.root) push(el.root, OP.SET_ELEMENT_TEXT, el.id, text);
    },
    insert(child, parent, anchor) {
      const wasAttached = child.root !== null;
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      const at = anchor ? parent.children.indexOf(anchor) : parent.children.length;
      parent.children.splice(at, 0, child);
      child.parent = parent;
      if (!parent.root) return;
      if (!wasAttached) materialize(child, parent.root);
      push(parent.root, OP.INSERT, parent.id, child.id, anchor ? anchor.id : 0);
    },
    remove(child) {
      const p = child.parent;
      if (!p) return;
      p.children.splice(p.children.indexOf(child), 1);
      child.parent = null;
      if (child.root) {
        push(child.root, OP.REMOVE, child.id);
        dematerialize(child);
      }
    },
    parentNode: (n) => n.parent,
    nextSibling(n) {
      const p = n.parent;
      return p ? (p.children[p.children.indexOf(n) + 1] ?? null) : null;
    },
    patchProp(el, key, prev, next) {
      if (/^on[A-Z]/.test(key)) {
        const name = key.slice(2).toLowerCase();
        const ev = el.events?.[name];
        if (next) {
          if (ev) ev.fn = next; // handler churn costs nothing across the boundary
          else {
            el.events ??= {};
            const created = (el.events[name] = { fn: next, sign: 0 });
            if (el.root) registerEvent(el, name, created);
          }
        } else if (ev) {
          if (el.root) {
            bufferOf(el.root).handlers.delete(ev.sign);
            push(el.root, OP.SET_EVENT, el.id, name, 0);
          }
          delete el.events[name];
        }
        return;
      }
      if (prev === next) return;
      el.props[key] = next ?? null;
      if (el.root) push(el.root, OP.SET_PROP, el.id, key, next ?? null);
    },
  };

  const { createApp } = createRenderer(nodeOps);

  return {
    createApp,
    createRoot(sid, name) {
      const root = new Root(sid, name, globalBuffer ?? undefined);
      const node = new RNode("el", "#root");
      node.root = root;
      node.id = 0;
      root.node = node;
      return root;
    },
    // called from app.config.errorHandler for a render-function error
    hold(root) {
      if (!holdOnError) return;
      bufferOf(root).held = true;
      mark(root); // the flush must see the flag even when this render produced no ops

    },
    handlerOf: (root, sign) => bufferOf(root).handlers.get(sign),
    handlerCount: (root) => bufferOf(root).handlers.size,
  };
}
