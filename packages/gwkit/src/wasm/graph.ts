import { decodeBody } from "./decode";
import type { WasmModule } from "./module";

export function callGraph(module: WasmModule): {
  callees(index: number): readonly number[];
  callers(index: number): readonly number[];
} {
  const outgoing = module.funcs.map(() => new Set<number>());
  const incoming = module.funcs.map(() => new Set<number>());
  const signatures = module.tables.map((t) => {
    const byType = new Map<string, Set<number>>();
    for (const index of t.elems) {
      if (index === null || index === undefined) continue;
      const f = module.funcs[index];
      if (!f) continue;
      const type = module.types[f.typeIndex];
      if (type === undefined) continue;
      const group = byType.get(type) ?? new Set<number>();
      group.add(index);
      byType.set(type, group);
    }
    return byType;
  });
  for (const f of module.funcs) {
    const edges = outgoing[f.index];
    if (!edges) continue;
    for (const ins of decodeBody(module, f.index)) {
      if (ins.op === 0x10 && typeof ins.imm[0] === "number") edges.add(ins.imm[0]);
      if (ins.op === 0x11 && typeof ins.imm[0] === "number" && typeof ins.imm[1] === "number") {
        const type = module.types[ins.imm[0]];
        if (type !== undefined)
          for (const index of signatures[ins.imm[1]]?.get(type) ?? []) edges.add(index);
      }
    }
    for (const index of edges) incoming[index]?.add(f.index);
  }
  const callees = outgoing.map((s) => [...s]),
    callers = incoming.map((s) => [...s]);
  return { callees: (index) => callees[index] ?? [], callers: (index) => callers[index] ?? [] };
}
