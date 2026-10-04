import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { expect, test } from "@playwright/test";

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

async function processes() {
  const { stdout } = await run("ps", ["-axo", "pid=,ppid="]);
  return stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [pid, parent] = line.trim().split(/\s+/).map(Number);
      return { pid, parent };
    });
}

test("shell keeps one launcher, rejects launcher actions from the game, and quits without orphan processes", async ({
  playwright,
}, testInfo) => {
  const data = await mkdtemp(join(tmpdir(), "moxi-e2e-"));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) env[name] = value;
  }
  env.MOXI_DATA_DIR = data;
  // An empty cache keeps ArenaNet's client out of the test; the game window shows its fallback.
  env.MOXI_GAME_CACHE = join(data, "game");
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MOXI_LAUNCHER_URL;
  delete env.MOXI_GAME_URL;
  delete env.MOXI_PLUGINHOST_URL;
  delete env.MOXI_CDP_PORT;
  for (let port = 4620; port <= 4629; port++) {
    const available = await new Promise<boolean>((done) => {
      const server = createServer();
      server.once("error", () => done(false));
      server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
    });
    if (available) {
      env.MOXI_CDP_PORT = String(port);
      break;
    }
  }
  if (!env.MOXI_CDP_PORT) {
    await rm(data, { recursive: true, force: true });
    throw new Error("No free CDP port in 4620–4629");
  }
  const application = await playwright._electron
    .launch({
      executablePath: executable,
      args: [appPath],
      env,
    })
    .catch(async (error: unknown) => {
      await rm(data, { recursive: true, force: true });
      throw error;
    });
  const child = application.process();
  const exit = exited(child);
  let second: ChildProcess | undefined;
  const owned = new Set<number>();
  if (child.pid) owned.add(child.pid);
  const drive = async (args: string[]) => {
    const result = await run("pnpm", ["drive", ...args], { env, cwd: root, timeout: 15_000 });
    console.log(`pnpm drive ${args.join(" ")} — exit 0\n${result.stdout.trim()}`);
    return result;
  };
  try {
    await expect
      .poll(() =>
        application
          .windows()
          .find((page) => page.url().startsWith("moxi://app/launcher/"))
          ?.url(),
      )
      .toBe("moxi://app/launcher/");
    const launcher = application
      .windows()
      .find((page) => page.url().startsWith("moxi://app/launcher/"));
    if (!launcher) throw new Error("Launcher did not open");
    await test.step("launcher shows the Dev identity and package version", async () => {
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
    await test.step("Play opens the game through the drive command", async () => {
      await drive(["click", "launcher", "Play"]);
      await expect
        .poll(() => application.windows().some((page) => page.url() === "moxi://app/game/"))
        .toBe(true);
    });
    const game = application.windows().find((page) => page.url() === "moxi://app/game/");
    if (!game) throw new Error("Game did not open");
    await test.step("Hub works above the unavailable client and closes with Escape", async () => {
      await expect(game.getByRole("status")).toHaveText(
        "The game client is unavailable. Run fetch-client and restart Moxi.",
      );
      await game.screenshot({ path: resolve(root, ".evidence/w1/game-before.png") });
      await game.keyboard.press(process.platform === "darwin" ? "Meta+r" : "Control+r");
      await expect(game.getByRole("dialog", { name: "Hub", exact: true })).toBeVisible();
      await game.getByRole("textbox").fill("10 ecto in p");
      await expect(
        game.getByText("10 Globs of Ectoplasm = 82 platinum", { exact: true }),
      ).toBeVisible();
      await game.screenshot({ path: resolve(root, ".evidence/w1/hub-open.png") });
      await game.keyboard.press("Escape");
      await expect(game.getByRole("textbox")).toHaveValue("");
      await game.keyboard.press("Escape");
      await expect(game.getByRole("dialog", { name: "Hub", exact: true })).toHaveCount(0);
    });
    await test.step("the game cannot invoke game.open", async () => {
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
    await test.step("a second launch focuses the first launcher and exits", async () => {
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((win) => win.webContents.getURL() === "moxi://app/launcher/")
          ?.hide();
      });
      second = spawn(executable, [appPath], { env, stdio: "ignore", timeout: 30_000 });
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
              focused: launchers[0]?.isFocused(),
            };
          }),
        )
        .toEqual({ count: 1, visible: true, focused: true });
    });
    await test.step("quitting exits cleanly and leaves no child processes", async () => {
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
  } finally {
    if (second && second.exitCode === null && second.signalCode === null) {
      second.kill("SIGKILL");
      await exited(second);
    }
    if (child.exitCode === null && child.signalCode === null) await application.close();
    for (const pid of owned) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        expect(error).toHaveProperty("code", "ESRCH");
      }
    }
    await rm(data, { recursive: true, force: true });
  }
});
