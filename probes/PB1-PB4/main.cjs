"use strict";
// Linux CI only: no Electron window may ever start on Matthias's Mac (hard rule of this probe).
if (process.platform !== "linux") {
  console.error("PB1-PB4 probe runs only in Linux CI.");
  process.exit(2);
}
// Probe app for PB1 (plugin worker memory and start) and PB4 (size ceiling of a data: module worker).
// CI only. Every window is hidden (show: false), in-memory partition, sandbox: true, plugin-host CSP.
const { app, BrowserWindow, ipcMain, protocol, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sampleProcess, processStatus, alive, usedSudo } = require("./lib/smaps.cjs");
const { summarize } = require("./lib/stats.cjs");
const { buildModuleText } = require("./lib/filler.cjs");

const MODE = process.env.PROBE_MODE || "diag"; // diag | pb1 | pb4-size | pb4-boot
const CORS = process.env.PROBE_CORS || "off"; // off | scheme | scheme+acao (pb4-boot only)
const CONFIG = JSON.parse(fs.readFileSync(process.env.PROBE_CONFIG || path.join(__dirname, "run-config.json"), "utf8"));
const OUT = process.env.PROBE_OUT || path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

for (const name of (process.env.PROBE_SWITCHES || "").split(",").filter(Boolean)) {
  app.commandLine.appendSwitch(name);
}
app.enableSandbox();
protocol.registerSchemesAsPrivileged([
  {
    scheme: "moxi",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      ...(CORS === "off" ? {} : { corsEnabled: true }),
    },
  },
]);
app.on("window-all-closed", () => {});

const dist = path.join(__dirname, "dist");
const bundles = {
  runtime: fs.readFileSync(path.join(dist, "runtime-api1.js"), "utf8"),
  plugins: Object.fromEntries(
    ["a", "b", "c", "a2", "c2"].map((kind) => [kind, fs.readFileSync(path.join(dist, `plugin-${kind}.js`), "utf8")]),
  ),
};
// Plugin-host CSP of the v2 design: today's value without 'wasm-unsafe-eval'.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src data:; connect-src 'none'";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MiB = (kib) => kib / 1024;
function emit(record) {
  console.log("PROBE_JSON " + JSON.stringify(record));
}
function writeOut(name, value) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 1));
}
const readText = (file) => {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch (error) {
    return `unreadable: ${error.code ?? error.message}`;
  }
};

function collectEnv() {
  const cpus = os.cpus();
  return {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    kernel: readText("/proc/version").slice(0, 160),
    osRelease: readText("/etc/os-release").split("\n").slice(0, 3).join("; "),
    userns: readText("/proc/sys/kernel/apparmor_restrict_unprivileged_userns"),
    cpuModel: cpus[0] && cpus[0].model,
    cpuCount: cpus.length,
    totalMemMiB: Math.round(os.totalmem() / 1048576),
    runner: {
      ImageOS: process.env.ImageOS,
      ImageVersion: process.env.ImageVersion,
      RUNNER_NAME: process.env.RUNNER_NAME,
      RUNNER_OS: process.env.RUNNER_OS,
      RUNNER_ARCH: process.env.RUNNER_ARCH,
    },
    mode: MODE,
    cors: CORS,
    switches: process.env.PROBE_SWITCHES || "",
    runtimeBytes: bundles.runtime.length,
    configTag: CONFIG.tag,
  };
}

// ---------------------------------------------------------------- hosts

const hosts = new Map(); // webContents.id -> host
const codeStore = new Map(); // id -> module text (bootstrap variant)
const hits = []; // requests that reached the moxi handler for code files
let caseCounter = 0;

function handler(request) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/plugin-host/code/")) console.log("HANDLER " + request.method + " " + url.pathname);
  const headers = (extra) => ({ "content-security-policy": CSP, ...extra });
  if (url.pathname === "/plugin-host/" || url.pathname === "/plugin-host/host.js") {
    const file = url.pathname.endsWith("host.js") ? "host.js" : "index.html";
    return new Response(fs.readFileSync(path.join(__dirname, "host", file)), {
      status: 200,
      headers: headers({ "content-type": file === "host.js" ? "text/javascript" : "text/html" }),
    });
  }
  const code = /^\/plugin-host\/code\/([\w-]+)\.js$/.exec(url.pathname);
  if (code) {
    hits.push({
      url: request.url,
      method: request.method,
      origin: request.headers.get("origin"),
      mode: request.headers.get("sec-fetch-mode"),
      dest: request.headers.get("sec-fetch-dest"),
      site: request.headers.get("sec-fetch-site"),
    });
    const text = codeStore.get(code[1]);
    if (text !== undefined) {
      return new Response(text, {
        status: 200,
        headers: headers({
          "content-type": "text/javascript",
          // Only the plugin partition's handler sets this (D 3.3 amendment).
          ...(CORS === "scheme+acao" ? { "access-control-allow-origin": "*" } : {}),
        }),
      });
    }
  }
  return new Response("Not found", { status: 404, headers: headers({ "content-type": "text/plain" }) });
}

ipcMain.on("probe:event", (event, name, payload) => {
  const host = hosts.get(event.sender.id);
  if (host) host.deliver(name, payload);
});
ipcMain.handle("probe:invoke", (_event, name) => {
  if (name === "bundles") return bundles;
  throw new Error("unknown invoke " + name);
});

async function openHost(label, { cdp = false } = {}) {
  const partition = `probe-${label}-${++caseCounter}`; // no "persist:" prefix = in-memory
  const ses = session.fromPartition(partition);
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.protocol.handle("moxi", handler);
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      partition,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      webSecurity: true,
    },
  });
  const host = {
    win,
    id: win.webContents.id,
    label,
    events: [],
    waiters: new Set(),
    gone: null,
    error: null,
    pid: 0,
    cdp: null,
    deliver(name, payload) {
      if (name === "host-error") host.error = payload;
      host.events.push({ name, payload });
      for (const check of [...host.waiters]) check();
    },
    send(name, payload) {
      win.webContents.send("probe:cmd:" + name, payload);
    },
    waitEvent(name, timeoutMs = 60000) {
      return new Promise((resolve, reject) => {
        let timer;
        const finish = () => {
          clearTimeout(timer);
          host.waiters.delete(check);
        };
        const check = () => {
          const i = host.events.findIndex((e) => e.name === name);
          if (i >= 0) {
            const [found] = host.events.splice(i, 1);
            finish();
            resolve(found.payload);
          } else if (host.gone) {
            finish();
            reject(Object.assign(new Error("renderer-gone:" + host.gone.reason), { gone: host.gone }));
          } else if (host.error) {
            finish();
            reject(new Error("host-error: " + host.error));
          }
        };
        timer = setTimeout(() => {
          finish();
          reject(Object.assign(new Error("timeout waiting for " + name), { timeout: true }));
        }, timeoutMs);
        host.waiters.add(check);
        check();
      });
    },
  };
  hosts.set(host.id, host);
  const wc = win.webContents;
  const note = (what) => console.log(`HOSTLOG ${label} ${what}`);
  wc.on("render-process-gone", (_event, details) => {
    note("render-process-gone " + JSON.stringify(details));
    host.gone = details;
    for (const check of [...host.waiters]) check();
  });
  wc.on("console-message", (...args) => {
    const e = args[0] && typeof args[0] === "object" && "message" in args[0] ? args[0] : { level: args[1], message: args[2], sourceId: args[4], lineNumber: args[3] };
    note(`console ${e.level} ${String(e.message).slice(0, 300)} (${e.sourceId}:${e.lineNumber})`);
  });
  wc.on("preload-error", (_event, preloadPath, error) => note(`preload-error ${preloadPath} ${error && error.stack}`));
  wc.on("did-fail-load", (_event, code, description, url) => note(`did-fail-load ${code} ${description} ${url}`));
  wc.on("dom-ready", () => note("dom-ready"));
  wc.on("did-finish-load", () => note("did-finish-load"));
  if (cdp) host.cdp = await attachCdp(host);
  await win.loadURL("moxi://app/plugin-host/");
  try {
    await host.waitEvent("host-ready", 8000);
  } catch (error) {
    if (!error.timeout) throw error;
    const snapshot = await wc.executeJavaScript(
      "JSON.stringify({probe: typeof window.probe, ready: document.readyState, href: location.href, title: document.title, html: document.documentElement.outerHTML.slice(0, 300)})",
    );
    note("no host-ready after 8 s; page state " + snapshot);
    await host.waitEvent("host-ready", 12000);
  }
  host.pid = win.webContents.getOSProcessId();
  return host;
}

async function closeHost(host) {
  hosts.delete(host.id);
  try {
    if (host.cdp) host.win.webContents.debugger.detach();
  } catch {}
  if (!host.win.isDestroyed()) host.win.destroy();
  for (let i = 0; i < 100 && host.pid && alive(host.pid); i++) await sleep(100);
  await sleep(500);
}

function workingSetKiB(pid) {
  const metric = app.getAppMetrics().find((m) => m.pid === pid);
  return metric ? metric.memory.workingSetSize : null;
}

// 1 Hz samples of the metric of the common rules (Private_Clean + Private_Dirty) plus Pss.
async function series(pid, count) {
  const out = { t: [], privateKiB: [], pssKiB: [], rssKiB: [], workingSetKiB: [] };
  const start = Date.now();
  for (let i = 0; i < count; i++) {
    const wait = start + i * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    const s = sampleProcess(pid);
    out.t.push(Date.now() - start);
    out.privateKiB.push(s.privateKiB);
    out.pssKiB.push(s.pssKiB);
    out.rssKiB.push(s.rssKiB);
    out.workingSetKiB.push(workingSetKiB(pid));
  }
  return out;
}
const seriesSummary = (s) => ({
  privateMiB: summarize(s.privateKiB.map(MiB)),
  pssMiB: summarize(s.pssKiB.map(MiB)),
  rssMiB: summarize(s.rssKiB.map(MiB)),
});

// ---------------------------------------------------------------- PB1

// Gated mix: 50 % Builds-class (a), 30 % HUD-only (b), 20 % Trade-class (c). The other mixes are diagnostics.
const MIXES = {
  default: ["a", "a", "a", "a", "a", "b", "b", "b", "c", "c"],
  elements: ["a2", "a2", "a2", "a2", "a2", "b", "b", "b", "c2", "c2"],
  runtime: ["runtime"],
  empty: ["empty"],
};
const plan = (P, mix = "default") =>
  Array.from({ length: P }, (_, i) => ({ id: `p${i}`, kind: MIXES[mix][i % MIXES[mix].length] }));
const stat = (values) => summarize(values);

async function pb1Case(spec, run, cfg) {
  const { P, S, sequential = false, mix = "default" } = spec;
  const base = sequential ? `cold-sequential P=${P}` : `P=${P},S=${S}`;
  const name = mix === "default" ? base : `${base} [${mix}]`;
  const rec = { run, name, P, S, sequential, mix };
  const samples = spec.samples ?? cfg.samples;
  const warmupMs = spec.warmupMs ?? cfg.warmupMs;
  let host;
  try {
    host = await openHost(`pb1-${P}-${S}`);
    rec.pid = host.pid;
    rec.status = processStatus(host.pid);
    if (P > 0) {
      host.send("spawn", { plugins: plan(P, mix), sessions: S, sequential });
      const spawned = await host.waitEvent("spawned", 240000);
      rec.spawn = {
        readyMs: stat(spawned.ready),
        evalMs: stat(spawned.evalMs),
        openFirstMs: stat(spawned.openFirst),
        openExtraMs: stat(spawned.openExtra),
        totalMs: spawned.totalMs,
        failures: spawned.failures,
      };
    }
    await sleep(warmupMs);
    host.send("counters");
    const c0 = await host.waitEvent("counters", 20000);
    const t0 = Date.now();
    const s = await series(host.pid, samples);
    host.send("counters");
    const c1 = await host.waitEvent("counters", 20000);
    const seconds = (Date.now() - t0) / 1000;
    rec.series = s;
    rec.summary = seriesSummary(s);
    rec.load = {
      batchesPerSec: (c1.batches - c0.batches) / seconds,
      numbersPerSec: (c1.numbers - c0.numbers) / seconds,
      errors: c1.errors,
    };
    const half = Math.floor(s.privateKiB.length / 2);
    rec.driftMiB = half > 0 ? MiB(summarize(s.privateKiB.slice(half)).p50 - summarize(s.privateKiB.slice(0, half)).p50) : 0;
  } catch (error) {
    rec.error = String(error.message);
  } finally {
    if (host) await closeHost(host);
  }
  emit({ pb1Case: { ...rec, series: undefined } });
  return rec;
}

async function runPB1() {
  const cfg = CONFIG.pb1;
  const cases = [];
  for (let run = 0; run < cfg.runs; run++) {
    const order = run % 2 === 0 ? cfg.cases : [...cfg.cases].reverse(); // A/B order alternates
    for (const spec of order) cases.push(await pb1Case(spec, run, cfg));
    if (run === 0 && cfg.coldSeqP) {
      cases.push(await pb1Case({ P: cfg.coldSeqP, S: 1, sequential: true, samples: 3, warmupMs: 1000 }, run, cfg));
    }
    if (run === 0) {
      for (const extra of cfg.extras || []) {
        cases.push(await pb1Case({ ...extra, samples: cfg.extraSamples, warmupMs: cfg.extraWarmupMs }, run, cfg));
      }
    }
  }
  const result = { probe: "PB1", env: collectEnv(), config: cfg, cases };
  writeOut("pb1-raw.json", result);
  emit({ pb1Done: true, cases: cases.length, errors: cases.filter((c) => c.error).length });
  if (cases.some((c) => c.error)) throw new Error("some PB1 cases failed");
}

// ---------------------------------------------------------------- PB4 size

async function sizeAttempt(form, bytes, cfg, { memory }) {
  const text = buildModuleText(bundles.runtime, bytes);
  const rec = { form, rawBytes: bytes, sizeMiB: bytes / 1048576 };
  let host;
  try {
    host = await openHost(`pb4-${form}`);
    host.send("size-test", { text, form, reps: cfg.reps, keep: false, timeoutMs: cfg.timeoutMs });
    const result = await host.waitEvent("size-result", cfg.timeoutMs * (cfg.reps + 1));
    Object.assign(rec, result);
  } catch (error) {
    rec.outcome = error.gone ? `renderer-gone:${error.gone.reason}` : error.timeout ? "timeout" : `error:${error.message}`;
  } finally {
    if (host) await closeHost(host);
  }
  const started = rec.attempts ? rec.attempts.filter((a) => a.outcome === "started") : [];
  rec.readyMs = summarize(started.map((a) => a.readyMs));
  rec.openMs = summarize(started.map((a) => a.openMs));
  if (memory && rec.outcome === "started") {
    let mem;
    try {
      mem = await openHost(`pb4-mem-${form}`);
      mem.send("size-test", { text, form, reps: 1, keep: true, timeoutMs: cfg.timeoutMs });
      const r = await mem.waitEvent("size-result", cfg.timeoutMs * 2);
      if (r.outcome === "started") {
        await sleep(cfg.memorySettleMs);
        const s = await series(mem.pid, cfg.memorySamples);
        rec.memory = seriesSummary(s);
        rec.memory.series = s.privateKiB;
      } else {
        rec.memoryOutcome = r.outcome;
      }
    } catch (error) {
      rec.memoryOutcome = `error:${error.message}`;
    } finally {
      if (mem) await closeHost(mem);
    }
  }
  emit({ pb4Attempt: { ...rec, attempts: undefined, memory: rec.memory && { privateMiB: rec.memory.privateMiB } } });
  return rec;
}

async function baselineMemory(cfg) {
  const host = await openHost("pb4-baseline");
  try {
    await sleep(cfg.memorySettleMs);
    const s = await series(host.pid, cfg.memorySamples);
    return { ...seriesSummary(s), series: s.privateKiB };
  } finally {
    await closeHost(host);
  }
}

async function runPB4Size() {
  const cfg = CONFIG.pb4;
  const baselineStart = await baselineMemory(cfg);
  const grid = [];
  for (const form of cfg.forms) {
    for (const mib of cfg.sizesMiB) grid.push(await sizeAttempt(form, Math.round(mib * 1048576), cfg, { memory: true }));
  }
  const bisect = {};
  for (const form of cfg.forms) {
    const rows = grid.filter((r) => r.form === form).sort((a, b) => a.rawBytes - b.rawBytes);
    let lastPass = 0;
    for (const r of rows) {
      if (r.outcome !== "started") break;
      lastPass = r.rawBytes;
    }
    const fail = rows.find((r) => r.rawBytes > lastPass && r.outcome !== "started");
    let firstFail = fail ? fail.rawBytes : null;
    const steps = [];
    if (firstFail !== null && lastPass > 0) {
      while (firstFail - lastPass > cfg.resolutionKiB * 1024) {
        const mid = Math.round((lastPass + firstFail) / 2 / 1024) * 1024;
        const r = await sizeAttempt(form, mid, { ...cfg, reps: 1 }, { memory: false });
        steps.push({ rawBytes: mid, urlLength: r.urlLength, outcome: r.outcome, message: r.attempts && r.attempts[0] && r.attempts[0].message });
        if (r.outcome === "started") lastPass = mid;
        else firstFail = mid;
      }
    }
    bisect[form] = { largestPassBytes: lastPass, smallestFailBytes: firstFail, steps };
  }
  // base64 raw sizes that are multiples of 3 give exact URL lengths around the 2 MiB (2,097,152) URL cap.
  const exact = [];
  for (const bytes of cfg.exactBase64Bytes || []) {
    const r = await sizeAttempt("base64", bytes, { ...cfg, reps: 1 }, { memory: false });
    exact.push({ rawBytes: bytes, urlLength: r.urlLength, outcome: r.outcome, message: r.attempts && r.attempts[0] && r.attempts[0].message });
  }
  const baselineEnd = await baselineMemory(cfg);
  const result = { probe: "PB4", part: "size", env: collectEnv(), config: cfg, baselineStart, baselineEnd, grid, bisect, exact };
  writeOut("pb4-size-raw.json", result);
  emit({ pb4SizeDone: true, bisect });
}

// ---------------------------------------------------------------- PB4 bootstrap

function bootstrapSource(url, pluginSource) {
  const boot = pluginSource ? `__moxiBoot((${pluginSource}));` : "";
  return `const t0 = performance.now();
const idb = () => new Promise((resolve) => {
  try {
    const r = indexedDB.open("pb4-" + Math.random());
    r.onsuccess = () => resolve("opened");
    r.onerror = () => resolve("error:" + (r.error && r.error.name));
    r.onblocked = () => resolve("blocked");
    setTimeout(() => resolve("pending"), 1500);
  } catch (e) { resolve("throw:" + e.name); }
});
const info = () => ({ origin: String(self.origin), protocol: location.protocol, secure: self.isSecureContext });
(async () => {
  const pre = { ...info(), idb: await idb() };
  try {
    await import(${JSON.stringify(url)});
    ${boot}
    self.postMessage({ t: "boot", ok: true, ms: performance.now() - t0, pre, post: { ...info(), idb: await idb() } });
  } catch (e) {
    self.postMessage({ t: "boot", ok: false, ms: performance.now() - t0, pre, name: e.name, message: String(e.message).slice(0, 300) });
  }
})();
`;
}

// Chrome DevTools Protocol on the host page and its workers: network failures carry the CORS reason.
async function attachCdp(host) {
  const log = { targets: [], failures: [], responses: [], requests: new Map(), console: [], errors: [] };
  const dbg = host.win.webContents.debugger;
  try {
    dbg.attach("1.3");
    dbg.on("message", (_event, method, params, sessionId) => {
      try {
        if (method === "Target.attachedToTarget") {
          const info = params.targetInfo;
          log.targets.push({ type: info.type, url: String(info.url).slice(0, 80), waiting: params.waitingForDebugger });
          if (info.type === "worker") {
            const sid = params.sessionId;
            const run = async () => {
              for (const m of ["Network.enable", "Runtime.enable", "Log.enable"]) await dbg.sendCommand(m, {}, sid);
              await dbg.sendCommand("Runtime.runIfWaitingForDebugger", {}, sid);
            };
            run().catch((error) => log.errors.push(String(error.message)));
          }
        } else if (method === "Network.requestWillBeSent") {
          log.requests.set(sessionId + ":" + params.requestId, params.request.url);
        } else if (method === "Network.responseReceived") {
          const r = params.response;
          if (String(r.url).includes("/plugin-host/code/")) {
            const keep = {};
            for (const key in r.headers) {
              const lower = key.toLowerCase();
              if (["access-control-allow-origin", "content-type", "content-security-policy", "vary"].includes(lower)) keep[lower] = String(r.headers[key]).slice(0, 200);
            }
            log.responses.push({ url: r.url, status: r.status, headers: keep });
          }
        } else if (method === "Network.loadingFailed") {
          log.failures.push({
            url: log.requests.get(sessionId + ":" + params.requestId) || null,
            errorText: params.errorText,
            blockedReason: params.blockedReason || null,
            corsErrorStatus: params.corsErrorStatus || null,
          });
        } else if (method === "Log.entryAdded") {
          log.console.push({ source: params.entry.source, level: params.entry.level, text: String(params.entry.text).slice(0, 300) });
        } else if (method === "Runtime.exceptionThrown") {
          log.console.push({ source: "exception", text: String(params.exceptionDetails.text).slice(0, 200) + " " + String((params.exceptionDetails.exception || {}).description || "").slice(0, 200) });
        }
      } catch (error) {
        log.errors.push(String(error.message));
      }
    });
    await dbg.sendCommand("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  } catch (error) {
    log.errors.push("attach: " + String(error.message));
  }
  return log;
}

function classifyBoot(rec) {
  if (rec.boot && rec.boot.ok) return "loaded";
  const fail = rec.cdp && rec.cdp.failures.find((f) => f.url && f.url.includes("/plugin-host/code/"));
  if (fail && fail.corsErrorStatus) return `cors-refusal:${fail.corsErrorStatus.corsError}`;
  if (fail && fail.blockedReason) return `blocked:${fail.blockedReason}`;
  if (fail) return `network-failure:${fail.errorText}`;
  const csp = rec.cdp && rec.cdp.console.find((c) => /Content Security Policy|violates the following/i.test(c.text));
  if (csp) return "csp-refusal";
  if (rec.hits.length === 0) return "blocked-before-handler(unclassified)";
  return "failed-after-handler(unclassified)";
}

// kind "size": a module of the given size is imported. kind "runtime": the real runtime is imported and a
// fixture plugin from the data: bootstrap runs one session end to end.
async function bootCase(mib, cfg, kind = "size") {
  const bytes = kind === "runtime" ? bundles.runtime.length : Math.max(Math.round(mib * 1048576), bundles.runtime.length + 2048);
  const id = kind === "runtime" ? "runtime-api1" : `code-${Math.round(bytes / 1024)}k`;
  codeStore.set(id, kind === "runtime" ? bundles.runtime : buildModuleText(bundles.runtime, bytes));
  hits.length = 0;
  const rec = { cors: CORS, kind, rawBytes: bytes, sizeMiB: bytes / 1048576, id };
  let host;
  try {
    host = await openHost("boot", { cdp: true });
    host.send("boot-test", {
      bootstrap: bootstrapSource(`moxi://app/plugin-host/code/${id}.js`, kind === "runtime" ? bundles.plugins.a : undefined),
      timeoutMs: cfg.timeoutMs,
      open: kind === "runtime",
    });
    Object.assign(rec, await host.waitEvent("boot-result", cfg.timeoutMs + 10000));
    await sleep(300);
  } catch (error) {
    rec.outcome = error.gone ? `renderer-gone:${error.gone.reason}` : `error:${error.message}`;
  } finally {
    rec.hits = hits.splice(0);
    if (host) {
      rec.cdp = host.cdp && { targets: host.cdp.targets, failures: host.cdp.failures, responses: host.cdp.responses, console: host.cdp.console.slice(0, 8), errors: host.cdp.errors.slice(0, 5) };
      await closeHost(host);
    }
  }
  rec.classified = classifyBoot(rec);
  codeStore.delete(id);
  emit({ pb4Boot: { cors: CORS, kind, sizeMiB: rec.sizeMiB, classified: rec.classified, boot: rec.boot, session: rec.session, hits: rec.hits.length } });
  return rec;
}

async function runPB4Boot() {
  const cfg = CONFIG.pb4boot;
  const cases = [];
  for (const mib of cfg.sizesMiB) cases.push(await bootCase(mib, cfg));
  cases.push(await bootCase(0, cfg, "runtime"));
  writeOut(`pb4-boot-${CORS}.json`, { probe: "PB4", part: "bootstrap", env: collectEnv(), config: cfg, cases });
  emit({ pb4BootDone: true, cors: CORS });
}

// ---------------------------------------------------------------- diag

async function runDiag() {
  const host = await openHost("diag");
  const env = collectEnv();
  const browser = { pid: process.pid, status: processStatus(process.pid) };
  let browserSmaps;
  try {
    browserSmaps = sampleProcess(process.pid);
  } catch (error) {
    browserSmaps = { error: String(error.message) };
  }
  let hostSmaps;
  try {
    hostSmaps = sampleProcess(host.pid);
  } catch (error) {
    hostSmaps = { error: String(error.message) };
  }
  const result = {
    env,
    browser,
    browserSmaps,
    host: { pid: host.pid, status: processStatus(host.pid), smaps: hostSmaps },
    metrics: app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, workingSetKiB: m.memory.workingSetSize, sandboxed: m.sandboxed })),
    sudoUsed: usedSudo(),
  };
  writeOut("diag.json", result);
  emit({ diag: result });
  await closeHost(host);
}

// ---------------------------------------------------------------- main

app.whenReady().then(async () => {
  const watchdog = setTimeout(() => {
    console.error("watchdog: probe exceeded its time limit");
    app.exit(3);
  }, Number(process.env.PROBE_MAX_MS || 50 * 60 * 1000));
  try {
    if (process.versions.electron !== "44.5.1") throw new Error("Electron must be 44.5.1, got " + process.versions.electron);
    emit({ env: collectEnv() });
    await runDiag();
    if (MODE === "pb1") await runPB1();
    else if (MODE === "pb4-size") await runPB4Size();
    else if (MODE === "pb4-boot") await runPB4Boot();
    clearTimeout(watchdog);
    app.exit(0);
  } catch (error) {
    console.error("probe failed:", error && error.stack ? error.stack : error);
    emit({ fatal: String(error && error.message) });
    app.exit(1);
  }
});
