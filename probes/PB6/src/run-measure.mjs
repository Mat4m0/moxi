// PB6 memory and time per session. Run: node --expose-gc src/run-measure.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { Pb6Worker } from "./harness.mjs";
import { buildsFact, pricesFact } from "./fixtures.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const KiB = 1024;
const q = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
};
const stat = (a, d = 1) => ({ p50: +q(a, 0.5).toFixed(d), p95: +q(a, 0.95).toFixed(d), max: +Math.max(...a).toFixed(d), min: +Math.min(...a).toFixed(d), n: a.length });

const FACTS = {
  pb6: (sid) => ({ "game.target": { name: `T${sid}` } }),
  list200: (sid) => ({ "inventory.builds": buildsFact(sid) }),
  trade500: (sid) => ({ "trade.prices": pricesFact(sid) }),
  fat: (sid) => ({ "game.target": { name: `T${sid}` } }),
  fatdata: (sid) => ({ "game.target": { name: `T${sid}` } }),
};
const SESSIONS = 8;
const RUNS = 5;

async function oneRun(plugin, extra = {}) {
  const w = new Pb6Worker({ plugin, light: true, ...extra });
  await w.ready();
  const heap = [(await w.heap("h0")).used];
  for (let sid = 1; sid <= SESSIONS; sid++) {
    await w.open(sid, FACTS[plugin](sid));
    heap.push((await w.heap(`h${sid}`)).used);
  }
  const errs = w.errors.length + w.uncaught.length;
  await w.terminate();
  // second worker with the timing hook for module evaluation and mount time (heap numbers above are bookkeeping-free)
  const t = new Pb6Worker({ plugin });
  await t.ready();
  for (let sid = 1; sid <= SESSIONS; sid++) await t.open(sid, FACTS[plugin](sid));
  const { timings } = await t.counters();
  await t.terminate();
  return { heap, timings, errs };
}

const out = { date: new Date().toISOString(), node: process.version, v8: process.versions.v8, os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0].model, cases: [] };

await oneRun("pb6"); // warm-up (disk cache, JIT of the harness), discarded

for (const plugin of ["pb6", "list200", "trade500", "fat", "fatdata"]) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await oneRun(plugin));
  const per = (f) => runs.map(f);
  const d = (r, a, b) => r.heap[b] - r.heap[a];
  const sAll = per((r) => d(r, 1, 8) / 7 / KiB); // sessions 2..8 over session 1
  const s4 = per((r) => d(r, 1, 4) / 3 / KiB);
  const sLate = per((r) => d(r, 4, 8) / 4 / KiB);
  const first = per((r) => d(r, 0, 1) / KiB);
  const evalCold = per((r) => r.timings.find((t) => t.sid === 1).evalMs);
  const mountCold = per((r) => r.timings.find((t) => t.sid === 1).mountMs);
  const evalWarm = runs.flatMap((r) => r.timings.filter((t) => t.sid >= 2).map((t) => t.evalMs));
  const mountWarm = runs.flatMap((r) => r.timings.filter((t) => t.sid >= 2).map((t) => t.mountMs));
  out.cases.push({
    plugin,
    runs: RUNS,
    errors: per((r) => r.errs),
    baseHeapKiB: stat(per((r) => r.heap[0] / KiB)),
    firstSessionKiB: stat(first),
    sessionKiB_2to8: stat(sAll, 1),
    sessionKiB_2to4: stat(s4, 1),
    sessionKiB_5to8: stat(sLate, 1),
    evalMs_cold: stat(evalCold, 2),
    evalMs_warm: stat(evalWarm, 3),
    mountMs_cold: stat(mountCold, 2),
    mountMs_warm: stat(mountWarm, 2),
    perRunS: sAll.map((x) => +x.toFixed(1)),
  });
}

// Control for the rejected variant: one shared module scope. Only memory; its isolation failure is check C1x.
{
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await oneRun("pb6", { shareModule: true }));
  const sShared = runs.map((r) => (r.heap[8] - r.heap[1]) / 7 / KiB);
  out.controls = { sharedModuleScope_pb6_sessionKiB_2to8: stat(sShared, 1) };
  console.log("control shared module scope, pb6: s(2..8) =", out.controls.sharedModuleScope_pb6_sessionKiB_2to8.p50, "KiB");
}

// Churn: open and close sessions. Heap slope in a bookkeeping-free worker; liveness of closed sessions with WeakRefs in a second one.
async function churn(plugin, cycles) {
  const w = new Pb6Worker({ plugin, light: true });
  await w.ready();
  await w.open(1, FACTS[plugin](1));
  const marks = [250, 500, 1000, 1500, cycles]; // heap rises for ~500 cycles (V8 tier-up), then must stay flat
  const samples = { 0: (await w.heap("c0")).used };
  for (let i = 1; i <= cycles; i++) {
    await w.open(100 + i, FACTS[plugin](100 + i));
    await w.close(100 + i);
    if (marks.includes(i)) samples[i] = (await w.heap(`c${i}`)).used;
  }
  await w.terminate();
  const v = new Pb6Worker({ plugin });
  await v.ready();
  await v.open(1, FACTS[plugin](1));
  for (let i = 1; i <= 50; i++) {
    await v.open(100 + i, FACTS[plugin](100 + i));
    await v.close(100 + i);
  }
  const weak = await v.weak();
  const res = {
    plugin,
    cycles,
    heapKiB: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, +(v / KiB).toFixed(1)])),
    slopeKiBPerCycle_250to500: +((samples[500] - samples[250]) / 250 / KiB).toFixed(3),
    slopeKiBPerCycle_1000toEnd: +((samples[cycles] - samples[1000]) / (cycles - 1000) / KiB).toFixed(3),
    weak: { cyclesChecked: 50, tracked: weak.tracked, aliveSessions: [...new Set(weak.alive.map((a) => a.sid))] },
    errors: w.errors.length + v.errors.length,
  };
  await v.terminate();
  return res;
}
out.churn = [await churn("pb6", 2000), await churn("list200", 2000)];

writeFileSync(join(root, "results", "measure.json"), JSON.stringify(out, null, 2));
for (const c of out.cases) {
  console.log(`${c.plugin.padEnd(8)} s(2..8)=${c.sessionKiB_2to8.p50} KiB [min ${c.sessionKiB_2to8.min} max ${c.sessionKiB_2to8.max}]  s(2..4)=${c.sessionKiB_2to4.p50}  s(5..8)=${c.sessionKiB_5to8.p50}  first=${c.firstSessionKiB.p50} KiB  eval cold ${c.evalMs_cold.p50} / warm p50 ${c.evalMs_warm.p50} ms  mount cold ${c.mountMs_cold.p50} / warm p50 ${c.mountMs_warm.p50} ms  errors ${c.errors.join(",")}`);
}
console.log(JSON.stringify(out.churn, null, 1));
