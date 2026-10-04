import { app, BrowserWindow, MessageChannelMain, net, protocol, session } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveIdentity } from "../identity.js";
import { resolveFolders } from "../folders.js";
import { resolveRendererPath } from "../protocol-path.js";
import { hubPortMessage } from "@moxi/contracts/windows";
import type { WindowKind } from "@moxi/contracts";
import { handle } from "./ipc.js";
import { createGameNetwork } from "../game-network/index.js";
import { createClientRoutes } from "./client.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const identity = resolveIdentity(app.isPackaged);
const cache =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Caches")
    : process.platform === "win32"
      ? (process.env.LOCALAPPDATA ?? app.getPath("appData"))
      : (process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"));
const folders = resolveFolders({
  packaged: app.isPackaged,
  repoRoot,
  env: process.env,
  platformDirs: { appData: app.getPath("appData"), cache },
});
app.setName(identity.productName);
mkdirSync(folders.data, { recursive: true });
app.setPath("userData", folders.data);
app.setAppUserModelId(identity.appId);
app.enableSandbox();
protocol.registerSchemesAsPrivileged([
  {
    scheme: "moxi",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
if (!app.isPackaged && process.env.MOXI_CDP_PORT) {
  const port = Number(process.env.MOXI_CDP_PORT);
  if (!Number.isInteger(port) || port < 4620 || port > 4629)
    throw new Error("Invalid development CDP port");
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  app.commandLine.appendSwitch("remote-debugging-port", String(port));
  writeFileSync(join(folders.data, "cdp.json"), JSON.stringify({ port }));
}
const windows = new Map<number, { kind: WindowKind; window: BrowserWindow }>();
const network = createGameNetwork((owner, event) => {
  const contents = windows.get(owner)?.window.webContents;
  if (contents && !contents.isDestroyed()) contents.send("game.net.event", event);
});
const sessions = new Map<
  number,
  { client: ReturnType<typeof createClientRoutes>; token: string }
>();
let launcher: BrowserWindow | undefined;
let game: BrowserWindow | undefined;
let pluginHost: BrowserWindow;
let pluginHostReady: Promise<void>;
let client = createClientRoutes(folders.gameCache);
const csp =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'";
// electron-builder.config.ts copies each renderer's dist to renderers/<name>.
const rendererRoot = (name: string) =>
  app.isPackaged ? join(app.getAppPath(), "renderers", name) : join(repoRoot, "apps", name, "dist");
const roots = {
  launcher: rendererRoot("launcher"),
  game: rendererRoot("game"),
  "plugin-host": rendererRoot("plugin-host"),
};
function createWindow(kind: WindowKind) {
  if (kind === "game") client = createClientRoutes(folders.gameCache);
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    show: kind !== "pluginHost",
    title: identity.productName,
    webPreferences: {
      preload: join(import.meta.dirname, `${kind}.cjs`),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The client advances its main loop, including network delivery, on
      // animation frames; plugins must keep answering while the game is busy.
      backgroundThrottling: kind === "launcher",
      webSecurity: true,
    },
  });
  if (kind === "game") {
    const loaded = new Promise<void>((done) =>
      win.webContents.once("did-finish-load", () => done()),
    );
    void Promise.all([loaded, pluginHostReady]).then(() => {
      if (win.isDestroyed()) return;
      const { port1, port2 } = new MessageChannelMain();
      pluginHost.webContents.postMessage(hubPortMessage, win.webContents.id, [port1]);
      win.webContents.postMessage(hubPortMessage, win.webContents.id, [port2]);
      const sessionId = win.webContents.id;
      win.once("closed", () => {
        if (!pluginHost.isDestroyed())
          pluginHost.webContents.postMessage(hubPortMessage, sessionId);
      });
    });
  }
  windows.set(win.webContents.id, { kind, window: win });
  const id = win.webContents.id;
  win.on("closed", () => {
    network.closeWindow(id);
    sessions.delete(id);
    windows.delete(id);
    if (![...windows.values()].some((entry) => entry.kind !== "pluginHost")) app.quit();
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.on("will-frame-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const route = kind === "pluginHost" ? "plugin-host" : kind;
  const devUrl = !app.isPackaged ? process.env[`MOXI_${kind.toUpperCase()}_URL`] : undefined;
  void win
    .loadURL(kind === "game" ? "moxi://app/game/" : (devUrl ?? `moxi://app/${route}/`))
    .then(() => {
      if (kind === "launcher") console.log(`[moxi] launcher loaded ${win.webContents.getURL()}`);
    })
    .catch((error: unknown) => console.error("[moxi] Window could not load", error));
  return win;
}
function showLauncher() {
  if (!launcher || launcher.isDestroyed()) launcher = createWindow("launcher");
  if (launcher.isMinimized()) launcher.restore();
  launcher.show();
  launcher.focus();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (app.isReady()) showLauncher();
    else void app.whenReady().then(showLauncher);
  });
  app.on("activate", () => {
    if (app.isReady()) showLauncher();
  });
  app.on("window-all-closed", () => app.quit());
  void app
    .whenReady()
    .then(() => {
      session.defaultSession.setPermissionRequestHandler((contents, permission, callback) =>
        callback(
          windows.get(contents.id)?.kind === "game" &&
            (permission === "pointerLock" || permission === "fullscreen"),
        ),
      );
      session.defaultSession.setPermissionCheckHandler(
        (contents, permission) =>
          contents !== null &&
          windows.get(contents.id)?.kind === "game" &&
          (permission === "pointerLock" || permission === "fullscreen"),
      );
      protocol.handle("moxi", async (request) => {
        const clientResponse = await client.handle(request);
        if (clientResponse) {
          clientResponse.headers.set("Content-Security-Policy", csp);
          return clientResponse;
        }
        const url = new URL(request.url);
        if (
          request.method === "GET" &&
          url.host === "app" &&
          !app.isPackaged &&
          process.env.MOXI_GAME_URL &&
          ["/game/", "/src/", "/@vite/", "/@fs/", "/@id/", "/node_modules/"].some((prefix) =>
            url.pathname.startsWith(prefix),
          )
        ) {
          const path = url.pathname.startsWith("/game/")
            ? url.pathname.slice("/game".length)
            : url.pathname;
          const upstream = new URL(path + url.search, process.env.MOXI_GAME_URL);
          return net.fetch(upstream.href);
        }
        const file = resolveRendererPath(request.url, roots);
        if (!file || request.method !== "GET")
          return new Response("Not found", {
            status: 404,
            headers: { "Content-Security-Policy": csp },
          });
        try {
          const response = await net.fetch(pathToFileURL(file).href);
          const headers = new Headers(response.headers);
          headers.set("Content-Security-Policy", csp);
          return new Response(response.body, { status: response.status, headers });
        } catch {
          return new Response("Not found", {
            status: 404,
            headers: { "Content-Security-Policy": csp },
          });
        }
      });
      const windowKind = (id: number) => windows.get(id)?.kind;
      handle(
        "game.client",
        async (_request, owner) => {
          const routes = client;
          const info = await routes.info();
          if (windows.has(owner))
            sessions.set(owner, { client: routes, token: info.generationToken });
          return info;
        },
        windowKind,
      );
      handle(
        "game.net.connect",
        (request, owner) => network.connect(owner, request.id, request.destination),
        windowKind,
      );
      handle(
        "game.net.write",
        (request, owner) => network.write(owner, request.id, request.bytes),
        windowKind,
      );
      handle("game.net.close", (request, owner) => network.close(owner, request.id), windowKind);
      handle(
        "game.net.ack",
        (request, owner) => network.ack(owner, request.id, request.bytes),
        windowKind,
      );
      handle("game.dns", (name) => network.resolve(name), windowKind);
      handle(
        "game.net.healthy",
        async (token, owner) => {
          const session = sessions.get(owner);
          if (!session || session.token !== token)
            throw new Error("Game session is not connected.");
          await session.client.confirmHealthy(token, network.hasConnected(owner));
          return undefined;
        },
        windowKind,
      );
      handle(
        "app.info",
        () => ({
          productName: identity.productName,
          version: app.getVersion(),
          channel: identity.channel,
        }),
        windowKind,
      );
      handle(
        "game.open",
        () => {
          if (!game || game.isDestroyed()) game = createWindow("game");
          game.show();
          game.focus();
          return undefined;
        },
        windowKind,
      );
      pluginHost = createWindow("pluginHost");
      pluginHostReady = new Promise((done) =>
        pluginHost.webContents.once("did-finish-load", () => done()),
      );
      showLauncher();
    })
    .catch((error: unknown) => {
      console.error("[moxi] Startup failed", error);
      app.quit();
    });
}
