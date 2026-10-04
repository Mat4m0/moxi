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

test("pause keeps Play available and an immediate resume waits for the aborted fill", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const events: Readiness[] = [];
  let calls = 0;
  let resumed!: () => void;
  const resumedFill = new Promise<void>((resolve) => {
    resumed = resolve;
  });
  const readiness = createClientReadiness({
    prepare: async () => {},
    state: async () => ({ active: null, candidate: "candidate" }),
    fill: async ({ signal, onProgress }) => {
      calls++;
      onProgress(4, 20);
      if (calls === 1) {
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
      } else {
        vi.setSystemTime(1000);
        onProgress(12, 20);
        expect(readiness.current()).toEqual({
          state: "playable",
          backgroundDownload: {
            status: "running",
            received: 12,
            total: 20,
            bytesPerSecond: 8,
            secondsRemaining: 1,
          },
        });
        onProgress(20, 20);
        resumed();
      }
    },
    changed: (value) => events.push(value),
    now: Date.now,
    log: () => {},
  });
  await readiness.retry();
  readiness.pause();
  expect(readiness.current()).toEqual({
    state: "playable",
    backgroundDownload: {
      status: "paused",
      received: 4,
      total: 20,
      bytesPerSecond: null,
      secondsRemaining: null,
    },
  });
  expect(() => readiness.assertPlayable()).not.toThrow();
  readiness.resume();
  await resumedFill;
  expect(calls).toBe(2);
  expect(readiness.current()).toEqual({
    state: "playable",
    backgroundDownload: {
      status: "complete",
      received: 20,
      total: 20,
      bytesPerSecond: 16,
      secondsRemaining: 0,
    },
  });
});

test("paused client reads publish their final resident bytes even inside the throttle interval", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  let progress!: (bytes: number, total: number) => void;
  const events: Readiness[] = [];
  const readiness = createClientReadiness({
    prepare: async () => {},
    state: async () => ({ active: null, candidate: "candidate" }),
    observe: async (listener) => {
      progress = listener;
      return () => {};
    },
    fill: async ({ signal, onProgress }) => {
      onProgress(4, 20);
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    },
    changed: (value) => events.push(value),
    now: Date.now,
    log: () => {},
  });
  await readiness.retry();
  readiness.pause();
  const count = events.length;
  progress(8, 20);
  progress(12, 20);
  await vi.advanceTimersByTimeAsync(249);
  expect(events).toHaveLength(count);
  await vi.advanceTimersByTimeAsync(1);
  expect(events).toHaveLength(count + 1);
  expect(events.at(-1)).toEqual({
    state: "playable",
    backgroundDownload: {
      status: "paused",
      received: 12,
      total: 20,
      bytesPerSecond: null,
      secondsRemaining: null,
    },
  });
});

test("an offline usable cache reports resident snapshot bytes without starting a fill", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const events: Readiness[] = [];
  const fill = vi.fn(async () => {});
  const readiness = createClientReadiness({
    prepare: async () => {
      throw new PatchNetworkError("offline");
    },
    state: async () => ({ active: "active", candidate: null }),
    observe: async (progress) => {
      progress(12, 20);
      return () => {};
    },
    fill,
    changed: (value) => events.push(value),
    now: Date.now,
    log: () => {},
  });
  await readiness.retry();
  await vi.runAllTimersAsync();
  expect(events.at(-1)).toEqual({
    state: "offline-playable",
    gameFilesInfo: { bytes: 12, totalBytes: 20 },
  });
  expect(() => readiness.assertPlayable()).not.toThrow();
  expect(fill).not.toHaveBeenCalled();
});
