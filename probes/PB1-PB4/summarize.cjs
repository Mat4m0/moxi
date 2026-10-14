"use strict";
// node summarize.cjs <dir with the CI artifacts> : derives w, s, ceilings and the decision rules of PB1 and PB4.
const fs = require("node:fs");
const path = require("node:path");
const { summarize } = require("./lib/stats.cjs");

const dir = process.argv[2] || path.join(__dirname, "out");
const read = (name) => {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const r2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);

function pb1() {
  const raw = read("pb1-raw.json");
  if (!raw) return null;
  const cases = raw.cases.filter((c) => !c.sequential && !c.error);
  const names = [...new Set(cases.map((c) => c.name))];
  const table = {};
  for (const name of names) {
    const runs = cases.filter((c) => c.name === name);
    const pooled = summarize(runs.flatMap((c) => c.series.privateKiB.map((v) => v / 1024)));
    const pss = summarize(runs.flatMap((c) => c.series.pssKiB.map((v) => v / 1024)));
    const perRunP50 = runs.map((c) => c.summary.privateMiB.p50);
    table[name] = {
      name,
      metric: "hostPrivateMiB",
      p50: r2(pooled.p50),
      p95: r2(pooled.p95),
      max: r2(pooled.max),
      host: r2(mean(perRunP50)),
      perRunP50: perRunP50.map(r2),
      pssP50: r2(pss.p50),
      driftMiB: runs.map((c) => r2(c.driftMiB)),
      batchesPerSec: runs.map((c) => r2(c.load.batchesPerSec)),
      readyP50: runs[0].spawn && r2(runs[0].spawn.readyMs.p50),
    };
  }
  const h = (name) => table[name] && table[name].host;
  const runDelta = (name, base, div) => {
    const a = cases.filter((c) => c.name === name);
    const b = cases.filter((c) => c.name === base);
    return a.map((c) => {
      const same = b.find((x) => x.run === c.run);
      return same ? r2((c.summary.privateMiB.p50 - same.summary.privateMiB.p50) / div) : null;
    });
  };
  const derived = {
    b_P0_hostMiB: h("P=0,S=0"),
    w_MiB: r2((h("P=10,S=1") - h("P=0,S=0")) / 10),
    w_perRun: runDelta("P=10,S=1", "P=0,S=0", 10),
    w1_P1_MiB: r2(h("P=1,S=1") - h("P=0,S=0")),
    w40_MiB: r2((h("P=40,S=1") - h("P=0,S=0")) / 40),
    s_MiB: r2((h("P=10,S=4") - h("P=10,S=1")) / 30),
    s_perRun: cases
      .filter((c) => c.name === "P=10,S=4")
      .map((c) => {
        const one = cases.find((x) => x.name === "P=10,S=1" && x.run === c.run);
        return one ? r2((c.summary.privateMiB.p50 - one.summary.privateMiB.p50) / 30) : null;
      }),
    s40_MiB: r2((h("P=40,S=4") - h("P=40,S=1")) / 120),
    host_P10_S4_minus_P0_MiB: r2(h("P=10,S=4") - h("P=0,S=0")),
    host_P40_S4_minus_P0_MiB: r2(h("P=40,S=4") - h("P=0,S=0")),
  };
  const ready = (pred) => {
    const rows = raw.cases.filter((c) => !c.error && c.spawn && pred(c));
    return summarize(rows.flatMap((c) => c.spawn.readyMs.n ? [] : []).concat([]));
  };
  // Pool per-case summaries is lossy, so report each case's own p50/p95 of ready time.
  const spawnTable = raw.cases
    .filter((c) => c.spawn && !c.error)
    .map((c) => ({
      name: c.name,
      run: c.run,
      readyP50: r2(c.spawn.readyMs.p50),
      readyP95: r2(c.spawn.readyMs.p95),
      readyMax: r2(c.spawn.readyMs.max),
      evalP50: r2(c.spawn.evalMs.p50),
      openFirstP50: r2(c.spawn.openFirstMs.p50),
      openFirstP95: r2(c.spawn.openFirstMs.p95),
      openExtraP50: c.spawn.openExtraMs.n ? r2(c.spawn.openExtraMs.p50) : null,
      openExtraP95: c.spawn.openExtraMs.n ? r2(c.spawn.openExtraMs.p95) : null,
      totalMs: r2(c.spawn.totalMs),
      failures: c.spawn.failures,
    }));
  const w = derived.w_MiB;
  const s = derived.s_MiB;
  const total = derived.host_P10_S4_minus_P0_MiB;
  let decision;
  if (w <= 6 && s <= 1 && total <= 102) decision = "adopt as designed";
  else {
    const parts = [];
    if (w > 10) parts.push("w above 10 MiB: also idle stop after 2 minutes and at most 15 running unverified plugins");
    else if (w > 6) parts.push("w between 6 and 10 MiB: HUD-only plugins get a slim runtime (reactivity plus HUD ops, no runtime-core); re-measure");
    if (s > 2) parts.push("s above 2 MiB: measure the shared-module variant; keep the factory unless it saves at least 50 %");
    else if (s > 1) parts.push("s above 1 MiB: report what grows (Vue apps or plugin module data)");
    if (total > 102) parts.push("host(P=10,S=4) - host(P=0) above 102 MiB");
    decision = parts.join("; ");
  }
  const launcher = read("launcher-idle.json");
  return {
    env: raw.env,
    config: raw.config,
    table,
    derived,
    spawnTable,
    errors: raw.cases.filter((c) => c.error).map((c) => ({ name: c.name, run: c.run, error: c.error })),
    decision,
    launcher: launcher && {
      launcherPrivateMiB: launcher.summary.launcher.privateMiB,
      todaysPluginHostPrivateMiB: launcher.summary.todaysPluginHost && launcher.summary.todaysPluginHost.privateMiB,
      status: launcher.summary.launcher.status,
    },
  };
}

function pb4() {
  const size = read("pb4-size-raw.json");
  const boots = ["off", "scheme", "scheme+acao"].map((c) => read(`pb4-boot-${c}.json`)).filter(Boolean);
  if (!size && boots.length === 0) return null;
  const out = { sizeTable: [], bisect: size && size.bisect, boot: boots.map((b) => ({ cors: b.cases[0] && b.cases[0].cors, cases: b.cases.map((c) => ({ sizeMiB: r2(c.sizeMiB), classified: c.classified, readyMs: c.boot && r2(c.boot.ms), pre: c.boot && c.boot.pre, post: c.boot && c.boot.post, hits: c.hits.length, hit0: c.hits[0], cdpFailures: c.cdp && c.cdp.failures, console: c.cdp && c.cdp.console, cdpErrors: c.cdp && c.cdp.errors, workerError: c.workerError, boot: c.boot })) })) };
  if (size) {
    const base = mean([size.baselineStart.privateMiB.p50, size.baselineEnd.privateMiB.p50]);
    out.baselinePrivateMiB = r2(base);
    for (const r of size.grid) {
      out.sizeTable.push({
        form: r.form,
        sizeMiB: r.sizeMiB,
        urlLength: r.urlLength,
        urlMiB: r.urlLength && r2(r.urlLength / 1048576),
        outcome: r.outcome,
        message: r.attempts && r.attempts[0] && r.attempts[0].message,
        readyP50: r2(r.readyMs.p50),
        readyP95: r2(r.readyMs.p95),
        openP50: r2(r.openMs.p50),
        urlBuildMs: r2(r.urlBuildMs),
        hostPrivateMiB: r.memory ? r2(r.memory.privateMiB.p50) : null,
        deltaMiB: r.memory ? r2(r.memory.privateMiB.p50 - base) : null,
      });
    }
    const passing = size.grid.filter((r) => r.form === "base64" && r.outcome === "started");
    const largest = passing.length ? Math.max(...passing.map((r) => r.sizeMiB)) : 0;
    out.largestPassingBase64MiB = largest;
    out.codeBudgetMiB = Math.min(largest / 2, 1);
    out.largestPassingBase64BisectMiB = size.bisect.base64 && r2(size.bisect.base64.largestPassBytes / 1048576);
  }
  return out;
}

const result = { PB1: pb1(), PB4: pb4() };
console.log(JSON.stringify(result, null, 1));
