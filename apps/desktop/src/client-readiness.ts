import type { Download, Readiness } from "@moxi/contracts";
import { PatchNetworkError } from "./game-files/transport.ts";

export function createClientReadiness(options: {
  observe?(progress: (bytes: number, total: number) => void): Promise<() => void>;
  fill?(options: {
    signal: AbortSignal;
    onProgress: (bytes: number, total: number) => void;
  }): Promise<void>;
  prepare(progress: (received: number, total: number) => void): Promise<unknown>;
  state(): Promise<{ active: string | null; candidate: string | null }>;
  changed(readiness: Readiness): void;
  log(error: unknown): void;
  now(): number;
}) {
  const preparing = (): Readiness => ({
    state: "preparing",
    progress: {
      status: "running",
      received: 0,
      total: 0,
      bytesPerSecond: null,
      secondsRemaining: null,
    },
  });
  let value = preparing();
  let running: Promise<void> | undefined;
  function publish(next: Readiness) {
    value = next;
    options.changed(next);
  }
  let fillController: AbortController | undefined;
  let filling: Promise<void> | undefined;
  let paused = false;
  let unsubscribe: (() => void) | undefined;
  let lastResidentEvent = 0;
  let residentTimer: ReturnType<typeof setTimeout> | undefined;
  function download(
    status: Download["status"],
    received: number,
    total: number,
    rate: number | null,
  ): Readiness {
    return {
      state: "playable",
      backgroundDownload: {
        status,
        received,
        total,
        bytesPerSecond: rate,
        secondsRemaining: rate === null || rate === 0 ? null : (total - received) / rate,
      },
    };
  }
  function startFill() {
    if (!options.fill || paused || filling || value.state !== "playable") return;
    const controller = new AbortController();
    fillController = controller;
    let lastEvent = options.now();
    const samples: { time: number; received: number }[] = [];
    filling = options
      .fill({
        signal: controller.signal,
        onProgress(received, total) {
          if (controller.signal.aborted || value.state !== "playable") return;
          const time = options.now();
          while (samples.length > 1 && samples[1]!.time <= time - 3000) samples.shift();
          const first = samples[0];
          const rate =
            first && time > first.time && received > first.received
              ? ((received - first.received) * 1000) / (time - first.time)
              : null;
          samples.push({ time, received });
          const initial = value.backgroundDownload === null;
          const completed = received === total && value.backgroundDownload?.status !== "complete";
          value = download(received === total ? "complete" : "running", received, total, rate);
          if (initial || time - lastEvent >= 250 || completed) {
            lastEvent = time;
            options.changed(value);
          }
        },
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        options.log(error);
        paused = true;
        if (value.state === "playable" && value.backgroundDownload) {
          const { received, total } = value.backgroundDownload;
          publish(download("paused", received, total, null));
        }
      })
      .finally(() => {
        filling = undefined;
        if (!paused && controller.signal.aborted) startFill();
      });
  }
  async function observeResidency() {
    return options.observe?.((received, total) => {
      if (value.state === "offline-playable")
        value = {
          state: "offline-playable",
          gameFilesInfo: { bytes: received, totalBytes: total },
        };
      else if (paused && value.state === "playable")
        value = download(received === total ? "complete" : "paused", received, total, null);
      else return;
      if (!residentTimer) {
        const delay = Math.max(0, 250 - (options.now() - lastResidentEvent));
        residentTimer = setTimeout(() => {
          residentTimer = undefined;
          if (value.state === "offline-playable" || (paused && value.state === "playable")) {
            lastResidentEvent = options.now();
            options.changed(value);
          }
        }, delay);
      }
    });
  }
  async function prepare() {
    paused = true;
    clearTimeout(residentTimer);
    residentTimer = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    fillController?.abort();
    await filling;
    publish(preparing());
    const samples = [{ time: options.now(), received: 0 }];
    let lastEvent = options.now();
    try {
      await options.prepare((received, total) => {
        const time = options.now();
        while (samples.length > 1 && samples[1]!.time <= time - 3000) samples.shift();
        const first = samples[0]!;
        const elapsed = time - first.time;
        const bytesPerSecond =
          elapsed > 0 && received > first.received
            ? ((received - first.received) * 1000) / elapsed
            : null;
        samples.push({ time, received });
        value = {
          state: "preparing",
          progress: {
            status: "running",
            received,
            total,
            bytesPerSecond,
            secondsRemaining: bytesPerSecond === null ? null : (total - received) / bytesPerSecond,
          },
        };
        if (time - lastEvent >= 250) {
          lastEvent = time;
          options.changed(value);
        }
      });
      publish({ state: "playable", backgroundDownload: null });
      paused = false;
      unsubscribe = await observeResidency();
      startFill();
    } catch (error) {
      options.log(error);
      let usable = false;
      if (error instanceof PatchNetworkError) {
        try {
          const state = await options.state();
          usable = Boolean(state.active || state.candidate);
        } catch (stateError) {
          options.log(stateError);
        }
      }
      publish({ state: usable ? "offline-playable" : "repair-required" });
      if (usable) {
        try {
          unsubscribe = await observeResidency();
        } catch (observeError) {
          options.log(observeError);
        }
      }
    }
  }
  return {
    current: () => value,
    pause() {
      lastResidentEvent = options.now();
      paused = true;
      fillController?.abort();
      if (value.state === "playable" && value.backgroundDownload) {
        const { received, total, status } = value.backgroundDownload;
        if (status !== "complete") publish(download("paused", received, total, null));
      }
    },
    resume() {
      clearTimeout(residentTimer);
      residentTimer = undefined;
      paused = false;
      startFill();
    },
    retry() {
      if (!running)
        running = prepare().finally(() => {
          running = undefined;
        });
      return running;
    },
    assertPlayable() {
      if (value.state !== "playable" && value.state !== "offline-playable")
        throw new Error("The game client is not ready. Check Game Files and try again.");
    },
  };
}
