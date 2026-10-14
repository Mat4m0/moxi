"use strict";
// Real OS-level key presses: xdotool (XTEST) on Linux under xvfb, SendInput through a
// persistent PowerShell process on Windows. Never used on a developer Mac.
const { execFileSync, spawn } = require("node:child_process");
const readline = require("node:readline");
const path = require("node:path");

const KEYSYM = {
  ControlLeft: "Control_L",
  AltLeft: "Alt_L",
  AltRight: "Alt_R",
  AltGr: "ISO_Level3_Shift", // only meaningful after `setxkbmap de`
  ShiftLeft: "Shift_L",
  KeyR: "r",
  KeyK: "k",
  KeyA: "a",
  KeyQ: "q",
  Digit1: "1",
};
// Set 1 scan codes; the second value marks an extended key (right Alt).
const SCAN = {
  ControlLeft: [0x1d, false],
  AltLeft: [0x38, false],
  AltRight: [0x38, true],
  ShiftLeft: [0x2a, false],
  KeyR: [0x13, false],
  KeyK: [0x25, false],
  KeyA: [0x1e, false],
  KeyQ: [0x10, false],
  Digit1: [0x02, false],
};

function linuxKeys(title) {
  const x = (...args) => execFileSync("xdotool", args, { encoding: "utf8" }).trim();
  return {
    name: "xdotool",
    async start() {},
    async focus() {
      const ids = x("search", "--onlyvisible", "--name", `^${title}$`).split("\n").filter(Boolean);
      const tried = [];
      for (const id of ids) {
        try {
          x("windowactivate", "--sync", id);
          const now = x("getwindowfocus");
          tried.push({ id, focusNow: now });
          if (now === id) return { ok: true, windowId: id, candidates: ids.length };
        } catch (error) {
          tried.push({ id, error: String(error.message).split("\n")[0] });
        }
      }
      return { ok: false, candidates: ids.length, tried };
    },
    async send(steps, gapMs) {
      const args = [];
      for (const [op, code] of steps)
        args.push(op === "down" ? "keydown" : "keyup", KEYSYM[code], "sleep", String(gapMs / 1000));
      x(...args);
      return { ok: true, sent: steps.length };
    },
    async releaseAll() {
      try {
        x("keyup", ...["Control_L", "Alt_L", "Shift_L", "r", "k", "a", "q", "1"]);
      } catch {
        // Nothing was held.
      }
    },
    setLayout(args) {
      execFileSync("setxkbmap", args);
    },
    async stop() {},
  };
}

function windowsKeys(title) {
  let ps = null;
  const waiters = [];
  const request = (obj, timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`powershell timeout for ${obj.cmd}`)), timeoutMs);
      waiters.push((reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      ps.stdin.write(`${JSON.stringify(obj)}\n`);
    });
  return {
    name: "SendInput",
    async start() {
      ps = spawn(
        process.env.PB9_PS_EXE || "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "sendkeys.ps1")],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      ps.stderr.on("data", (d) => console.log(`PB9_PS_STDERR ${String(d).trim()}`));
      const rl = readline.createInterface({ input: ps.stdout });
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("powershell did not become ready")), 60000);
        waiters.push((reply) => {
          clearTimeout(timer);
          resolve(reply);
        });
      });
      rl.on("line", (line) => {
        if (!line.startsWith("@@")) return;
        const waiter = waiters.shift();
        if (waiter) waiter(JSON.parse(line.slice(2)));
      });
      this.ready = await ready;
    },
    async focus() {
      return request({ cmd: "focus", title });
    },
    async send(steps, gapMs) {
      const mapped = steps.map(([op, code]) => ({ op, scan: SCAN[code][0], ext: SCAN[code][1] }));
      return request({ cmd: "keys", steps: mapped, gap: gapMs });
    },
    async releaseAll() {
      const codes = Object.keys(SCAN);
      await request({ cmd: "keys", steps: codes.map((c) => ({ op: "up", scan: SCAN[c][0], ext: SCAN[c][1] })), gap: 2 });
    },
    async stop() {
      if (ps) ps.stdin.end();
    },
  };
}

function createOsKeys(title) {
  if (process.platform === "linux") return linuxKeys(title);
  if (process.platform === "win32") return windowsKeys(title);
  return null;
}

module.exports = { createOsKeys, windowsKeys };
