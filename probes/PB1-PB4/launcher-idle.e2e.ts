// PB1 part: idle footprint of the real launcher renderer (and of today's plugin-host renderer) in the fixture app.
import { expect, test } from "@playwright/test";
import { seedFixtureClient } from "@moxi/fixture-client";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createServer } from "node:http";

const root = resolve(import.meta.dirname, "../..");
const appPath = resolve(root, "apps/desktop");
const appRequire = createRequire(join(appPath, "package.json"));
const executable: unknown = appRequire("electron");
if (typeof executable !== "string") throw new Error("Electron executable is unavailable");
const probeRequire = createRequire(import.meta.url);
const { sampleProcess, processStatus } = probeRequire("./lib/smaps.cjs");
const { summarize } = probeRequire("./lib/stats.cjs");
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

test("launcher renderer idle footprint", async ({ playwright }) => {
  const config = JSON.parse(await readFile(join(import.meta.dirname, "run-config.json"), "utf8"));
  const { warmupMs, samples } = config.launcher as { warmupMs: number; samples: number };
  const data = await mkdtemp(join(tmpdir(), "moxi-launcher-idle-"));
  const patch = createServer((_request, response) => {
    response.writeHead(503);
    response.end();
  });
  await new Promise<void>((done) => patch.listen(0, "127.0.0.1", done));
  const address = patch.address();
  if (!address || typeof address === "string") throw new Error("No fixture patch address");
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
  env.MOXI_DATA_DIR = data;
  env.MOXI_BACKGROUND = "1";
  env.MOXI_GAME_CACHE = join(data, "game");
  env.MOXI_PATCH_ROOT = `http://127.0.0.1:${address.port}`;
  for (const name of ["ELECTRON_RUN_AS_NODE", "MOXI_LAUNCHER_URL", "MOXI_GAME_URL", "MOXI_PLUGINHOST_URL", "MOXI_CDP_PORT"])
    delete env[name];
  let application: Awaited<ReturnType<typeof playwright._electron.launch>> | undefined;
  try {
    await seedFixtureClient(join(data, "game"));
    application = await playwright._electron.launch({ executablePath: executable, args: [appPath], env });
    const started = application;
    await expect
      .poll(() => started.windows().some((page) => page.url() === "moxi://app/launcher/"))
      .toBe(true);
    const launcher = started.windows().find((page) => page.url() === "moxi://app/launcher/");
    if (!launcher) throw new Error("Launcher did not open");
    await expect(launcher.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    const windows = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        url: window.webContents.getURL(),
        pid: window.webContents.getOSProcessId(),
      })),
    );
    const launcherPid = windows.find((w) => w.url === "moxi://app/launcher/")?.pid;
    const hostPid = windows.find((w) => w.url === "moxi://app/plugin-host/")?.pid;
    if (!launcherPid) throw new Error("No launcher pid: " + JSON.stringify(windows));
    await sleep(warmupMs);
    const pids: Record<string, number | undefined> = { launcher: launcherPid, todaysPluginHost: hostPid };
    const series: Record<string, { privateKiB: number[]; pssKiB: number[]; rssKiB: number[] }> = {};
    for (const key of Object.keys(pids)) series[key] = { privateKiB: [], pssKiB: [], rssKiB: [] };
    const start = Date.now();
    for (let i = 0; i < samples; i++) {
      const wait = start + i * 1000 - Date.now();
      if (wait > 0) await sleep(wait);
      for (const [key, pid] of Object.entries(pids)) {
        if (!pid) continue;
        const s = sampleProcess(pid);
        series[key].privateKiB.push(s.privateKiB);
        series[key].pssKiB.push(s.pssKiB);
        series[key].rssKiB.push(s.rssKiB);
      }
    }
    const summary: Record<string, unknown> = {};
    for (const [key, s] of Object.entries(series)) {
      summary[key] = {
        pid: pids[key],
        status: pids[key] ? processStatus(pids[key]) : null,
        privateMiB: summarize(s.privateKiB.map((v: number) => v / 1024)),
        pssMiB: summarize(s.pssKiB.map((v: number) => v / 1024)),
        series: s.privateKiB,
      };
    }
    const result = {
      probe: "PB1",
      part: "launcher-idle",
      env: {
        platform: process.platform,
        runner: { ImageOS: process.env.ImageOS, ImageVersion: process.env.ImageVersion, RUNNER_NAME: process.env.RUNNER_NAME },
      },
      config: { warmupMs, samples },
      summary,
    };
    await mkdir(join(import.meta.dirname, "out"), { recursive: true });
    await writeFile(join(import.meta.dirname, "out/launcher-idle.json"), JSON.stringify(result, null, 1));
    console.log("PROBE_JSON " + JSON.stringify({ launcherIdle: { launcher: (summary.launcher as { privateMiB: unknown }).privateMiB, todaysPluginHost: (summary.todaysPluginHost as { privateMiB: unknown } | undefined)?.privateMiB } }));
  } finally {
    await application?.close();
    await new Promise<void>((done, reject) => patch.close((error) => (error ? reject(error) : done())));
    await rm(data, { recursive: true, force: true });
  }
});
