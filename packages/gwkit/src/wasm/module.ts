import { reader, WasmError, type Reader } from "./reader";
import { instruction, valueType, type Instruction } from "./decode";

export type Limits = { min: number; max: number | null };
export type Func = {
  index: number;
  typeIndex: number;
  bodyStart: number | null;
  bodyEnd: number | null;
};
export type Import = { module: string; name: string } & (
  | { kind: "function"; typeIndex: number }
  | { kind: "table"; elementType: number; limits: Limits }
  | { kind: "memory"; limits: Limits }
  | { kind: "global"; valueType: number; mutable: boolean }
);
export type Table = { elementType: number; limits: Limits; elems: (number | null)[] };
export type Global = { valueType: number; mutable: boolean; init: Instruction | null };
export type ElementSegment = {
  mode: "active" | "passive" | "declarative";
  tableIndex: number | null;
  offset: number | null;
  elements: (number | null)[];
};
export type DataSegment = { memoryIndex: number | null; offset: number | null; bytes: Uint8Array };
export type WasmModule = {
  bytes: Uint8Array;
  types: string[];
  imports: Import[];
  importedFuncs: number;
  funcs: Func[];
  tables: Table[];
  globals: Global[];
  exports: Map<string, { kind: "function" | "table" | "memory" | "global"; index: number }>;
  memories: Limits[];
  elements: ElementSegment[];
  data: DataSegment[];
  dataStart: number;
  stackPointerInit: number | null;
  customSections: string[];
};
const typeNames = new Map([
  [127, "i32"],
  [126, "i64"],
  [125, "f32"],
  [124, "f64"],
  [112, "funcref"],
  [111, "externref"],
]);
function limits(r: Reader): Limits {
  const flags = r.u8();
  if (flags > 1) r.fail("Unsupported limits");
  const min = r.u32(),
    max = flags ? r.u32() : null;
  if (max !== null && max < min) r.fail("Invalid limits");
  return { min, max };
}
function mutable(r: Reader): boolean {
  const value = r.u8();
  if (value > 1) r.fail("Invalid mutability");
  return value === 1;
}
function table(r: Reader): Table {
  const elementType = valueType(r);
  if (elementType !== 0x70 && elementType !== 0x6f) r.fail("Invalid table type");
  return { elementType, limits: limits(r), elems: [] };
}
function init(r: Reader): Instruction {
  const ins = instruction(r);
  if (![0x41, 0x42, 0x43, 0x44, 0x23, 0xd0, 0xd2].includes(ins.op)) r.fail("Invalid initializer");
  if (r.u8() !== 0x0b) r.fail("Missing initializer end");
  return ins;
}
function offset(r: Reader, globals: Global[]): number | null {
  const ins = init(r);
  const value =
    ins.op === 0x41
      ? ins.imm[0]
      : ins.op === 0x23 && typeof ins.imm[0] === "number"
        ? globals[ins.imm[0]]?.init?.imm[0]
        : undefined;
  if (ins.op !== 0x41 && ins.op !== 0x23) r.fail("Invalid offset expression");
  return typeof value === "number" ? value >>> 0 : null;
}
function vector<T>(r: Reader, read: () => T): T[] {
  const out: T[] = [];
  for (let n = r.u32(); n > 0; n--) out.push(read());
  return out;
}

export function parseModule(bytes: Uint8Array): WasmModule {
  const r = reader(bytes);
  for (const byte of [0, 97, 115, 109, 1, 0, 0, 0])
    if (r.u8() !== byte) throw new WasmError("Invalid module header", r.pos - 1);
  const m: WasmModule = {
    bytes,
    types: [],
    imports: [],
    importedFuncs: 0,
    funcs: [],
    tables: [],
    globals: [],
    exports: new Map(),
    memories: [],
    elements: [],
    data: [],
    dataStart: Infinity,
    stackPointerInit: null,
    customSections: [],
  };
  let lastSection = 0,
    codeCount = 0;
  let dataCount: number | null = null;
  const addFunc = (s: Reader, typeIndex: number) => {
    const type = m.types[typeIndex];
    if (type === undefined) return s.fail("Invalid function type index");
    m.funcs.push({ index: m.funcs.length, typeIndex, bodyStart: null, bodyEnd: null });
  };
  while (r.pos < r.end) {
    const id = r.u8(),
      size = r.u32(),
      end = r.pos + size;
    if (end > r.end) r.fail("Truncated section");
    const s = reader(bytes, r.pos, end);
    const order = id === 12 ? 9.5 : id;
    if (id > 12 || (id !== 0 && order <= lastSection)) s.fail("Invalid section order");
    if (id !== 0) lastSection = order;
    if (id === 0) {
      m.customSections.push(s.name());
      s.pos = end;
    } else if (id === 1) {
      vector(s, () => {
        if (s.u8() !== 0x60) s.fail("Invalid function type");
        const params = vector(s, () => valueType(s)),
          results = vector(s, () => valueType(s));
        m.types.push(
          `${params.map((v) => typeNames.get(v)).join(",")}->${results.map((v) => typeNames.get(v)).join(",")}`,
        );
      });
    } else if (id === 2) {
      m.imports = vector(s, () => {
        const base = { module: s.name(), name: s.name() },
          kind = s.u8();
        if (kind === 0) {
          const typeIndex = s.u32();
          addFunc(s, typeIndex);
          m.importedFuncs++;
          return { ...base, kind: "function", typeIndex };
        }
        if (kind === 1) {
          const t = table(s);
          m.tables.push(t);
          return { ...base, kind: "table", elementType: t.elementType, limits: t.limits };
        }
        if (kind === 2) {
          const l = limits(s);
          m.memories.push(l);
          return { ...base, kind: "memory", limits: l };
        }
        if (kind === 3) {
          const g = { valueType: valueType(s), mutable: mutable(s), init: null };
          m.globals.push(g);
          return { ...base, kind: "global", valueType: g.valueType, mutable: g.mutable };
        }
        return s.fail("Invalid import kind");
      });
    } else if (id === 3) vector(s, () => addFunc(s, s.u32()));
    else if (id === 4) m.tables.push(...vector(s, () => table(s)));
    else if (id === 5) m.memories.push(...vector(s, () => limits(s)));
    else if (id === 6)
      m.globals.push(
        ...vector(s, () => ({ valueType: valueType(s), mutable: mutable(s), init: init(s) })),
      );
    else if (id === 7)
      vector(s, () => {
        const name = s.name(),
          kind = ["function", "table", "memory", "global"] as const;
        const k = kind[s.u8()];
        if (!k || m.exports.has(name)) return s.fail("Invalid export");
        m.exports.set(name, { kind: k, index: s.u32() });
      });
    else if (id === 8) {
      if (!m.funcs[s.u32()]) s.fail("Invalid start function");
    } else if (id === 9)
      m.elements = vector(s, () => {
        const flags = s.u32();
        if (flags > 7) s.fail("Invalid element flags");
        const active = !(flags & 1),
          tableIndex = active ? (flags & 2 ? s.u32() : 0) : null;
        const start = active ? offset(s, m.globals) : null;
        if (flags & 4) {
          if (flags !== 4) {
            const t = valueType(s);
            if (t !== 0x70 && t !== 0x6f) s.fail("Invalid element type");
          }
        } else if (flags !== 0 && s.u8() !== 0) s.fail("Invalid element kind");
        const elements = vector(s, () => {
          if (!(flags & 4)) return s.u32();
          const ins = init(s);
          if (ins.op === 0xd0) return null;
          if (ins.op !== 0xd2 || typeof ins.imm[0] !== "number")
            return s.fail("Invalid element expression");
          return ins.imm[0];
        });
        if (tableIndex !== null) {
          const t = m.tables[tableIndex];
          if (!t) return s.fail("Invalid element table");
          if (start !== null) {
            if (start + elements.length > t.limits.min) s.fail("Element exceeds table");
            elements.forEach((f, i) => {
              t.elems[start + i] = f;
            });
          }
        }
        return {
          mode: active ? "active" : flags & 2 ? "declarative" : "passive",
          tableIndex,
          offset: start,
          elements,
        };
      });
    else if (id === 10) {
      codeCount = s.u32();
      if (codeCount !== m.funcs.length - m.importedFuncs) s.fail("Function/code count mismatch");
      for (let i = 0; i < codeCount; i++) {
        const size = s.u32(),
          f = m.funcs[m.importedFuncs + i];
        if (!f) return s.fail("Missing function");
        f.bodyStart = s.pos;
        s.take(size);
        f.bodyEnd = s.pos;
      }
    } else if (id === 11)
      m.data = vector(s, () => {
        const flags = s.u32();
        if (flags > 2) s.fail("Invalid data flags");
        const memoryIndex = flags === 1 ? null : flags === 2 ? s.u32() : 0;
        const start = memoryIndex === null ? null : offset(s, m.globals);
        if (memoryIndex !== null && !m.memories[memoryIndex]) s.fail("Invalid data memory");
        if (start !== null) m.dataStart = Math.min(m.dataStart, start);
        return { memoryIndex, offset: start, bytes: s.take(s.u32()) };
      });
    else if (id === 12) dataCount = s.u32();
    if (s.pos !== end) s.fail("Section size mismatch");
    r.pos = end;
  }
  if (codeCount !== m.funcs.length - m.importedFuncs) r.fail("Missing code section");
  for (const segment of m.elements)
    for (const index of segment.elements)
      if (index !== null && !m.funcs[index]) r.fail("Invalid element function");
  for (const exp of m.exports.values()) {
    const space =
      exp.kind === "function"
        ? m.funcs
        : exp.kind === "table"
          ? m.tables
          : exp.kind === "memory"
            ? m.memories
            : m.globals;
    if (!space[exp.index]) r.fail("Invalid export index");
  }
  if (dataCount !== null && dataCount !== m.data.length) r.fail("Data count mismatch");
  const stack = m.globals[0]?.init;
  if (stack?.op === 0x41 && typeof stack.imm[0] === "number") m.stackPointerInit = stack.imm[0];
  return m;
}
