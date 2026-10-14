// Plugin-host page (main world). Starts workers from data: module URLs, pings them, relays to Main.
const gen = Number(new URLSearchParams(location.search).get("gen"));

const PRELUDE = `self.onmessage = (e) => { if (e.data && e.data.t === "ping") postMessage({ t: "pong", id: e.data.id }); };\n`;

const SOURCES = {
  hud: `
let n = 0, busy = 0;
setInterval(() => { const t = performance.now(); n++; postMessage({ t: "hud", n }); busy += performance.now() - t; }, 100);
setInterval(() => { postMessage({ t: "busy", ms: busy }); busy = 0; }, 1000);`,
  list: `
let busy = 0, version = 0;
const rows = Array.from({ length: 200 }, (_, i) => ({ id: "row" + i, name: "Item " + i, value: i, tags: ["a", "b"] }));
postMessage({ t: "list", rows });
setInterval(() => {
  const t = performance.now();
  const changed = [];
  for (let k = 0; k < 2; k++) { const i = Math.floor(Math.random() * 200); rows[i] = { ...rows[i], value: rows[i].value + 1 }; changed.push(rows[i]); }
  postMessage({ t: "rows", version: ++version, changed });
  busy += performance.now() - t;
}, 1000);
setInterval(() => { postMessage({ t: "busy", ms: busy }); busy = 0; }, 1000);`,
  // Variant A: keeps 64 MiB ArrayBuffers (pages touched) in an array; yields between steps so it answers pings.
  A: `
const keep = []; let mib = 0;
function step() { const b = new ArrayBuffer(64 * 1048576); new Uint8Array(b).fill(1); keep.push(b); mib += 64; postMessage({ t: "progress", mib }); setTimeout(step, 0); }
setTimeout(step, 0);`,
  // Variant A-hold: like A, but catches the allocation failure (as a Vue errorHandler would) and keeps everything.
  "A-hold": `
const keep = []; let mib = 0, failed = 0;
function step() {
  try { const b = new ArrayBuffer(64 * 1048576); new Uint8Array(b).fill(1); keep.push(b); mib += 64; }
  catch (e) { failed++; if (failed === 1) postMessage({ t: "limit", mib, message: String(e) }); }
  postMessage({ t: "progress", mib, failed });
  setTimeout(step, failed ? 100 : 0);
}
setTimeout(step, 0);`,
  // Variant B: grows arrays of distinct ~1 KiB strings on the V8 heap.
  B: `
const keep = []; let cur = []; let n = 0; const base = "x".repeat(1000);
function step() {
  for (let i = 0; i < 20000; i++) { cur.push([n++, base].join("")); if (cur.length === 65536) { keep.push(cur); cur = []; } }
  postMessage({ t: "progress", mib: Math.round((n * 1024) / 1048576) });
  setTimeout(step, 0);
}
setTimeout(step, 0);`,
};
const burner = (lie) => `
let busy = 0;
function burn() { const t = performance.now(); while (performance.now() - t < 80) {} busy += performance.now() - t; setTimeout(burn, 20); }
setInterval(() => { postMessage({ t: "busy", ms: ${lie ? "0" : "busy"} }); busy = 0; }, 1000);
setTimeout(burn, 0);`;
SOURCES["C-honest"] = burner(false);
SOURCES["C-lying"] = burner(true);

const workers = {};
let port = null;
let hudN = 0;
let listRows = 0;
let listUpdates = 0;
let bombMiB = null;
let bombFailed = 0;
let pingId = 0;

function start(name, kind) {
  const url = "data:text/javascript;base64," + btoa(PRELUDE + SOURCES[kind]);
  const w = new Worker(url, { type: "module", name });
  const rec = { w, kind, alive: true, lastPong: performance.now(), busyMs: 0 };
  workers[name] = rec;
  w.onmessage = (e) => onWorker(name, rec, e.data);
  w.onerror = (e) => {
    probe.event({ gen, ev: "worker-error", worker: name, message: e.message || "(no message)", lineno: e.lineno });
    // Crash policy: an uncaught error in the bomb terminates it at once.
    if (name === "bomb") stop("bomb", "error");
  };
  w.onmessageerror = () => probe.event({ gen, ev: "worker-messageerror", worker: name });
}

function stop(name, why) {
  const rec = workers[name];
  if (!rec || !rec.alive) return;
  rec.w.terminate();
  rec.alive = false;
  probe.event({ gen, ev: "worker-stopped", worker: name, why });
}

function onWorker(name, rec, d) {
  if (workers[name] !== rec || !d) return;
  if (d.t === "pong") rec.lastPong = performance.now();
  else if (d.t === "busy") rec.busyMs = d.ms;
  else if (d.t === "hud") {
    hudN = d.n;
    if (port) port.postMessage({ gen, n: d.n });
  } else if (d.t === "list") listRows = d.rows.length;
  else if (d.t === "rows") listUpdates++;
  else if (d.t === "progress") {
    bombMiB = d.mib;
    bombFailed = d.failed || 0;
  } else if (d.t === "limit") probe.event({ gen, ev: "bomb-limit", mib: d.mib, message: d.message });
}

window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data) return;
  if (e.data.type === "pb2-port") port = e.ports[0];
  if (e.data.type === "pb2-cmd") {
    const c = e.data.cmd;
    if (c.cmd === "start-bomb") {
      start("bomb", c.kind);
      probe.event({ gen, ev: "bomb-started", kind: c.kind });
    } else if (c.cmd === "stop") stop(c.worker, "main");
    else if (c.cmd === "restart") {
      const rec = workers[c.worker];
      if (rec) start(c.worker, rec.kind);
    }
  }
});

setInterval(() => {
  pingId++;
  for (const rec of Object.values(workers)) if (rec.alive) rec.w.postMessage({ t: "ping", id: pingId });
}, 500);

setInterval(() => {
  const t = performance.now();
  const ws = {};
  for (const [name, rec] of Object.entries(workers))
    ws[name] = { alive: rec.alive, pongAgeMs: Math.round(t - rec.lastPong), busyMs: Math.round(rec.busyMs * 10) / 10 };
  probe.report({ gen, hudN, listRows, listUpdates, bombMiB, bombFailed, workers: ws });
}, 250);

start("hud", "hud");
start("list", "list");
probe.event({ gen, ev: "ready", sandboxed: probe.sandboxed });
