"use strict";
// PB9 driver. Launches the probe app (twice: default menu, then no menu), presses the same key
// sequences through three input paths and prints one JSON row per run (`PB9_ROW {...}`).
//   cdp  = Playwright keyboard (Input.dispatchKeyEvent over CDP)
//   send = webContents.sendInputEvent from Main
//   os   = real OS-level keys (xdotool under xvfb, SendInput on Windows)
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("@playwright/test");
const electronPath = require("electron");
const { createOsKeys } = require("./os-keys.cjs");

const OUT = process.env.PB9_OUT || path.join(__dirname, "..", "out");
const GAP = Number(process.env.PB9_GAP_MS || 25);
const mainPath = path.join(__dirname, "main.cjs");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rows = [];
function emit(row) {
  rows.push(row);
  console.log(`PB9_ROW ${JSON.stringify(row)}`);
}

const D = (code) => ["down", code];
const U = (code) => ["up", code];
const CTRL = "ControlLeft";
const ALT = "AltLeft";
const SHIFT = "ShiftLeft";
const chord = (mods, key) => [...mods.map(D), D(key), U(key), ...[...mods].reverse().map(U)];

const SWALLOWED = { mainDown: true, mainUp: true, pageDown: false, pageUp: false, reloaded: false };
const PASSED = { mainDown: true, mainUp: true, pageDown: true, pageUp: true, reloaded: false };
const swallowedFiring = (id) => ({ ...SWALLOWED, fired: [id] });
const passedSilent = { ...PASSED, fired: [] };

const scenarios = {
  "plain-r": {
    target: "KeyR", session: "world", steps: [D("KeyR"), U("KeyR")],
    expect: { observe: { mainDown: true, mainUp: true, pageDown: true, pageUp: true, fired: [] } },
  },
  hub: {
    target: "KeyR", session: "world", steps: chord([CTRL], "KeyR"),
    expect: {
      swallow: swallowedFiring("hub.toggle"),
      observe: { mainDown: true, mainUp: true, pageDown: true, pageUp: true, fired: [] },
      "down-only": { mainDown: true, mainUp: true, pageDown: false, pageUp: true, fired: ["hub.toggle"] },
    },
  },
  "hub-login": { target: "KeyR", session: "login", steps: chord([CTRL], "KeyR"), expect: { swallow: swallowedFiring("hub.toggle") } },
  "hub-charselect": { target: "KeyR", session: "charselect", steps: chord([CTRL], "KeyR"), expect: { swallow: swallowedFiring("hub.toggle") } },
  "hub-release-order": {
    // Control is released before R: the R key up carries no modifiers and must still be swallowed.
    target: "KeyR", session: "world", steps: [D(CTRL), D("KeyR"), U(CTRL), U("KeyR")],
    expect: { swallow: swallowedFiring("hub.toggle") },
  },
  "hub-repeat": {
    target: "KeyR", session: "world", steps: [D(CTRL), D("KeyR"), D("KeyR"), D("KeyR"), U("KeyR"), U(CTRL)],
    expect: { swallow: swallowedFiring("hub.toggle") },
  },
  "plugin-world": { target: "KeyK", session: "world", steps: chord([CTRL], "KeyK"), expect: { swallow: swallowedFiring("plugin.quick-travel") } },
  "plugin-login": { target: "KeyK", session: "login", steps: chord([CTRL], "KeyK"), expect: { swallow: passedSilent } },
  "plugin-charselect": { target: "KeyK", session: "charselect", steps: chord([CTRL], "KeyK"), expect: { swallow: passedSilent } },
  altgr: { target: "KeyR", session: "world", steps: chord([CTRL, ALT], "KeyR"), expect: { swallow: passedSilent } },
  "altgr-plugin": { target: "KeyK", session: "world", steps: chord([CTRL, ALT], "KeyK"), expect: { swallow: passedSilent } },
  "altgr-right-alt": {
    // The stream Windows produces for AltGr: left Control, then right (extended) Alt.
    target: "KeyR", session: "world", steps: [D(CTRL), D("AltRight"), D("KeyR"), U("KeyR"), U("AltRight"), U(CTRL)],
    expect: { swallow: passedSilent },
  },
  "shift-k": { target: "KeyK", session: "world", steps: chord([SHIFT], "KeyK"), expect: { swallow: passedSilent } },
  "shift-1": { target: "Digit1", session: "world", steps: chord([SHIFT], "Digit1"), expect: { swallow: passedSilent } },
  "alt-a": { target: "KeyA", session: "world", steps: chord([ALT], "KeyA"), expect: { swallow: passedSilent } },
};

// Linux only: a German layout and a real AltGr key (ISO_Level3_Shift) to record what X11 sends.
const deScenarios = {
  "de-altgr-q": { target: "KeyQ", session: "world", steps: [D("AltGr"), D("KeyQ"), U("KeyQ"), U("AltGr")], keepLogs: true, expect: { swallow: passedSilent } },
  "de-ctrl-altgr-r": { target: "KeyR", session: "world", steps: [D(CTRL), D("AltGr"), D("KeyR"), U("KeyR"), U("AltGr"), U(CTRL)], keepLogs: true, expect: { swallow: passedSilent } },
  "de-ctrl-r": { target: "KeyR", session: "world", steps: chord([CTRL], "KeyR"), keepLogs: true, expect: { swallow: swallowedFiring("hub.toggle") } },
};

const KEYCODE = { ControlLeft: "Control", AltLeft: "Alt", AltRight: "Alt", ShiftLeft: "Shift", KeyR: "R", KeyK: "K", KeyA: "A", KeyQ: "Q", Digit1: "1" };
const MODFLAG = { ControlLeft: "control", AltLeft: "alt", AltRight: "alt", ShiftLeft: "shift" };

function toInputEvents(steps) {
  const heldMods = new Set();
  const downKeys = new Set();
  const events = [];
  for (const [op, code] of steps) {
    const isMod = Boolean(MODFLAG[code]);
    const repeat = op === "down" && downKeys.has(code);
    if (isMod) (op === "down" ? heldMods.add(code) : heldMods.delete(code));
    if (op === "down") downKeys.add(code);
    else downKeys.delete(code);
    const modifiers = [...new Set([...heldMods].map((c) => MODFLAG[c]))];
    if (repeat) modifiers.push("isAutoRepeat");
    events.push({ type: op === "down" ? "keyDown" : "keyUp", keyCode: KEYCODE[code], modifiers });
  }
  return events;
}

async function press(pathName, ctx, steps) {
  if (pathName === "cdp") {
    for (const [op, code] of steps) {
      if (op === "down") await ctx.page.keyboard.down(code);
      else await ctx.page.keyboard.up(code);
      await sleep(GAP);
    }
    return { ok: true };
  }
  if (pathName === "send") {
    const events = toInputEvents(steps);
    await ctx.app.evaluate((_electron, a) => globalThis.pb9.sendInput(a.events, a.gap), { events, gap: GAP });
    return { ok: true };
  }
  return ctx.os.send(steps, GAP);
}

const short = (e, kind) => `${/down/i.test(e.type) ? "v" : "^"}${(e.code || e.key || "?").replace(/^Key|^Digit|Left$/, "")}${kind === "main" && e.rep ? "*" : kind === "page" && e.repeat ? "*" : ""}`;

function analyze(scn, snap) {
  const isDown = (e) => /down/i.test(e.type);
  const isUp = (e) => /up/i.test(e.type);
  const main = snap.mainLog;
  const page = snap.pageLog;
  const hit = (log, test) => log.some((e) => e.code === scn.target && test(e));
  return {
    mainDown: hit(main, isDown),
    mainUp: hit(main, isUp),
    pageDown: hit(page, isDown),
    pageUp: hit(page, isUp),
    pageSawModifier: page.some((e) => /^(Control|Alt|Shift)/.test(e.code)),
    reloaded: snap.loads > snap.loadsAtReset,
    fired: snap.fired,
    swallowedKeyDown: snap.decisions.filter((d) => d.swallow && isDown(d)).length,
    swallowedKeyUp: snap.decisions.filter((d) => d.swallow && isUp(d)).length,
    mainSeq: main.map((e) => short(e, "main")).join(" "),
    pageSeq: page.map((e) => short(e, "page")).join(" "),
  };
}

async function runOne(ctx, pathName, id, scn, mode) {
  const row = { kind: "run", os: process.platform, menu: ctx.menu, path: pathName, scenario: id, mode, session: scn.session };
  try {
    await ctx.app.evaluate((_electron, a) => globalThis.pb9.reset(a), { mode, session: scn.session });
    await sleep(120);
    const sent = await press(pathName, ctx, scn.steps);
    await sleep(350);
    if (pathName === "os") await ctx.os.releaseAll();
    const snap = await ctx.app.evaluate(() => globalThis.pb9.snapshot());
    Object.assign(row, analyze(scn, snap));
    if (sent && sent.ok === false) row.sendError = sent;
    if (scn.keepLogs) {
      row.mainLog = snap.mainLog.map(({ t, ...rest }) => rest);
      row.pageLog = snap.pageLog.map(({ t, ...rest }) => rest);
    }
    const want = scn.expect && scn.expect[mode];
    if (want) {
      row.mismatches = Object.keys(want).filter((k) => JSON.stringify(want[k]) !== JSON.stringify(row[k]));
      row.matchesDesign = row.mismatches.length === 0;
    }
  } catch (error) {
    row.error = String(error && error.message ? error.message : error).slice(0, 400);
  }
  emit(row);
  return row;
}

async function preflight(ctx, pathName) {
  // The control run decides whether a path delivers keys at all, so that "Main did not see the
  // key" can be told apart from "the key never reached the app".
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (pathName === "os") {
      await ctx.app.evaluate(() => globalThis.pb9.focus());
      const focus = await ctx.os.focus();
      emit({ kind: "focus", os: process.platform, menu: ctx.menu, path: pathName, attempt, focus });
    }
    const row = await runOne(ctx, pathName, "plain-r", scenarios["plain-r"], "observe");
    if (row.mainDown || row.pageDown) return true;
  }
  return false;
}

async function runLaunch(menu, os) {
  const env = { ...process.env, PB9_MENU: menu };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: electronPath, args: [mainPath], env, timeout: 90000 });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await sleep(500);
    const ctx = { app, page, os, menu };
    const info = await app.evaluate(() => globalThis.pb9.info());
    const focus = await app.evaluate(() => globalThis.pb9.focus());
    emit({ kind: "info", os: process.platform, menu, ...info, focus });

    const plan =
      menu === "default"
        ? [["plain-r", ["observe"]], ["hub", ["observe", "swallow"]], ["hub-release-order", ["swallow"]], ["altgr", ["swallow"]]]
        : [
            ["plain-r", ["observe"]],
            ["hub", ["observe", "swallow", "down-only"]],
            ...Object.keys(scenarios)
              .filter((id) => !["plain-r", "hub"].includes(id))
              .map((id) => [id, ["swallow"]]),
          ];

    const paths = os ? ["cdp", "send", "os"] : ["cdp", "send"];
    for (const pathName of paths) {
      const delivered = await preflight(ctx, pathName);
      emit({ kind: "path", os: process.platform, menu, path: pathName, delivered });
      if (!delivered) continue;
      for (const [id, modes] of plan) {
        if (id === "plain-r") continue; // already run as the preflight
        for (const mode of modes) {
          if (pathName === "os") await ctx.os.focus();
          await runOne(ctx, pathName, id, scenarios[id], mode);
        }
      }
      if (pathName === "os" && menu === "null" && process.platform === "linux") {
        try {
          os.setLayout("de");
          await sleep(300);
          for (const [id, scn] of Object.entries(deScenarios)) {
            await ctx.os.focus();
            await runOne(ctx, "os", id, scn, "swallow");
          }
        } finally {
          os.setLayout("us");
        }
      }
    }
  } finally {
    await app.close().catch(() => {});
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const os = createOsKeys("PB9-GAME");
  if (os) await os.start();
  const started = Date.now();
  try {
    for (const menu of ["default", "null"]) await runLaunch(menu, os);
  } finally {
    if (os) await os.stop();
  }
  const summary = {
    probe: "PB9",
    os: process.platform,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    rows: rows.length,
    mismatches: rows.filter((r) => r.matchesDesign === false).length,
    errors: rows.filter((r) => r.error).length,
  };
  console.log(`PB9_SUMMARY ${JSON.stringify(summary)}`);
  fs.writeFileSync(path.join(OUT, `pb9-${process.platform}.json`), JSON.stringify({ summary, rows }, null, 1));
  process.exit(0);
}

main().catch((error) => {
  console.log(`PB9_FATAL ${String(error && error.stack ? error.stack : error)}`);
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `pb9-${process.platform}.json`), JSON.stringify({ fatal: String(error), rows }, null, 1));
  } catch {
    // Nothing more to do.
  }
  process.exit(1);
});
