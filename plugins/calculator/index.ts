import { definePlugin, Meta, type HubItem } from "@moxi/sdk";

// Gold value of one unit. The ecto value is a sample quote, labelled as such.
const UNITS: Record<string, { gold: number; name: string; sample?: true }> = {
  g: { gold: 1, name: "gold" },
  k: { gold: 1000, name: "gold" },
  p: { gold: 1000, name: "platinum" },
  e: { gold: 8200, name: "Globs of Ectoplasm", sample: true },
};
const ALIASES: Record<string, string> = {
  g: "g",
  gold: "g",
  k: "k",
  p: "p",
  plat: "p",
  platinum: "p",
  e: "e",
  ecto: "e",
  ectos: "e",
  ectoplasm: "e",
};
const PATTERN = /^(\d+(?:\.\d+)?)\s*([a-z]+)\s+(?:in|to)\s+([a-z]+)$/;

const format = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");

export default definePlugin(({ hub }) => {
  hub.query((text): HubItem[] => {
    const m = PATTERN.exec(text.trim().toLowerCase());
    if (!m || m[2] === undefined || m[3] === undefined) return [];
    const from = UNITS[ALIASES[m[2]] ?? ""],
      to = UNITS[ALIASES[m[3]] ?? ""];
    if (!from || !to) return [];
    const amount = Number(m[1]);
    const result = (amount * from.gold) / to.gold;
    const sample = from.sample || to.sample;
    const answer = `${format(result)} ${to.name}`;
    return [
      {
        id: `calc:${text}`,
        // "100k" reads as 100000 gold, not "100 gold".
        title: `${format(from.name === "gold" ? amount * from.gold : amount)} ${from.name} = ${answer}`,
        subtitle: sample ? "Sample trader quote: 1 ecto = 8.2 platinum" : "Fixed conversion",
        icon: { glyph: "coins" },
        preview: [
          Meta([
            ["Result", answer],
            ["Source", sample ? "Sample quote, not live" : "Fixed rate"],
          ]),
        ],
        actions: [{ id: "copy", title: "Copy result", copy: answer }],
      },
    ];
  });
});
