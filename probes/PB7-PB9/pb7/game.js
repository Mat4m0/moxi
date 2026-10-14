"use strict";
// PB7 fixture game page. Publishes facts at 20 Hz to every plugin host, applies the HUD ops that
// come back, and stamps fact -> applier latency with this renderer's one monotonic clock.
(() => {
  const query = new URLSearchParams(location.search);
  const HOSTS = Number(query.get("hosts"));
  const WORKERS = Number(query.get("workers"));
  const SESSIONS = Number(query.get("sessions"));
  const FACT_MS = 50;
  const wall = () => performance.timeOrigin + performance.now();

  const hud = document.getElementById("hud");
  const cells = [];
  for (let i = 0; i < WORKERS * SESSIONS; i += 1) {
    const cell = document.createElement("span");
    hud.appendChild(cell);
    cells.push(cell);
  }

  const data = {
    lat: [], // [t, ms] fact stamped out -> ops batch applied
    ticks: [], // [t, ms] real interval between fact ticks
    frames: [], // [t, count] requestAnimationFrame callbacks per second
    vis: [[wall(), document.visibilityState]],
    sent: 0,
    applied: 0,
    appliedPerWorker: new Array(WORKERS).fill(0),
    skippedTicks: 0,
  };
  document.addEventListener("visibilitychange", () => data.vis.push([wall(), document.visibilityState]));

  const links = [];
  let control = null;
  let announced = false;

  function onOps(event) {
    const now = performance.now();
    const msg = event.data;
    if (msg.t !== "ops") return;
    data.lat.push(performance.timeOrigin + now, now - msg.stamp);
    data.applied += 1;
    data.appliedPerWorker[msg.w] += 1;
    for (const op of msg.ops) cells[msg.w * SESSIONS + op.s].textContent = op.v;
  }

  let running = false;
  let seq = 0;
  function start() {
    running = true;
    let last = performance.now();
    let next = last + FACT_MS;
    const loop = () => {
      if (!running) return;
      const now = performance.now();
      data.ticks.push(performance.timeOrigin + now, now - last);
      last = now;
      seq += 1;
      const facts = { hp: 400 + (seq % 100), maxhp: 500, energy: 30 + (seq % 20), x: seq * 0.5, y: seq * 0.25, z: 0 };
      const stamp = performance.now();
      for (const port of links) port.postMessage({ t: "facts", seq, stamp, f: facts });
      data.sent += 1;
      next += FACT_MS;
      let delay = next - performance.now();
      if (delay < 0) {
        // A stalled tick publishes current state once instead of bursting to catch up.
        data.skippedTicks += 1;
        next = performance.now() + FACT_MS;
        delay = FACT_MS;
      }
      setTimeout(loop, delay);
    };
    setTimeout(loop, FACT_MS);
  }

  function onControl(event) {
    const msg = event.data;
    if (msg.t === "start") start();
    else if (msg.t === "stop") running = false;
    else if (msg.t === "collect") control.postMessage({ t: "result", data });
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg.__probe !== "port") return;
    const port = event.ports[0];
    if (msg.meta.kind === "control") {
      control = port;
      port.onmessage = onControl;
    } else if (msg.meta.kind === "link") {
      links[msg.meta.host] = port;
      port.onmessage = onOps;
    }
    if (!announced && control && links.length === HOSTS && links.every(Boolean)) {
      announced = true;
      control.postMessage({ t: "ready", visibility: document.visibilityState });
    }
  });

  // A small canvas loop keeps the fixture busy like a game would and counts frames per second.
  const canvas = document.getElementById("world");
  const ctx = canvas.getContext("2d");
  let frames = 0;
  function frame() {
    frames += 1;
    ctx.fillStyle = "#181a20";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#6aa7ff";
    ctx.fillRect((frames * 3) % canvas.width, 40 + (frames % 30), 24, 24);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(() => {
    data.frames.push(wall(), frames);
    frames = 0;
  }, 1000);
})();
