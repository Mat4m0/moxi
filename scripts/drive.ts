import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const [command, kind, value, ...extra] = process.argv.slice(2);
const usage =
  "Usage: pnpm drive windows | screenshot <launcher|game> <file> | key <launcher|game> <keys> | click <launcher|game> <text>";

function windowKind(page: Page) {
  const url = new URL(page.url());
  if (url.protocol === "moxi:" && url.hostname === "app") {
    return url.pathname.split("/")[1];
  }
  if (url.hostname === "127.0.0.1") {
    return { "4611": "launcher", "4612": "game", "4613": "plugin-host" }[url.port];
  }
  return undefined;
}

async function drive() {
  if (
    extra.length ||
    (command === "windows"
      ? kind !== undefined
      : !["screenshot", "key", "click"].includes(command ?? "") ||
        !["launcher", "game"].includes(kind ?? "") ||
        !value)
  )
    throw new Error(usage);

  const file = resolve(process.env.MOXI_DATA_DIR ?? resolve(root, ".data"), "cdp.json");
  let port: number;
  try {
    const data: unknown = JSON.parse(await readFile(file, "utf8"));
    if (
      typeof data !== "object" ||
      data === null ||
      !("port" in data) ||
      typeof data.port !== "number" ||
      !Number.isInteger(data.port) ||
      data.port < 4620 ||
      data.port > 4629
    )
      throw new Error("Invalid CDP port");
    port = data.port;
  } catch {
    throw new Error(
      `Dev app is not running or its CDP file is invalid (${file}). Start pnpm dev; use the same MOXI_DATA_DIR.`,
    );
  }
  const browser = await chromium
    .connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5000 })
    .catch(() => {
      throw new Error(
        `Dev app is not running at CDP port ${port}. Start pnpm dev; use the same MOXI_DATA_DIR.`,
      );
    });
  try {
    const pages = browser.contexts().flatMap((context) => context.pages());
    if (command === "windows") {
      for (const page of pages) {
        const name = windowKind(page);
        if (name) console.log(`${name}\t${await page.title()}`);
      }
      return;
    }
    const page = pages.find((page) => windowKind(page) === kind);
    if (!page) throw new Error(`The ${kind} window is not open.`);
    if (command === "screenshot") await page.screenshot({ path: value });
    else if (command === "key") await page.keyboard.press(value ?? "");
    else await page.getByText(value ?? "", { exact: true }).click({ timeout: 5000 });
  } finally {
    // Closing a CDP connection disconnects the driver and leaves the Dev app running.
    await browser.close();
  }
}

try {
  await drive();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
