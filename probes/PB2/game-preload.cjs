"use strict";
// Fixture game: counts animation frames and HUD counter messages from the plugin host's port.
const { ipcRenderer } = require("electron");

let frames = 0;
let lastFrame = 0;
let maxFrameGap = 0;
let hudGen = 0;
let hudN = 0;
let lastHud = 0;
let maxHudGap = 0;

function frame(t) {
  frames++;
  if (lastFrame) maxFrameGap = Math.max(maxFrameGap, t - lastFrame);
  lastFrame = t;
  if (frames % 6 === 0) {
    const el = document.getElementById("c");
    if (el) el.textContent = `frame ${frames} · hud ${hudGen}/${hudN}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

ipcRenderer.on("pb2-port", (e) => {
  const p = e.ports[0];
  p.onmessage = (m) => {
    const t = performance.now();
    if (lastHud) maxHudGap = Math.max(maxHudGap, t - lastHud);
    lastHud = t;
    if (m.data.gen !== hudGen) {
      hudGen = m.data.gen;
      ipcRenderer.send("pb2-hud-back", { gen: hudGen, n: m.data.n });
    }
    hudN = m.data.n;
  };
});

setInterval(() => {
  ipcRenderer.send("pb2-game", { frames, maxFrameGapMs: maxFrameGap, hudGen, hudN, maxHudGapMs: maxHudGap, sandboxed: process.sandboxed === true });
  maxFrameGap = 0;
  maxHudGap = 0;
}, 250);
