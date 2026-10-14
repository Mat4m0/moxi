"use strict";
// PB9 probe app: one fixture game window, a `before-input-event` handler with the reference
// chord router, and a page key logger. The driver (drive.cjs) calls globalThis.pb9 through
// Playwright's app.evaluate. Probe code, not product code.
const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const os = require("node:os");
const path = require("node:path");
const { ChordRouter } = require("../lib/chord.cjs");

const MENU = process.env.PB9_MENU === "null" ? "null" : "default";
const mac = process.platform === "darwin";
if (MENU === "null") Menu.setApplicationMenu(null);

const hr = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const bindings = [
  { id: "hub.toggle", scope: "always", code: "KeyR", ctrl: !mac, meta: mac },
  { id: "plugin.quick-travel", scope: "world", code: "KeyK", ctrl: !mac, meta: mac },
];

const st = {
  mode: "observe", // observe | swallow | down-only
  session: "world", // login | charselect | world
  mainLog: [],
  pageLog: [],
  decisions: [],
  fired: [],
  loads: 0,
  loadsAtReset: 0,
};
let router = new ChordRouter({ bindings });
let win = null;

ipcMain.on("pagekey", (_event, rec) => {
  st.pageLog.push({ t: hr(), ...rec });
});

function menuReport() {
  const menu = Menu.getApplicationMenu();
  if (!menu) return null;
  const found = [];
  const walk = (items, trail) => {
    for (const item of items) {
      const label = item.label || item.role || "";
      if (item.role || item.accelerator)
        found.push({ trail: [...trail, label].join(" > "), role: item.role || null, accelerator: item.accelerator ? String(item.accelerator) : null });
      if (item.submenu) walk(item.submenu.items, [...trail, label]);
    }
  };
  walk(menu.items, []);
  return { top: menu.items.map((i) => i.label || i.role), reload: found.filter((f) => f.role === "reload" || /\bR$/.test(f.accelerator || "")), count: found.length };
}

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 600,
    x: 80,
    y: 80,
    show: true,
    title: "PB9-GAME",
    backgroundColor: "#1b1d22",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.on("did-finish-load", () => {
    st.loads += 1;
  });
  win.webContents.on("before-input-event", (event, input) => {
    const t = hr();
    st.mainLog.push({
      t,
      type: input.type,
      code: input.code,
      key: input.key,
      ctrl: input.control,
      alt: input.alt,
      shift: input.shift,
      meta: input.meta,
      rep: input.isAutoRepeat,
      loc: input.location,
      mods: input.modifiers,
    });
    if (st.mode === "observe") return;
    const d = router.handle(input, { session: st.session });
    st.decisions.push({ t, type: input.type, code: input.code, swallow: d.swallow, fire: d.fire, why: d.why });
    if (d.fire) st.fired.push(d.fire);
    if (d.swallow) event.preventDefault();
  });
  return win.loadFile(path.join(__dirname, "game.html"));
}

globalThis.pb9 = {
  info() {
    return {
      menuMode: MENU,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0] && os.cpus()[0].model,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      session: process.env.XDG_SESSION_TYPE || null,
      display: process.env.DISPLAY || null,
      appMenu: menuReport(),
      menuBarVisible: win.isMenuBarVisible(),
      bounds: win.getBounds(),
      title: win.getTitle(),
      loads: st.loads,
    };
  },
  async focus() {
    win.show();
    win.focus();
    win.webContents.focus();
    await sleep(400);
    return { focused: win.isFocused(), webContentsFocused: win.webContents.isFocused(), visible: win.isVisible() };
  },
  reset({ mode, session }) {
    st.mode = mode;
    st.session = session;
    st.mainLog = [];
    st.pageLog = [];
    st.decisions = [];
    st.fired = [];
    st.loadsAtReset = st.loads;
    router = new ChordRouter({ bindings, downOnly: mode === "down-only" });
    return win.webContents.executeJavaScript(
      `document.getElementById("screen").textContent = "screen: ${session}"; true`,
    );
  },
  snapshot() {
    return {
      mainLog: st.mainLog,
      pageLog: st.pageLog,
      decisions: st.decisions,
      fired: st.fired,
      loads: st.loads,
      loadsAtReset: st.loadsAtReset,
    };
  },
  async sendInput(events, gapMs) {
    for (const event of events) {
      win.webContents.sendInputEvent(event);
      await sleep(gapMs);
    }
    return events.length;
  },
};

app.whenReady().then(async () => {
  if (MENU === "null") Menu.setApplicationMenu(null);
  await createWindow();
});

app.on("window-all-closed", () => app.quit());
