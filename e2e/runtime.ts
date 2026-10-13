import { test as base, expect, type ElectronApplication } from "@playwright/test";
import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { rm, writeFile } from "node:fs/promises";

import { stageBudget } from "./budget.ts";
export { stageBudget } from "./budget.ts";
const run = promisify(execFile);

export async function processes() {
  const { stdout } = await run("ps", ["-axo", "pid=,ppid=,pgid=,comm="], {
    timeout: 5_000,
    killSignal: "SIGKILL",
  });
  return stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [pid, parent, group, ...command] = line.trim().split(/\s+/);
      return {
        pid: Number(pid),
        parent: Number(parent),
        group: Number(group),
        command: command.join(" "),
      };
    })
    .filter((entry) => entry.command !== "ps");
}

export async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
  const start = Date.now();
  console.log(`[stage] START ${name}`);
  try {
    return await base.step(name, action, { timeout: stageBudget });
  } catch (error) {
    console.error(`[stage] FAILED ${name}`);
    throw error;
  } finally {
    console.log(`[stage] END ${name}: ${Date.now() - start} ms`);
  }
}

export const test = base.extend<{
  cleanup: {
    apps: { application: ElectronApplication; child: ChildProcess }[];
    data: string[];
    children: ChildProcess[];
  };
}>({
  cleanup: [
    async ({ playwright }, use, testInfo) => {
      const cleanup: {
        apps: { application: ElectronApplication; child: ChildProcess }[];
        data: string[];
        children: ChildProcess[];
      } = { apps: [], data: [], children: [] };
      void playwright;
      try {
        await use(cleanup);
      } finally {
        const start = Date.now();
        const groups = new Set([
          ...cleanup.apps.map(({ child }) => child.pid),
          ...cleanup.children.map((child) => child.pid),
        ]);
        const owned = new Set<number>([process.pid]);
        for (const group of groups) if (group) owned.add(group);
        const snapshot = await processes().catch((error: unknown) => {
          console.error("[cleanup] Process snapshot unavailable:", error);
          return [];
        });
        for (const entry of snapshot)
          if (groups.has(entry.group) && entry.pid) owned.add(entry.pid);
        if (testInfo.status !== testInfo.expectedStatus) {
          await writeFile(
            testInfo.outputPath("processes.json"),
            JSON.stringify(
              snapshot.filter((entry) => groups.has(entry.group)),
              null,
              2,
            ),
          ).catch((error: unknown) => console.error("[cleanup] Process evidence failed:", error));
          if (process.platform === "darwin") {
            for (const { child } of cleanup.apps) {
              const pid = child.pid;
              if (pid && snapshot.some((entry) => entry.pid === pid)) {
                await run(
                  "sample",
                  [String(pid), "1", "10", "-file", testInfo.outputPath(`sample-${pid}.txt`)],
                  { timeout: 5_000, killSignal: "SIGKILL" },
                ).catch((error: unknown) => console.error("[cleanup] sample failed:", error));
                break;
              }
            }
          }
        }
        let size = 0;
        while (size !== owned.size) {
          size = owned.size;
          for (const entry of snapshot)
            if (entry.pid && entry.parent && owned.has(entry.parent)) owned.add(entry.pid);
        }
        owned.delete(process.pid);
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.allSettled(cleanup.apps.map(({ application }) => application.close())),
            new Promise<void>((done) => {
              deadline = setTimeout(done, 8_000);
            }),
          ]);
        } finally {
          clearTimeout(deadline);
          // Playwright launches Electron in its own process group; include reparented children.
          if (process.platform !== "win32") {
            for (const group of groups) {
              if (group) {
                try {
                  process.kill(-group, "SIGKILL");
                } catch (error) {
                  if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH")
                    console.error(`[cleanup] Cannot kill group ${group}:`, error);
                }
              }
            }
          }
          for (const pid of owned) {
            try {
              process.kill(pid, "SIGKILL");
            } catch (error) {
              if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH")
                console.error(`[cleanup] Cannot kill ${pid}:`, error);
            }
          }
          await Promise.all(cleanup.data.map((data) => rm(data, { recursive: true, force: true })));
        }
        await expect
          .poll(
            async () =>
              (await processes()).filter(
                ({ pid, group }) => pid && (owned.has(pid) || groups.has(group)),
              ),
            {
              timeout: 10_000,
            },
          )
          .toEqual([]);
        console.log(`[cleanup] ${Date.now() - start} ms; ${owned.size} owned processes; 0 remain`);
      }
    },
    { auto: true, timeout: 30_000 },
  ],
});
