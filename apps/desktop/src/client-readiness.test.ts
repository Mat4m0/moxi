import { afterEach, expect, test, vi } from "vite-plus/test";
import type { Readiness } from "@moxi/contracts";
import { createClientReadiness } from "./client-readiness.ts";
import { PatchNetworkError } from "./game-files/transport.ts";

afterEach(() => vi.useRealTimers());

test("keeps Play closed until preparation succeeds and coalesces concurrent retries", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const events: Readiness[] = [];
  const prepare = vi.fn(async () => gate);
  const readiness = createClientReadiness({
    prepare,
    state: async () => ({ active: null, candidate: null }),
    now: Date.now,
    changed: (value) => events.push(value),
    log: () => {},
  });
  expect(() => readiness.assertPlayable()).toThrow("The game client is not ready");
  const first = readiness.retry();
  expect(readiness.retry()).toBe(first);
  expect(readiness.current().state).toBe("preparing");
  finish();
  await first;
  expect(readiness.current()).toEqual({ state: "playable", backgroundDownload: null });
  expect(() => readiness.assertPlayable()).not.toThrow();
  await readiness.retry();
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(events.map((value) => value.state)).toEqual([
    "preparing",
    "playable",
    "preparing",
    "playable",
  ]);
});

test.each([
  [null, null, true, "repair-required"],
  ["active", null, true, "offline-playable"],
  [null, "candidate", true, "offline-playable"],
  ["active", null, false, "repair-required"],
] as const)(
  "does not unlock an unusable cache after failure (%s, %s, network=%s)",
  async (active, candidate, network, expected) => {
    const events: Readiness[] = [];
    const error = network ? new PatchNetworkError("offline") : new Error("invalid artifacts");
    const log = vi.fn();
    const readiness = createClientReadiness({
      prepare: async () => {
        throw error;
      },
      state: async () => ({ active, candidate }),
      now: Date.now,
      changed: (value) => events.push(value),
      log,
    });
    await readiness.retry();
    expect(events.map((value) => value.state)).toEqual(["preparing", expected]);
    expect(log).toHaveBeenCalledWith(error);
    if (expected === "repair-required") expect(() => readiness.assertPlayable()).toThrow();
    else expect(() => readiness.assertPlayable()).not.toThrow();
  },
);

test("limits progress to four events per second and drops old speed samples", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const events: { time: number; value: Readiness }[] = [];
  const readiness = createClientReadiness({
    prepare: async (progress) => {
      progress(0, 10000);
      expect(readiness.current()).toEqual({
        state: "preparing",
        progress: {
          status: "running",
          received: 0,
          total: 10000,
          bytesPerSecond: null,
          secondsRemaining: null,
        },
      });
      for (let i = 1; i <= 200; i++) {
        vi.setSystemTime(i * 10);
        progress(i * 10, 10000);
      }
      vi.setSystemTime(6000);
      progress(6000, 10000);
      expect(readiness.current()).toEqual({
        state: "preparing",
        progress: {
          status: "running",
          received: 6000,
          total: 10000,
          bytesPerSecond: 1000,
          secondsRemaining: 4,
        },
      });
    },
    state: async () => ({ active: null, candidate: null }),
    now: Date.now,
    changed: (value) => events.push({ time: Date.now(), value }),
    log: () => {},
  });
  await readiness.retry();
  expect(
    events
      .filter((event) => event.value.state === "preparing" && event.time > 0)
      .map((event) => event.time),
  ).toEqual([250, 500, 750, 1000, 1250, 1500, 1750, 2000, 6000]);
  expect(readiness.current()).toEqual({ state: "playable", backgroundDownload: null });
});
