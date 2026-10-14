"use strict";
// Small statistics helpers shared by the PB7 and PB9 probes. Probe code, not product code.

function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// Linear-interpolated percentile on an ascending Float64Array.
function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function summarize(values, digits = 2) {
  const clean = Float64Array.from(values.filter((v) => Number.isFinite(v))).sort();
  if (clean.length === 0) return { n: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null };
  let sum = 0;
  for (const v of clean) sum += v;
  return {
    n: clean.length,
    min: round(clean[0], digits),
    p50: round(pct(clean, 0.5), digits),
    p95: round(pct(clean, 0.95), digits),
    p99: round(pct(clean, 0.99), digits),
    max: round(clean[clean.length - 1], digits),
    mean: round(sum / clean.length, digits),
  };
}

// Flat sample arrays: [t0, a0, b0, t1, a1, b1, ...] with a fixed stride. Returns the rows
// whose first column t lies in [from, to).
function rowsIn(flat, stride, from, to) {
  const rows = [];
  for (let i = 0; i + stride <= flat.length; i += stride) {
    const t = flat[i];
    if (t >= from && t < to) rows.push(flat.slice(i, i + stride));
  }
  return rows;
}

module.exports = { round, pct, summarize, rowsIn };
