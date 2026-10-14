"use strict";
// Linux memory metric of the common rules: Private_Clean + Private_Dirty from smaps_rollup.
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

let useSudo = false;
function parseRollup(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = /^(\w+):\s+(\d+) kB/.exec(line);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}
function readFile(path) {
  if (!useSudo) {
    try {
      return fs.readFileSync(path, "utf8");
    } catch (error) {
      if (error.code !== "EACCES" && error.code !== "EPERM") throw error;
      useSudo = true;
    }
  }
  return execFileSync("sudo", ["-n", "cat", path], { encoding: "utf8" });
}
// Returns KiB values; privateKiB is the gate metric.
function sampleProcess(pid) {
  const rollup = parseRollup(readFile(`/proc/${pid}/smaps_rollup`));
  return {
    privateKiB: (rollup.Private_Clean ?? 0) + (rollup.Private_Dirty ?? 0),
    pssKiB: rollup.Pss ?? 0,
    rssKiB: rollup.Rss ?? 0,
    sharedKiB: (rollup.Shared_Clean ?? 0) + (rollup.Shared_Dirty ?? 0),
  };
}
function processStatus(pid) {
  const out = {};
  try {
    const text = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    for (const key of ["Name", "Seccomp", "NoNewPrivs", "Threads", "VmRSS", "VmHWM"]) {
      const m = new RegExp(`^${key}:\\s+(.*)$`, "m").exec(text);
      if (m) out[key] = m[1].trim();
    }
    out.cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").slice(0, 400);
  } catch (error) {
    out.error = String(error.message);
  }
  return out;
}
const alive = (pid) => fs.existsSync(`/proc/${pid}`);
module.exports = { parseRollup, sampleProcess, processStatus, alive, usedSudo: () => useSudo };
