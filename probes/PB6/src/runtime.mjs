// Prototype of the host-supplied runtime (D 3.3) with one plugin module instance per session (D 3.2).
// Bundled to dist/runtime-api1.*.js; the worker text is runtime + "\n" + __moxiBoot(function plugin(__moxi) {...}).
// Messages in:  open {sid, facts} | fact {sid, id, value} | event {sid, root, sign, payload} | close {sid}
// Messages out: ready | ops {sid, root, seq, ops} | error {sid, root, phase, message}
import * as Vue from "@vue/runtime-core";
import { createOpsRenderer } from "./ops-renderer.mjs";

const hooks = globalThis.__moxiTestHooks; // probe-only instrumentation; absent in a real worker
const SESSION_KEY = Symbol.for("moxi.session");

// A host component defined once in the runtime and used by every session of the install.
const Counter = Vue.defineComponent({
  props: { label: String },
  emits: ["bump"],
  setup(props, { emit, slots }) {
    const n = Vue.ref(0);
    return () =>
      Vue.h("ui-stack", null, [
        Vue.h("ui-text", { text: `${props.label}:${n.value}` }),
        Vue.h("ui-button", {
          label: "bump",
          onPress: () => {
            n.value++;
            emit("bump", n.value);
          },
        }),
        slots.default?.(),
      ]);
  },
});

const renderer = createOpsRenderer({
  mode: globalThis.__moxiRendererMode ?? "rooted",
  holdOnError: globalThis.__moxiHold === true,
  post: (m) => postMessage(m),
});
const sessions = new Map();
let factory = null;
let sharedDef = null; // probe-only control: the rejected "one shared module scope" variant (globalThis.__moxiShareModule)

const report = (sid, root, phase, err) =>
  postMessage({ t: "error", sid, root, phase, message: String(err?.message ?? err) });

// Everything a plugin module reaches for is built per session, so no composable needs an ambient "current session".
function sdkFor(s) {
  return {
    definePlugin: (def) => def,
    Counter,
    useFact(id) {
      let r = s.facts.get(id);
      if (!r) s.facts.set(id, (r = Vue.shallowRef({ state: "unknown" })));
      return Vue.computed(() => r.value);
    },
    probe: (name) => hooks?.probe(s.sid, name),
  };
}

function* rootsOf(def) {
  for (const [k, c] of Object.entries(def.commands ?? {})) yield [`cmd:${k}`, c];
  for (const [k, c] of Object.entries(def.hud ?? {})) yield [`hud:${k}`, c];
}

function mountRoot(s, name, component) {
  const root = renderer.createRoot(s.sid, name);
  const app = renderer.createApp(component);
  app.config.errorHandler = (err, _inst, info) => {
    if (/render function|runtime-1$/.test(info)) renderer.hold(root);
    report(s.sid, name, `vue:${info}`, err);
  };
  app.provide(SESSION_KEY, { sid: s.sid });
  s.roots.set(name, { root, app, mounted: false });
  hooks?.rootCreated(s.sid, name, root.node, app);
  try {
    app.mount(root.node);
    s.roots.get(name).mounted = true;
  } catch (e) {
    report(s.sid, name, "mount", e);
  }
}

function openSession(sid, facts) {
  if (sessions.has(sid)) throw new Error(`session ${sid} exists`);
  const s = { sid, scope: Vue.effectScope(true), facts: new Map(), roots: new Map(), closed: false };
  sessions.set(sid, s);
  hooks?.sessionOpened(sid, s.scope);
  for (const [id, v] of Object.entries(facts ?? {})) s.facts.set(id, Vue.shallowRef(v));
  const t0 = performance.now();
  let def;
  try {
    // Module-level effects (computed, watch) belong to the session scope and stop with it.
    const run = () => s.scope.run(() => factory({ vue: Vue, sdk: sdkFor(s) }));
    def = globalThis.__moxiShareModule ? (sharedDef ??= run()) : run();
  } catch (e) {
    report(sid, null, "module", e);
    closeSession(sid);
    return;
  }
  const t1 = performance.now();
  for (const [name, component] of rootsOf(def)) mountRoot(s, name, component);
  hooks?.timing(sid, { evalMs: t1 - t0, mountMs: performance.now() - t1 });
}

function closeSession(sid) {
  const s = sessions.get(sid);
  if (!s) return;
  s.closed = true;
  for (const r of s.roots.values()) {
    r.root.discard = true; // the host drops the whole root; unmount ops would be wasted bytes
    if (r.mounted) r.app.unmount();
  }
  s.roots.clear();
  if (!hooks?.skipScopeStop) s.scope.stop(); // probe-only switch: the negative control for "module-level effects stop"
  s.facts.clear();
  sessions.delete(sid);
}

function onMessage(m) {
  switch (m.t) {
    case "multi": // several messages in one task: they share one scheduler flush
      for (const x of m.msgs) onMessage(x);
      break;
    case "open":
      openSession(m.sid, m.facts);
      break;
    case "close":
      closeSession(m.sid);
      break;
    case "fact": {
      const s = sessions.get(m.sid);
      if (!s) return;
      const r = s.facts.get(m.id);
      if (r) r.value = m.value;
      else s.facts.set(m.id, Vue.shallowRef(m.value));
      break;
    }
    case "event": {
      const s = sessions.get(m.sid);
      const r = s?.roots.get(m.root);
      const ev = r && renderer.handlerOf(r.root, m.sign);
      if (!ev) return;
      try {
        // a rejected promise from an async handler is attributed to its session too
        const r = ev.fn(m.payload);
        if (typeof r?.then === "function") r.then(undefined, (e) => report(m.sid, m.root, "handler", e));
      } catch (e) {
        report(m.sid, m.root, "handler", e);
      }
      break;
    }
  }
}

export function boot(f) {
  if (factory) throw new Error("boot called twice");
  factory = f;
  addEventListener("message", (e) => onMessage(e.data));
  postMessage({ t: "ready" });
}
