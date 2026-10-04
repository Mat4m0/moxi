import type { WasmModule } from "../wasm/module";
import { fingerprints } from "./fingerprint";

type Match = { index: number; via: "fingerprint" | "call-graph" };

function uniquePositions(values: string[]): Map<string, number> {
  const positions = new Map<string, number>();
  values.forEach((value, index) => positions.set(value, positions.has(value) ? -1 : index));
  return positions;
}

export function matchBuilds(old: WasmModule, next: WasmModule): Map<number, Match> {
  const a = fingerprints(old),
    b = fingerprints(next);
  const oldPositions = uniquePositions(a.values),
    nextPositions = uniquePositions(b.values);
  const matches = new Map<number, Match>();
  for (const [value, index] of oldPositions) {
    const target = nextPositions.get(value);
    if (index >= 0 && target !== undefined && target >= 0)
      matches.set(index, { index: target, via: "fingerprint" });
  }
  const taken = new Set([...matches.values()].map((match) => match.index));
  for (let round = 0; round < 10; round++) {
    const proposals = new Map<number, Set<number>>();
    for (const [i, match] of matches) {
      const ca = a.calls[i] ?? [],
        cb = b.calls[match.index] ?? [];
      if (ca.length !== cb.length) continue;
      ca.forEach((x, position) => {
        const y = cb[position];
        if (
          y === undefined ||
          x < old.importedFuncs ||
          y < next.importedFuncs ||
          matches.has(x) ||
          taken.has(y)
        )
          return;
        const source = old.funcs[x],
          target = next.funcs[y];
        if (!source || !target || old.types[source.typeIndex] !== next.types[target.typeIndex])
          return;
        const targets = proposals.get(x) ?? new Set<number>();
        targets.add(y);
        proposals.set(x, targets);
      });
    }
    const claims = new Map<number, number>();
    for (const targets of proposals.values()) {
      if (targets.size !== 1) continue;
      for (const y of targets) claims.set(y, (claims.get(y) ?? 0) + 1);
    }
    let added = 0;
    for (const [x, targets] of proposals) {
      if (targets.size !== 1) continue;
      for (const y of targets) {
        if (claims.get(y) !== 1 || taken.has(y)) continue;
        matches.set(x, { index: y, via: "call-graph" });
        taken.add(y);
        added++;
      }
    }
    if (!added) break;
  }
  return matches;
}
