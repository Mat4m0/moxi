// PB10 only. Spliced into Main by probes/PB10/apply.mjs at CI time; never on main.
// Reads the sandbox signals Main can see at runtime, opens the fixture game once,
// counts plugin workers through CDP, writes one JSON file and quits.
import type { App, BrowserWindow as BrowserWindowType, WebContents } from "electron";
import { readFileSync, readlinkSync, writeFileSync } from "node:fs";

type Kind = "launcher" | "game" | "pluginHost";
type Options = {
  app: App;
  BrowserWindow: typeof BrowserWindowType;
  out: string;
  windows: () => { kind: Kind; contents: WebContents }[];
  openGame: () => void;
  readiness: () => unknown;
  noSandboxBeforeEnable: boolean;
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function proc(pid: number) {
  const read = (file: string) => {
    try {
      return readFileSync(`/proc/${pid}/${file}`, "utf8");
    } catch (error) {
      return `ERR ${error instanceof Error && "code" in error ? String(error.code) : "read"}`;
    }
  };
  const link = (file: string) => {
    try {
      return readlinkSync(`/proc/${pid}/${file}`);
    } catch (error) {
      return `ERR ${error instanceof Error && "code" in error ? String(error.code) : "read"}`;
    }
  };
  const status = read("status");
  const field = (name: string) => new RegExp(`^${name}:\\s*(.*)$`, "m").exec(status)?.[1] ?? null;
  const cmdline = read("cmdline").split(/[\0 ]/).filter(Boolean);
  return {
    seccomp: field("Seccomp"),
    seccompFilters: field("Seccomp_filters"),
    noNewPrivs: field("NoNewPrivs"),
    noSandboxArg: cmdline.includes("--no-sandbox"),
    typeArg: cmdline.find((arg) => arg.startsWith("--type=")) ?? null,
    userNs: link("ns/user"),
    pidNs: link("ns/pid"),
    netNs: link("ns/net"),
    apparmor: read("attr/current").trim(),
  };
}

async function until(test: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) return false;
    await sleep(100);
  }
  return true;
}

export function pb10Probe(options: Options) {
  const { app } = options;
  const t0 = Date.now();
  const events: string[] = [];
  const note = (text: string) => events.push(`${Date.now() - t0}ms ${text}`);
  const loaded = (kind: Kind) =>
    options.windows().some((w) => w.kind === kind && !w.contents.isLoading() && w.contents.getURL());
  void (async () => {
    const result: Record<string, unknown> = { t0 };
    try {
      result.launcherLoaded = await until(() => loaded("launcher"), 30_000);
      result.pluginHostLoaded = await until(() => loaded("pluginHost"), 30_000);
      note(`launcher=${result.launcherLoaded} pluginHost=${result.pluginHostLoaded}`);
      const host = options.windows().find((w) => w.kind === "pluginHost")?.contents;
      const workers = new Map<string, string>();
      const workersEver = new Set<string>();
      if (host) {
        try {
          host.debugger.attach("1.3");
          host.debugger.on("message", (_event, method, params) => {
            if (method === "Target.attachedToTarget" && params.targetInfo?.type === "worker") {
              workers.set(params.sessionId, params.targetInfo.title ?? params.targetInfo.url ?? "");
              workersEver.add(params.targetInfo.targetId);
            }
            if (method === "Target.detachedFromTarget") workers.delete(params.sessionId);
          });
          await host.debugger.sendCommand("Target.setAutoAttach", {
            autoAttach: true,
            waitForDebuggerOnStart: false,
            flatten: true,
          });
          note("cdp auto-attach on plugin host");
        } catch (error) {
          result.cdpError = String(error);
        }
      }
      result.readinessBeforeGame = options.readiness();
      options.openGame();
      result.gameLoaded = await until(() => loaded("game"), 30_000);
      note(`game=${result.gameLoaded}`);
      // Let the plugin host register plugins and start the game-activated worker.
      await until(() => workers.size > 0, 15_000);
      await sleep(5_000);
      result.readiness = options.readiness();
      result.workersLive = workers.size;
      result.workersEver = workersEver.size;
      result.workerNames = [...workers.values()].map((name) => name.slice(0, 60));
      result.noSandboxSwitch = app.commandLine.hasSwitch("no-sandbox");
      result.noSandboxSwitchBeforeEnableSandbox = options.noSandboxBeforeEnable;
      result.argvNoSandbox = process.argv.includes("--no-sandbox");
      result.argvSwitches = process.argv.slice(1).filter((arg) => arg.startsWith("--"));
      result.mainPid = process.pid;
      result.main = proc(process.pid);
      const kinds = new Map<number, Kind>();
      for (const w of options.windows())
        if (!w.contents.isDestroyed()) kinds.set(w.contents.getOSProcessId(), w.kind);
      result.processes = app.getAppMetrics().map((m) => ({
        pid: m.pid,
        type: m.type,
        serviceName: m.serviceName ?? null,
        window: kinds.get(m.pid) ?? null,
        // ProcessMetric.sandboxed is documented for darwin and win32 only.
        sandboxedField: "sandboxed" in m ? (m.sandboxed ?? "undefined") : "absent",
        ...proc(m.pid),
      }));
      const pluginHostPid = [...kinds].find(([, kind]) => kind === "pluginHost")?.[0];
      const hostProc = pluginHostPid ? proc(pluginHostPid) : undefined;
      // The refusal rule as written in DESIGN 15 (Linux branch), evaluated, not enforced.
      result.refusalRule = {
        pluginHostPid: pluginHostPid ?? null,
        pluginHostSeccomp: hostProc?.seccomp ?? null,
        wouldRefuseNonOfficial: result.noSandboxSwitch === true || hostProc?.seccomp !== "2",
      };
      // Candidate rule: layer 1 (namespace or SUID sandbox) gives the host its own PID namespace.
      const mainProc = proc(process.pid);
      result.namespaceRule = {
        hostOwnPidNs: hostProc ? hostProc.pidNs !== mainProc.pidNs : null,
        hostOwnNetNs: hostProc ? hostProc.netNs !== mainProc.netNs : null,
        hostOwnUserNs: hostProc ? hostProc.userNs !== mainProc.userNs : null,
        wouldRefuseNonOfficial:
          result.argvNoSandbox === true ||
          hostProc?.seccomp !== "2" ||
          !hostProc ||
          hostProc.pidNs === mainProc.pidNs,
      };
      // chrome://sandbox, when Electron serves it, is Chromium's own verdict.
      try {
        const win = new options.BrowserWindow({ show: false, webPreferences: { sandbox: true } });
        await Promise.race([win.loadURL("chrome://sandbox"), sleep(8_000)]);
        await sleep(1_000);
        const text: unknown = await Promise.race([
          win.webContents.executeJavaScript("document.body ? document.body.innerText : ''"),
          sleep(5_000).then(() => "TIMEOUT"),
        ]);
        result.chromeSandboxPage = typeof text === "string" ? text.slice(0, 1500) : String(text);
        win.destroy();
      } catch (error) {
        result.chromeSandboxPage = `ERR ${String(error).slice(0, 200)}`;
      }
    } catch (error) {
      result.error = String(error);
    }
    result.events = events;
    result.elapsedMs = Date.now() - t0;
    writeFileSync(options.out, JSON.stringify(result, null, 1));
    // Give the driver time to read /proc of the live process tree.
    await sleep(3_000);
    app.quit();
    // Game windows defer close until the client records the session; force exit if stuck.
    setTimeout(() => app.exit(0), 10_000);
  })();
}
