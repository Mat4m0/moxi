import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const appPath = resolve(import.meta.dirname, "../apps/desktop");
const require = createRequire(join(appPath, "package.json"));
const executable: unknown = require("electron");
if (typeof executable !== "string") throw new Error("Electron executable is unavailable");
async function environment(data: string, cache: string) {
  const endpoint = createServer();
  await new Promise<void>((done, reject) => {
    endpoint.once("error", reject);
    endpoint.listen(0, "127.0.0.1", done);
  });
  const address = endpoint.address();
  await new Promise<void>((done, reject) =>
    endpoint.close((error) => (error ? reject(error) : done())),
  );
  if (!address || typeof address === "string") throw new Error("Missing local patch port");
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env))
    if (value !== undefined) env[name] = value;
  for (const name of [
    "ELECTRON_RUN_AS_NODE",
    "MOXI_CDP_PORT",
    "MOXI_LAUNCHER_URL",
    "MOXI_GAME_URL",
    "MOXI_PLUGINHOST_URL",
  ])
    delete env[name];
  return {
    ...env,
    MOXI_DATA_DIR: data,
    MOXI_GAME_CACHE: cache,
    MOXI_BACKGROUND: "1",
    MOXI_PATCH_ROOT: `http://127.0.0.1:${address.port}`,
  };
}

test("damaged settings cannot silently quit before the launcher opens", async ({ playwright }) => {
  const directory = await mkdtemp(join(tmpdir(), "moxi-startup-"));
  const data = join(directory, "data");
  await mkdir(data);
  await writeFile(join(data, "moxi.sqlite"), "damaged settings");
  try {
    const application = await playwright._electron.launch({
      executablePath: executable,
      args: [appPath],
      env: await environment(data, join(directory, "empty-cache")),
    });
    try {
      await expect
        .poll(() => application.windows().some((page) => page.url() === "moxi://app/launcher/"))
        .toBe(true);
      const launcher = application.windows().find((page) => page.url() === "moxi://app/launcher/");
      if (!launcher) throw new Error("Launcher did not open");
      await expect(launcher.getByRole("heading", { name: "Moxi Dev", exact: true })).toBeVisible();
      const files = (await readdir(data)).filter((name) =>
        /^moxi\.sqlite\.corrupt-.*Z$/.test(name),
      );
      expect(files).toHaveLength(1);
      expect(await readFile(join(data, files[0]!), "utf8")).toBe("damaged settings");
    } finally {
      await application.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unwritable data parent exits with code 1 before creating a window", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moxi-startup-"));
  const parent = join(directory, "readonly");
  await mkdir(parent);
  const data = join(parent, "data");
  const entry = join(directory, "startup.cjs");
  await writeFile(
    entry,
    `const { app } = require("electron");
app.on("browser-window-created", () => console.log("STARTUP_WINDOW_CREATED"));
import(${JSON.stringify(pathToFileURL(join(appPath, "dist/main.mjs")).href)});
`,
  );
  await chmod(parent, 0o555);
  try {
    const child = spawn(executable, [entry], {
      env: await environment(data, join(directory, "empty-cache")),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    let output = "";
    child.stdout.on("data", (bytes: Buffer) => {
      output += bytes.toString();
    });
    child.stderr.on("data", (bytes: Buffer) => {
      output += bytes.toString();
    });
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (done, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => done({ code, signal }));
      },
    );
    expect(result).toEqual({ code: 1, signal: null });
    expect(output).toContain(`[moxi] Cannot write data folder ${data}`);
    expect(output).not.toContain("STARTUP_WINDOW_CREATED");
  } finally {
    await chmod(parent, 0o755);
    await rm(directory, { recursive: true, force: true });
  }
});
