import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { expect } from "@playwright/test";
import { test, step, stageBudget, processes } from "./runtime.ts";
import { seedFixtureClient } from "@moxi/fixture-client";

const root = resolve(import.meta.dirname, "..");
const appPath = resolve(root, "apps/desktop");
const require = createRequire(join(appPath, "package.json"));
const executable: unknown = require("electron");
if (typeof executable !== "string") throw new Error("Electron executable is unavailable");
const run = promisify(execFile);

function exited(child: ChildProcess) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      done({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => done({ code, signal }));
  });
}

async function environment(data: string) {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) env[name] = value;
  }
  env.MOXI_DATA_DIR = data;
  // A closed local patch endpoint keeps ArenaNet out of both journeys.
  env.MOXI_GAME_CACHE = join(data, "game");
  env.MOXI_PATCH_ROOT = "http://127.0.0.1:0";
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MOXI_LAUNCHER_URL;
  delete env.MOXI_GAME_URL;
  delete env.MOXI_PLUGINHOST_URL;
  delete env.MOXI_CDP_PORT;
  return env;
}

test("shell keeps one launcher, rejects launcher actions from the game, and quits without orphan processes", async ({
  playwright,
  cleanup,
}, testInfo) => {
  const data = await mkdtemp(join(tmpdir(), "moxi-e2e-"));
  cleanup.data.push(data);
  const env = await environment(data);
  await step("prepare fixture client", () => seedFixtureClient(env.MOXI_GAME_CACHE!));
  const application = await step("start Electron", () =>
    playwright._electron.launch({
      executablePath: executable,
      args: [appPath],
      env,
      timeout: stageBudget,
    }),
  );
  cleanup.apps.push({ application, child: application.process() });
  const child = application.process();
  const exit = exited(child);
  let second: ChildProcess | undefined;
  const owned = new Set<number>();
  if (child.pid) owned.add(child.pid);
  const drive = async (args: string[]) => {
    if (child.exitCode === null && child.signalCode === null) {
      const port = Number(
        (await readFile(join(data, "DevToolsActivePort"), "utf8")).split("\n")[0],
      );
      await writeFile(join(data, "cdp.json"), JSON.stringify({ port }));
    }
    const result = await run("pnpm", ["drive", ...args], { env, cwd: root, timeout: stageBudget });
    console.log(`pnpm drive ${args.join(" ")} — exit 0\n${result.stdout.trim()}`);
    return result;
  };
  const frames: number[] = [];
  application.on("window", (page) => {
    page.on("console", (message) => {
      const match = /^\[gwkit\] frames=(\d+)$/.exec(message.text());
      if (match) frames.push(Number(match[1]));
    });
  });
  try {
    await step("wait for launcher", async () => {
      await expect
        .poll(() =>
          application
            .windows()
            .find((page) => page.url().startsWith("moxi://app/launcher/"))
            ?.url(),
        )
        .toBe("moxi://app/launcher/");
    });
    const launcher = application
      .windows()
      .find((page) => page.url().startsWith("moxi://app/launcher/"));
    if (!launcher) throw new Error("Launcher did not open");
    await step("launcher shows the Dev identity and package version", async () => {
      const manifest: unknown = JSON.parse(await readFile(join(appPath, "package.json"), "utf8"));
      if (
        typeof manifest !== "object" ||
        manifest === null ||
        !("version" in manifest) ||
        typeof manifest.version !== "string"
      )
        throw new Error("Missing app version");
      await expect(launcher.getByRole("heading", { name: "Moxi Dev", exact: true })).toBeVisible();
      await expect(
        launcher.getByText(`Version ${manifest.version}`, { exact: true }),
      ).toBeVisible();
      expect((await drive(["windows"])).stdout).toContain("launcher\tMoxi");
      await drive(["screenshot", "launcher", testInfo.outputPath("launcher.png")]);
    });
    await step("appearance saves Modern before opening the game", async () => {
      await launcher.getByRole("button", { name: "Settings", exact: true }).click();
      await launcher.getByRole("button", { name: "Appearance", exact: true }).click();
      await launcher.screenshot({ path: testInfo.outputPath("launcher-before.png") });
      await launcher.getByRole("combobox", { name: /^Panel style/ }).selectOption("obsidian");
      await expect(launcher.getByRole("combobox", { name: /^Panel style/ })).toHaveValue(
        "obsidian",
      );
      await launcher.screenshot({ path: testInfo.outputPath("launcher-after.png") });
    });
    await step("Play opens the game through the drive command", async () => {
      await expect(launcher.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
      await drive(["click", "launcher", "Play"]);
      await expect
        .poll(() => application.windows().some((page) => page.url() === "moxi://app/game/"))
        .toBe(true);
    });
    const game = application.windows().find((page) => page.url() === "moxi://app/game/");
    if (!game) throw new Error("Game did not open");
    await step("Hub works above the running fixture client and closes with Escape", async () => {
      await expect(game.getByRole("status")).toBeHidden();
      await expect.poll(() => frames.filter((frame) => frame > 0).length).toBeGreaterThanOrEqual(2);
      expect(frames.at(-1)!).toBeGreaterThan(frames.find((frame) => frame > 0)!);
      console.log(`Fixture gwkit frames: ${frames.join(" → ")}`);
      expect(
        await game
          .getByLabel("Guild Wars")
          .evaluate((canvas: HTMLCanvasElement) =>
            Array.from(canvas.getContext("2d")!.getImageData(0, 0, 1, 1).data),
          ),
      ).toEqual([16, 32, 48, 255]);
      await game.screenshot({ path: testInfo.outputPath("fixture-game.png") });
      await game.screenshot({ path: testInfo.outputPath("game-before.png") });
      await game.keyboard.press(process.platform === "darwin" ? "Meta+r" : "Control+r");
      await expect(game.getByRole("dialog", { name: "Hub", exact: true })).toBeVisible();
      await game.screenshot({ path: testInfo.outputPath("fixture-hub.png") });
      await expect(game.locator("html")).toHaveAttribute("data-ui-style", "obsidian");
      await game.screenshot({ path: testInfo.outputPath("hub-modern.png") });
      await launcher.getByRole("combobox", { name: /^Panel style/ }).selectOption("classic");
      await expect(game.locator("html")).toHaveAttribute("data-ui-style", "classic");
      await launcher.getByRole("combobox", { name: /^Panel style/ }).selectOption("custom");
      await launcher.getByRole("combobox", { name: /^Panel finish/ }).selectOption("modern");
      await expect(game.locator("html")).toHaveAttribute("data-ui-style", "obsidian");
      await expect(launcher.locator("html")).toHaveAttribute("data-ui-style", "obsidian");
      await launcher.getByRole("combobox", { name: /^Panel style/ }).selectOption("obsidian");
      await expect(game.locator("html")).toHaveAttribute("data-ui-style", "obsidian");
      await game.getByRole("textbox").fill("10 ecto in p");
      await expect(
        game.getByText("10 Globs of Ectoplasm = 82 platinum", { exact: true }),
      ).toBeVisible();
      await game.screenshot({ path: testInfo.outputPath("hub-open.png") });
      await game.keyboard.press("Escape");
      await expect(game.getByRole("textbox")).toHaveValue("");
      await game.keyboard.press("Escape");
      await expect(game.getByRole("dialog", { name: "Hub", exact: true })).toHaveCount(0);
    });
    await step("the game cannot invoke game.open", async () => {
      await expect(game.getByLabel("Guild Wars")).toBeVisible();
      expect(
        await game.evaluate(async () => {
          const bridge: unknown = Reflect.get(window, "moxi");
          if (
            typeof bridge !== "object" ||
            bridge === null ||
            !("invoke" in bridge) ||
            typeof bridge.invoke !== "function"
          )
            throw new Error("Game bridge is missing");
          try {
            await bridge.invoke("game.open", undefined);
            return "allowed";
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        }),
      ).toBe("This window cannot use that action.");
      await drive(["key", "game", "Escape"]);
      await drive(["screenshot", "game", testInfo.outputPath("game.png")]);
      expect((await drive(["windows"])).stdout).toContain("game\tMoxi");
    });
    await step("a second launch brings the existing launcher forward and exits", async () => {
      await application.evaluate(({ BrowserWindow }) => {
        const launcher = BrowserWindow.getAllWindows().find(
          (win) => win.webContents.getURL() === "moxi://app/launcher/",
        );
        if (!launcher) throw new Error("Launcher missing");
        launcher.minimize();
        launcher.hide();
        Reflect.set(globalThis, "launcherBroughtForward", false);
        const focus = launcher.focus.bind(launcher);
        launcher.focus = () => {
          Reflect.set(globalThis, "launcherBroughtForward", true);
          focus();
        };
      });
      second = spawn(executable, [appPath], {
        env,
        stdio: "ignore",
        detached: process.platform !== "win32",
        timeout: stageBudget,
        killSignal: "SIGKILL",
      });
      cleanup.children.push(second);
      expect(await exited(second)).toEqual({ code: 0, signal: null });
      console.log("Second launch: exit 0, signal null");
      await expect
        .poll(() =>
          application.evaluate(({ BrowserWindow }) => {
            const launchers = BrowserWindow.getAllWindows().filter(
              (win) => win.webContents.getURL() === "moxi://app/launcher/",
            );
            return {
              count: launchers.length,
              visible: launchers[0]?.isVisible(),
              minimized: launchers[0]?.isMinimized(),
              broughtForward: Reflect.get(globalThis, "launcherBroughtForward"),
            };
          }),
        )
        .toEqual({ count: 1, visible: true, minimized: false, broughtForward: true });
    });
    await step("quitting exits cleanly and leaves no child processes", async () => {
      const snapshot = await processes();
      let size = 0;
      while (size !== owned.size) {
        size = owned.size;
        for (const entry of snapshot)
          if (entry.pid && entry.parent && owned.has(entry.parent)) owned.add(entry.pid);
      }
      expect(owned.size).toBeGreaterThan(1);
      await application.close();
      expect(await exit).toEqual({ code: 0, signal: null });
      await expect
        .poll(async () => (await processes()).filter((entry) => entry.pid && owned.has(entry.pid)))
        .toEqual([]);
      console.log(`Quit: exit 0, signal null; ${owned.size} app processes checked, 0 remain`);
      await expect(drive(["windows"])).rejects.toThrow("Dev app is not running");
    });
    await step("relaunching with the same data folder keeps Modern selected", async () => {
      const relaunched = await step("restart Electron", () =>
        playwright._electron.launch({
          executablePath: executable,
          args: [appPath],
          env,
          timeout: stageBudget,
        }),
      );
      cleanup.apps.push({ application: relaunched, child: relaunched.process() });
      try {
        await expect
          .poll(() => relaunched.windows().some((page) => page.url() === "moxi://app/launcher/"))
          .toBe(true);
        const page = relaunched.windows().find((page) => page.url() === "moxi://app/launcher/");
        if (!page) throw new Error("Launcher did not reopen");
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await page.getByRole("button", { name: "Appearance", exact: true }).click();
        await expect(page.getByRole("combobox", { name: /^Panel style/ })).toHaveValue("obsidian");
        await page.screenshot({ path: testInfo.outputPath("launcher-reopened.png") });
      } finally {
        await step("close restarted Electron", () => relaunched.close());
      }
    });
  } finally {
    if (second && second.exitCode === null && second.signalCode === null) second.kill("SIGKILL");
  }
});

test("an offline fresh install refuses Play and offers repair", async ({
  playwright,
  cleanup,
}, testInfo) => {
  const data = await mkdtemp(join(tmpdir(), "moxi-e2e-"));
  cleanup.data.push(data);
  const env = await environment(data);
  const application = await step("start Electron", () =>
    playwright._electron.launch({
      executablePath: executable,
      args: [appPath],
      env,
      timeout: stageBudget,
    }),
  );
  cleanup.apps.push({ application, child: application.process() });
  await step("wait for offline launcher", async () => {
    await expect
      .poll(() => application.windows().some((page) => page.url() === "moxi://app/launcher/"))
      .toBe(true);
  });
  {
    const launcher = application.windows().find((page) => page.url() === "moxi://app/launcher/");
    if (!launcher) throw new Error("Launcher did not open");
    await step("an offline fresh install shows repair and rejects game.open", async () => {
      await expect(
        launcher.getByRole("button", { name: "Open Game Files", exact: true }),
      ).toBeEnabled();
      await expect(launcher.getByRole("button", { name: "Play", exact: true })).toHaveCount(0);
      expect(
        await launcher.evaluate(async () => {
          try {
            const bridge: unknown = Reflect.get(window, "moxi");
            if (
              typeof bridge !== "object" ||
              bridge === null ||
              !("invoke" in bridge) ||
              typeof bridge.invoke !== "function"
            )
              throw new Error("Launcher bridge is missing");
            await bridge.invoke("game.open", undefined);
            return "allowed";
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        }),
      ).toContain("This app action was rejected.");
      await launcher.getByRole("button", { name: "Open Game Files", exact: true }).click();
      await expect(launcher.getByText("Repair needed", { exact: true })).toBeVisible();
      await launcher.screenshot({ path: testInfo.outputPath("offline-repair.png") });
      await launcher.getByRole("button", { name: "Repair game files", exact: true }).click();
      await expect(
        launcher.getByRole("main").getByText("Downloading the playable client", { exact: true }),
      ).toBeVisible();
      await expect(launcher.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
      await expect(launcher.getByText("Repair needed", { exact: true })).toBeVisible();
      expect(application.windows().some((page) => page.url() === "moxi://app/game/")).toBe(false);
    });
  }
});
