// Node-only shim that makes a worker_threads Worker look like a Web Worker for the runtime, plus probe hooks.
// It is not part of the runtime under test.
const { parentPort, workerData } = require("node:worker_threads");
const v8 = require("node:v8");

globalThis.postMessage = (m) => parentPort.postMessage(m);
globalThis.addEventListener = (type, fn) => {
  if (type === "message") parentPort.on("message", (data) => fn({ data }));
};

// A Chromium worker survives an uncaught exception (it fires `error`); a Node worker dies. Emulate Chromium.
if (workerData?.emulateChromium) {
  process.on("uncaughtException", (e) => parentPort.postMessage({ t: "uncaught", message: String(e?.message ?? e) }));
  process.on("unhandledRejection", (e) => parentPort.postMessage({ t: "unhandled", message: String(e?.message ?? e) }));
}

// Vue logs unattributable errors with console.error; keep them out of the terminal and count them.
console.error = (...a) => parentPort.postMessage({ t: "console", text: a.map((x) => String(x?.message ?? x)).join(" ") });

console.warn = (...a) => parentPort.postMessage({ t: "console-warn", text: a.map((x) => String(x?.message ?? x)).join(" ") });

const counters = {};
const timings = [];
const weak = [];
// light: no bookkeeping at all, so heap numbers contain only the runtime and the plugin sessions
globalThis.__moxiTestHooks = workerData?.light ? { probe() {}, timing() {}, rootCreated() {}, sessionOpened() {} } : {
  probe(sid, name) {
    const c = (counters[sid] ??= {});
    c[name] = (c[name] ?? 0) + 1;
  },
  timing: (sid, t) => timings.push({ sid, ...t }),
  rootCreated(sid, name, node, app) {
    weak.push({ sid, kind: `root:${name}`, ref: new WeakRef(node) }, { sid, kind: `app:${name}`, ref: new WeakRef(app) });
  },
  skipScopeStop: !!workerData?.skipScopeStop,
  sessionOpened: (sid, scope) => weak.push({ sid, kind: "scope", ref: new WeakRef(scope) }),
};

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 3; i++) {
    await tick(); // WeakRef targets stay alive until the current job ends
    gc();
  }
}

parentPort.on("message", async (m) => {
  switch (m.t) {
    case "sync":
      await tick();
      parentPort.postMessage({ t: "synced", id: m.id });
      break;
    case "heap": {
      await settle();
      const h = v8.getHeapStatistics();
      parentPort.postMessage({ t: "heap", tag: m.tag, used: h.used_heap_size, total: h.total_heap_size, external: h.external_memory });
      break;
    }
    case "weak":
      await settle();
      parentPort.postMessage({ t: "weak", alive: weak.filter((w) => w.ref.deref()).map((w) => ({ sid: w.sid, kind: w.kind })), tracked: weak.length });
      break;
    case "counters":
      parentPort.postMessage({ t: "counters", counters, timings });
      break;
    case "busy": {
      // Block the worker thread, as a heavy render would.
      const end = performance.now() + m.ms;
      while (performance.now() < end);
      break;
    }
  }
});
