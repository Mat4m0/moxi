import { seedFixtureClient } from "@moxi/fixture-client";
import { spawn, type ChildProcess } from "node:child_process";
import { watch } from "node:fs";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { createRequire } from "node:module";

await new Promise<void>((done, reject) => {
  const build = spawn("node", ["scripts/build-plugins.ts", "--bundled"], { stdio: "inherit" });
  build.once("error", reject);
  build.once("exit", (code) => (code === 0 ? done() : reject(new Error("Plugin build failed"))));
});

const root = resolve(import.meta.dirname, "..");
await mkdir(resolve(root, ".data"), { recursive: true });
const fixtureCache = process.argv.includes("--fixture")
  ? await mkdtemp(resolve(root, ".data/fixture-"))
  : undefined;
if (fixtureCache) {
  await seedFixtureClient(fixtureCache);
  console.log("[dev] Fixture client active (no ArenaNet, no login)");
}
const children = new Set<ChildProcess>();
let stopping = false;
let electron: ChildProcess | undefined;
let restarting = false;
let restartPending = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const output = resolve(root, "apps/desktop/dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const require = createRequire(resolve(root, "apps/desktop/package.json"));
const electronBinary: unknown = require("electron");
if (typeof electronBinary !== "string") throw new Error("Electron executable is unavailable");
function start(command: string, args: string[], cwd = root, env = process.env) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.add(child);
  child.on("exit", () => {
    children.delete(child);
  });
  child.on("error", (error) => {
    console.error("[dev] Child failed", error);
    void shutdown(1);
  });
  return child;
}
function signal(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      killer.on("error", (error) => console.error("[dev] Could not stop child tree", error));
    } else process.kill(-child.pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const deadline = setTimeout(() => signal(child, "SIGKILL"), 3000);
    child.once("exit", () => {
      clearTimeout(deadline);
      done();
    });
    signal(child, "SIGTERM");
  });
}
async function shutdown(code: number) {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  watcher.close();
  await Promise.all([...children].map(stop));
  if (fixtureCache) await rm(fixtureCache, { recursive: true, force: true });
  process.exit(code);
}
let ready = false;
const watcher = watch(output, (_event, name) => {
  if (ready && name && /\.(mjs|cjs)$/.test(name)) schedule();
});
process.on("SIGINT", () => {
  void shutdown(0);
});
process.on("SIGTERM", () => {
  void shutdown(0);
});
const port = await (async () => {
  for (let candidate = 4620; candidate <= 4629; candidate++) {
    const free = await new Promise<boolean>((done) => {
      const server = createServer();
      server.once("error", () => done(false));
      server.listen(candidate, "127.0.0.1", () => server.close(() => done(true)));
    });
    if (free) return candidate;
  }
  throw new Error("No free CDP port in 4620–4629");
})();
const env = {
  ...process.env,
  ...(fixtureCache
    ? { MOXI_GAME_CACHE: fixtureCache, MOXI_PATCH_ROOT: "http://127.0.0.1:4699" }
    : {}),
  ...(process.argv.includes("--background") ? { MOXI_BACKGROUND: "1" } : {}),
  MOXI_CDP_PORT: String(port),
  MOXI_LAUNCHER_URL: "http://127.0.0.1:4611",
  MOXI_GAME_URL: "http://127.0.0.1:4612",
  MOXI_PLUGINHOST_URL: "http://127.0.0.1:4613",
};
async function launch() {
  if (stopping) return;
  if (restarting) {
    restartPending = true;
    return;
  }
  restarting = true;
  try {
    if (electron) await stop(electron);
    if (!stopping) {
      const app = start(String(electronBinary), [resolve(root, "apps/desktop")], root, env);
      electron = app;
      // The app quits when its last window closes; `pnpm dev` ends with it. A restart for a
      // rebuild stops the old app inside `launch`, where `restarting` is set.
      app.once("exit", () => {
        if (electron === app && !restarting && !stopping) void shutdown(0);
      });
      console.log(`[dev] Electron started (PID ${app.pid}), CDP 127.0.0.1:${port}`);
    }
  } finally {
    restarting = false;
    if (restartPending) {
      restartPending = false;
      schedule();
    }
  }
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    void launch();
  }, 200);
}
for (const [name, port] of [
  ["launcher", 4611],
  ["game", 4612],
  ["plugin-host", 4613],
] as const) {
  const child = start(
    "pnpm",
    ["exec", "vp", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    resolve(root, "apps", name),
  );
  child.on("exit", () => {
    if (!stopping) void shutdown(1);
  });
}
const pack = start("pnpm", ["exec", "vp", "pack", "--watch"], resolve(root, "apps/desktop"));
pack.on("exit", () => {
  if (!stopping) void shutdown(1);
});
try {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (stopping) break;
    const files = await Promise.all(
      ["main.mjs", "launcher.cjs", "game.cjs", "pluginHost.cjs"].map((file) =>
        access(resolve(output, file)).then(
          () => true,
          () => false,
        ),
      ),
    );
    const servers = await Promise.all(
      [4611, 4612, 4613].map((port) =>
        fetch(`http://127.0.0.1:${port}`).then(
          (response) => response.ok,
          () => false,
        ),
      ),
    );
    if (files.every(Boolean) && servers.every(Boolean)) {
      ready = true;
      await launch();
      break;
    }
    if (attempt === 299) throw new Error("Development services did not become ready");
    await new Promise((done) => setTimeout(done, 100));
  }
} catch (error) {
  console.error("[dev] Startup failed", error);
  await shutdown(1);
}
