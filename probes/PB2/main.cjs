"use strict";
// PB2: what one plugin worker's out-of-memory (or CPU burn) kills, and how fast Main restarts the host.
// One visible fixture game window (frame counter + HUD counter over a brokered port) and one hidden
// plugin-host window with three workers: HUD (100 ms counter), 200-row list, and a bomb.
const { app, BrowserWindow, ipcMain, MessageChannelMain } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const arg = (name, fallback) => {
  const prefix = `--pb2-${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};
const CASE = arg("case", "baseline");
const REP = Number(arg("rep", "1"));
const OUT = path.resolve(arg("out", path.join(os.tmpdir(), "pb2.jsonl")));
const IS_C = CASE.startsWith("C-");
const BOMB_CAP_MS = 120_000;
const HOLD_MS = 30_000;
const CPU_CAP_MS = 60_000;
const HARD_CAP_MS = 280_000;

app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (x) => (typeof x === "number" ? Math.round(x * 10) / 10 : x);
function out(obj, toLog) {
  const line = JSON.stringify({ probe: "PB2", case: CASE, rep: REP, ts: Date.now(), t: Math.round(now()), ...obj });
  try {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.appendFileSync(OUT, line + "\n");
  } catch {}
  if (toLog) console.log(line);
}
async function waitFor(pred, timeoutMs) {
  const end = now() + timeoutMs;
  while (now() < end) {
    if (pred()) return true;
    await sleep(50);
  }
  return pred();
}

// ---------- state ----------
let game = null;
let host = null;
let hostGen = 0;
let hostPid = 0;
const hostContents = new Set(); // ids of every plugin-host webContents ever created
let gamePid = 0;
let phase = "start";
let bombT0 = 0;
const phases = {};
const events = [];
const gameReports = [];
let lastGameReportT = 0;
let lastHost = null;
const hudBack = {}; // gen -> t
const restarts = []; // { reason, exitCode, phase, goneT, backMs }
let pendingRestart = null;
const outcome = { cls: null, t: null, detail: null, workerError: null, hostGone: null, otherGone: [], limit: null };
const cw = { samples: [], searching: false, done: false, detectMs: null, foundMs: null, found: null, steps: [], healthyRestarts: 0, baselineMaxPct: 0 };
let env = {};
let finished = false;

function ps(name) {
  if (!phases[name]) {
    phases[name] = {
      startT: now(), endT: null, frames0: null, frames1: null, hud0: null, hud1: null, hudGen0: null, hudGen1: null,
      maxFrameGapMs: 0, maxHudGapMs: 0, maxGameReportGapMs: 0, hostMaxPongAgeMs: {}, hostMaxCpuPct: 0, peak: {},
      minFps1s: null, fps: null,
    };
  }
  return phases[name];
}
function setPhase(name) {
  if (phases[phase]) phases[phase].endT = now();
  phase = name;
  ps(name);
  out({ kind: "phase", phase: name }, false);
}

// ---------- windows ----------
function broker() {
  if (!game || !host) return;
  const { port1, port2 } = new MessageChannelMain();
  game.webContents.postMessage("pb2-port", null, [port1]);
  host.webContents.postMessage("pb2-port", null, [port2]);
}

function readLinux(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    return `unreadable: ${e.code}`;
  }
}

function createHost() {
  hostGen += 1;
  const gen = hostGen;
  const w = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      partition: "pb2-host",
      preload: path.join(__dirname, "host-preload.cjs"),
    },
  });
  host = w;
  hostContents.add(w.webContents.id);
  w.webContents.on("render-process-gone", (_e, d) => onHostGone(gen, d));
  const loaded = new Promise((resolve) => w.webContents.once("did-finish-load", resolve));
  w.loadFile(path.join(__dirname, "host.html"), { query: { gen: String(gen) } });
  return loaded.then(() => {
    hostPid = w.webContents.getOSProcessId();
    broker();
    if (process.platform === "linux" && gen === 1) {
      const limits = readLinux(`/proc/${hostPid}/limits`)
        .split("\n")
        .filter((l) => /Max (data size|address space|resident set)/.test(l))
        .map((l) => l.replace(/\s+/g, " ").trim());
      const status = readLinux(`/proc/${hostPid}/status`)
        .split("\n")
        .filter((l) => /^(Seccomp|NoNewPrivs|NSpid):/.test(l))
        .map((l) => l.replace(/\s+/g, " ").trim());
      const smaps = readLinux(`/proc/${hostPid}/smaps_rollup`).startsWith("unreadable") ? "unreadable" : "readable";
      env.hostLinux = { limits, status, smaps };
    }
    return gen;
  });
}

function onHostGone(gen, d) {
  if (gen !== hostGen || finished) return;
  const t = now();
  const rec = { reason: d.reason, exitCode: d.exitCode, phase, goneT: Math.round(t), sinceBombMs: bombT0 ? Math.round(t - bombT0) : null, backMs: null };
  restarts.push(rec);
  events.push({ ev: "host-gone", ...rec });
  out({ kind: "event", ev: "host-gone", ...rec }, true);
  if (!outcome.hostGone && (phase === "bomb" || phase === "after" || phase === "burn")) outcome.hostGone = rec;
  const old = host;
  host = null;
  hostPid = 0;
  pendingRestart = rec;
  setImmediate(async () => {
    try {
      old.destroy();
    } catch {}
    const newGen = await createHost();
    await waitFor(() => hudBack[newGen] != null || finished, 30_000);
    if (hudBack[newGen] != null) rec.backMs = Math.round(hudBack[newGen] - t);
    out({ kind: "event", ev: "host-back", gen: newGen, backMs: rec.backMs }, true);
    pendingRestart = null;
  });
}

function sendHost(cmd) {
  if (host && !host.isDestroyed()) host.webContents.send("pb2-cmd", cmd);
}

// ---------- IPC ----------
ipcMain.on("pb2-game", (e, d) => {
  if (!game || e.sender.id !== game.webContents.id) return;
  const t = now();
  const p = ps(phase);
  if (lastGameReportT) p.maxGameReportGapMs = Math.max(p.maxGameReportGapMs, t - lastGameReportT);
  lastGameReportT = t;
  if (p.frames0 == null) {
    p.frames0 = d.frames;
    p.hud0 = d.hudN;
    p.hudGen0 = d.hudGen;
  }
  p.frames1 = d.frames;
  p.hud1 = d.hudN;
  p.hudGen1 = d.hudGen;
  p.maxFrameGapMs = Math.max(p.maxFrameGapMs, d.maxFrameGapMs);
  p.maxHudGapMs = Math.max(p.maxHudGapMs, d.maxHudGapMs);
  gameReports.push({ t, phase, frames: d.frames });
  if (!env.gameSandboxed) env.gameSandboxed = d.sandboxed;
});
ipcMain.on("pb2-hud-back", (e, d) => {
  if (!game || e.sender.id !== game.webContents.id) return;
  if (hudBack[d.gen] == null) hudBack[d.gen] = now();
});
ipcMain.on("pb2-host", (e, d) => {
  if (!host || e.sender.id !== host.webContents.id || d.gen !== hostGen) return;
  lastHost = { ...d, t: now() };
  const p = ps(phase);
  for (const [name, w] of Object.entries(d.workers)) {
    if (!w.alive) continue;
    p.hostMaxPongAgeMs[name] = Math.max(p.hostMaxPongAgeMs[name] || 0, w.pongAgeMs);
    if (name === "bomb" && w.pongAgeMs > 2500 && outcome.firstUnresponsiveMs == null && bombT0)
      outcome.firstUnresponsiveMs = Math.round(now() - bombT0);
    if (name !== "bomb" && w.pongAgeMs > 2500 && bombT0) {
      outcome.healthyUnresponsive = outcome.healthyUnresponsive || [];
      if (!outcome.healthyUnresponsive.includes(name)) outcome.healthyUnresponsive.push(name);
    }
  }
  if (d.bombMiB != null) outcome.bombMiB = Math.max(outcome.bombMiB || 0, d.bombMiB);
});
ipcMain.on("pb2-host-event", (e, d) => {
  if (!host || e.sender.id !== host.webContents.id || d.gen !== hostGen) return;
  const t = now();
  const rec = { ...d, at: Math.round(t), sinceBombMs: bombT0 ? Math.round(t - bombT0) : null, phase };
  events.push(rec);
  out({ kind: "event", ...rec }, true);
  if (d.ev === "ready" && d.gen === 1) env.hostSandboxed = d.sandboxed;
  if (d.ev === "worker-error" && d.worker === "bomb" && !outcome.workerError) outcome.workerError = rec;
  if (d.ev === "bomb-limit" && !outcome.limit) outcome.limit = rec;
});

app.on("render-process-gone", (_e, wc, d) => {
  if (hostContents.has(wc.id)) return;
  const rec = { who: game && wc.id === game.webContents.id ? "game" : "other", reason: d.reason, exitCode: d.exitCode, phase, at: Math.round(now()) };
  outcome.otherGone.push(rec);
  events.push({ ev: "render-process-gone", ...rec });
  out({ kind: "event", ev: "render-process-gone", ...rec }, true);
});
app.on("child-process-gone", (_e, d) => {
  if (d.reason === "clean-exit") return;
  const rec = { type: d.type, reason: d.reason, exitCode: d.exitCode, name: d.name, serviceName: d.serviceName, phase, at: Math.round(now()) };
  outcome.otherGone.push(rec);
  events.push({ ev: "child-process-gone", ...rec });
  out({ kind: "event", ev: "child-process-gone", ...rec }, true);
});

// ---------- sampling ----------
let prevCpu = null; // { pid, t, cum }
function role(m) {
  if (m.pid === hostPid) return "host";
  if (m.pid === gamePid) return "game";
  if (m.type === "Browser") return "main";
  if (m.type === "GPU") return "gpu";
  return m.type.toLowerCase();
}
function hostCpuNow() {
  const m = app.getAppMetrics().find((p) => p.pid === hostPid);
  return m ? { pid: m.pid, t: now(), cum: m.cpu.cumulativeCPUUsage, pct: m.cpu.percentCPUUsage } : null;
}
function sample() {
  if (finished) return;
  if (cw.searching && env.cumulativeCpu === false) return; // percentCPUUsage resets on every read
  const t = now();
  const metrics = app.getAppMetrics();
  const sys = process.getSystemMemoryInfo();
  const procs = {};
  let hostCpuPct = null;
  for (const m of metrics) {
    const r = role(m);
    const rec = { pid: m.pid, type: m.type, wsMiB: r1(m.memory.workingSetSize / 1024), peakWsMiB: r1(m.memory.peakWorkingSetSize / 1024) };
    if (typeof m.memory.privateBytes === "number") rec.privMiB = r1(m.memory.privateBytes / 1024);
    rec.cpuPct = r1(m.cpu.percentCPUUsage);
    if (r === "host") {
      if (env.cumulativeCpu == null) env.cumulativeCpu = typeof m.cpu.cumulativeCPUUsage === "number";
      if (env.cumulativeCpu && prevCpu && prevCpu.pid === m.pid) hostCpuPct = ((m.cpu.cumulativeCPUUsage - prevCpu.cum) / ((t - prevCpu.t) / 1000)) * 100;
      else if (!env.cumulativeCpu) hostCpuPct = m.cpu.percentCPUUsage;
      prevCpu = { pid: m.pid, t, cum: m.cpu.cumulativeCPUUsage };
      if (process.platform === "linux") {
        const s = readLinux(`/proc/${m.pid}/smaps_rollup`);
        if (!s.startsWith("unreadable")) {
          const kb = (k) => Number((s.match(new RegExp(`^${k}:\\s+(\\d+)`, "m")) || [])[1] || 0);
          rec.privMiB = r1((kb("Private_Clean") + kb("Private_Dirty")) / 1024);
          rec.pssMiB = r1(kb("Pss") / 1024);
        }
      }
    }
    const key = procs[r] ? `${r}:${m.pid}` : r;
    procs[key] = rec;
    const p = ps(phase);
    const pk = (p.peak[r] = p.peak[r] || { wsMiB: 0, privMiB: 0 });
    pk.wsMiB = Math.max(pk.wsMiB, rec.wsMiB);
    if (rec.privMiB != null) pk.privMiB = Math.max(pk.privMiB, rec.privMiB);
  }
  const p = ps(phase);
  if (hostCpuPct != null) p.hostMaxCpuPct = Math.max(p.hostMaxCpuPct, hostCpuPct);
  out({ kind: "sample", phase, hostCpuPct: r1(hostCpuPct), sysFreeMiB: r1(sys.free / 1024), sysSwapFreeMiB: r1((sys.swapFree || 0) / 1024), procs }, false);
  if (IS_C && hostCpuPct != null) cpuWatch(hostCpuPct);
}

// ---------- CPU watch (D 3.5): above 50 % of one core for 10 s, stop workers one at a time ----------
function cpuWatch(pct) {
  if (phase === "baseline") cw.baselineMaxPct = Math.max(cw.baselineMaxPct, pct);
  if (phase !== "burn") return;
  cw.samples.push({ t: Math.round(now() - bombT0), pct: r1(pct) });
  if (cw.searching || cw.done) return;
  const recent = cw.samples.slice(-5);
  if (recent.length === 5 && recent.every((s) => s.pct >= 50)) cpuSearch();
}
async function measureHostCpu(ms) {
  const a = hostCpuNow();
  await sleep(ms);
  const b = hostCpuNow();
  if (!a || !b || a.pid !== b.pid) return null;
  if (typeof a.cum === "number" && typeof b.cum === "number") return ((b.cum - a.cum) / ((b.t - a.t) / 1000)) * 100;
  return b.pct;
}
async function cpuSearch() {
  cw.searching = true;
  cw.detectMs = Math.round(now() - bombT0);
  const busy = (lastHost && lastHost.workers) || {};
  const order = Object.keys(busy)
    .filter((n) => busy[n].alive)
    .sort((a, b) => (busy[b].busyMs || 0) - (busy[a].busyMs || 0));
  cw.order = order.map((n) => ({ worker: n, busyHintMs: r1(busy[n].busyMs) }));
  for (const name of order) {
    sendHost({ cmd: "stop", worker: name });
    const pct = await measureHostCpu(2000);
    cw.steps.push({ worker: name, cpuAfterPct: r1(pct), at: Math.round(now() - bombT0) });
    if (pct != null && pct < 50) {
      cw.found = name;
      cw.foundMs = Math.round(now() - bombT0);
      break;
    }
    sendHost({ cmd: "restart", worker: name });
    cw.healthyRestarts += name === "bomb" ? 0 : 1;
  }
  cw.done = true;
  cw.searching = false;
  out({ kind: "event", ev: "cpu-search-done", found: cw.found, foundMs: cw.foundMs, healthyRestarts: cw.healthyRestarts }, true);
}

// ---------- summary ----------
function minFps1s(name) {
  const rs = gameReports.filter((r) => r.phase === name);
  let min = null;
  for (let i = 0; i < rs.length; i++) {
    const j = rs.findIndex((r, k) => k > i && r.t - rs[i].t >= 1000);
    if (j < 0) break;
    const fps = (rs[j].frames - rs[i].frames) / ((rs[j].t - rs[i].t) / 1000);
    min = min == null ? fps : Math.min(min, fps);
  }
  return min;
}
function finish(code) {
  if (finished) return;
  finished = true;
  if (phases[phase]) phases[phase].endT = now();
  const phaseOut = {};
  for (const [name, p] of Object.entries(phases)) {
    const durMs = (p.endT || now()) - p.startT;
    phaseOut[name] = {
      durMs: Math.round(durMs),
      fps: p.frames1 != null ? r1((p.frames1 - p.frames0) / (durMs / 1000)) : null,
      minFps1s: r1(minFps1s(name)),
      maxFrameGapMs: r1(p.maxFrameGapMs),
      maxGameReportGapMs: r1(p.maxGameReportGapMs),
      hudGain: p.hud1 != null && p.hudGen1 === p.hudGen0 ? p.hud1 - p.hud0 : null,
      hudGen: [p.hudGen0, p.hudGen1],
      maxHudGapMs: r1(p.maxHudGapMs),
      hostMaxPongAgeMs: Object.fromEntries(Object.entries(p.hostMaxPongAgeMs).map(([k, v]) => [k, r1(v)])),
      hostMaxCpuPct: r1(p.hostMaxCpuPct),
      peakMiB: p.peak,
    };
  }
  const summary = {
    kind: "summary",
    exit: code,
    env,
    outcome: {
      cls: outcome.cls,
      timeToOutcomeMs: outcome.t != null ? Math.round(outcome.t - bombT0) : null,
      detail: outcome.detail,
      bombMiB: outcome.bombMiB ?? null,
      firstUnresponsiveMs: outcome.firstUnresponsiveMs ?? null,
      healthyUnresponsive: outcome.healthyUnresponsive ?? [],
      workerError: outcome.workerError,
      limit: outcome.limit,
      hostGone: outcome.hostGone,
      rendererGoneAfterDecision: outcome.rendererGoneAfterDecision ?? null,
      otherGone: outcome.otherGone,
    },
    restarts,
    cpuWatch: IS_C ? { ...cw, samples: cw.samples } : undefined,
    phases: phaseOut,
  };
  out(summary, true);
  setTimeout(() => app.exit(code), 200);
}

// ---------- case flows ----------
async function waitRestartSettled() {
  if (!pendingRestart) return;
  setPhase("restart");
  await waitFor(() => !pendingRestart, 35_000);
  setPhase("post-restart");
  await sleep(5000);
}

async function runBomb() {
  setPhase("bomb");
  bombT0 = now();
  sendHost({ cmd: "start-bomb", kind: CASE });
  const hold = CASE === "A-hold";
  let holdStart = null;
  while (now() - bombT0 < BOMB_CAP_MS) {
    await sleep(50);
    if (outcome.hostGone) {
      outcome.cls = outcome.workerError ? "worker-error-then-renderer-gone" : "renderer-gone";
      outcome.t = outcome.hostGone.goneT;
      break;
    }
    if (outcome.otherGone.length) {
      outcome.cls = "other-process-gone";
      outcome.t = now();
      break;
    }
    if (outcome.workerError && !hold) {
      outcome.cls = "worker-only";
      outcome.t = outcome.workerError.at;
      outcome.detail = outcome.workerError.message;
      break;
    }
    if (hold && outcome.limit && holdStart == null) holdStart = now();
    if (hold && holdStart != null && now() - holdStart >= HOLD_MS) {
      outcome.cls = "worker-held-at-limit";
      outcome.t = outcome.limit.at;
      outcome.detail = `renderer alive after ${HOLD_MS} ms at the limit: ${outcome.limit.message}`;
      break;
    }
  }
  if (!outcome.cls) {
    outcome.cls = outcome.workerError ? "worker-error" : "none-within-cap";
    outcome.t = now();
  }
  out({ kind: "event", ev: "outcome", cls: outcome.cls, timeToOutcomeMs: Math.round(outcome.t - bombT0), bombMiB: outcome.bombMiB }, true);
  if (host && !pendingRestart) {
    sendHost({ cmd: "stop", worker: "bomb" });
    setPhase("after");
    await sleep(10_000);
    if (outcome.hostGone) outcome.rendererGoneAfterDecision = outcome.hostGone;
  }
  await waitRestartSettled();
}

async function runCrash() {
  for (let i = 0; i < 3; i++) {
    setPhase(`crash${i + 1}`);
    const before = restarts.length;
    host.webContents.forcefullyCrashRenderer();
    await waitFor(() => restarts.length > before && restarts[before].backMs != null && !pendingRestart, 35_000);
    await sleep(5000);
  }
}

async function runCpu() {
  setPhase("burn");
  bombT0 = now();
  sendHost({ cmd: "start-bomb", kind: CASE });
  await waitFor(() => cw.done || now() - bombT0 > CPU_CAP_MS, CPU_CAP_MS + 30_000);
  outcome.cls = cw.found === "bomb" ? "burner-found" : cw.found ? "wrong-worker-found" : "burner-not-found";
  outcome.t = cw.foundMs != null ? bombT0 + cw.foundMs : now();
  if (cw.found !== "bomb") sendHost({ cmd: "stop", worker: "bomb" });
  setPhase("after");
  await sleep(5000);
  await waitRestartSettled();
}

async function run() {
  out({ kind: "start", argv: process.argv.slice(2) }, true);
  const cpus = os.cpus();
  env = {
    platform: process.platform,
    osRelease: os.release(),
    osVersion: typeof os.version === "function" ? os.version() : null,
    arch: process.arch,
    runner: process.env.RUNNER_NAME || null,
    imageOS: process.env.ImageOS || null,
    imageVersion: process.env.ImageVersion || null,
    cpuModel: cpus[0] && cpus[0].model,
    cpuCount: cpus.length,
    totalMemMiB: Math.round(os.totalmem() / 1048576),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    v8: process.versions.v8,
    node: process.versions.node,
  };
  game = new BrowserWindow({
    show: true,
    width: 480,
    height: 270,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      partition: "pb2-game",
      preload: path.join(__dirname, "game-preload.cjs"),
    },
  });
  const gameLoaded = new Promise((resolve) => game.webContents.once("did-finish-load", resolve));
  game.loadFile(path.join(__dirname, "game.html"));
  await gameLoaded;
  gamePid = game.webContents.getOSProcessId();
  await createHost();
  setPhase("warmup");
  if (!(await waitFor(() => hudBack[1] != null && lastHost && lastHost.hudN > 3, 20_000))) throw new Error("HUD counter never reached the game window");
  const sampler = setInterval(sample, IS_C ? 2000 : 500);
  await sleep(2000);
  setPhase("baseline");
  await sleep(10_000);
  if (CASE === "baseline") {
    setPhase("idle");
    await sleep(15_000);
    outcome.cls = "baseline";
  } else if (CASE === "crash") await runCrash();
  else if (IS_C) await runCpu();
  else if (["A", "A-hold", "B"].includes(CASE)) await runBomb();
  else throw new Error(`unknown case ${CASE}`);
  clearInterval(sampler);
  finish(0);
}

setTimeout(() => {
  out({ kind: "event", ev: "hard-cap" }, true);
  finish(4);
}, HARD_CAP_MS);

app.on("window-all-closed", () => {});
app.whenReady()
  .then(run)
  .catch((err) => {
    out({ kind: "fatal", error: String((err && err.stack) || err) }, true);
    finish(3);
  });
