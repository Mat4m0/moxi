// Aggregates the PB14 launch files (Main records) and the root sampler files (memory) into one
// JSON document, and prints it as "PB14 <json>" lines. Usage: node summarize.mjs <dir>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
const median = (values) => (values.length ? pct(values, 0.5) : null);
const stats = (values) =>
  values.length
    ? {
        n: values.length,
        p50: toMiB(pct(values, 0.5)),
        p95: toMiB(pct(values, 0.95)),
        max: toMiB(Math.max(...values)),
      }
    : null;
function lines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { kind: "unparsed", line: line.slice(0, 200) };
      }
    });
}

const states = ["S0", "S1", "S2", "S3"];
const launches = [];
for (const file of readdirSync(dir)
  .filter((name) => /^launch-.*\.jsonl$/.test(name))
  .sort()) {
  const records = lines(join(dir, file));
  const mem = lines(join(dir, file.replace(/^launch-/, "mem-")));
  const of = (kind) => records.filter((record) => record.kind === kind);
  const env = of("env")[0] ?? {};

  // Group the sampler rows into ticks (one tick = every Electron process at one instant).
  const ticks = new Map();
  for (const row of mem.filter((record) => record.kind === "mem")) {
    const tick = ticks.get(row.tick) ?? { t: row.t, rows: [] };
    tick.rows.push(row);
    ticks.set(row.tick, tick);
  }

  const state = {};
  for (const name of states) {
    const phase = of("phase").find((record) => record.state === name);
    if (!phase) continue;
    const from = phase.t + phase.warmMs;
    const to = from + phase.samples * 1000;
    const inside = [...ticks.values()].filter((tick) => tick.t >= from && tick.t <= to);
    const account = new Map(Object.entries(phase.pids ?? {}).map(([name, pid]) => [pid, name]));
    const rows = inside.map((tick) => {
      const byType = {};
      const byAccount = {};
      const vmByAccount = {};
      let priv = 0;
      let pss = 0;
      let rss = 0;
      for (const row of tick.rows) {
        if (!Number.isFinite(row.privKiB)) continue;
        const key = row.sub ? `${row.type}:${row.sub}` : row.type;
        byType[key] = (byType[key] ?? 0) + row.privKiB;
        priv += row.privKiB;
        pss += row.pssKiB;
        rss += row.rssKiB;
        const who = account.get(row.pid);
        if (who) {
          byAccount[who] = row.privKiB;
          vmByAccount[who] = row.vmKiB;
        }
      }
      return { priv, pss, rss, byType, byAccount, vmByAccount, processes: tick.rows.length };
    });
    const keys = new Set(rows.flatMap((row) => Object.keys(row.byType)));
    const med = (pick) => median(rows.map(pick).filter((value) => Number.isFinite(value)));
    state[name] = {
      samples: rows.length,
      expectedSamples: phase.samples,
      games: phase.games,
      private: stats(rows.map((row) => row.priv)),
      pss: stats(rows.map((row) => row.pss)),
      rss: stats(rows.map((row) => row.rss)),
      medianPrivKiB: med((row) => row.priv),
      byTypeMedianKiB: Object.fromEntries(
        [...keys].map((key) => [key, median(rows.map((row) => row.byType[key] ?? 0))]),
      ),
      byAccountMedianKiB: Object.fromEntries(
        ["a", "b"].map((who) => [who, med((row) => row.byAccount[who])]),
      ),
      vmSizeMedianMiB: Object.fromEntries(
        ["a", "b"].map((who) => {
          const value = med((row) => row.vmByAccount[who]);
          return [who, value === null ? null : toMiB(value)];
        }),
      ),
      processesMedian: med((row) => row.processes),
    };
  }
  const delta = (left, right) =>
    state[left]?.medianPrivKiB != null && state[right]?.medianPrivKiB != null
      ? toMiB(state[right].medianPrivKiB - state[left].medianPrivKiB)
      : null;
  const typeDelta = (left, right) => {
    if (!state[left] || !state[right]) return null;
    const out = {};
    for (const key of new Set([
      ...Object.keys(state[left].byTypeMedianKiB),
      ...Object.keys(state[right].byTypeMedianKiB),
    ]))
      out[key] = toMiB(
        (state[right].byTypeMedianKiB[key] ?? 0) - (state[left].byTypeMedianKiB[key] ?? 0),
      );
    return out;
  };

  // Frames per second per window while two windows ran (from Main's 1 Hz ticks).
  const frameRate = {};
  for (const name of ["S2", "S3"]) {
    const phase = of("phase").find((record) => record.state === name);
    if (!phase) continue;
    const from = phase.t + phase.warmMs;
    const to = from + phase.samples * 1000;
    const inside = of("tick").filter((tick) => tick.t >= from && tick.t <= to);
    if (inside.length < 2) continue;
    const first = inside[0];
    const last = inside[inside.length - 1];
    frameRate[name] = Object.fromEntries(
      ["a", "b"].map((who) => [
        who,
        Math.round(((last.frames[who] - first.frames[who]) / ((last.t - first.t) / 1000)) * 10) / 10,
      ]),
    );
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
    deltaMiB: {
      firstWindowOverNone: delta("S0", "S1"),
      secondWindow: delta("S1", "S2"),
      reserveWasmMemory: delta("S2", "S3"),
    },
    secondWindowByTypeMiB: typeDelta("S1", "S2"),
    reserve: of("reserve")[0]?.reserved ?? null,
    frameRate,
    memSamplerRows: mem.length,
    env: {
      os: env.os,
      runner: env.runner,
      cpu: env.cpu,
      cpus: env.cpus,
      totalMemMiB: env.totalMemMiB,
      electron: env.electron,
      chrome: env.chrome,
      node: env.node,
    },
  });
}

const byArm = {};
for (const arm of ["partitioned", "shared"]) {
  const mine = launches.filter((launch) => launch.arm === arm && launch.show !== false && !launch.fast);
  const col = (pick) => mine.map(pick).filter((value) => value !== null && value !== undefined);
  byArm[arm] = {
    launches: mine.length,
    secondWindowDeltaMiB: col((launch) => launch.deltaMiB.secondWindow),
    secondWindowMedianMiB: median(col((launch) => launch.deltaMiB.secondWindow)),
    firstWindowDeltaMiB: col((launch) => launch.deltaMiB.firstWindowOverNone),
    s1PrivateP50MiB: col((launch) => launch.memory.S1?.private?.p50),
    s2PrivateP50MiB: col((launch) => launch.memory.S2?.private?.p50),
    reserveDeltaMiB: col((launch) => launch.deltaMiB.reserveWasmMemory),
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
        samplesPerState: Object.fromEntries(
          Object.entries(launch.memory).map(([name, value]) => [name, value.samples]),
        ),
        deltaMiB: launch.deltaMiB,
        secondWindowByTypeMiB: launch.secondWindowByTypeMiB,
        privateP50MiB: Object.fromEntries(
          Object.entries(launch.memory).map(([name, value]) => [name, value.private?.p50 ?? null]),
        ),
        frameRate: launch.frameRate,
        vmS2: launch.memory.S2?.vmSizeMedianMiB,
        vmS3: launch.memory.S3?.vmSizeMedianMiB,
        reserve: launch.reserve,
        fatal: launch.fatal,
        errors: launch.errors.slice(0, 5),
      }),
  );
