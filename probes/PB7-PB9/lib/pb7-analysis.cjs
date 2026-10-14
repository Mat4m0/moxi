"use strict";
// PB7 analysis: turns the raw samples of the game page, the hosts and Main into per-phase
// statistics. Pure functions over plain arrays, so the data shapes can be checked without Electron.
const { summarize, rowsIn } = require("./stats.cjs");

const col = (flat, stride, column, from, to) => rowsIn(flat, stride, from, to).map((row) => row[column]);
const absDev = (values, nominal) => values.map((v) => Math.abs(v - nominal));
const maxOf = (values) => (values.length ? Math.max(...values) : null);

function summarizeStates(gameStates, from, to) {
  const rows = gameStates.filter((s) => s[0] >= from && s[0] < to);
  const count = (i) => rows.filter((s) => s[i]).length;
  return { samples: rows.length, minimized: count(1), visible: count(2), focused: count(3), covered: count(4) };
}

// phases: [{ name, start, end }] in epoch ms. The "warmup" phase is excluded from every group.
function analyze({ phases, gameData, hostData, mainPongs, mainStops, mainTicks, loopLag, gameStates, cpu }) {
  const measured = phases.filter((p) => p.name !== "warmup");
  const groups = [
    ...measured.map((p) => ({ name: p.name, from: p.start, to: p.end })),
    { name: "all", from: measured[0].start, to: measured[measured.length - 1].end },
  ];
  const result = {};
  for (const { name, from, to } of groups) {
    const hostRows = (key, stride) => hostData.flatMap((d) => rowsIn(d[key], stride, from, to));
    const hostCols = (key, stride, column) => hostData.flatMap((d) => col(d[key], stride, column, from, to));
    const pongIntervals = hostRows("pong", 4).map((r) => r[2]);
    const timerIntervals = hostCols("wdTicks", 2, 1);
    const mainIntervals = col(mainPongs, 4, 2, from, to);
    const stops = hostData.flatMap((d) => d.stops.filter((s) => s[0] >= from && s[0] < to));
    const cpuByRole = {};
    for (const [t, role, percent] of cpu) {
      if (t >= from && t < to) (cpuByRole[role] ||= []).push(percent);
    }
    const factTicks = col(gameData.ticks, 2, 1, from, to);
    result[name] = {
      seconds: Math.round((to - from) / 100) / 10,
      latencyFactToApplierMs: summarize(col(gameData.lat, 2, 1, from, to), 3),
      gameFactTickIntervalMs: summarize(factTicks, 3),
      gameFactTickJitterMs: summarize(absDev(factTicks, 50), 3),
      gameRafPerSecond: summarize(col(gameData.frames, 2, 1, from, to), 1),
      hostWatchdog: {
        pongIntervalMs: summarize(pongIntervals, 2),
        pongJitterMs: summarize(absDev(pongIntervals, 1000), 2),
        rttMs: summarize(hostRows("pong", 4).map((r) => r[3]), 3),
        gapsOver2500: pongIntervals.filter((v) => v > 2500).length,
        maxGapMs: maxOf(pongIntervals),
        timerIntervalMs: summarize(timerIntervals, 2),
        timerJitterMs: summarize(absDev(timerIntervals, 1000), 2),
        wouldBeStops: stops.length,
        wouldBeStopsWhenOwnTickOnTime: stops.filter((s) => s[3] === 0).length,
      },
      mainDrivenPings: {
        pongIntervalMs: summarize(mainIntervals, 2),
        pongJitterMs: summarize(absDev(mainIntervals, 1000), 2),
        rttMs: summarize(col(mainPongs, 4, 3, from, to), 3),
        gapsOver2500: mainIntervals.filter((v) => v > 2500).length,
        maxGapMs: maxOf(mainIntervals),
        wouldBeStops: mainStops.filter((s) => s[0] >= from && s[0] < to).length,
        mainTimerJitterMs: summarize(absDev(col(mainTicks, 2, 1, from, to), 1000), 2),
      },
      hostRafPerSecond: summarize(hostCols("raf", 2, 1), 1),
      hostSetTimeout0DelayMs: summarize(hostCols("t0", 2, 1), 2),
      workerTimerLateness100msMs: summarize(
        hostData.flatMap((d) => d.workerStats.flatMap((w) => col(w.gaps, 2, 1, from, to))),
        2,
      ),
      mainLoopLagMs: summarize(col(loopLag, 2, 1, from, to), 2),
      cpuPercentByRole: Object.fromEntries(Object.entries(cpuByRole).map(([role, v]) => [role, summarize(v, 1)])),
      gameStates: summarizeStates(gameStates, from, to),
    };
  }
  return result;
}

// Last known visibilityState at the start of each phase, plus every change inside it.
function visibilityPerPhase(phases, vis) {
  return phases.map((p) => {
    const before = vis.filter(([t]) => t <= p.start).pop();
    const inside = vis.filter(([t]) => t > p.start && t < p.end).map(([t, s]) => [Math.round((t - p.start) / 100) / 10, s]);
    return { phase: p.name, atStart: before ? before[1] : null, changes: inside };
  });
}

module.exports = { analyze, visibilityPerPhase };
