import { reactive } from "vue";
import type { Observed, Slice } from "@moxi/sdk";

export type SimMode = "ok" | "loading" | "unsupported";

export const sim = reactive({
  mode: "ok" as SimMode,
  area: "outpost" as "outpost" | "explorable" | "pvp",
  hasTarget: true,
  moving: true,
  player: { x: 0, y: 0 },
  target: { x: 900, y: 300 },
  t: 0,
});

const MAPS = {
  outpost: [248, "Great Temple of Balthazar"],
  explorable: [55, "Talmark Wilderness"],
  pvp: [368, "Random Arenas"],
} as const;

export function tick(dt: number) {
  if (!sim.moving || !sim.hasTarget) return;
  sim.t += dt;
  // Walk the target in and out of cast range so the HUD changes visibly.
  const r = 1100 + Math.sin(sim.t / 2400) * 900;
  sim.target = { x: Math.cos(sim.t / 3100) * r, y: Math.sin(sim.t / 3100) * r };
}

export function observe(slice: Slice): Observed<unknown> {
  if (sim.mode === "loading") return { ok: false, reason: "loading" };
  // An ArenaNet update the integration cannot (yet) locate: only target breaks.
  if (sim.mode === "unsupported" && slice === "target") return { ok: false, reason: "unsupported" };
  const at = Date.now();
  switch (slice) {
    case "player":
      return {
        ok: true,
        at,
        value: { name: "Mo Kai", profession: "monk", position: { ...sim.player } },
      };
    case "target":
      if (sim.area === "pvp") return { ok: false, reason: "restricted-area" };
      return {
        ok: true,
        at,
        value: sim.hasTarget
          ? { id: 42, name: "Mursaat Elementalist", kind: "foe", position: { ...sim.target } }
          : null,
      };
    case "map": {
      const [id, name] = MAPS[sim.area];
      return { ok: true, at, value: { id, name, area: sim.area } };
    }
  }
}

export async function performAction(
  op: "game.loadBuild" | "game.travel",
  _args: unknown,
): Promise<import("@moxi/sdk").ActionResult> {
  if (sim.mode === "loading")
    return { status: "refused", reason: "restricted-area", message: "The map is loading." };
  if (op === "game.loadBuild" && sim.area !== "outpost")
    return {
      status: "refused",
      reason: "restricted-area",
      message: "Builds can only be loaded in an outpost.",
    };
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { status: "done" };
}
