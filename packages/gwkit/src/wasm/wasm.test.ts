import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import wabtFactory from "wabt";
import { parseModule, decodeBody, callGraph, WasmError } from "../index";

const wabt = await wabtFactory();
function module(wat: string) {
  const parsed = wabt.parseWat("fixture.wat", wat, {
    bulk_memory: true,
    reference_types: true,
    multi_value: true,
    sat_float_to_int: true,
  });
  try {
    return parseModule(parsed.toBinary({}).buffer);
  } finally {
    parsed.destroy();
  }
}
function code(wat: string) {
  const m = module(`(module (memory 1) (func ${wat}))`);
  return decodeBody(m, 0).map(({ op, imm, memarg }) => ({
    op,
    imm,
    ...(memarg ? { memarg } : {}),
  }));
}

test("keeps imported functions in the index space so calls do not target the next definition", () => {
  const m = module('(module (import "env" "f" (func)) (func (call 0)) (export "run" (func 1)))');
  expect(m.importedFuncs).toBe(1);
  expect(
    m.funcs.map((f) => [f.index, f.typeIndex, m.types[f.typeIndex], f.bodyStart === null]),
  ).toEqual([
    [0, 0, "->", true],
    [1, 0, "->", false],
  ]);
  expect(m.imports).toEqual([{ module: "env", name: "f", kind: "function", typeIndex: 0 }]);
  expect(m.exports.get("run")).toEqual({ kind: "function", index: 1 });
  expect(decodeBody(m, 0)).toEqual([]);
  expect(decodeBody(m, 1).map((i) => [i.op, i.imm])).toEqual([
    [16, [0]],
    [11, []],
  ]);
  const graph = callGraph(m);
  expect(graph.callees(1)).toEqual([0]);
  expect(graph.callers(0)).toEqual([1]);
});

test.each([
  ["i32.const -2147483648", 65, -2147483648],
  ["i32.const 2147483647", 65, 2147483647],
  ["i64.const -9223372036854775808", 66, -9223372036854775808n],
  ["i64.const 9223372036854775807", 66, 9223372036854775807n],
  ["f32.const -1.5", 67, -1.5],
  ["f64.const 1.25", 68, 1.25],
])("decodes %s without sign loss or constant hashing", (wat, op, value) => {
  expect(code(`${wat} drop`)).toEqual([
    { op, imm: [value] },
    { op: 26, imm: [] },
    { op: 11, imm: [] },
  ]);
});

test("retains memarg alignment and large offsets instead of swapping or truncating them", () => {
  expect(code("i32.const 0 i32.load offset=4294967295 align=2 drop")).toEqual([
    { op: 65, imm: [0] },
    { op: 40, imm: [1, 4294967295], memarg: { align: 1, offset: 4294967295 } },
    { op: 26, imm: [] },
    { op: 11, imm: [] },
  ]);
});

test("decodes a multivalue block type index rather than treating it as a value type", () => {
  const m = module(
    "(module (type (func (result i32 i64))) (func (block (type 0) i32.const 3 i64.const 4) drop drop))",
  );
  expect(decodeBody(m, 0).map((i) => [i.op, i.imm])).toEqual([
    [2, [0]],
    [65, [3]],
    [66, [4n]],
    [11, []],
    [26, []],
    [26, []],
    [11, []],
  ]);
});

test("consumes FC immediates so the next opcode is not read as a memory index", () => {
  expect(
    code(
      "i32.const 0 i32.const 0 i32.const 1 memory.copy i32.const 0 i32.const 0 i32.const 1 memory.fill f32.const 0 i32.trunc_sat_f32_s drop",
    ),
  ).toEqual([
    { op: 65, imm: [0] },
    { op: 65, imm: [0] },
    { op: 65, imm: [1] },
    { op: 64522, imm: [0, 0] },
    { op: 65, imm: [0] },
    { op: 65, imm: [0] },
    { op: 65, imm: [1] },
    { op: 64523, imm: [0] },
    { op: 67, imm: [0] },
    { op: 64512, imm: [] },
    { op: 26, imm: [] },
    { op: 11, imm: [] },
  ]);
});

test("keeps the br_table default target after all explicit targets", () => {
  expect(code("block block i32.const 0 br_table 0 1 1 end end").filter((i) => i.op === 14)).toEqual(
    [{ op: 14, imm: [0, 1, 1] }],
  );
});

test("resolves indirect calls only through the selected table and matching signature", () => {
  const m = module(`(module
    (type (func)) (type (func (param i32))) (type (func))
    (import "env" "f" (func (type 0)))
    (table 4 funcref) (table 3 funcref)
    (func (type 0)) (func (type 1))
    (func (type 0) i32.const 0 call_indirect 1 (type 2))
    (elem (i32.const 0) func 0 1 2)
    (elem (table 1) (i32.const 1) funcref (ref.func 1) (ref.null func))
    (elem func 0) (elem declare func 2))`);
  expect(m.tables.map((t) => t.elems)).toEqual([
    [0, 1, 2],
    [undefined, 1, null],
  ]);
  expect(m.elements.map((s) => [s.mode, s.tableIndex, s.offset, s.elements])).toEqual([
    ["active", 0, 0, [0, 1, 2]],
    ["active", 1, 1, [1, null]],
    ["passive", null, null, [0]],
    ["declarative", null, null, [2]],
  ]);
  expect(decodeBody(m, 3).map((i) => [i.op, i.imm])).toEqual([
    [65, [0]],
    [17, [2, 1]],
    [11, []],
  ]);
  expect(callGraph(m).callees(3)).toEqual([1]);
  expect(callGraph(m).callers(1)).toEqual([3]);
});

test("retains memory, global and data metadata needed to find static addresses", () => {
  const m = module(`(module
    (import "env" "g" (global i32)) (import "env" "t" (table 1 3 funcref)) (import "env" "mem" (memory 1 2))
    (global (mut i32) (i32.const 1024)) (global i64 (i64.const -1))
    (data (i32.const 32) "abc") (data "xyz") (data (memory 0) (i32.const 16) "q")
    (export "g" (global 1)) (export "t" (table 0)) (export "mem" (memory 0)))`);
  expect(m.imports.map((i) => i.kind)).toEqual(["global", "table", "memory"]);
  expect(m.memories).toEqual([{ min: 1, max: 2 }]);
  expect(m.globals.map((g) => [g.valueType, g.mutable, g.init?.imm ?? null])).toEqual([
    [127, false, null],
    [127, true, [1024]],
    [126, false, [-1n]],
  ]);
  expect(m.stackPointerInit).toBeNull();
  expect(m.dataStart).toBe(16);
  expect(m.data.map((s) => [s.memoryIndex, s.offset, [...s.bytes]])).toEqual([
    [0, 32, [97, 98, 99]],
    [null, null, [120, 121, 122]],
    [0, 16, [113]],
  ]);
  expect(module("(module (global (mut i32) (i32.const 4096)))").stackPointerInit).toBe(4096);
});

test.each([
  [[0, 97, 115, 109, 1, 0, 0], 7],
  [[0, 97, 115, 109, 1, 0, 0, 0, 1, 5], 10],
  [[0, 97, 115, 109, 1, 0, 0, 0, 1, 1, 128], 11],
  [[0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 128, 128, 128, 128, 16, 0], 15],
])(
  "reports malformed bytes %j at the failing byte rather than reading past the buffer",
  (bytes, offset) => {
    try {
      parseModule(new Uint8Array(bytes));
      expect.unreachable("Accepted malformed module");
    } catch (error) {
      expect(error).toBeInstanceOf(WasmError);
      expect(error).toHaveProperty("offset", offset);
    }
  },
);

test("rejects an incomplete function body instead of silently returning partial instructions", () => {
  const m = module("(module (func i32.const 1 drop))");
  const f = m.funcs[0];
  if (!f || f.bodyEnd === null) throw new Error("Missing fixture function");
  m.bytes[f.bodyEnd - 1] = 0x41;
  expect(() => decodeBody(m, 0)).toThrow(WasmError);
});

test("distinguishes a large multivalue type index from a one-byte value type", () => {
  const m = module(`(module ${"(type (func))".repeat(64)} (type (func (result i32 i64)))
    (func block (type 64) i32.const 1 i64.const 2 end drop drop))`);
  expect(decodeBody(m, 0)[0]).toMatchObject({
    op: 2,
    imm: [64],
    blockType: { kind: "type", typeIndex: 64 },
  });
  expect(decodeBody(module("(module (func block end))"), 0)[0]).toMatchObject({
    op: 2,
    imm: [64],
    blockType: { kind: "empty" },
  });
});

test("consumes segment and table operands of bulk operations without desynchronizing the body", () => {
  const m = module(`(module (memory 1) (table 4 funcref) (func $f)
    (elem $e func $f) (data $d "x")
    (func
      i32.const 0 i32.const 0 i32.const 1 memory.init $d data.drop $d
      i32.const 0 i32.const 0 i32.const 1 table.init $e elem.drop $e
      i32.const 0 i32.const 0 i32.const 1 table.copy
      ref.null func i32.const 1 table.grow drop table.size drop
      i32.const 0 ref.null func i32.const 1 table.fill))`);
  expect(
    decodeBody(m, 1)
      .filter((i) => i.op >= 0xfc00)
      .map((i) => [i.op, i.imm]),
  ).toEqual([
    [64520, [0, 0]],
    [64521, [0]],
    [64524, [0, 0]],
    [64525, [0]],
    [64526, [0, 0]],
    [64527, [0]],
    [64528, [0]],
    [64529, [0]],
  ]);
});

test("resolves expression elements and retains passive segments instead of treating them as table zero", () => {
  const m = module(`(module (table 3 funcref) (func $f)
    (elem (i32.const 0) funcref (ref.func $f) (ref.null func))
    (elem (table 0) (i32.const 2) func $f)
    (elem funcref (ref.func $f)) (elem declare funcref (ref.func $f)))`);
  expect(m.tables[0]?.elems).toEqual([0, null, 0]);
  expect(m.elements.map((e) => [e.mode, e.tableIndex, e.offset, e.elements])).toEqual([
    ["active", 0, 0, [0, null]],
    ["active", 0, 2, [0]],
    ["passive", null, null, [0]],
    ["declarative", null, null, [0]],
  ]);
});

test("reads custom section names without interpreting their opaque payload as module sections", () => {
  const parsed = wabt.parseWat("named.wat", "(module (func $f))");
  try {
    const m = parseModule(parsed.toBinary({ write_debug_names: true }).buffer);
    expect(m.customSections).toEqual(["name"]);
    expect(decodeBody(m, 0).map((i) => [i.op, i.imm])).toEqual([[11, []]]);
  } finally {
    parsed.destroy();
  }
});

const corpus = process.env.MOXI_CORPUS;
if (!corpus) console.info("Corpus lane skipped: MOXI_CORPUS is unset.");
describe.skipIf(!corpus)("official corpus (skipped when MOXI_CORPUS is unset)", () => {
  test("parses and decodes every defined body without losing functions after an ArenaNet rebuild", () => {
    if (!corpus) throw new Error("MOXI_CORPUS is required");
    const files = readdirSync(corpus)
      .filter((f) => /^B[1-7]-.*\.wasm$/.test(f))
      .sort();
    expect(files).toHaveLength(7);
    const counts: number[] = [];
    for (const file of files) {
      const m = parseModule(readFileSync(join(corpus, file)));
      counts.push(m.funcs.length - m.importedFuncs);
      for (const f of m.funcs.slice(m.importedFuncs)) decodeBody(m, f.index);
    }
    expect(counts).toEqual([17603, 17604, 17610, 17610, 17610, 17610, 17637]);
  }, 30000);
});
