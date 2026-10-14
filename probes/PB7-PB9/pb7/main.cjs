"use strict";
// PB7 probe app: timers and latency in hidden plugin hosts while the game window is visible,
// minimized and covered. One visible fixture game window, two hidden hosts with five plugin
// workers each (10 plugins x 3 sessions), facts at 20 Hz, a watchdog ping every second in each
// host page and a second set of pings driven by Main over a control port with Main's own clock.
// Variants: PB7_VARIANT = false (hosts keep backgroundThrottling:false), default (hosts keep
// Chromium's default) or reassert (default, then setBackgroundThrottling(false) after load).
// Probe code, not product code.
const { app, BrowserWindow, MessageChannelMain } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { analyze, visibilityPerPhase } = require("../lib/pb7-analysis.cjs");

const VARIANT = process.env.PB7_VARIANT || "false";
const SCALE = Number(process.env.PB7_SCALE || "1");
// PB7_HIDE=1: show every host once and hide it again after load, so that Chromium really treats
// the page as hidden (a window created with show:false may still report "visible").
const HIDE = process.env.PB7_HIDE === "1";
const TAG = `${VARIANT}${HIDE ? "-hide" : ""}`;
const OUT = process.env.PB7_OUT || path.join(__dirname, "..", "out");
const N_HOSTS = 2;
const PLUGINS = 5; // per host
const SESSIONS = 3;
const WORKERS = N_HOSTS * PLUGINS;
// 10 s visible, then 2 min minimized, 2 min covered and a restored tail. The tail pushes the
// hidden hosts past 5 minutes, where Chromium's intensive wake-up throttling would start.
const PLAN = [["warmup", 5], ["visible", 10], ["minimized", 120], ["covered", 120], ["restored", 90]];
const planMs = (seconds) => Math.max(1500, seconds * SCALE * 1000);

const hr = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (tag, obj) => console.log(`${tag} ${JSON.stringify(obj)}`);

let game = null;
let cover = null;
const hosts = [];
const hostPorts = [];
let gamePort = null;

const waiting = new Map();
const waitFor = (key, ms = 60000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${key}`)), ms);
    waiting.set(key, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
const settle = (key, value) => {
  const resolve = waiting.get(key);
  if (resolve) {
    waiting.delete(key);
    resolve(value);
  }
};

const phases = []; // { name, start, end } in epoch ms
function beginPhase(name) {
  const t = Date.now();
  if (phases.length) phases[phases.length - 1].end = t;
  phases.push({ name, start: t, end: null });
  log("PB7_PHASE", { name, t, variant: TAG });
}

// Main-side sampling.
const mainPongs = []; // [t, worker, ms since previous pong, round trip ms] on Main's clock
const mainStops = []; // [t, worker, ms since last pong]
const mainTicks = []; // [t, ms] real interval of Main's 1 s ping loop
const loopLag = []; // [t, ms] lateness of a 100 ms Main timer
const gameStates = []; // [t, minimized, visible, focused, covered]
const cpu = []; // [t, role, percent]
const pingSent = new Map();
const lastMainPong = new Array(WORKERS).fill(0);
const prevMainPong = new Array(WORKERS).fill(null);

function startMainPings() {
  const started = hr();
  lastMainPong.fill(started);
  let n = 0;
  let last = started;
  let next = started + 1000;
  const loop = () => {
    const now = hr();
    n += 1;
    mainTicks.push(Date.now(), now - last);
    last = now;
    for (let h = 0; h < N_HOSTS; h += 1) {
      for (let i = 0; i < PLUGINS; i += 1) {
        const w = h * PLUGINS + i;
        const since = now - lastMainPong[w];
        if (since > 2500) {
          mainStops.push([Date.now(), w, since]);
          lastMainPong[w] = now;
        }
        pingSent.set(`${w}:${n}`, now);
        hostPorts[h].postMessage({ t: "mping", w, seq: n });
      }
    }
    next += 1000;
    setTimeout(loop, Math.max(0, next - hr()));
  };
  setTimeout(loop, 1000);
}

function onHostMessage(h, msg) {
  if (msg.t === "mpong") {
    const now = hr();
    const sent = pingSent.get(`${msg.w}:${msg.seq}`);
    pingSent.delete(`${msg.w}:${msg.seq}`);
    const previous = prevMainPong[msg.w];
    prevMainPong[msg.w] = now;
    lastMainPong[msg.w] = now;
    if (previous !== null && sent !== undefined) mainPongs.push(Date.now(), msg.w, now - previous, now - sent);
  } else if (msg.t === "ready") {
    settle(`host${h}-ready`, msg);
  } else if (msg.t === "collected") {
    settle(`host${h}-collected`, msg.data);
  }
}

function startSamplers() {
  let lagLast = hr();
  setInterval(() => {
    const now = hr();
    loopLag.push(Date.now(), now - lagLast - 100);
    lagLast = now;
  }, 100);
  setInterval(() => {
    gameStates.push([Date.now(), game.isMinimized(), game.isVisible(), game.isFocused(), Boolean(cover && !cover.isDestroyed())]);
  }, 1000);
  setInterval(() => {
    const roles = new Map([[game.webContents.getOSProcessId(), "game"]]);
    hosts.forEach((h, i) => roles.set(h.webContents.getOSProcessId(), `host${i}`));
    for (const metric of app.getAppMetrics()) {
      const role = roles.get(metric.pid) || metric.type.toLowerCase();
      cpu.push([Date.now(), role, metric.cpu.percentCPUUsage]);
    }
  }, 2000);
}

async function makeCover() {
  const b = game.getBounds();
  const window = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#ff00ff",
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  await window.loadURL('data:text/html,<body style="margin:0;background:%23f0f"></body>');
  window.show();
  return window;
}

async function runPhases() {
  for (const [name, seconds] of PLAN) {
    beginPhase(name);
    if (name === "minimized") game.minimize();
    if (name === "covered") {
      game.restore();
      await sleep(1000);
      cover = await makeCover();
    }
    if (name === "restored") {
      if (cover) cover.close();
      cover = null;
      game.show();
    }
    await sleep(planMs(seconds));
  }
  phases[phases.length - 1].end = Date.now();
}

async function main() {
  await app.whenReady();
  const preload = path.join(__dirname, "preload.cjs");
  const web = (extra) => ({ preload, sandbox: true, contextIsolation: true, ...extra });
  game = new BrowserWindow({
    width: 800,
    height: 450,
    x: 60,
    y: 60,
    show: true,
    title: "PB7-GAME",
    backgroundColor: "#101114",
    webPreferences: web({ backgroundThrottling: false }),
  });
  for (let i = 0; i < N_HOSTS; i += 1) {
    hosts.push(
      new BrowserWindow({
        show: false,
        width: 300,
        height: 200,
        webPreferences: web(VARIANT === "false" ? { backgroundThrottling: false } : {}),
      }),
    );
  }
  await Promise.all([
    game.loadFile(path.join(__dirname, "game.html"), {
      query: { hosts: String(N_HOSTS), workers: String(WORKERS), sessions: String(SESSIONS) },
    }),
    ...hosts.map((h, i) =>
      h.loadFile(path.join(__dirname, "host.html"), {
        query: { host: String(i), plugins: String(PLUGINS), sessions: String(SESSIONS) },
      }),
    ),
  ]);
  if (VARIANT === "reassert") for (const h of hosts) h.webContents.setBackgroundThrottling(false);
  if (HIDE) {
    for (const h of hosts) h.showInactive();
    await sleep(500);
    for (const h of hosts) h.hide();
    await sleep(700);
  }

  // Control ports (Main <-> each page) and links (game <-> each host) brokered once by Main.
  const gameControl = new MessageChannelMain();
  game.webContents.postMessage("port", { kind: "control" }, [gameControl.port2]);
  gamePort = gameControl.port1;
  gamePort.on("message", (event) => {
    if (event.data.t === "ready") settle("game-ready", event.data);
    else if (event.data.t === "result") settle("game-result", event.data.data);
  });
  gamePort.start();
  hosts.forEach((h, i) => {
    const control = new MessageChannelMain();
    h.webContents.postMessage("port", { kind: "control", host: i }, [control.port2]);
    hostPorts[i] = control.port1;
    control.port1.on("message", (event) => onHostMessage(i, event.data));
    control.port1.start();
    const link = new MessageChannelMain();
    game.webContents.postMessage("port", { kind: "link", host: i }, [link.port1]);
    h.webContents.postMessage("port", { kind: "link", host: i }, [link.port2]);
  });

  const ready = await Promise.all([waitFor("game-ready"), ...hosts.map((_h, i) => waitFor(`host${i}-ready`))]);
  const env = {
    probe: "PB7",
    variant: VARIANT,
    hideHosts: HIDE,
    scale: SCALE,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    runner: process.env.ImageOS || process.env.RUNNER_OS || null,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0] && os.cpus()[0].model,
    memGiB: Math.round(os.totalmem() / 2 ** 30),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    display: process.env.DISPLAY || null,
    startVisibility: { game: ready[0].visibility, hosts: ready.slice(1).map((r) => r.visibility) },
  };
  log("PB7_ENV", env);

  // Start everything on the same beat: samplers first, then the measurement clocks, then facts.
  startSamplers();
  for (const port of hostPorts) port.postMessage({ t: "start" });
  startMainPings();
  gamePort.postMessage({ t: "start" });

  const totalMs = PLAN.reduce((sum, [, s]) => sum + planMs(s), 0);
  const hard = setTimeout(() => {
    log("PB7_FATAL", { reason: "hard timeout", phases });
    app.exit(2);
  }, totalMs + 240000);
  const progress = setInterval(() => {
    const now = Date.now();
    const current = phases[phases.length - 1];
    log("PB7_PROGRESS", { phase: current && current.name, tMs: now - phases[0].start, mainPongs: mainPongs.length / 4, mainStops: mainStops.length, lag: loopLag.length ? loopLag[loopLag.length - 1] : null });
  }, 30000);

  await runPhases();
  clearInterval(progress);
  gamePort.postMessage({ t: "stop" });
  await sleep(1000);

  gamePort.postMessage({ t: "collect" });
  for (const port of hostPorts) port.postMessage({ t: "collect" });
  const [gameData, ...hostData] = await Promise.all([waitFor("game-result"), ...hosts.map((_h, i) => waitFor(`host${i}-collected`))]);

  const result = {
    env,
    phases: phases.map((p) => ({ name: p.name, seconds: Math.round((p.end - p.start) / 100) / 10 })),
    delivery: {
      factTicksSent: gameData.sent,
      expectedOpsBatches: gameData.sent * WORKERS,
      opsBatchesApplied: gameData.applied,
      skippedStalledTicks: gameData.skippedTicks,
      factsInPerHost: hostData.map((d) => d.factsIn),
      opsOutPerHost: hostData.map((d) => d.opsOut),
      workerErrors: hostData.flatMap((d) => d.workerErrors),
    },
    visibility: { game: visibilityPerPhase(phases, gameData.vis), hosts: hostData.map((d) => visibilityPerPhase(phases, d.vis)) },
    groups: analyze({ phases, gameData, hostData, mainPongs, mainStops, mainTicks, loopLag, gameStates, cpu }),
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `pb7-${process.platform}-${TAG}.json`), JSON.stringify(result, null, 1));
  log("PB7_RESULT", result);
  clearTimeout(hard);
  fs.writeFileSync(process.env.PB7_DONE_FILE || path.join(OUT, `pb7-done-${TAG}`), "done\n");
  await new Promise((resolve) => process.stdout.write("PB7_DONE\n", resolve));
  // app.exit() hung at teardown on two CI runs after the result was already on disk; skip it.
  process.kill(process.pid, "SIGKILL");
}

main().catch((error) => {
  log("PB7_FATAL", { error: String(error && error.stack ? error.stack : error), phases });
  app.exit(1);
});
