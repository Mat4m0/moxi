"use strict";
// Hidden plugin-host page: starts workers from data: URLs and acks every op batch without rendering.
const probe = window.probe;
const workers = new Map();
const totals = { batches: 0, numbers: 0, errors: 0 };
let bundles = null;

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
const dataUrl = (text, form) =>
  form === "percent"
    ? "data:text/javascript;charset=utf-8," + encodeURIComponent(text)
    : "data:text/javascript;base64," + base64(text);

function track(record, message) {
  if (message.t === "ops") {
    totals.batches++;
    totals.numbers += message.ops.length;
    record.worker.postMessage({ t: "ack", sid: message.sid, seq: message.seq });
  } else if (message.t === "ready") {
    record.onReady(message);
  } else if (message.t === "opened") {
    const resolve = record.opening.get(message.sid);
    if (resolve) resolve(message.ms);
  } else if (message.t === "error") {
    totals.errors++;
  }
}

function startPlugin(plugin) {
  const text = bundles.runtime + "\n__moxiBoot((" + bundles.plugins[plugin.kind] + "));";
  const url = dataUrl(text, "base64");
  const record = { id: plugin.id, opening: new Map(), t0: performance.now() };
  const ready = new Promise((resolve, reject) => {
    record.onReady = (message) => resolve({ ms: performance.now() - record.t0, evalMs: message.evalMs });
    const timer = setTimeout(() => reject(new Error("ready timeout " + plugin.id)), 60000);
    record.worker = new Worker(url, { type: "module", name: plugin.id });
    record.worker.onmessage = (event) => track(record, event.data);
    record.worker.onerror = (event) => {
      clearTimeout(timer);
      reject(new Error("worker error " + plugin.id + ": " + event.message));
    };
    record.clear = () => clearTimeout(timer);
  });
  workers.set(plugin.id, record);
  return ready.then((r) => (record.clear(), r));
}

function openSession(record, sid) {
  return new Promise((resolve) => {
    record.opening.set(sid, resolve);
    record.worker.postMessage({ t: "open", sid });
  });
}

async function spawn({ plugins, sessions, sequential }) {
  const result = { ready: [], evalMs: [], openFirst: [], openExtra: [], failures: [] };
  const started = performance.now();
  const one = async (plugin) => {
    try {
      const ready = await startPlugin(plugin);
      result.ready.push(ready.ms);
      result.evalMs.push(ready.evalMs);
      const record = workers.get(plugin.id);
      for (let k = 1; k <= sessions; k++) {
        const ms = await openSession(record, plugin.id + "#" + k);
        (k === 1 ? result.openFirst : result.openExtra).push(ms);
      }
    } catch (error) {
      result.failures.push(String(error.message));
    }
  };
  if (sequential) for (const plugin of plugins) await one(plugin);
  else await Promise.all(plugins.map(one));
  result.totalMs = performance.now() - started;
  probe.emit("spawned", result);
}

// One start attempt of a data: module worker; resolves instead of throwing.
function tryWorker(url, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let worker;
    try {
      worker = new Worker(url, { type: "module" });
    } catch (error) {
      resolve({ outcome: "exception", name: error.name, message: String(error.message).slice(0, 200) });
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ outcome: "timeout" });
    }, timeoutMs);
    const fail = (outcome, message) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ outcome, message: String(message).slice(0, 300) });
    };
    worker.onerror = (event) => fail("worker-error", event.message);
    worker.onmessageerror = () => fail("messageerror", "");
    worker.onmessage = (event) => {
      const m = event.data;
      if (m.t === "ready") {
        const readyMs = performance.now() - t0;
        worker.postMessage({ t: "open", sid: "s" });
        worker.__readyMs = readyMs;
      } else if (m.t === "opened") {
        clearTimeout(timer);
        resolve({ outcome: "started", readyMs: worker.__readyMs, openMs: m.ms, worker });
      }
    };
  });
}

async function sizeTest({ text, form, reps, keep, timeoutMs }) {
  const out = { form, rawBytes: text.length, attempts: [] };
  let url;
  const built = performance.now();
  try {
    url = dataUrl(text, form);
  } catch (error) {
    out.outcome = "url-build-failed";
    out.message = String(error.message);
    probe.emit("size-result", out);
    return;
  }
  out.urlBuildMs = performance.now() - built;
  out.urlLength = url.length;
  let kept = null;
  for (let i = 0; i < reps; i++) {
    const attempt = await tryWorker(url, timeoutMs);
    const { worker, ...plain } = attempt;
    out.attempts.push(plain);
    if (attempt.outcome !== "started") break;
    if (keep && i === reps - 1) kept = worker;
    else worker.terminate();
    await new Promise((r) => setTimeout(r, 50));
  }
  const bad = out.attempts.find((a) => a.outcome !== "started");
  out.outcome = bad ? bad.outcome : "started";
  if (kept) workers.set("kept", { worker: kept });
  probe.emit("size-result", out);
}

// Bootstrap variant: a tiny data: module that imports the code from the moxi scheme.
async function bootTest({ bootstrap, timeoutMs }) {
  const url = dataUrl(bootstrap, "base64");
  const out = { messages: [] };
  const worker = new Worker(url, { type: "module", name: "bootstrap" });
  const done = new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), timeoutMs);
    worker.onerror = (event) => {
      out.workerError = String(event.message).slice(0, 300);
      clearTimeout(timer);
      resolve("worker-error");
    };
    worker.onmessage = (event) => {
      const m = event.data;
      if (m.t === "boot") {
        out.boot = m;
        clearTimeout(timer);
        resolve("boot");
      } else if (m.t === "ready") {
        out.messages.push("ready");
      }
    };
  });
  out.outcome = await done;
  worker.terminate();
  probe.emit("boot-result", out);
}

async function init() {
  bundles = await probe.invoke("bundles");
  probe.on("spawn", (cmd) => void spawn(cmd));
  probe.on("counters", () => probe.emit("counters", { ...totals }));
  probe.on("size-test", (cmd) => void sizeTest(cmd));
  probe.on("boot-test", (cmd) => void bootTest(cmd));
  probe.emit("host-ready", { href: location.href, origin: String(location.origin) });
}
init().catch((error) => probe.emit("host-error", String(error && error.stack ? error.stack : error)));
