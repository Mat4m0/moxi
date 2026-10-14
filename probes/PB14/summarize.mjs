// Aggregates the PB14 launch files into one JSON document and prints it as "PB14 <json>" lines.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "pb14-out";
const toMiB = (kib) => Math.round((kib / 1024) * 100) / 100;
function pct(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}
const stats = (values) =>
  values.length
    ? { n: values.length, p50: toMiB(pct(values, 0.5)), p95: toMiB(pct(values, 0.95)), max: toMiB(Math.max(...values)) }
    : null;
const median = (values) => (values.length ? pct(values, 0.5) : null);

const launches = [];
for (const file of readdirSync(dir).filter((name) => /^launch-.*\.jsonl$/.test(name)).sort()) {
  const records = readFileSync(join(dir, file), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { kind: "unparsed", line: line.slice(0, 200) };
      }
    });
  const of = (kind) => records.filter((record) => record.kind === kind);
  const env = of("env")[0] ?? {};
  const state = {};
  for (const name of ["S0", "S1", "S2"]) {
    const rows = of("sample").filter((record) => record.state === name && record.privKiB !== undefined);
    const types = new Set(rows.flatMap((row) => Object.keys(row.byType ?? {})));
    state[name] = {
      samples: rows.length,
      private: stats(rows.map((row) => row.privKiB)),
      pss: stats(rows.map((row) => row.pssKiB)),
      rss: stats(rows.map((row) => row.rssKiB)),
      medianPrivKiB: median(rows.map((row) => row.privKiB)),
      byTypeMedianKiB: Object.fromEntries(
        [...types].map((type) => [type, median(rows.map((row) => row.byType?.[type] ?? 0))]),
      ),
      byAccountMedianKiB: Object.fromEntries(
        ["a", "b"].map((account) => [account, median(rows.map((row) => row.byAccount?.[account] ?? 0).filter((v) => v > 0))]),
      ),
      processesMedian: median(rows.map((row) => row.processes)),
      missingMax: Math.max(0, ...rows.map((row) => row.missing ?? 0)),
    };
  }
  const delta = (from, to) =>
    state[from].medianPrivKiB !== null && state[to].medianPrivKiB !== null
      ? toMiB(state[to].medianPrivKiB - state[from].medianPrivKiB)
      : null;
  const typeDelta = {};
  for (const type of new Set([...Object.keys(state.S1.byTypeMedianKiB), ...Object.keys(state.S2.byTypeMedianKiB)]))
    typeDelta[type] = toMiB((state.S2.byTypeMedianKiB[type] ?? 0) - (state.S1.byTypeMedianKiB[type] ?? 0));
  const s2 = of("sample").filter((record) => record.state === "S2" && record.frames);
  const frameRate = {};
  if (s2.length > 1)
    for (const account of ["a", "b"]) {
      const first = s2[0];
      const last = s2[s2.length - 1];
      frameRate[account] = Math.round(((last.frames[account] - first.frames[account]) / ((last.t - first.t) / 1000)) * 10) / 10;
    }
  launches.push({
    file,
    arm: env.arm,
    first: env.firstAccount,
    show: env.show,
    fast: env.fast,
    windows: Object.fromEntries(of("window").map((record) => [record.account, record.ready])),
    checks: Object.fromEntries(of("check").map((record) => [record.id, record.pass])),
    summary: of("summary")[0] ?? null,
    fatal: of("fatal")[0]?.message ?? null,
    errors: of("error").map((record) => `${record.step}: ${record.message}`.slice(0, 200)),
    memory: state,
    deltaMiB: { firstWindowOverNone: delta("S0", "S1"), secondWindow: delta("S1", "S2") },
    secondWindowByTypeMiB: typeDelta,
    frameRateS2: frameRate,
    env: { os: env.os, runner: env.runner, cpu: env.cpu, cpus: env.cpus, totalMemMiB: env.totalMemMiB, electron: env.electron, chrome: env.chrome, node: env.node },
  });
}

const byArm = {};
for (const arm of ["partitioned", "shared"]) {
  const mine = launches.filter((launch) => launch.arm === arm && launch.show !== false && !launch.fast);
  const second = mine.map((launch) => launch.deltaMiB.secondWindow).filter((v) => v !== null);
  const first = mine.map((launch) => launch.deltaMiB.firstWindowOverNone).filter((v) => v !== null);
  byArm[arm] = {
    launches: mine.length,
    secondWindowDeltaMiB: second,
    secondWindowMedianMiB: median(second),
    firstWindowDeltaMiB: first,
    firstWindowMedianMiB: median(first),
    s1PrivateP50MiB: mine.map((launch) => launch.memory.S1.private?.p50 ?? null),
    s2PrivateP50MiB: mine.map((launch) => launch.memory.S2.private?.p50 ?? null),
  };
}
const result = { dir, launches, byArm };
writeFileSync(join(dir, "summary.json"), JSON.stringify(result, null, 2));
console.log("PB14 " + JSON.stringify({ byArm }));
for (const launch of launches)
  console.log(
    "PB14 " +
      JSON.stringify({
        file: launch.file,
        windows: launch.windows,
        checks: launch.checks,
        deltaMiB: launch.deltaMiB,
        secondWindowByTypeMiB: launch.secondWindowByTypeMiB,
        frameRateS2: launch.frameRateS2,
        fatal: launch.fatal,
        errors: launch.errors.slice(0, 5),
      }),
  );
