import { describe, expect, test } from "vite-plus/test";
import { parseManifest } from "@moxi/sdk/host";
import { createTestHost } from "@moxi/sdk/testing";
import plugin from "./index.ts";
import manifest from "./plugin.json";

const at = 0;
const player = {
  ok: true,
  at,
  value: { name: "Mo Kai", profession: "monk", position: { x: 0, y: 0 } },
} as const;
const target = (x: number) =>
  ({ ok: true, at, value: { id: 7, name: "Foe", kind: "foe", position: { x, y: 0 } } }) as const;

describe("target distance", () => {
  test.each([
    [100, "100", "Touch"],
    [1000, "1000", "Earshot"],
    [1248, "1248", "Cast range"],
    [6000, "6000", "Out of compass"],
  ])("a target at %i units shows %s and %s", async (x, distance, band) => {
    const host = await createTestHost(manifest, plugin, {
      game: { player, target: target(x) },
    });
    expect(host.state.hud.distance).toMatchObject({
      type: "row",
      children: [{ text: distance }, { text: band }],
    });
  });

  test("hides when the target is gone, unsupported after an update, or withheld in PvP", async () => {
    const host = await createTestHost(manifest, plugin, {
      game: { player, target: target(500) },
    });
    for (const t of [
      { ok: true, at, value: null },
      { ok: false, reason: "unsupported" },
      { ok: false, reason: "restricted-area" },
    ] as const) {
      await host.setGame({ target: t });
      expect(host.state.hud.distance).toBeNull();
    }
  });
});

test("accepts the bundled manifest without author casts", () => {
  expect(parseManifest(manifest)).toEqual(manifest);
});
