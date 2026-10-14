// Runtime prototype for PB1/PB4: Vue runtime-core custom renderer that emits flat ops
// (R7 3.2/3.3), handler de-duplication, signs freed on removal, one factory call per session.
import {
  createRenderer,
  h,
  ref,
  shallowRef,
  computed,
  watchEffect,
  defineComponent,
  nextTick,
  Fragment,
  triggerRef,
} from "@vue/runtime-core";

const OP = {
  CREATE: 1,
  CREATE_TEXT: 2,
  INSERT: 3,
  REMOVE: 4,
  SET_PROP: 5,
  SET_EVENT: 6,
  SET_TEXT: 7,
  SET_ELEMENT_TEXT: 8,
  ITEMS: 9,
};
const VUE = { h, ref, shallowRef, computed, watchEffect, defineComponent, nextTick, Fragment, triggerRef };
let nextId = 1;

class HostNode {
  constructor(type) {
    this.id = nextId++;
    this.type = type;
    this.parent = null;
    this.children = [];
    this.signs = null;
  }
}

function freeSigns(node, handlers) {
  if (node.signs) for (const key in node.signs) handlers.delete(node.signs[key]);
  if (node.rows) for (const row of node.rows.values()) for (const sign of row.signs) handlers.delete(sign);
  for (let i = 0; i < node.children.length; i++) freeSigns(node.children[i], handlers);
}

// Collections are data: a keyed diff by id turns `items` into one ITEMS patch (5.2).
// Functions inside a row (actions' run) stay here; the wire carries { $fn: sign }.
function toWire(value, signs, state, s) {
  if (typeof value === "function") {
    const k = state.k++;
    let sign = signs[k];
    if (sign === undefined) sign = signs[k] = s.nextSign++;
    s.handlers.set(sign, value);
    return { $fn: sign };
  }
  if (Array.isArray(value)) return value.map((v) => toWire(v, signs, state, s));
  if (value && typeof value === "object") {
    const out = {};
    for (const key in value) {
      const v = value[key];
      if (v !== undefined) out[key] = toWire(v, signs, state, s);
    }
    return out;
  }
  return value;
}

function patchItems(el, next, s) {
  const rows = el.rows || (el.rows = new Map());
  const previousOrder = el.order || [];
  const ids = [];
  const upserts = [];
  const seen = new Set();
  for (const row of next || []) {
    ids.push(row.id);
    seen.add(row.id);
    const current = rows.get(row.id) || { json: "", signs: [] };
    const state = { k: 0 };
    const wire = toWire(row, current.signs, state, s);
    for (let i = state.k; i < current.signs.length; i++) s.handlers.delete(current.signs[i]);
    current.signs.length = state.k;
    const json = JSON.stringify(wire);
    if (json !== current.json) {
      current.json = json;
      upserts.push(wire);
    }
    rows.set(row.id, current);
  }
  const removes = [];
  for (const [id, row] of rows) {
    if (seen.has(id)) continue;
    for (const sign of row.signs) s.handlers.delete(sign);
    rows.delete(id);
    removes.push(id);
  }
  // Order is sent only when it is not "survivors in old order, then new rows".
  const expected = previousOrder.filter((id) => seen.has(id));
  const known = new Set(previousOrder);
  for (const id of ids) if (!known.has(id)) expected.push(id);
  let reorder = expected.length !== ids.length;
  for (let i = 0; !reorder && i < ids.length; i++) reorder = expected[i] !== ids[i];
  el.order = ids;
  return upserts.length || removes.length || reorder ? [OP.ITEMS, el.id, upserts, removes, reorder ? ids : null] : null;
}

function createSession(sid, post) {
  const s = {
    sid,
    ops: [],
    handlers: new Map(),
    nextSign: 1,
    inflight: false,
    scheduled: false,
    closed: false,
    seq: 0,
    apps: [],
    closers: [],
    ack() {
      s.inflight = false;
      flush(s);
    },
  };
  const touch = () => {
    if (s.scheduled) return;
    s.scheduled = true;
    queueMicrotask(() => {
      s.scheduled = false;
      flush(s);
    });
  };
  s.post = post;
  const ops = () => s.ops;
  const nodeOps = {
    createElement(tag) {
      const n = new HostNode(tag);
      ops().push(OP.CREATE, n.id, tag);
      touch();
      return n;
    },
    createText(text) {
      const n = new HostNode("#text");
      ops().push(OP.CREATE_TEXT, n.id, text);
      touch();
      return n;
    },
    createComment() {
      const n = new HostNode("#comment");
      ops().push(OP.CREATE_TEXT, n.id, "");
      touch();
      return n;
    },
    setText(n, text) {
      ops().push(OP.SET_TEXT, n.id, text);
      touch();
    },
    setElementText(n, text) {
      for (let i = 0; i < n.children.length; i++) freeSigns(n.children[i], s.handlers);
      n.children = [];
      ops().push(OP.SET_ELEMENT_TEXT, n.id, text);
      touch();
    },
    insert(child, parent, anchor) {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      const i = anchor ? parent.children.indexOf(anchor) : parent.children.length;
      parent.children.splice(i, 0, child);
      child.parent = parent;
      ops().push(OP.INSERT, parent.id, child.id, anchor ? anchor.id : 0);
      touch();
    },
    remove(child) {
      const p = child.parent;
      if (!p) return;
      p.children.splice(p.children.indexOf(child), 1);
      child.parent = null;
      freeSigns(child, s.handlers);
      ops().push(OP.REMOVE, child.id);
      touch();
    },
    parentNode: (n) => n.parent,
    nextSibling(n) {
      const p = n.parent;
      return p ? (p.children[p.children.indexOf(n) + 1] ?? null) : null;
    },
    patchProp(el, key, prev, next) {
      if (key === "items") {
        const patch = patchItems(el, next, s);
        if (patch) {
          ops().push(...patch);
          touch();
        }
        return;
      }
      if (key.length > 2 && key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && key.charCodeAt(2) < 91) {
        // onXxx: the function stays here; only a stable number crosses the boundary
        const name = key.slice(2).toLowerCase();
        if (next) {
          el.signs = el.signs || {};
          let sign = el.signs[key];
          const first = sign === undefined;
          if (first) sign = el.signs[key] = s.nextSign++;
          s.handlers.set(sign, next);
          if (first) ops().push(OP.SET_EVENT, el.id, name, sign);
        } else if (el.signs && el.signs[key] !== undefined) {
          s.handlers.delete(el.signs[key]);
          delete el.signs[key];
          ops().push(OP.SET_EVENT, el.id, name, 0);
        }
        touch();
        return;
      }
      if (prev === next) return;
      ops().push(OP.SET_PROP, el.id, key, next);
      touch();
    },
  };
  s.renderer = createRenderer(nodeOps);
  s.root = () => {
    const n = new HostNode("root");
    ops().push(OP.CREATE, n.id, "root");
    return n;
  };
  return s;
}

function flush(s) {
  if (s.inflight || s.closed || s.ops.length === 0) return;
  const ops = s.ops;
  s.ops = [];
  s.inflight = true;
  s.post({ t: "ops", sid: s.sid, seq: ++s.seq, ops });
}

globalThis.__moxiBoot = function __moxiBoot(factory) {
  const sessions = new Map();
  const post = (m) => self.postMessage(m);
  self.onmessage = (event) => {
    const m = event.data;
    if (m.t === "open") {
      const t0 = performance.now();
      const s = createSession(m.sid, post);
      sessions.set(m.sid, s);
      const definition = factory({
        vue: VUE,
        sid: m.sid,
        onClose: (fn) => s.closers.push(fn),
      });
      for (const name in definition.views) {
        const app = s.renderer.createApp(definition.views[name]);
        app.config.errorHandler = (error) => post({ t: "error", sid: m.sid, message: String(error) });
        app.mount(s.root());
        s.apps.push(app);
      }
      post({ t: "opened", sid: m.sid, ms: performance.now() - t0 });
    } else if (m.t === "heap") {
      // Diagnostic only (PB1 growth check).
      const pm = performance.memory;
      post({ t: "heap", used: pm ? pm.usedJSHeapSize : -1, total: pm ? pm.totalJSHeapSize : -1 });
    } else if (m.t === "gc") {
      const ok = typeof gc === "function";
      if (ok) gc();
      post({ t: "gced", ok });
    } else if (m.t === "ack") {
      const s = sessions.get(m.sid);
      if (s) s.ack();
    } else if (m.t === "close") {
      const s = sessions.get(m.sid);
      if (!s) return;
      s.closed = true;
      for (const fn of s.closers) fn();
      for (const app of s.apps) app.unmount();
      sessions.delete(m.sid);
      post({ t: "closed", sid: m.sid });
    }
  };
  __moxiBoot.stats = () => ({
    sessions: sessions.size,
    handlers: [...sessions.values()].map((s) => s.handlers.size),
  });
  post({ t: "ready", evalMs: performance.now() });
};
