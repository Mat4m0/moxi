import {
  app,
  BrowserWindow,
  Menu,
  MessageChannelMain,
  net,
  protocol,
  session,
  systemPreferences,
} from "electron";
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
import { createClientCache } from "../game-files/client.ts";
import { createClientReadiness } from "../client-readiness.ts";
import { createClientRoutes } from "./client.js";

import { openDatabase, migrations } from "../storage/index.js";
import { createPluginDocuments } from "../plugin-documents.ts";
import { loadPluginBundles } from "../plugin-bundles.ts";
import { pluginCsp } from "../plugin-isolation.ts";
import { createAppearanceSettings } from "../storage/appearance.js";

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
// Tests and agents run the app without a Dock icon, visible windows or focus changes.
// Not on Linux: Electron applies opacity there, which throttles a transparent window to
// about 1 fps, and a page screenshot after a style change never completes.
const background =
  !app.isPackaged && process.env.MOXI_BACKGROUND === "1" && process.platform !== "linux";
if (background && process.platform === "darwin") app.setActivationPolicy("accessory");
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
const patchRoot = !app.isPackaged ? process.env.MOXI_PATCH_ROOT : undefined;
const patchFetch: typeof fetch = patchRoot
  ? (url, init) => {
      const original = new URL(
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      );
      const root = new URL(patchRoot);
      if (
        root.protocol !== "http:" ||
        root.hostname !== "127.0.0.1" ||
        !Number.isInteger(Number(root.port)) ||
        Number(root.port) < 1 ||
        Number(root.port) > 65535
      )
        throw new Error("Invalid development patch root.");
      return fetch(new URL(original.pathname, root), init);
    }
  : fetch;
const cacheClient = createClientCache(folders.gameCache, patchFetch);
let client = createClientRoutes(folders.gameCache, patchFetch, cacheClient);
const readiness = createClientReadiness({
  prepare: cacheClient.prepare,
  observe: (progress) =>
    createClientRoutes(folders.gameCache, patchFetch, cacheClient).observe(progress),
  fill: (options) => createClientRoutes(folders.gameCache, patchFetch, cacheClient).fill(options),
  state: cacheClient.state,
  now: Date.now,
  log: (error) =>
    console.warn(
      "[moxi] Client preparation failed",
      error instanceof Error && "code" in error ? error.code : "client_prepare",
    ),
  changed: (value) => {
    for (const { kind, window } of windows.values())
      if (kind === "launcher" && !window.isDestroyed())
        window.webContents.send("client.readiness.changed", value);
  },
});
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
  if (kind === "game") client = createClientRoutes(folders.gameCache, patchFetch, cacheClient);
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    show: kind !== "pluginHost" && !background,
    title: identity.productName,
    webPreferences: {
      ...(kind === "pluginHost" ? { partition: "persist:plugins" } : {}),
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
  if (background) {
    win.setOpacity(0);
    win.setIgnoreMouseEvents(true);
  }
  windows.set(win.webContents.id, { kind, window: win });
  const id = win.webContents.id;
  if (kind === "game") {
    // Record a failed client update before the window goes away; closing always wins.
    let closing = false;
    const end = (crashed: boolean) => {
      if (closing) return;
      closing = true;
      void (sessions.get(id)?.client ?? client)
        .end(crashed)
        .then((failed) => (failed ? readiness.retry() : undefined))
        .catch((error: unknown) => console.warn("[moxi] Failed client was not recorded", error))
        .finally(() => {
          if (!win.isDestroyed()) win.destroy();
        });
    };
    win.on("close", (event) => {
      event.preventDefault();
      end(false);
    });
    win.webContents.on("render-process-gone", () => end(true));
  }
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
// Runs before the first window. AppKit reads the bundle's press-and-hold preference when it
// creates text clients; with it off, macOS sends native key repeats to the game's text fields
// (held letters, Backspace, arrows). The menu keeps Edit for Cmd+C/V/X/A and drops Reload.
function prepareKeyboard() {
  if (process.platform === "darwin") {
    systemPreferences.setUserDefault("ApplePressAndHoldEnabled", "boolean", false);
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]),
    );
  } else {
    Menu.setApplicationMenu(null);
  }
}
function reveal(win: BrowserWindow) {
  if (background) return win.showInactive();
  win.show();
  win.focus();
}
function showLauncher() {
  if (!launcher || launcher.isDestroyed()) launcher = createWindow("launcher");
  if (launcher.isMinimized()) launcher.restore();
  reveal(launcher);
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
      prepareKeyboard();
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
      const pluginSession = session.fromPartition("persist:plugins");
      pluginSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      pluginSession.setPermissionCheckHandler(() => false);
      pluginSession.protocol.handle("moxi", async (request) => {
        const url = new URL(request.url);
        const file = url.pathname.startsWith("/plugin-host/")
          ? resolveRendererPath(request.url, roots)
          : undefined;
        if (!file || request.method !== "GET")
          return new Response("Not found", {
            status: 404,
            headers: { "Content-Security-Policy": pluginCsp },
          });
        try {
          const response = await net.fetch(pathToFileURL(file).href);
          const headers = new Headers(response.headers);
          headers.set("Content-Security-Policy", pluginCsp);
          return new Response(response.body, { status: response.status, headers });
        } catch {
          return new Response("Not found", {
            status: 404,
            headers: { "Content-Security-Policy": pluginCsp },
          });
        }
      });
      const database = openDatabase({
        file: join(folders.data, "moxi.sqlite"),
        backupDir: join(folders.data, "backups"),
        appVersion: app.getVersion(),
        migrations,
      });
      app.once("will-quit", () => database.close());
      const appearance = createAppearanceSettings(database);
      const windowKind = (id: number) => windows.get(id)?.kind;
      const pluginDocuments = createPluginDocuments(database);
      handle("plugin.doc.read", (ref) => pluginDocuments.read(ref), windowKind);
      handle("plugin.doc.write", (request) => pluginDocuments.write(request), windowKind);
      handle("plugin.bundles", () => loadPluginBundles(roots["plugin-host"]), windowKind);
      pluginDocuments.onChange((change) => {
        for (const { kind, window } of windows.values())
          if (kind === "pluginHost" && !window.webContents.isDestroyed())
            window.webContents.send("plugin.doc.changed", change);
      });
      handle("appearance.get", () => appearance.get(), windowKind);
      handle(
        "appearance.set",
        (settings) => {
          appearance.set(settings);
          for (const entry of windows.values()) {
            if (entry.kind === "game" && !entry.window.webContents.isDestroyed())
              entry.window.webContents.send("appearance.changed", appearance.get());
          }
          return undefined;
        },
        windowKind,
      );
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
        async ({ token, frame }, owner) => {
          const session = sessions.get(owner);
          if (!session || session.token !== token)
            throw new Error("Game session is not connected.");
          return session.client.confirmHealthy(token, network.hasConnected(owner), frame);
        },
        windowKind,
      );
      handle(
        "game.client.failed",
        (token, owner) => {
          const session = sessions.get(owner);
          if (!session || session.token !== token)
            throw new Error("Stale client generation token.");
          session.client.reportFailure();
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
        "download.pause",
        () => {
          readiness.pause();
          return undefined;
        },
        windowKind,
      );
      handle(
        "download.resume",
        () => {
          readiness.resume();
          return undefined;
        },
        windowKind,
      );
      handle("client.readiness", () => readiness.current(), windowKind);
      handle(
        "client.retry",
        () => {
          void readiness.retry();
          return undefined;
        },
        windowKind,
      );
      void readiness.retry();
      handle(
        "game.open",
        () => {
          readiness.assertPlayable();
          if (!game || game.isDestroyed()) game = createWindow("game");
          reveal(game);
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
