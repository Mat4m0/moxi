"use strict";
// PB7 fixture plugin host. Runs PLUGINS Blob workers, relays facts in and HUD ops out, runs the
// in-page watchdog (ping every 1 s, a stop after 2.5 s without a pong) and answers pings that
// Main sends over its control port. Everything is recorded; nothing is stopped.
(() => {
  const query = new URLSearchParams(location.search);
  const HOST = Number(query.get("host"));
  const PLUGINS = Number(query.get("plugins"));
  const SESSIONS = Number(query.get("sessions"));
  const wall = () => performance.timeOrigin + performance.now();

  const workerSource = `
    "use strict";
    let w = -1, sessions = 3, handled = 0, pending = [], scheduled = false, last = 0;
    const wall = () => performance.timeOrigin + performance.now();
    const gaps = []; // [t, ms beyond the nominal 100 ms] for a 100 ms timer inside the worker
    function flush() {
      scheduled = false;
      const batch = pending;
      pending = [];
      for (const b of batch) postMessage(b);
    }
    self.onmessage = (e) => {
      const m = e.data;
      if (m.t === "facts") {
        handled += 1;
        const ops = [];
        for (let s = 0; s < sessions; s += 1) {
          ops.push({ s, k: "text", v: "HP " + (m.f.hp + s) + "/" + m.f.maxhp + " EN " + m.f.energy });
        }
        pending.push({ t: "ops", w, seq: m.seq, stamp: m.stamp, ops });
        if (!scheduled) { scheduled = true; queueMicrotask(flush); }
      } else if (m.t === "ping") {
        postMessage({ t: "pong", id: m.id, seq: m.seq, sent: m.sent, w });
      } else if (m.t === "init") {
        w = m.w; sessions = m.sessions; last = performance.now();
        setInterval(() => { const n = performance.now(); gaps.push(wall(), n - last - 100); last = n; }, 100);
        postMessage({ t: "ready", w });
      } else if (m.t === "collect") {
        postMessage({ t: "wstats", w, handled, gaps });
      }
    };
  `;

  const data = {
    host: HOST,
    pong: [], // watchdog pongs: [t, worker, ms since that worker's previous pong, round trip ms]
    wdTicks: [], // [t, ms] real interval of the watchdog's 1 s timer
    stops: [], // would-be stops: [t, worker, ms since last pong, 1 when the tick itself was late]
    raf: [], // [t, count] requestAnimationFrame callbacks per second
    t0: [], // [t, ms] delay of a setTimeout(0) scheduled once per second
    vis: [[wall(), document.visibilityState]],
    factsIn: 0,
    opsOut: 0,
    workerStats: [],
    workerErrors: [],
  };
  document.addEventListener("visibilitychange", () => data.vis.push([wall(), document.visibilityState]));

  let control = null;
  let link = null;
  let workersReady = 0;
  let announced = false;
  const workers = [];
  const lastPongAt = new Array(PLUGINS).fill(0);
  const prevPongAt = new Array(PLUGINS).fill(null);

  function announce() {
    if (announced || !control || !link || workersReady < PLUGINS) return;
    announced = true;
    control.postMessage({ t: "ready", host: HOST, visibility: document.visibilityState });
  }

  function onWorker(index, msg) {
    if (msg.t === "ops") {
      data.opsOut += 1;
      link.postMessage(msg);
    } else if (msg.t === "pong") {
      const now = performance.now();
      if (msg.id === "wd") {
        const previous = prevPongAt[index];
        prevPongAt[index] = now;
        lastPongAt[index] = now;
        if (previous !== null) data.pong.push(wall(), msg.w, now - previous, now - msg.sent);
      } else {
        control.postMessage({ t: "mpong", w: msg.w, seq: msg.seq });
      }
    } else if (msg.t === "ready") {
      workersReady += 1;
      announce();
    } else if (msg.t === "wstats") {
      data.workerStats.push(msg);
      if (data.workerStats.length === PLUGINS) control.postMessage({ t: "collected", host: HOST, data });
    }
  }

  const blobUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  for (let i = 0; i < PLUGINS; i += 1) {
    const worker = new Worker(blobUrl);
    worker.onmessage = (event) => onWorker(i, event.data);
    worker.onerror = (event) => data.workerErrors.push(String(event.message));
    workers.push(worker);
    worker.postMessage({ t: "init", w: HOST * PLUGINS + i, sessions: SESSIONS });
  }

  function startMeasuring() {
    const started = performance.now();
    lastPongAt.fill(started);
    let lastTick = started;
    let seq = 0;
    setInterval(() => {
      const now = performance.now();
      const interval = now - lastTick;
      lastTick = now;
      data.wdTicks.push(wall(), interval);
      const late = interval > 1500 ? 1 : 0;
      seq += 1;
      for (let i = 0; i < PLUGINS; i += 1) {
        const since = now - lastPongAt[i];
        if (since > 2500) {
          data.stops.push([wall(), HOST * PLUGINS + i, since, late]);
          lastPongAt[i] = now; // a real stop would restart the worker: count each episode once
        }
        workers[i].postMessage({ t: "ping", id: "wd", seq, sent: now });
      }
    }, 1000);

    let frames = 0;
    const frame = () => {
      frames += 1;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    setInterval(() => {
      data.raf.push(wall(), frames);
      frames = 0;
      const scheduledAt = performance.now();
      setTimeout(() => data.t0.push(wall(), performance.now() - scheduledAt), 0);
    }, 1000);
  }

  function onControl(event) {
    const msg = event.data;
    if (msg.t === "start") startMeasuring();
    else if (msg.t === "mping") workers[msg.w - HOST * PLUGINS].postMessage({ t: "ping", id: "main", seq: msg.seq, w: msg.w });
    else if (msg.t === "collect") for (const worker of workers) worker.postMessage({ t: "collect" });
  }

  function onLink(event) {
    const msg = event.data;
    if (msg.t !== "facts") return;
    data.factsIn += 1;
    for (const worker of workers) worker.postMessage(msg);
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg.__probe !== "port") return;
    const port = event.ports[0];
    if (msg.meta.kind === "control") {
      control = port;
      port.onmessage = onControl;
    } else if (msg.meta.kind === "link") {
      link = port;
      port.onmessage = onLink;
    }
    announce();
  });
})();
