import { definePlugin, HudText, type HudNode } from "@moxi/sdk";

// Guild Wars range bands in game units (outer edge of each band; GWCA Constants.h).
const RANGES: readonly [number, string][] = [
  [144, "Touch"],
  [166, "Adjacent"],
  [252, "Nearby"],
  [322, "In the area"],
  [1012, "Earshot"],
  [1248, "Cast range"],
  [2500, "Spirit range"],
  [5000, "Compass"],
];

export default definePlugin((ctx) => {
  const { game, hud } = ctx;
  hud.widget("distance", (): HudNode | null => {
    const player = game.player();
    const target = game.target();
    if (!player.ok || !target.ok || !target.value) return null; // nothing to show is a valid state

    const { x, y } = target.value.position;
    const d = Math.hypot(x - player.value.position.x, y - player.value.position.y);
    const band = RANGES.find(([edge]) => d <= edge)?.[1] ?? "Out of compass";
    const tone = d <= 1248 ? "accent" : "muted";

    if (!ctx.settings().showRangeName) return HudText(`${Math.round(d)}`, { tone, size: "l" });
    return {
      type: "row",
      children: [
        HudText(`${Math.round(d)}`, { tone, size: "l" }),
        HudText(band, { tone: "muted", size: "s" }),
      ],
    };
  });
});
