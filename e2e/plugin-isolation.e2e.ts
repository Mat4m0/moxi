import { expect, test } from "@playwright/test";
import { seedFixtureClient } from "@moxi/fixture-client";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createServer } from "node:http";

const appPath = resolve(import.meta.dirname, "../apps/desktop");
const require = createRequire(join(appPath, "package.json"));
const executable: unknown = require("electron");
if (typeof executable !== "string") throw new Error("Electron executable is unavailable");

test("opaque plugin workers cannot access storage, game files or network and leave game IndexedDB untouched", async ({
  playwright,
}) => {
  const data = await mkdtemp(join(tmpdir(), "moxi-isolation-"));
  const patch = createServer((_request, response) => {
    response.writeHead(503);
    response.end();
  });
  await new Promise<void>((done) => patch.listen(0, "127.0.0.1", done));
  const address = patch.address();
  if (!address || typeof address === "string") throw new Error("No fixture patch address");
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env))
    if (value !== undefined) env[name] = value;
  env.MOXI_DATA_DIR = data;
  env.MOXI_BACKGROUND = "1";
  env.MOXI_GAME_CACHE = join(data, "game");
  env.MOXI_PATCH_ROOT = `http://127.0.0.1:${address.port}`;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MOXI_LAUNCHER_URL;
  delete env.MOXI_GAME_URL;
  delete env.MOXI_PLUGINHOST_URL;
  delete env.MOXI_CDP_PORT;
  let application: Awaited<ReturnType<typeof playwright._electron.launch>> | undefined;
  try {
    await seedFixtureClient(join(data, "game"));
    application = await playwright._electron.launch({
      executablePath: executable,
      args: [appPath],
      env,
      chromiumSandbox: true,
    });
    const started = application;
    await expect
      .poll(() => started.windows().some((page) => page.url() === "moxi://app/launcher/"))
      .toBe(true);
    const launcher = started.windows().find((page) => page.url() === "moxi://app/launcher/");
    if (!launcher) throw new Error("Launcher did not open");
    await expect(launcher.getByRole("button", { name: /^Play / })).toBeEnabled();
    const running = application;
    await launcher.getByRole("button", { name: /^Play / }).click();
    await expect
      .poll(() => running.windows().some((page) => page.url() === "moxi://app/game/"))
      .toBe(true);
    const game = running.windows().find((page) => page.url() === "moxi://app/game/");
    if (!game) throw new Error("Game did not open");
    await expect(game.getByRole("status")).toBeHidden();
    await game.keyboard.press(process.platform === "darwin" ? "Meta+r" : "Control+r");
    await expect(game.getByText("Isolation probe complete", { exact: true })).toBeVisible();
    await expect(
      game.getByText(
        '{"opaqueOrigin":true,"indexedDB":true,"cacheStorage":true,"client":true,"game":true,"https":true,"remoteImport":true,"webSocket":true,"importScripts":true}',
        { exact: true },
      ),
    ).toBeVisible();
    expect(await game.evaluate(() => indexedDB.databases())).toEqual([]);
    await game.getByRole("textbox").fill("10 ecto in p");
    await expect(
      game.getByText("10 Globs of Ectoplasm = 82 platinum", { exact: true }),
    ).toBeVisible();
    await game.screenshot({
      path: resolve(import.meta.dirname, "../.evidence/s1/isolated-plugin-calculator.png"),
    });
    const isolation = await application.evaluate(({ BrowserWindow, session }) => {
      const host = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.getURL() === "moxi://app/plugin-host/",
      );
      return {
        partitioned: host?.webContents.session === session.fromPartition("persist:plugins"),
        sharedWithGame: host?.webContents.session === session.defaultSession,
      };
    });
    expect(isolation).toEqual({ partitioned: true, sharedWithGame: false });
    expect(
      await application.evaluate(async ({ session }) => {
        const pluginSession = session.fromPartition("persist:plugins");
        const results = [];
        for (const path of ["client/Gw.snapshot", "game/", "launcher/"])
          results.push((await pluginSession.fetch(`moxi://app/${path}`)).status);
        const page = await pluginSession.fetch("moxi://app/plugin-host/");
        return {
          denied: results,
          host: page.status,
          csp: page.headers.get("Content-Security-Policy"),
        };
      }),
    ).toEqual({
      denied: [404, 404, 404],
      host: 200,
      csp: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src data:; connect-src 'none'",
    });
  } finally {
    await application?.close();
    await new Promise<void>((done, reject) =>
      patch.close((error) => (error ? reject(error) : done())),
    );
    await rm(data, { recursive: true, force: true });
  }
});
