// PB6 isolation checks. Every scenario runs in a fresh worker. Run: node --expose-gc src/run-checks.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pb6Worker } from "./harness.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const F = (name, extra = {}) => ({ "game.target": { name, ...extra } });
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const results = [];
function check(id, title, kind, fn) {
  results.push({ id, title, kind, fn });
}

// kind: "isolation" must hold; "expected-leak" documents a leak that the design accepts;
//       "finding" records behaviour the design text should know about; "control" must show the failure.
function makeCtx() {
  const c = { failures: [], notes: {} };
  c.eq = (actual, expected, label) => {
    if (!same(actual, expected)) c.failures.push(`${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  };
  c.ok = (cond, label) => {
    if (!cond) c.failures.push(label);
  };
  c.note = (k, v) => (c.notes[k] = v);
  return c;
}

const treeErrors = (w) => [...w.trees.values()].flatMap((t) => t.errors);
const cmd = (name, count, raw) => [`target=${name}`, `count=${count} raw=${raw}`, "globals="];

async function until(w, pred, label, ms = 5000) {
  const end = performance.now() + ms;
  while (!pred()) {
    if (performance.now() > end) throw new Error(`timeout waiting for ${label}`);
    await sleep(10);
    await w.sync();
  }
}

// ---------------------------------------------------------------------------------------------
check("C1", "Module-level state, useFact and the HUD root are per session (sessions 1 to 4)", "isolation", async (c) => {
  const w = new Pb6Worker({ plugin: "pb6" });
  await w.ready();
  for (const sid of [1, 2, 3, 4]) await w.open(sid, F(`T${sid}`));
  for (let i = 0; i < 3; i++) await w.press(1, "inc");
  await w.press(4, "inc");
  c.eq(w.texts(1), cmd("T1", 3, 3), "session 1 view");
  c.eq(w.texts(2), cmd("T2", 0, 0), "session 2 view");
  c.eq(w.texts(3), cmd("T3", 0, 0), "session 3 view");
  c.eq(w.texts(4), cmd("T4", 1, 1), "session 4 view");
  for (const sid of [1, 2, 3, 4]) c.eq(w.texts(sid, "hud:w1"), [`hud:T${sid}`], `session ${sid} hud`);
  c.eq(treeErrors(w), [], "tree errors");
  c.eq(w.errors, [], "runtime errors");
  await w.terminate();
});

check("C1x", "Control: one shared module scope (the rejected variant) leaks counter and fact between sessions", "control", async (c) => {
  const w = new Pb6Worker({ plugin: "pb6", shareModule: true });
  await w.ready();
  for (const sid of [1, 2, 3, 4]) await w.open(sid, F(`T${sid}`));
  await w.press(1, "inc");
  c.note("session4View", w.texts(4));
  c.ok(!same(w.texts(4), cmd("T4", 0, 0)), "the shared-scope control should have shown session 1's state in session 4 (the check could not fail)");
  await w.terminate();
});

check("C2", "A fact update re-renders only its own session (render counters, batches)", "isolation", async (c) => {
  const w = new Pb6Worker({ plugin: "pb6" });
  await w.ready();
  for (const sid of [1, 2, 3, 4]) await w.open(sid, F(`T${sid}`));
  const before = (await w.counters()).counters;
  const nb = w.batches.length;
  await w.fact(4, "game.target", { name: "T4b" });
  const after = (await w.counters()).counters;
  const delta = (sid, k) => (after[sid]?.[k] ?? 0) - (before[sid]?.[k] ?? 0);
  c.eq([1, 2, 3, 4].map((s) => delta(s, "render")), [0, 0, 0, 1], "view renders per session");
  c.eq([1, 2, 3, 4].map((s) => delta(s, "hud-render")), [0, 0, 0, 1], "hud renders per session");
  c.eq([...new Set(w.batches.slice(nb).map((b) => b.sid))], [4], "sessions that received ops");
  c.eq(w.texts(4), cmd("T4b", 0, 0), "session 4 view");
  await w.terminate();
});

check("C3", "Two sessions change in one scheduler flush: one batch per (session, root), no foreign ops", "isolation", async (c) => {
  const w = new Pb6Worker({ plugin: "pb6" });
  await w.ready();
  for (const sid of [1, 2, 3, 4]) await w.open(sid, F(`T${sid}`));
  const nb = w.batches.length;
  w.multi([
    { t: "fact", sid: 1, id: "game.target", value: { name: "A" } },
    { t: "fact", sid: 4, id: "game.target", value: { name: "D" } },
  ]);
  await w.sync();
  const got = w.batches.slice(nb).map((b) => `${b.sid}/${b.root}`).sort();
  c.eq(got, ["1/cmd:main", "1/hud:w1", "4/cmd:main", "4/hud:w1"], "batches of the shared flush");
  c.eq(w.texts(1), cmd("A", 0, 0), "session 1 view");
  c.eq(w.texts(4), cmd("D", 0, 0), "session 4 view");
  c.eq(w.texts(2), cmd("T2", 0, 0), "session 2 view untouched");
  c.eq(treeErrors(w), [], "tree errors");
  await w.terminate();
});

check("C3x", "Control: a single global op buffer (R7 renderer) mixes sessions in that flush", "control", async (c) => {
  const w = new Pb6Worker({ plugin: "pb6", rendererMode: "global" });
  await w.ready();
  for (const sid of [1, 2, 3, 4]) await w.open(sid, F(`T${sid}`));
  w.multi([
    { t: "fact", sid: 1, id: "game.target", value: { name: "A" } },
    { t: "fact", sid: 4, id: "game.target", value: { name: "D" } },
  ]);
  await w.sync();
  const errs = treeErrors(w).length;
  const wrong = !same(w.texts(1), cmd("A", 0, 0)) || !same(w.texts(4), cmd("D", 0, 0));
  c.note("treeErrors", errs);
  c.note("viewsWrong", wrong);
  c.ok(errs > 0 || wrong, "the global buffer should have corrupted a tree (the check could not fail)");
  await w.terminate();
});

// ---------------------------------------------------------------------------------------------
check("C4", "Render throw at mount in session 2: 1, 3 and 4 render and keep updating; 2 heals", "isolation", async (c) => {
  const w = new Pb6Worker({ plugin: "pb6" });
  await w.ready();
  await w.open(1, F("T1"));
  await w.open(2, F("T2", { boom: true }));
  await w.open(3, F("T3"));
  await w.open(4, F("T4"));
  c.eq(w.errors.map((e) => [e.sid, e.message]), [[2, "boom in render"]], "errors");
  c.eq([1, 3, 4].map((s) => w.texts(s)), [cmd("T1", 0, 0), cmd("T3", 0, 0), cmd("T4", 0, 0)], "views of 1, 3, 4");
  c.eq(w.texts(2), [], "session 2 view is blank");
  c.eq(w.texts(2, "hud:w1"), ["hud:T2"], "session 2 hud (its own root) still renders");
  w.multi([1, 3, 4].map((sid) => ({ t: "fact", sid, id: "game.target", value: { name: `N${sid}` } })));
  await w.sync();
  c.eq([1, 3, 4].map((s) => w.texts(s)), [cmd("N1", 0, 0), cmd("N3", 0, 0), cmd("N4", 0, 0)], "views after update");
  await w.fact(2, "game.target", { name: "T2b" });
  c.eq(w.texts(2), cmd("T2b", 0, 0), "session 2 heals on the next reactive change");
  c.eq(treeErrors(w), [], "tree errors");
  await w.terminate();
});

check("C4b", "Render throw on update in session 2, same flush as 1, 3, 4: they update; 2 goes blank", "finding", async (c) => {
  const w = new Pb6Worker({ plugin: "pb6" });
  await w.ready();
  for (const sid of [1, 2, 3, 4]) await w.open(sid, F(`T${sid}`));
  w.multi([
    { t: "fact", sid: 1, id: "game.target", value: { name: "N1" } },
    { t: "fact", sid: 2, id: "game.target", value: { name: "T2", boom: true } },
    { t: "fact", sid: 3, id: "game.target", value: { name: "N3" } },
    { t: "fact", sid: 4, id: "game.target", value: { name: "N4" } },
  ]);
  await w.sync();
  c.eq(w.errors.map((e) => e.sid), [2], "errors by session");
  c.eq([1, 3, 4].map((s) => w.texts(s)), [cmd("N1", 0, 0), cmd("N3", 0, 0), cmd("N4", 0, 0)], "views of 1, 3, 4");
  c.note("session2TreeAfterThrow", w.texts(2));
  c.note("lastGoodTreeKept", w.texts(2).length > 0);
  await w.terminate();
});

check("C4g", "Remedy for C4b: hold the root's ops on a render error, send a snapshot on recovery (last good tree stays)", "finding", async (c) => {
  const w = new Pb6Worker({ plugin: "pb6", hold: true });
  await w.ready();
  await w.open(1, F("T1"));
  await w.open(2, F("T2", { boom: true })); // throws at mount: nothing was ever shown
  await w.open(3, F("T3"));
  c.eq(w.texts(2), [], "session 2 view at a failed mount (host shows nothing)");
  await w.fact(2, "game.target", { name: "T2b" });
  c.eq(w.texts(2), cmd("T2b", 0, 0), "session 2 shows its first good tree after recovery (snapshot)");
  await w.press(2, "inc");
  w.multi([
    { t: "fact", sid: 1, id: "game.target", value: { name: "N1" } },
    { t: "fact", sid: 2, id: "game.target", value: { name: "T2c", boom: true } },
    { t: "fact", sid: 3, id: "game.target", value: { name: "N3" } },
  ]);
  await w.sync();
  c.eq(w.texts(2), cmd("T2b", 1, 1), "session 2 keeps its last good tree after a throw on update");
  c.eq([w.texts(1), w.texts(3)], [cmd("N1", 0, 0), cmd("N3", 0, 0)], "sessions 1 and 3 updated in the same flush");
  // The failed render removed the handlers in the worker, so the old tree shown by the host is inert.
  const sign = w.tree(2).button("inc");
  w.post({ t: "event", sid: 2, root: "cmd:main", sign, payload: null });
  await w.sync();
  c.eq(w.texts(2), cmd("T2b", 1, 1), "a click on the inert old tree does nothing");
  await w.fact(2, "game.target", { name: "T2d" });
  c.eq(w.texts(2), cmd("T2d", 1, 1), "recovery: the snapshot replaces the old tree");
  await w.press(2, "inc");
  c.eq(w.texts(2), cmd("T2d", 2, 2), "buttons work again after the snapshot");
  c.eq(treeErrors(w), [], "tree errors");
  c.eq(w.errors.map((e) => [e.sid, e.message]), [[2, "boom in render"], [2, "boom in render"]], "attributed render errors (mount, update)");
  await w.terminate();
});

check("C4c", "Throw in a handler (sync and async) in session 2 is attributed to 2; others and 2 keep working", "isolation", async (c) => {
  const w = new Pb6Worker({ plugin: "pb6" });
  await w.ready();
  for (const sid of [1, 2, 3]) await w.open(sid, F(`T${sid}`));
  await w.press(2, "throwInHandler");
  await w.press(2, "throwInAsyncHandler");
  c.eq(w.errors.map((e) => [e.sid, e.phase, e.message]), [[2, "handler", "boom in handler"], [2, "handler", "boom in async handler"]], "errors");
  await w.press(2, "inc");
  await w.press(1, "inc");
  c.eq([w.texts(1), w.texts(2), w.texts(3)], [cmd("T1", 1, 1), cmd("T2", 1, 1), cmd("T3", 0, 0)], "views");
  c.eq(w.uncaught, [], "nothing reached the worker's uncaught handlers");
  await w.terminate();
});

check("C4d", "Throw in module evaluation in session 2: only session 2 fails to open; the id is reusable", "isolation", async (c) => {
  const w = new Pb6Worker({ plugin: "pb6" });
  await w.ready();
  await w.open(1, F("T1"));
  await w.open(2, F("T2", { moduleBoom: true }));
  await w.open(3, F("T3"));
  c.eq(w.errors.map((e) => [e.sid, e.phase, e.message]), [[2, "module", "boom at module evaluation"]], "errors");
  c.eq(w.batchesFor(2).length, 0, "ops for the failed session");
  c.eq([w.texts(1), w.texts(3)], [cmd("T1", 0, 0), cmd("T3", 0, 0)], "views of 1 and 3");
  await w.open(2, F("T2"));
  c.eq(w.texts(2), cmd("T2", 0, 0), "session 2 opens after a failed open");
  await w.terminate();
});

check("C4e", "Uncaught throw from a timer in session 2 (outside Vue): cannot be attributed", "finding", async (c) => {
  const w = new Pb6Worker({ plugin: "pb6", emulateChromium: true });
  await w.ready();
  for (const sid of [1, 2, 3]) await w.open(sid, F(`T${sid}`));
  await w.press(2, "throwInTimer");
  await sleep(20);
  await w.sync();
  c.note("uncaughtAsChromiumWouldReport", w.uncaught);
  c.eq(w.errors, [], "runtime attributed an error to a session");
  await w.fact(1, "game.target", { name: "after" });
  c.eq(w.texts(1), cmd("after", 0, 0), "session 1 keeps rendering");
  await w.terminate();
  // Node's default: an uncaught exception ends the worker. Chromium's does not, which this process cannot check.
  const n = new Pb6Worker({ plugin: "pb6", emulateChromium: false });
  await n.ready();
  await n.open(1, F("T1"));
  await n.open(2, F("T2"));
  n.post({ t: "event", sid: 2, root: "cmd:main", sign: n.tree(2).button("throwInTimer"), payload: null });
  await sleep(200);
  c.note("nodeDefaultWorkerState", n.exited);
  await n.terminate();
});

check("C4f", "Throw in a module-level watcher of session 2 (no component instance), prod and dev builds", "finding", async (c) => {
  for (const mode of ["prod", "dev"]) {
    const w = new Pb6Worker({ plugin: "globals", mode });
    await w.ready();
    for (const sid of [1, 2, 4]) await w.open(sid, F(`T${sid}`, { delayMs: 5 }));
    await until(w, () => [1, 2, 4].every((s) => w.texts(s).some((t) => t.startsWith("sfc"))), "async setups");
    w.multi([
      { t: "fact", sid: 1, id: "game.target", value: { name: "T1", delayMs: 5, x: 1 } },
      { t: "fact", sid: 2, id: "game.target", value: { name: "T2", delayMs: 5, watchBoom: true } },
      { t: "fact", sid: 4, id: "game.target", value: { name: "T4", delayMs: 5, x: 1 } },
    ]);
    await sleep(30);
    await w.sync();
    const runs = (sid) => w.texts(sid).find((t) => t.startsWith("watcherRuns"));
    c.note(`${mode}.viewsAfter`, { 1: runs(1), 2: runs(2), 4: runs(4) });
    c.note(`${mode}.errorsAttributedToASession`, w.errors.length);
    c.note(`${mode}.consoleErrors`, w.consoleErrors);
    c.note(`${mode}.unhandled`, w.uncaught);
    c.note(`${mode}.othersUpdated`, runs(1) === "watcherRuns=1 shared=0" && runs(4) === "watcherRuns=1 shared=0");
    await w.terminate();
  }
});

// ---------------------------------------------------------------------------------------------
check("C5", "Closing session 3: no ops, no work, nothing retained; negative control without scope.stop", "isolation", async (c) => {
  const run = async (skipScopeStop) => {
    const w = new Pb6Worker({ plugin: "globals", skipScopeStop });
    await w.ready();
    for (const sid of [1, 2, 3, 4]) await w.open(sid, F(`T${sid}`, { delayMs: 5 }));
    await until(w, () => [1, 2, 3, 4].every((s) => w.texts(s).some((t) => t.startsWith("sfc"))), "async setups");
    await w.press(1, "bumpShared");
    const c1 = (await w.counters()).counters;
    const batchesAt = w.batchesFor(3).length;
    await w.close(3);
    await w.press(1, "bumpShared");
    const c2 = (await w.counters()).counters;
    // late traffic for the closed session
    w.post({ t: "fact", sid: 3, id: "game.target", value: { name: "late" } });
    w.post({ t: "event", sid: 3, root: "cmd:main", sign: 1, payload: null });
    await w.sync();
    const weak = await w.weak();
    const out = {
      sharedWatcherRuns: (sid) => (c2[sid]?.sharedWatcher ?? 0) - (c1[sid]?.sharedWatcher ?? 0),
      newBatchesFor3: w.batchesFor(3).length - batchesAt,
      alive3: weak.alive.filter((a) => a.sid === 3).map((a) => a.kind),
      aliveOthers: weak.alive.filter((a) => a.sid !== 3).length,
      tracked: weak.tracked,
      errors: w.errors.length,
      views: [1, 2, 4].map((s) => w.texts(s)[1]),
    };
    const watcher = [1, 2, 3, 4].map(out.sharedWatcherRuns);
    await w.terminate();
    return { ...out, watcher };
  };
  const good = await run(false);
  c.eq(good.watcher, [1, 1, 0, 1], "shared-state watcher runs per session after closing 3");
  c.eq(good.newBatchesFor3, 0, "ops for session 3 after close");
  c.eq(good.alive3, [], "session 3 objects still alive after gc");
  c.ok(good.aliveOthers > 0, "other sessions' objects should still be alive");
  c.eq(good.errors, 0, "late fact and event for the closed session raised errors");
  c.eq(good.views, ["watcherRuns=0 shared=2", "watcherRuns=0 shared=2", "watcherRuns=0 shared=2"], "views of 1, 2, 4 follow the shared bump");
  const bad = await run(true);
  c.note("withoutScopeStop", { watcherRuns: bad.watcher, alive3: bad.alive3 });
  c.ok(bad.watcher[2] === 1 && bad.alive3.length > 0, "negative control: without scope.stop the closed session should keep working and stay alive");
});

// ---------------------------------------------------------------------------------------------
check("C6", "Vue globals: app-level provide, getCurrentInstance after async gaps, module-level effects (prod and dev)", "isolation", async (c) => {
  for (const mode of ["prod", "dev"]) {
    const w = new Pb6Worker({ plugin: "globals", mode });
    await w.ready();
    // opened 1..4, finishing 4..1: each setup resumes while another session's setup is still waiting
    const delays = { 1: 80, 2: 50, 3: 25, 4: 5 };
    for (const sid of [1, 2, 3, 4]) await w.open(sid, F(`T${sid}`, { delayMs: delays[sid] }));
    await until(w, () => [1, 2, 3, 4].every((s) => w.texts(s).some((t) => t.startsWith("sfc"))), "async setups");
    for (const sid of [1, 2, 3, 4]) {
      const t = w.texts(sid);
      c.eq(t[0], `inject sid=${sid}`, `${mode}: app-level provide, session ${sid}`);
      c.eq(t.find((x) => x.startsWith("raw")), `raw sid=${sid}/none inst=true/false`, `${mode}: plain await loses the instance, session ${sid}`);
      c.eq(t.find((x) => x.startsWith("sfc")), `sfc sid=${sid}/${sid} inst=true fact=T${sid}`, `${mode}: compiled await keeps own instance, session ${sid}`);
    }
    // module-level watcher belongs to one session
    await w.fact(2, "game.target", { name: "T2", delayMs: 50, x: 1 });
    c.eq([1, 2, 3, 4].map((s) => w.texts(s)[1].split(" ")[0]), ["watcherRuns=0", "watcherRuns=1", "watcherRuns=0", "watcherRuns=0"], `${mode}: module-level watcher runs per session`);
    c.eq(w.errors, [], `${mode}: errors`);
    c.eq(treeErrors(w), [], `${mode}: tree errors`);
    if (mode === "dev") c.note("dev.consoleWarns", w.consoleWarns.slice(0, 5));
    await w.terminate();
  }
});

check("C6b", "Shared raw object reached through globalThis becomes reactive across sessions (Vue's one proxy cache)", "expected-leak", async (c) => {
  const w = new Pb6Worker({ plugin: "globals" });
  await w.ready();
  for (const sid of [1, 4]) await w.open(sid, F(`T${sid}`, { delayMs: 5 }));
  await until(w, () => [1, 4].every((s) => w.texts(s).some((t) => t.startsWith("sfc"))), "async setups");
  await w.press(1, "bumpShared");
  c.note("session4SeesSession1Bump", w.texts(4)[1]);
  c.ok(w.texts(4)[1].endsWith("shared=1"), "expected the leak through a shared reactive object");
  await w.terminate();
});

check("C6c", "A host component defined once in the runtime keeps per-session state, emits and slots", "isolation", async (c) => {
  const w = new Pb6Worker({ plugin: "globals" });
  await w.ready();
  for (const sid of [1, 4]) await w.open(sid, F(`T${sid}`, { delayMs: 5 }));
  await until(w, () => [1, 4].every((s) => w.texts(s).some((t) => t.startsWith("sfc"))), "async setups");
  await w.press(1, "bump");
  await w.press(1, "bump");
  await w.press(4, "bump");
  const tail = (sid) => w.texts(sid).filter((t) => /^(c:|bumped=)/.test(t));
  c.eq(tail(1), ["c:2", "bumped=2"], "session 1");
  c.eq(tail(4), ["c:1", "bumped=1"], "session 4");
  await w.terminate();
});

check("C7", "Realm globals: globalThis and Array.prototype writes in session 1 are visible in 2 and 4; rendering survives", "expected-leak", async (c) => {
  const w = new Pb6Worker({ plugin: "pb6" });
  await w.ready();
  for (const sid of [1, 2, 3, 4]) await w.open(sid, F(`T${sid}`));
  await w.press(1, "poison");
  await w.press(4, "readGlobals");
  await w.press(2, "readGlobals");
  c.eq(w.texts(4)[2], 'globals={"cache":{"writer":"T1"},"last":3}', "session 4 reads session 1's writes");
  c.eq(w.texts(2)[2], 'globals={"cache":{"writer":"T1"},"last":3}', "session 2 reads session 1's writes");
  c.eq(w.texts(3)[2], "globals=", "session 3 never read");
  w.multi([1, 2, 3, 4].map((sid) => ({ t: "fact", sid, id: "game.target", value: { name: `P${sid}` } })));
  await w.sync();
  c.eq(w.texts(3), cmd("P3", 0, 0).slice(0, 2).concat(["globals="]), "rendering continues with a patched Array.prototype");
  c.eq(w.errors, [], "errors");
  await w.terminate();
});

// ---------------------------------------------------------------------------------------------
check("C8", "Shared scheduler: cross-session latency equals single-thread blocking (median of 5)", "isolation", async (c) => {
  const w = new Pb6Worker({ plugin: "pb6" });
  await w.ready();
  for (const sid of [1, 2, 3, 4]) await w.open(sid, F(`T${sid}`));
  const latency = async (setup, n = 5) => {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const nb = w.batchTimes.length;
      const t0 = performance.now();
      setup(i);
      await w.sync();
      const b = w.batchTimes.slice(nb).find((x) => x.sid === 1 && x.root === "cmd:main");
      xs.push(b.at - t0);
    }
    return Math.round(median(xs) * 10) / 10;
  };
  const f1 = (i) => ({ t: "fact", sid: 1, id: "game.target", value: { name: `a${i}` } });
  const f4busy = (i, ms) => ({ t: "fact", sid: 4, id: "game.target", value: { name: `b${i}`, busyMs: ms } });
  const alone = await latency((i) => w.post(f1(i)));
  const sameFlush = await latency((i) => w.multi([f4busy(i, 30), f1(i)]));
  const separate = await latency((i) => (w.post(f4busy(i, 30)), w.post(f1(i))));
  c.note("sessionOneLatencyMs", { alone, sameFlushWithSession4Busy30ms: sameFlush, separateTasksWithSession4Busy30ms: separate });
  // Only the physical lower bound is asserted (the thread is blocked 30 ms); the numbers are a Measure.
  c.ok(sameFlush >= 30 && separate >= 30, "one thread: busy session 4 delays session 1 in both delivery modes");
  await w.terminate();
});

// ---------------------------------------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function oracleRun(seed, rendererMode, nOps = 400, hold = false) {
  const r = rng(seed);
  const w = new Pb6Worker({ plugin: "pb6", rendererMode, hold });
  await w.ready();
  const SIDS = [1, 2, 3, 4, 5, 6, 7, 8];
  const m = new Map(); // sid -> model
  const pick = (a) => a[Math.floor(r() * a.length)];
  const open = async (sid) => {
    m.set(sid, { name: `S${sid}.0`, boom: false, count: 0, v: 0, shown: { name: `S${sid}.0`, count: 0 } });
    await w.open(sid, F(`S${sid}.0`));
  };
  for (const sid of SIDS.slice(0, 5)) await open(sid);
  const mismatches = [];
  const verify = (op) => {
    for (const [sid, s] of m) {
      if (!s.boom) s.shown = { name: s.name, count: s.count }; // last successful render
      const want = hold ? (s.shown ? cmd(s.shown.name, s.shown.count, s.shown.count) : []) : s.boom ? [] : cmd(s.name, s.count, s.count);
      if (!same(w.texts(sid), want) || !same(w.texts(sid, "hud:w1"), [`hud:${s.name}`])) {
        mismatches.push({ op, sid, got: w.texts(sid), want });
        return;
      }
    }
  };
  let booms = 0;
  for (let i = 0; i < nOps; i++) {
    const live = [...m.keys()];
    const closed = SIDS.filter((s) => !m.has(s));
    const x = r();
    let op;
    if (x < 0.35) {
      const sid = pick(live), s = m.get(sid);
      s.name = `S${sid}.${++s.v}`;
      op = `name ${sid}`;
      await w.fact(sid, "game.target", { name: s.name, boom: s.boom });
    } else if (x < 0.6) {
      const sid = pick(live), s = m.get(sid);
      op = `inc ${sid}`;
      if (s.boom) continue; // the failed render removed the handlers (and, without hold, the tree)
      s.count++;
      await w.press(sid, "inc");
    } else if (x < 0.68) {
      const sid = pick(live), s = m.get(sid);
      s.boom = !s.boom;
      booms += s.boom ? 1 : 0;
      op = `boom ${sid}=${s.boom}`;
      await w.fact(sid, "game.target", { name: s.name, boom: s.boom });
    } else if (x < 0.76 && live.length > 2) {
      const sid = pick(live);
      m.delete(sid);
      op = `close ${sid}`;
      await w.close(sid);
    } else if (x < 0.86 && closed.length) {
      const sid = pick(closed);
      op = `open ${sid}`;
      await open(sid);
    } else {
      // burst: up to 4 sessions change in the same scheduler flush
      const picks = live.filter(() => r() < 0.5).slice(0, 4);
      op = `burst ${picks}`;
      const msgs = [];
      for (const sid of picks) {
        const s = m.get(sid);
        if (r() < 0.3) s.boom = !s.boom, (booms += s.boom ? 1 : 0);
        s.name = `S${sid}.${++s.v}`;
        msgs.push({ t: "fact", sid, id: "game.target", value: { name: s.name, boom: s.boom } });
      }
      if (!msgs.length) continue;
      w.multi(msgs);
      await w.sync();
    }
    verify(op);
    if (mismatches.length) break;
  }
  const foreignErrors = w.errors.filter((e) => e.message !== "boom in render");
  const out = { seed, ops: nOps, mismatches: mismatches.length, first: mismatches[0] ?? null, treeErrors: treeErrors(w).length, booms, renderErrors: w.errors.length, foreignErrors: foreignErrors.length, exited: w.exited };
  await w.terminate();
  return out;
}

check("C9", "Seeded random interleavings against an oracle: 8 sessions, 5 seeds x 400 ops (open, close, facts, clicks, throws, bursts)", "isolation", async (c) => {
  const runs = [];
  for (const seed of [1, 2, 3, 4, 5]) runs.push(await oracleRun(seed, "rooted"));
  c.note("runs", runs);
  for (const r of runs) {
    c.eq(r.mismatches, 0, `seed ${r.seed} mismatches (${JSON.stringify(r.first)?.slice(0, 200)})`);
    c.eq(r.treeErrors, 0, `seed ${r.seed} tree errors`);
    c.eq(r.foreignErrors, 0, `seed ${r.seed} unexpected errors`);
  }
});

check("C9h", "Same oracle with the last good tree held on a render error (snapshot on recovery): 5 seeds x 400 ops", "isolation", async (c) => {
  const runs = [];
  for (const seed of [1, 2, 3, 4, 5]) runs.push(await oracleRun(seed, "rooted", 400, true));
  c.note("runs", runs.map((r) => ({ seed: r.seed, mismatches: r.mismatches, treeErrors: r.treeErrors, booms: r.booms, renderErrors: r.renderErrors })));
  for (const r of runs) {
    c.eq(r.mismatches, 0, `seed ${r.seed} mismatches (${JSON.stringify(r.first)?.slice(0, 300)})`);
    c.eq(r.treeErrors, 0, `seed ${r.seed} tree errors`);
    c.eq(r.foreignErrors, 0, `seed ${r.seed} unexpected errors`);
  }
});

check("C9x", "Control: the same oracle against the global op buffer must fail", "control", async (c) => {
  const r = await oracleRun(1, "global", 120);
  c.note("run", r);
  c.ok(r.mismatches > 0 || r.treeErrors > 0, "the oracle did not detect the global buffer (the check could not fail)");
});

// ---------------------------------------------------------------------------------------------
const only = process.argv.slice(2);
const out = [];
for (const { id, title, kind, fn } of results) {
  if (only.length && !only.includes(id)) continue;
  const c = makeCtx();
  let crashed = null;
  const t0 = performance.now();
  try {
    await fn(c);
  } catch (e) {
    crashed = String(e?.stack ?? e);
  }
  const pass = !crashed && c.failures.length === 0;
  out.push({ id, title, kind, pass, failures: c.failures, crashed, notes: c.notes, ms: Math.round(performance.now() - t0) });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} [${kind}] ${title}`);
  for (const f of c.failures) console.log(`     - ${f}`);
  if (crashed) console.log(`     ! ${crashed.split("\n").slice(0, 3).join("\n       ")}`);
}
mkdirSync(join(root, "results"), { recursive: true });
if (!only.length && !process.env.PB6_NO_WRITE) writeFileSync(join(root, "results", "checks.json"), JSON.stringify(out, null, 2));
console.log(`\n${out.filter((r) => r.pass).length}/${out.length} passed`);
process.exit(out.every((r) => r.pass) ? 0 : 1);
