// PB3 probe app (Electron main). For each hardening configuration it opens a hidden window in
// its own in-memory partition, starts a data: module worker like moxi's plugin host, and runs
// every egress and code-generation attempt from the worker and from the page. Loopback
// listeners count hits and bytes per attempt. CI only: never run this on a desktop.
const { app, BrowserWindow, protocol, session } = require("electron");
const http = require("node:http");
const net = require("node:net");
const dgram = require("node:dgram");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const hostDir = path.join(__dirname, "host");
const outDir = process.env.PB3_OUT ?? path.join(__dirname, "out");
const settleMs = 300;
const isolationSource = fs.readFileSync(
  path.join(__dirname, "../../apps/desktop/src/plugin-isolation.ts"),
  "utf8",
);
const todayCsp = isolationSource.match(/"([^"]+)"/)?.[1];
if (!todayCsp?.includes(" 'wasm-unsafe-eval'")) throw new Error("Unexpected pluginCsp in plugin-isolation.ts");
const cspWithoutWasm = todayCsp.replace(" 'wasm-unsafe-eval'", "");
const allConfigs = [
  { name: "N", layers: "none (positive control)" },
  { name: "A1", layers: "CSP as today (with 'wasm-unsafe-eval')", csp: todayCsp },
  { name: "A2", layers: "CSP without 'wasm-unsafe-eval'", csp: cspWithoutWasm },
  { name: "B", layers: "webRequest cancel of every non-host URL only", webRequest: true },
  { name: "P", layers: "permission handlers that deny all only", permissions: true },
  {
    name: "C",
    layers: "A2 + B + permission handlers",
    csp: cspWithoutWasm,
    webRequest: true,
    permissions: true,
  },
];
const wanted = process.env.PB3_CONFIGS?.split(",");
const configs = wanted ? allConfigs.filter((config) => wanted.includes(config.name)) : allConfigs;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lines = [];
function emit(line) {
  lines.push(line);
  console.log(`PB3 ${JSON.stringify(line)}`);
}

// Listener hits are attributed to the attempt Main is running when they arrive. Main waits
// for the listeners to go quiet before it starts the next attempt.
let label = "startup";
let lastListenerEvent = 0;
async function settle() {
  const started = Date.now();
  await sleep(settleMs);
  while (Date.now() - lastListenerEvent < settleMs && Date.now() - started < 8000) await sleep(100);
}
const hits = new Map();
const emitted = new Map();
function counter(key = label) {
  if (key === label) lastListenerEvent = Date.now();
  let entry = hits.get(key);
  if (!entry) {
    entry = {
      httpRequests: 0,
      httpBytes: 0,
      wsUpgrades: 0,
      wsBytes: 0,
      tlsConnections: 0,
      tlsBytes: 0,
      turnConnections: 0,
      turnBytes: 0,
      stunDatagrams: 0,
      stunBytes: 0,
      quicDatagrams: 0,
      quicBytes: 0,
      httpPaths: [],
      protocolRequests: [],
      webRequestSeen: [],
      permissionAsks: [],
      console: [],
    };
    hits.set(key, entry);
  }
  return entry;
}
const push = (list, value) => list.length < 12 && list.push(String(value).slice(0, 200));
function take(key) {
  const entry = counter(key);
  const snapshot = JSON.parse(JSON.stringify(entry));
  emitted.set(key, JSON.stringify(entry));
  const connections =
    entry.httpRequests +
    entry.wsUpgrades +
    entry.tlsConnections +
    entry.turnConnections +
    entry.stunDatagrams +
    entry.quicDatagrams;
  const bytes =
    entry.httpBytes + entry.wsBytes + entry.tlsBytes + entry.turnBytes + entry.stunBytes + entry.quicBytes;
  return { egress: connections > 0, connections, bytes, ...snapshot };
}

const httpServer = http.createServer((request, response) => {
  const entry = counter();
  entry.httpRequests++;
  push(entry.httpPaths, `${request.method} ${request.url}`);
  let bytes =
    request.method.length +
    request.url.length +
    12 +
    request.rawHeaders.reduce((total, part) => total + part.length + 2, 0);
  request.on("data", (chunk) => (bytes += chunk.length));
  request.on("end", () => {
    entry.httpBytes += bytes;
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Private-Network": "true",
    };
    if (request.url.endsWith("/eventSource")) {
      response.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      response.write("data: pb3\n\n");
      setTimeout(() => response.end(), 500);
      return;
    }
    const type = request.url.endsWith(".mjs") || request.url.endsWith(".js") ? "text/javascript" : "text/plain";
    const body = request.url.endsWith(".mjs") ? "export default 42;" : "self.pb3Loaded = 1;";
    response.writeHead(request.method === "OPTIONS" ? 204 : 200, { ...cors, "Content-Type": type });
    response.end(request.method === "OPTIONS" ? undefined : body);
  });
});
httpServer.on("upgrade", (request, socket) => {
  const entry = counter();
  entry.wsUpgrades++;
  push(entry.httpPaths, `UPGRADE ${request.url}`);
  socket.on("error", () => {});
  socket.on("data", (chunk) => (entry.wsBytes += chunk.length));
  const accept = crypto
    .createHash("sha1")
    .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  setTimeout(() => socket.destroy(), 2000);
});
// TLS and TURN targets only count connections and bytes; they never answer, so a TLS
// ClientHello or a TURN Allocate request is enough to register as egress.
function byteCounter(prefix) {
  return net.createServer((socket) => {
    const entry = counter();
    entry[`${prefix}Connections`]++;
    socket.on("error", () => {});
    socket.on("data", (chunk) => (entry[`${prefix}Bytes`] += chunk.length));
    setTimeout(() => socket.destroy(), 1500);
  });
}
function datagramCounter(prefix) {
  const socket = dgram.createSocket("udp4");
  socket.on("message", (message) => {
    const entry = counter();
    entry[`${prefix}Datagrams`]++;
    entry[`${prefix}Bytes`] += message.length;
  });
  return socket;
}
const tlsServer = byteCounter("tls");
const turnServer = byteCounter("turn");
const stunSocket = datagramCounter("stun");
const quicSocket = datagramCounter("quic");
const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const bind = (socket) =>
  new Promise((resolve) => socket.bind(0, "127.0.0.1", () => resolve(socket.address().port)));

async function selfTest(ports) {
  label = "selftest";
  await fetch(`http://127.0.0.1:${ports.http}/selftest/main/fetch`).catch(() => {});
  for (const port of [ports.tls, ports.turn]) {
    await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => socket.end("pb3", resolve));
      socket.on("error", resolve);
    });
  }
  const sender = dgram.createSocket("udp4");
  for (const port of [ports.stun, ports.quic])
    await new Promise((resolve) => sender.send("pb3", port, "127.0.0.1", resolve));
  sender.close();
  if (typeof WebSocket === "function")
    await new Promise((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${ports.http}/selftest/main/ws`);
      socket.onopen = () => {
        socket.send("pb3");
        setTimeout(() => (socket.close(), resolve()), 100);
      };
      socket.onerror = resolve;
    });
  await sleep(settleMs);
  emit({ kind: "selftest", hits: take("selftest") });
}

const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript" };
function configureSession(config) {
  const partition = `pb3-${config.name}`;
  const target = session.fromPartition(partition);
  const policy = config.csp ? { "Content-Security-Policy": config.csp } : {};
  target.protocol.handle("moxi", async (request) => {
    const url = new URL(request.url);
    push(counter().protocolRequests, `${request.method} ${request.url}`);
    if (url.host === "app" && url.pathname.startsWith("/plugin-host/") && request.method === "GET") {
      const file = url.pathname.slice("/plugin-host/".length) || "index.html";
      if (/^[a-z-]+\.(html|js|mjs)$/.test(file) && fs.existsSync(path.join(hostDir, file)))
        return new Response(fs.readFileSync(path.join(hostDir, file)), {
          headers: { ...policy, "Content-Type": mime[path.extname(file)] },
        });
    }
    return new Response("Not found", { status: 404, headers: policy });
  });
  if (config.webRequest)
    target.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith("moxi://app/plugin-host/");
      push(
        counter().webRequestSeen,
        `${allowed ? "allow" : "cancel"} ${details.resourceType} ${details.url.slice(0, 120)}`,
      );
      callback({ cancel: !allowed });
    });
  if (config.permissions) {
    target.setPermissionRequestHandler((_contents, permission, callback) => {
      push(counter().permissionAsks, `request ${permission}`);
      callback(false);
    });
    target.setPermissionCheckHandler((_contents, permission) => {
      push(counter().permissionAsks, `check ${permission}`);
      return false;
    });
  }
  return { partition, target };
}

function exec(window, code, ms = 30000) {
  return Promise.race([
    window.webContents.executeJavaScript(code),
    sleep(ms).then(() => {
      throw new Error(`executeJavaScript timed out after ${ms} ms`);
    }),
  ]);
}

function sandboxState(window) {
  const pid = window.webContents.getOSProcessId();
  const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
  let seccomp;
  if (process.platform === "linux")
    try {
      seccomp = fs.readFileSync(`/proc/${pid}/status`, "utf8").match(/^Seccomp:\s*(\d)/m)?.[1];
    } catch (error) {
      seccomp = `unreadable: ${error.code}`;
    }
  return {
    rendererPid: pid,
    sandboxedMetric: metric?.sandboxed,
    seccomp,
    noSandboxSwitch: app.commandLine.hasSwitch("no-sandbox"),
  };
}

async function runConfig(config, ports) {
  const { partition, target } = configureSession(config);
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      webSecurity: true,
    },
  });
  window.webContents.on("console-message", (event, ...legacy) =>
    push(counter().console, event.message ?? legacy[1]),
  );
  window.webContents.on("render-process-gone", (_event, details) =>
    emit({ kind: "rendererGone", config: config.name, label, details }),
  );
  label = `${config.name}/start`;
  await window.loadURL("moxi://app/plugin-host/");
  const started = await exec(window, `window.pb3.start(${JSON.stringify({ config: config.name, ports })})`);
  emit({
    kind: "start",
    config: config.name,
    layers: config.layers,
    csp: config.csp ?? null,
    ...started,
    sandbox: sandboxState(window),
    hits: take(label),
  });
  for (const context of ["worker", "page"]) {
    const names = await exec(window, `window.pb3.names(${JSON.stringify(context)})`);
    for (const name of names) {
      label = `${config.name}/${context}/${name}`;
      let result;
      try {
        result = await exec(window, `window.pb3.run(${JSON.stringify(context)}, ${JSON.stringify(name)})`);
      } catch (error) {
        result = { outcome: "harnessError", detail: String(error) };
      }
      await settle();
      emit({ kind: "attempt", config: config.name, context, attempt: name, ...result, hits: take(label) });
    }
  }
  label = `${config.name}/main/sessionFetch`;
  let fetched;
  try {
    const response = await target.fetch(`http://127.0.0.1:${ports.http}/${label}`);
    fetched = { outcome: "succeeded", detail: `status ${response.status}` };
  } catch (error) {
    fetched = { outcome: "threw", detail: `${error?.name}: ${error?.message}`.slice(0, 300) };
  }
  await settle();
  emit({ kind: "attempt", config: config.name, context: "main", attempt: "sessionFetch", ...fetched, hits: take(label) });
  label = `${config.name}/afterClose`;
  window.destroy();
  await sleep(1500);
  emit({ kind: "afterClose", config: config.name, hits: take(label) });
}

function summarize() {
  const attempts = lines.filter((line) => line.kind === "attempt");
  const byConfig = {};
  for (const config of configs) {
    const own = attempts.filter((line) => line.config === config.name);
    const pick = (test) => own.filter(test).map((line) => `${line.context}/${line.attempt}`);
    byConfig[config.name] = {
      layers: config.layers,
      egress: pick((line) => line.hits.egress),
      succeeded: pick((line) => line.outcome === "succeeded"),
      afterCloseEgress: lines.find((line) => line.kind === "afterClose" && line.config === config.name)
        ?.hits.egress,
    };
  }
  const late = [];
  for (const [key, entry] of hits)
    if (emitted.has(key) && emitted.get(key) !== JSON.stringify(entry)) late.push({ label: key, final: entry });
  return { byConfig, late };
}

async function main() {
  const ports = {
    http: await listen(httpServer),
    tls: await listen(tlsServer),
    turn: await listen(turnServer),
    stun: await bind(stunSocket),
    quic: await bind(quicSocket),
  };
  emit({
    kind: "environment",
    date: new Date().toISOString(),
    platform: process.platform,
    osRelease: os.release(),
    imageOS: process.env.ImageOS ?? null,
    imageVersion: process.env.ImageVersion ?? null,
    runner: process.env.RUNNER_NAME ?? "local",
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    ports,
    configs: configs.map((config) => config.name),
  });
  await selfTest(ports);
  for (const config of configs) await runConfig(config, ports);
  label = "end";
  await sleep(1000);
  emit({ kind: "summary", elapsedMs: Math.round(performance.now()), ...summarize() });
  fs.mkdirSync(outDir, { recursive: true });
  const file = `results-${process.platform}.jsonl`;
  fs.writeFileSync(path.join(outDir, file), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  console.log(`PB3 wrote ${path.join(outDir, file)}`);
}

setTimeout(() => {
  console.error("PB3 watchdog: probe did not finish in 20 minutes");
  app.exit(2);
}, 20 * 60 * 1000).unref();
app.enableSandbox();
protocol.registerSchemesAsPrivileged([
  { scheme: "moxi", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
app.on("window-all-closed", () => {});
app
  .whenReady()
  .then(main)
  .then(
    () => app.exit(0),
    (error) => {
      console.error("PB3 failed", error);
      app.exit(1);
    },
  );
