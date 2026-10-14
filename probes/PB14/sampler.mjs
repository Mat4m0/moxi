// Root-side memory sampler for PB14 (Linux). Chromium renderers are not dumpable, so only root can
// read their smaps_rollup. Run as: sudo -n node sampler.mjs <out.jsonl>. Stops on SIGTERM.
// Metric: Private_Clean + Private_Dirty per process (Pss and Rss alongside), 1 Hz, with VmSize.
import { appendFileSync, readdirSync, readFileSync, readlinkSync } from "node:fs";

const out = process.argv[2];
if (!out) throw new Error("usage: sampler.mjs <out.jsonl>");
const self = process.pid;
const kib = (text, name) => Number(new RegExp(`^${name}:\\s+(\\d+) kB`, "m").exec(text)?.[1] ?? NaN);

function electronProcesses() {
  const found = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === self) continue;
    try {
      // Chromium starts its children as /proc/self/exe, so identify the binary by the exe link.
      if (!readlinkSync(`/proc/${pid}/exe`).endsWith("/electron/dist/electron")) continue;
      // Chromium rewrites the title of forked children, so match on the whole command line.
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
      const type = /--type=(\S+)/.exec(cmdline)?.[1] ?? "browser";
      const sub = /--utility-sub-type=(\S+)/.exec(cmdline)?.[1];
      found.push({ pid, type, sub: sub ? sub.split(".").pop() : undefined });
    } catch {
      // The process ended while scanning.
    }
  }
  return found;
}

let tick = 0;
let stop = false;
process.on("SIGTERM", () => {
  stop = true;
});
process.on("SIGINT", () => {
  stop = true;
});
const started = Date.now();
while (!stop) {
  const t = Date.now();
  const lines = [];
  for (const { pid, type, sub } of electronProcesses()) {
    try {
      const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      lines.push(
        JSON.stringify({
          kind: "mem",
          tick,
          t,
          pid,
          type,
          sub,
          privKiB: kib(rollup, "Private_Clean") + kib(rollup, "Private_Dirty"),
          pssKiB: kib(rollup, "Pss"),
          pssAnonKiB: kib(rollup, "Pss_Anon"),
          pssFileKiB: kib(rollup, "Pss_File"),
          pssShmemKiB: kib(rollup, "Pss_Shmem"),
          rssKiB: kib(rollup, "Rss"),
          vmKiB: kib(status, "VmSize"),
        }),
      );
    } catch {
      // The process ended between discovery and reading.
    }
  }
  if (lines.length) appendFileSync(out, lines.join("\n") + "\n");
  tick++;
  const wait = started + tick * 1000 - Date.now();
  if (wait > 0) await new Promise((done) => setTimeout(done, wait));
}
