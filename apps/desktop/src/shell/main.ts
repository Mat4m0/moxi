import {
  app,
  BrowserWindow,
  Menu,
  MenuItem,
  MessageChannelMain,
  net,
  protocol,
  screen,
  session,
  systemPreferences,
} from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveIdentity } from "../identity.js";
import { resolveFolders } from "../folders.js";
import { createGameWeb } from "../game-web/index.js";
import { resolveRendererPath } from "../protocol-path.js";
import { hubPortMessage } from "@moxi/contracts/windows";
import type { Account, LauncherDestination, WindowKind } from "@moxi/contracts";
import { handle } from "./ipc.js";
import { createGameNetwork } from "../game-network/index.js";
import { createClientCache } from "../game-files/client.ts";
import { createClientReadiness } from "../client-readiness.ts";
import { createClientRoutes } from "./client.js";

import {
  openDatabase,
  migrations,
  createAccountStore,
  createAccountSelection,
} from "../storage/index.js";
import { createGameWindows } from "../game-windows.js";
import { createPluginDocuments } from "../plugin-documents.ts";
import { loadPluginBundles } from "../plugin-bundles.ts";
import { pluginCsp } from "../plugin-isolation.ts";
import { createAppearanceSettings } from "../storage/appearance.js";
import { createWindowStateSettings } from "../storage/window-state.js";
import { captureWindow, planWindow, type SavedWindowKind } from "../window-state.js";
import {
  accountMenuModel,
  afterPlay,
  onGameClosed,
  onLauncherClose,
  sameMenuModel,
  type AccountMenuEntry,
} from "../window-policy.js";

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
let windowState: ReturnType<typeof createWindowStateSettings> | undefined;
let accounts: ReturnType<typeof createAccountStore>;
let accountSelection: ReturnType<typeof createAccountSelection>;
const gameWindows = createGameWindows();
// One game window per account, each in its own browser partition.
const gameByAccount = new Map<string, BrowserWindow>();
const accountOfWindow = new Map<number, string>();
const accountRoutes = new Map<string, ReturnType<typeof createClientRoutes>>();
const preparedPartitions = new Set<string>();
let launcher: BrowserWindow | undefined;
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
// Work areas of every display, the primary first.
function workAreas() {
  const primary = screen.getPrimaryDisplay();
  const others = screen.getAllDisplays().filter((display) => display.id !== primary.id);
  return [primary, ...others].map((display) => display.workArea);
}
// Saves the normal bounds, not the full screen size, so leaving full screen restores the old size.
function rememberWindowState(win: BrowserWindow, kind: SavedWindowKind) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    if (win.isDestroyed() || !windowState) return;
    try {
      windowState.set(
        kind,
        captureWindow({
          normalBounds: win.getNormalBounds(),
          fullscreen: win.isFullScreen(),
          maximized: win.isMaximized(),
        }),
      );
    } catch (error) {
      console.warn("[moxi] Window state was not saved", error);
    }
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  win.on("resize", later);
  win.on("move", later);
  win.on("enter-full-screen", save);
  win.on("leave-full-screen", save);
  win.on("maximize", save);
  win.on("unmaximize", save);
  win.on("close", save);
  win.on("closed", () => clearTimeout(timer));
}
const partitionOf = (accountId: string) => `persist:account-${accountId}`;
let appHandlerFor: (accountId: string) => (request: Request) => Promise<Response>;
// A game session is its own browser profile, so two accounts never share cookies or saved files.
function prepareAccountSession(accountId: string) {
  const partition = partitionOf(accountId);
  if (preparedPartitions.has(partition)) return;
  preparedPartitions.add(partition);
  const accountSession = session.fromPartition(partition);
  const gamePermission = (contents: Electron.WebContents | null, permission: string) =>
    contents !== null &&
    windows.get(contents.id)?.kind === "game" &&
    (permission === "pointerLock" || permission === "fullscreen");
  accountSession.setPermissionRequestHandler((contents, permission, callback) =>
    callback(gamePermission(contents, permission)),
  );
  accountSession.setPermissionCheckHandler((contents, permission) =>
    gamePermission(contents, permission),
  );
  accountSession.protocol.handle("moxi", appHandlerFor(accountId));
}
function currentAccounts(): Account[] {
  const stored = accounts.list();
  const marked = accountSelection.ids(stored);
  return stored.map((entry) => ({
    ...entry,
    selected: marked.has(entry.id),
    ...gameWindows.state(entry.id),
  }));
}
function broadcastAccounts() {
  const list = currentAccounts();
  for (const { kind, window } of windows.values())
    if (kind === "launcher" && !window.isDestroyed())
      window.webContents.send("accounts.changed", list);
  refreshAccountsMenu();
}
function openGameCount() {
  return [...gameByAccount.values()].filter((window) => !window.isDestroyed()).length;
}
let quitting = false;
// Opens or shows each account's game window, then steps the launcher aside. The first account
// ends up in front. A refusal (the client is not ready) leaves the launcher where it is.
function playAccounts(ids: readonly string[]) {
  readiness.assertPlayable();
  const stored = accounts.list().filter((entry) => !entry.archived);
  const playable = new Set(stored.map((entry) => entry.id));
  const shown: BrowserWindow[] = [];
  for (const step of gameWindows.play(ids, playable)) {
    const existing = gameByAccount.get(step.accountId);
    if (step.do === "show" && existing && !existing.isDestroyed()) {
      reveal(existing);
      shown.push(existing);
      continue;
    }
    const entry = stored.find((candidate) => candidate.id === step.accountId);
    if (!entry) continue;
    const created = createWindow("game", { id: entry.id, name: entry.name });
    reveal(created);
    shown.push(created);
  }
  if (afterPlay(shown.length) === "hide-launcher") {
    reveal(shown[0]!);
    launcher?.hide();
  }
  broadcastAccounts();
}
function activateAccount(id: string) {
  try {
    playAccounts([id]);
  } catch {
    showLauncher("accounts");
  }
}
// Native menu: macOS only, like the rest of the menu. It is rebuilt only when an account name or
// state changed, so a menu the player has open is not disturbed.
let installedMenu: AccountMenuEntry[] | undefined;
function installApplicationMenu(entries: AccountMenuEntry[]) {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  installedMenu = entries;
  const menu = Menu.buildFromTemplate([
    { role: "appMenu" },
    {
      label: "Accounts",
      submenu: [
        { label: "Manage Accounts…", click: () => showLauncher("accounts") },
        { type: "separator" },
        ...entries.map((entry) => ({
          label: entry.label,
          enabled: entry.enabled,
          click: () => activateAccount(entry.id),
        })),
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ]);
  const windowMenu = menu.items.find((item) => item.role?.toLowerCase() === "windowmenu")?.submenu;
  windowMenu?.append(new MenuItem({ type: "separator" }));
  windowMenu?.append(new MenuItem({ label: "Show Launcher", click: () => showLauncher() }));
  Menu.setApplicationMenu(menu);
}
function refreshAccountsMenu() {
  if (process.platform !== "darwin") return;
  const entries = accountMenuModel(currentAccounts());
  if (installedMenu && sameMenuModel(installedMenu, entries)) return;
  installApplicationMenu(entries);
}
function createWindow(kind: WindowKind, account?: { id: string; name: string }) {
  const routes =
    kind === "game" ? createClientRoutes(folders.gameCache, patchFetch, cacheClient) : undefined;
  if (account && routes) {
    accountRoutes.set(account.id, routes);
    prepareAccountSession(account.id);
  }
  // Agents and tests run without remembered placement or full screen.
  const remembered = kind !== "pluginHost" && !background ? kind : undefined;
  const plan = remembered
    ? planWindow(remembered, windowState?.get(remembered) ?? null, workAreas())
    : undefined;
  // A second game window opens a little below and right of the last one, so they do not stack.
  const lastGame = [...gameByAccount.values()].filter((other) => !other.isDestroyed()).at(-1);
  const cascade =
    kind === "game" && lastGame && !plan?.maximized && !plan?.fullscreen
      ? { x: lastGame.getBounds().x + 30, y: lastGame.getBounds().y + 30 }
      : {};
  const win = new BrowserWindow({
    ...(plan?.bounds ?? { width: 960, height: 640 }),
    ...cascade,
    minWidth: 640,
    minHeight: 480,
    // Hidden until `reveal`, so a maximized window opens at full size instead of growing.
    show: false,
    title: account ? `${identity.productName} – ${account.name}` : identity.productName,
    webPreferences: {
      ...(kind === "pluginHost" ? { partition: "persist:plugins" } : {}),
      ...(account ? { partition: partitionOf(account.id) } : {}),
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
  if (remembered && plan) {
    if (plan.maximized) win.maximize();
    if (plan.fullscreen) win.setFullScreen(true);
    rememberWindowState(win, remembered);
  }
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
  // Dev only: the client's own messages explain a failed connect or login.
  if (kind === "game" && !app.isPackaged)
    win.webContents.on("console-message", ({ message, level }) => {
      if (message.startsWith("[client]") || level === "warning" || level === "error")
        console.info(message);
    });
  if (background) {
    win.setOpacity(0);
    win.setIgnoreMouseEvents(true);
  }
  windows.set(win.webContents.id, { kind, window: win });
  const id = win.webContents.id;
  let crashedWindow = false;
  if (kind === "game" && account && routes) {
    accountOfWindow.set(id, account.id);
    gameByAccount.set(account.id, win);
    gameWindows.opened(account.id);
    // Record a failed client update before the window goes away; closing always wins.
    let closing = false;
    const end = (crashed: boolean) => {
      if (closing) return;
      closing = true;
      crashedWindow = crashed;
      void (sessions.get(id)?.client ?? routes)
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
  if (kind === "launcher")
    win.on("close", (event) => {
      if (onLauncherClose({ gameWindows: openGameCount(), quitting }) === "hide") {
        event.preventDefault();
        win.hide();
      }
    });
  win.on("closed", () => {
    network.closeWindow(id);
    sessions.delete(id);
    windows.delete(id);
    const accountId = accountOfWindow.get(id);
    accountOfWindow.delete(id);
    if (accountId !== undefined) {
      if (gameByAccount.get(accountId) === win) gameByAccount.delete(accountId);
      gameWindows.ended(accountId, crashedWindow);
      broadcastAccounts();
      if (onGameClosed({ gameWindows: openGameCount(), quitting }) === "reveal-launcher")
        showLauncher();
    }
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
  }
  installApplicationMenu([]);
}
function reveal(win: BrowserWindow) {
  if (background) return win.showInactive();
  win.show();
  win.focus();
}
function showLauncher(destination?: LauncherDestination) {
  if (!launcher || launcher.isDestroyed()) launcher = createWindow("launcher");
  if (launcher.isMinimized()) launcher.restore();
  reveal(launcher);
  if (destination) launcher.webContents.send("launcher.navigate", destination);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (app.isReady()) showLauncher();
    else void app.whenReady().then(() => showLauncher());
  });
  app.on("activate", () => {
    if (app.isReady()) showLauncher();
  });
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("window-all-closed", () => app.quit());
  void app
    .whenReady()
    .then(() => {
      prepareKeyboard();
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      const gameWeb = createGameWeb((url, init) => net.fetch(url, init));
      const appHandler =
        (routes: () => ReturnType<typeof createClientRoutes> | undefined) =>
        async (request: Request): Promise<Response> => {
          const clientResponse = await routes()?.handle(request);
          if (clientResponse) {
            clientResponse.headers.set("Content-Security-Policy", csp);
            return clientResponse;
          }
          const webResponse = await gameWeb.handle(request);
          if (webResponse) {
            webResponse.headers.set("Content-Security-Policy", csp);
            return webResponse;
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
        };
      protocol.handle(
        "moxi",
        appHandler(() => undefined),
      );
      appHandlerFor = (accountId) => appHandler(() => accountRoutes.get(accountId));
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
      windowState = createWindowStateSettings(database);
      accounts = createAccountStore(database);
      accountSelection = createAccountSelection(database);
      refreshAccountsMenu();
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
          const routes = accountRoutes.get(accountOfWindow.get(owner) ?? "");
          if (!routes) throw new Error("This window has no account.");
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
      handle("accounts.list", () => currentAccounts(), windowKind);
      handle(
        "accounts.save",
        (input) => {
          accounts.save(input);
          broadcastAccounts();
          return currentAccounts();
        },
        windowKind,
      );
      handle(
        "accounts.archive",
        ({ id, archived }) => {
          if (gameWindows.running(id)) throw new Error("Close the account's game window first.");
          accounts.archive(id, archived);
          if (archived) accountSelection.drop(id);
          broadcastAccounts();
          return currentAccounts();
        },
        windowKind,
      );
      handle(
        "accounts.remove",
        async ({ id }) => {
          if (gameWindows.running(id)) throw new Error("Close the account's game window first.");
          accounts.remove(id);
          accountSelection.drop(id);
          gameWindows.forget(id);
          accountRoutes.delete(id);
          const accountSession = session.fromPartition(partitionOf(id));
          await accountSession.clearStorageData();
          await accountSession.clearCache();
          broadcastAccounts();
          return currentAccounts();
        },
        windowKind,
      );
      handle(
        "accounts.select",
        ({ ids }) => {
          accountSelection.set(ids, accounts.list());
          broadcastAccounts();
          return currentAccounts();
        },
        windowKind,
      );
      handle(
        "accounts.play",
        ({ ids }) => {
          playAccounts(ids);
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
