"use strict";
// Hidden plugin-host page: starts workers from data: URLs and acks every op batch without rendering.
const api = window.probe; // a top-level `probe` binding would clash with the exposed global
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

const EMPTY_WORKER =
  "self.postMessage({t:'ready',evalMs:performance.now()});self.onmessage=(e)=>{if(e.data.t==='open')self.postMessage({t:'opened',sid:e.data.sid,ms:0})};";
// Kinds a, b, c are the fixture plugins; "runtime" and "empty" are diagnostic floors.
function workerText(kind) {
  if (kind === "empty") return EMPTY_WORKER;
  if (kind === "runtime") return bundles.runtime + "\n__moxiBoot((function(){return{views:{}}}));";
  return bundles.runtime + "\n__moxiBoot((" + bundles.plugins[kind] + "));";
}

function startPlugin(plugin) {
  const text = workerText(plugin.kind);
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
  api.emit("spawned", result);
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
    worker.onerror = (event) => fail("worker-error", [event.message, event.filename, event.lineno].join("|"));
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
    api.emit("size-result", out);
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
  api.emit("size-result", out);
}

// Bootstrap variant: a tiny data: module that imports code from the moxi scheme.
// With `open`, the imported runtime then boots a plugin and one session runs end to end.
async function bootTest({ bootstrap, timeoutMs, open }) {
  const url = dataUrl(bootstrap, "base64");
  const out = { messages: [] };
  const worker = new Worker(url, { type: "module", name: "bootstrap" });
  const finish = (resolve, label) => {
    out.outcome = label;
    resolve();
  };
  await new Promise((resolve) => {
    const timer = setTimeout(() => finish(resolve, "timeout"), timeoutMs);
    worker.onerror = (event) => {
      out.workerError = String(event.message).slice(0, 300);
      clearTimeout(timer);
      finish(resolve, "worker-error");
    };
    worker.onmessage = (event) => {
      const m = event.data;
      if (m.t === "boot") {
        out.boot = m;
        if (m.ok && open) {
          out.session = {};
          out.sessionStart = performance.now();
          worker.postMessage({ t: "open", sid: "b" });
        } else {
          clearTimeout(timer);
          finish(resolve, "boot");
        }
      } else if (m.t === "opened") {
        out.session.opened = true;
      } else if (m.t === "ops") {
        out.session.ops = true;
        out.session.firstOpsMs = performance.now() - out.sessionStart;
        worker.postMessage({ t: "ack", sid: m.sid, seq: m.seq });
        clearTimeout(timer);
        finish(resolve, "boot");
      } else if (m.t === "ready") {
        out.messages.push("ready");
      }
    };
  });
  worker.terminate();
  api.emit("boot-result", out);
}

async function init() {
  bundles = await api.invoke("bundles");
  api.on("spawn", (cmd) => void spawn(cmd));
  api.on("counters", () => api.emit("counters", { ...totals }));
  api.on("size-test", (cmd) => void sizeTest(cmd));
  api.on("boot-test", (cmd) => void bootTest(cmd));
  api.emit("host-ready", { href: location.href, origin: String(location.origin) });
}
init().catch((error) => api.emit("host-error", String(error && error.stack ? error.stack : error)));
