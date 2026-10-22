// Deterministic fixture data. No ArenaNet data: names and skill ids are made up.
const PROFS = ["Warrior", "Ranger", "Monk", "Necromancer", "Mesmer", "Elementalist", "Assassin", "Ritualist"];

export function buildsFact(label, n = 200) {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `${label}-b${i}`,
    name: `Build ${label}.${i}`,
    prof: PROFS[i % 8],
    sec: PROFS[(i * 3 + 1) % 8],
    skills: Array.from({ length: 8 }, (_, k) => 100 + ((i * 17 + k * 31) % 900)),
    note: `Notes for build ${i}: bring a spare set of runes and check the attribute split before Apply.`,
  }));
  return { rows };
}

export function pricesFact(label, n = 500) {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `${label}-p${i}`,
    name: `Item ${label}.${i}`,
    category: ["Material", "Rune", "Weapon", "Consumable"][i % 4],
    buy: 100 + ((i * 37) % 5000),
    sell: 90 + ((i * 53) % 5200),
  }));
  return { rows };
}
