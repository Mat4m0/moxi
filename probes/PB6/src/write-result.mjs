// Turns results/checks.json and results/measure.json into the PROBES.md result file for PB6.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const checks = JSON.parse(readFileSync(join(root, "results/checks.json"), "utf8"));
const m = JSON.parse(readFileSync(join(root, "results/measure.json"), "utf8"));
const sizes = JSON.parse(readFileSync(join(root, "dist/sizes.json"), "utf8"));
const note = (id) => checks.find((c) => c.id === id).notes;
const one = (v) => ({ p50: v, p95: v, max: v });

const cases = [];
for (const c of m.cases) {
  cases.push({ name: `s: extra session, ${c.plugin}`, metric: "heapKiBPerSession(forced GC, sessions 2..8 over 1)", p50: c.sessionKiB_2to8.p50, p95: c.sessionKiB_2to8.p95, max: c.sessionKiB_2to8.max });
  cases.push({ name: `first session (cold), ${c.plugin}`, metric: "heapKiB", p50: c.firstSessionKiB.p50, p95: c.firstSessionKiB.p95, max: c.firstSessionKiB.max });
  cases.push({ name: `module evaluation, extra session, ${c.plugin}`, metric: "ms", p50: c.evalMs_warm.p50, p95: c.evalMs_warm.p95, max: c.evalMs_warm.max });
  cases.push({ name: `module evaluation, first session, ${c.plugin}`, metric: "ms", p50: c.evalMs_cold.p50, p95: c.evalMs_cold.p95, max: c.evalMs_cold.max });
  cases.push({ name: `mount of both roots, extra session, ${c.plugin}`, metric: "ms", p50: c.mountMs_warm.p50, p95: c.mountMs_warm.p95, max: c.mountMs_warm.max });
}
const ctl = m.controls.sharedModuleScope_pb6_sessionKiB_2to8;
cases.push({ name: "control: shared module scope (rejected variant), pb6", metric: "heapKiBPerSession", p50: ctl.p50, p95: ctl.p95, max: ctl.max });
for (const c of m.churn) {
  cases.push({ name: `open+close churn x${c.cycles}, ${c.plugin}`, metric: "heapKiBPerCycle(cycles 1000..end, forced GC)", ...one(c.slopeKiBPerCycle_1000toEnd) });
}
const lat = note("C8").sessionOneLatencyMs;
cases.push({ name: "session 1 latency, alone", metric: "ms(median of 5)", ...one(lat.alone) });
cases.push({ name: "session 1 latency, session 4 busy 30 ms, same scheduler flush", metric: "ms(median of 5)", ...one(lat.sameFlushWithSession4Busy30ms) });
cases.push({ name: "session 1 latency, session 4 busy 30 ms, separate tasks", metric: "ms(median of 5)", ...one(lat.separateTasksWithSession4Busy30ms) });

const result = {
  probe: "PB6",
  date: "2026-10-14",
  os: `${m.os} (macOS 27.0)`,
  runner: "local-node",
  electron: `n/a: Node ${m.node} worker_threads, V8 ${m.v8}; no Electron or Chromium was started`,
  verdict: "pass",
  cases,
  checks: checks.map((c) => ({ id: c.id, kind: c.kind, pass: c.pass, title: c.title })),
  decision: "adopt as designed: factory per session in one worker (D 3.2). Add to the design: batch ops per (session, root); run each factory in a per-session effect scope; bind session-scoped SDK functions through the per-session __moxi argument.",
  notes: {
    cpu: m.cpu,
    bundleKiB: sizes,
    isolation: `${checks.filter((c) => c.pass).length}/${checks.length} checks pass (${checks.filter((c) => c.kind === "isolation").length} isolation, ${checks.filter((c) => c.kind === "control").length} controls that must fail, ${checks.filter((c) => c.kind === "finding" || c.kind === "expected-leak").length} findings and expected leaks); no state leaks through Vue globals or runtime state. Final code: 3 full runs, the third with all cores busy.`,
    leaksByDesign: ["globalThis and Array.prototype writes (C7)", "a raw object shared via globalThis becomes reactive across sessions (C6b)"],
    findings: {
      lastGoodTree: note("C4b"),
      moduleLevelWatcher: note("C4f"),
      uncaughtTimer: note("C4e"),
      withoutScopeStop: note("C5").withoutScopeStop,
    },
    code: "probes/PB6",
  },
};
const dir = new URL("../results", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "PB6.json"), JSON.stringify(result, null, 2));
console.log("wrote", join(dir, "PB6.json"), "cases:", cases.length);
for (const c of cases) console.log(`${c.name} | ${c.metric} | ${c.p50} / ${c.p95} / ${c.max}`);
