"use strict";
// Page key logger. Listeners run on window in the capture phase and report to Main, so the
// log survives a reload and shows exactly which DOM key events reached the page.
const { ipcRenderer } = require("electron");

function report(e) {
  ipcRenderer.send("pagekey", {
    type: e.type,
    code: e.code,
    key: e.key,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
    repeat: e.repeat,
    trusted: e.isTrusted,
  });
}
window.addEventListener("keydown", report, true);
window.addEventListener("keyup", report, true);
