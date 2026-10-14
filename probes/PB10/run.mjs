// PB10 case driver (CI only, ubuntu-24.04 under xvfb-run).
// Usage: node probes/PB10/run.mjs <case> -- <command> [args...]
// Seeds the fixture client into a fresh data folder, starts the packaged app with the
// PB10 hook, reads /proc of the whole process tree from outside, prints one PB10 JSON line.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedFixtureClient } from "../../tools/fixture-client/seed.ts";

const [name, separator, command, ...args] = process.argv.slice(2);
if (!name || separator !== "--" || !command) throw new Error("usage: run.mjs <case> -- <command> [args]");
const results = process.env.PB10_RESULTS ?? join(process.cwd(), "pb10-out");
mkdirSync(results, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sh = (cmd, cmdArgs) => {
  const r = spawnSync(cmd, cmdArgs, { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().slice(0, 2000) };
};

function system() {
  if (process.platform !== "linux") return { platform: process.platform };
  const sysctl = sh("sysctl", ["-n", "kernel.apparmor_restrict_unprivileged_userns"]).out;
  const unshare = sh("unshare", ["-Ur", "true"]);
  const aa = sh("sudo", ["-n", "aa-status"]);
  const profileLoaded = /^\s+moxi$/m.test(aa.out);
  let chromeSandbox = null;
  try {
    const s = statSync("/opt/Moxi/chrome-sandbox");
    chromeSandbox = { mode: (s.mode & 0o7777).toString(8), uid: s.uid };
  } catch {}
  return {
    apparmorRestrictUserns: sysctl,
    unshareUr: unshare.status === 0 ? "ok" : `fail(${unshare.status}): ${unshare.out.slice(0, 120)}`,
    moxiProfileLoaded: profileLoaded,
    chromeSandbox,
  };
}

function proc(pid) {
  const read = (file) => {
    try {
      return readFileSync(`/proc/${pid}/${file}`, "utf8");
    } catch {
      return "";
    }
  };
  const link = (file) => {
    try {
      return readlinkSync(`/proc/${pid}/${file}`);
    } catch {
      return null;
    }
  };
  const status = read("status");
  const field = (n) => new RegExp(`^${n}:\\s*(.*)$`, "m").exec(status)?.[1] ?? null;
  const cmdline = read("cmdline").split(/[\0 ]/).filter(Boolean);
  const stat = read("stat");
  const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
  return {
    pid,
    ppid,
    comm: read("comm").trim(),
    exe: link("exe"),
    typeArg: cmdline.find((a) => a.startsWith("--type=")) ?? null,
    noSandboxArg: cmdline.includes("--no-sandbox"),
    seccomp: field("Seccomp"),
    noNewPrivs: field("NoNewPrivs"),
    nsPid: field("NSpid"),
    userNs: link("ns/user"),
    pidNs: link("ns/pid"),
    apparmor: read("attr/current").trim(),
  };
}

function tree(root) {
  const all = readdirSync("/proc")
    .filter((d) => /^\d+$/.test(d))
    .map((d) => proc(Number(d)))
    .filter((p) => p.comm);
  const keep = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of all)
      if (!keep.has(p.pid) && keep.has(p.ppid)) {
        keep.add(p.pid);
        grew = true;
      }
  }
  return all.filter((p) => keep.has(p.pid));
}

const data = await mkdtemp(join(tmpdir(), `pb10-${name}-`));
await seedFixtureClient(join(data, "game"));
const hookOut = join(data, "pb10-hook.json");
const before = system();
const started = Date.now();
const child = spawn(command, args, {
  env: {
    ...process.env,
    MOXI_DATA_DIR: data,
    MOXI_GAME_CACHE: join(data, "game"),
    MOXI_PROBE_PB10: hookOut,
    ELECTRON_ENABLE_LOGGING: "1",
  },
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
const keep = (chunk) => {
  if (output.length < 400_000) output += chunk.toString();
};
child.stdout.on("data", keep);
child.stderr.on("data", keep);
let exit = null;
child.on("exit", (code, signal) => (exit = { code, signal, afterMs: Date.now() - started }));

let external = null;
let hook = null;
while (Date.now() - started < 120_000) {
  if (exit) break;
  if (existsSync(hookOut)) {
    external = tree(child.pid);
    await sleep(300);
    hook = JSON.parse(readFileSync(hookOut, "utf8"));
    break;
  }
  await sleep(200);
}
const hookSeenBeforeExit = Boolean(hook);
if (!hook && existsSync(hookOut)) hook = JSON.parse(readFileSync(hookOut, "utf8"));
for (let i = 0; i < 100 && !exit; i++) await sleep(200);
if (!exit) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {}
  await sleep(1000);
}
// Leftovers outside the group (zygotes, the AppImage FUSE child): match the executable path.
for (const d of existsSync("/proc") ? readdirSync("/proc").filter((d) => /^\d+$/.test(d)) : []) {
  let exe = "";
  try {
    exe = readlinkSync(`/proc/${d}/exe`);
  } catch {}
  if (exe.startsWith("/opt/Moxi/") || exe.includes("/.mount_Moxi") || exe.endsWith(".AppImage"))
    try {
      process.kill(Number(d), "SIGKILL");
    } catch {}
}
await sleep(1000);

const lines = output.split("\n");
const sandboxLines = lines
  .filter((l) => /sandbox|zygote|namespace|seccomp|FATAL/i.test(l))
  .slice(0, 12)
  .map((l) => l.slice(0, 300));
const renderersMain = (hook?.processes ?? []).filter((p) => p.type === "Tab");
const renderersExternal = (external ?? []).filter(
  (p) => p.typeArg === "--type=renderer" || renderersMain.some((m) => m.pid === p.pid),
);
const mainExternal = (external ?? []).find((p) => p.pid === hook?.mainPid);
const summary = {
  probe: "PB10",
  case: name,
  command: [command, ...args].join(" "),
  system: before,
  started: hook?.launcherLoaded === true,
  exit: exit ?? { code: null, signal: "killed-by-driver" },
  hookSeenBeforeExit,
  hookError: hook?.error ?? null,
  noSandboxSwitch: hook?.noSandboxSwitch ?? null,
  noSandboxSwitchBeforeEnableSandbox: hook?.noSandboxSwitchBeforeEnableSandbox ?? null,
  argvNoSandbox: hook?.argvNoSandbox ?? null,
  mainArgvSwitches: hook?.argvSwitches ?? null,
  mainUserNsEqualsRunner: mainExternal ? mainExternal.userNs === readlinkSync("/proc/self/ns/user") : null,
  renderers: renderersMain.map((p) => ({
    window: p.window,
    seccomp: p.seccomp,
    noSandboxArg: p.noSandboxArg,
    typeArg: p.typeArg,
    nsPid: p.nsPid,
    ownNetNs: hook?.main ? p.netNs !== hook.main.netNs : null,
    ownUserNs: hook?.main ? p.userNs !== hook.main.userNs : null,
    ownPidNs: hook?.main ? p.pidNs !== hook.main.pidNs : null,
    sandboxedField: p.sandboxedField,
  })),
  otherProcesses: (hook?.processes ?? [])
    .filter((p) => p.type !== "Tab")
    .map((p) => `${p.type}${p.serviceName ? `/${p.serviceName}` : ""}:seccomp=${p.seccomp},nosb=${p.noSandboxArg},field=${p.sandboxedField}`),
  externalRenderers: renderersExternal.map((p) => ({ pid: p.pid, typeArg: p.typeArg, seccomp: p.seccomp, nsPid: p.nsPid, noSandboxArg: p.noSandboxArg, apparmor: p.apparmor })),
  externalOthers: (external ?? []).filter((p) => !renderersExternal.includes(p)).map((p) => `${p.typeArg ?? p.comm}:seccomp=${p.seccomp},nosb=${p.noSandboxArg}`),
  externalAgrees:
    hook && external
      ? renderersMain.every((m) =>
          renderersExternal.some((e) => e.pid === m.pid && e.seccomp === m.seccomp && e.nsPid === m.nsPid),
        )
      : null,
  mainApparmor: mainExternal?.apparmor ?? hook?.main?.apparmor ?? null,
  gameLoaded: hook?.gameLoaded ?? null,
  workersLive: hook?.workersLive ?? null,
  workerNames: hook?.workerNames ?? null,
  cdpError: hook?.cdpError ?? null,
  refusalRule: hook?.refusalRule ?? null,
  namespaceRule: hook?.namespaceRule ?? null,
  statusRule: hook?.statusRule ?? null,
  readiness: hook?.readiness ?? null,
  chromeSandboxPage: typeof hook?.chromeSandboxPage === "string" ? hook.chromeSandboxPage.replace(/\s+/g, " ").slice(0, 600) : null,
  sandboxLogLines: sandboxLines,
};
writeFileSync(join(results, `${name}.json`), JSON.stringify({ summary, hook, external, logTail: lines.slice(-80) }, null, 1));
console.log(`PB10 ${JSON.stringify(summary)}`);
