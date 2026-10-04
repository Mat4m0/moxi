import type { Readiness } from "@moxi/contracts";
import { PatchNetworkError } from "./game-files/transport.ts";

export function createClientReadiness(options: {
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
  async function prepare() {
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
    }
  }
  return {
    current: () => value,
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
