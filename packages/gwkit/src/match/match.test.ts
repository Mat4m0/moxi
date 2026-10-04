import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import wabtFactory from "wabt";
import { parseModule, fingerprint, exactBodyHash, matchBuilds } from "../index";

const wabt = await wabtFactory();
function module(wat: string) {
  const parsed = wabt.parseWat("match.wat", `(module ${wat})`);
  try {
    parsed.validate();
    return parseModule(parsed.toBinary({}).buffer);
  } finally {
    parsed.destroy();
  }
}

test("finds a moved function instead of trusting its previous index", () => {
  const old = module("(func (result i32) i32.const 7)");
  const next = module("(func) (func (result i32) i32.const 7)");
  expect([...matchBuilds(old, next)]).toEqual([[0, { index: 1, via: "fingerprint" }]]);
  expect(fingerprint(old, 0)).toBe("eKlAzO9sYLLrYBP5");
  expect(exactBodyHash(old, 0)).toBe("VhQ9XfYT7mAVGl4B");
});

test.each([
  ["a multi-block body", "nop ".repeat(80), "E92AM5sUeMY5ZrPe"],
  ["a non-ASCII operand byte", "i32.const 128", "1AsgVqhVZaOvwIfJ"],
])("keeps the probe's exact hash for %s", (_, body, expected) => {
  const suffix = body.startsWith("i32") ? "(result i32) " : "";
  expect(exactBodyHash(module(`(func ${suffix}${body})`), 0)).toBe(expected);
});

test.each([
  ["constant", "i32.const 1024", "i32.const 2048"],
  ["memarg", "i32.const 0 i32.load offset=1024", "i32.const 0 i32.load offset=2048"],
])(
  "matches shifted static data in a %s without requiring identical body bytes",
  (_, before, after) => {
    const old = module(`(memory 1) (data (i32.const 1024) "a") (func (result i32) ${before})`);
    const next = module(`(memory 1) (data (i32.const 2048) "a") (func (result i32) ${after})`);
    expect(fingerprint(old, 0)).toBe(fingerprint(next, 0));
    expect(exactBodyHash(old, 0)).not.toBe(exactBodyHash(next, 0));
    expect([...matchBuilds(old, next)]).toEqual([[0, { index: 0, via: "fingerprint" }]]);
  },
);

test("matches a caller after its callee is renumbered", () => {
  const old = module("(func $leaf (result i32) i32.const 7) (func (result i32) call $leaf)");
  const next = module(
    "(func) (func $leaf (result i32) i32.const 7) (func (result i32) call $leaf)",
  );
  expect([...matchBuilds(old, next)]).toEqual([
    [0, { index: 1, via: "fingerprint" }],
    [1, { index: 2, via: "fingerprint" }],
  ]);
});

test.each([
  ["old", "(func) (func)", "(func)"],
  ["next", "(func)", "(func) (func)"],
  ["both", "(func) (func)", "(func) (func)"],
])("refuses an unanchored duplicate fingerprint on %s builds", (_, before, after) => {
  expect([...matchBuilds(module(before), module(after))]).toEqual([]);
});

test.each([
  ["body", "(func (result i32) i32.const 7)", "(func (result i32) i32.const 8)"],
  [
    "field offset",
    '(memory 1) (data (i32.const 1024) "a") (func (result i32) i32.const 0 i32.load offset=4)',
    '(memory 1) (data (i32.const 2048) "a") (func (result i32) i32.const 0 i32.load offset=8)',
  ],
  [
    "address upper bound",
    '(memory 1) (data (i32.const 1024) "a") (func (result i32) i32.const 268435456)',
    '(memory 1) (data (i32.const 2048) "a") (func (result i32) i32.const 268435457)',
  ],
])("refuses a changed %s instead of treating every operand as relocatable", (_, before, after) => {
  expect([...matchBuilds(module(before), module(after))]).toEqual([]);
});

test("recovers look-alike callees only through unique matched caller positions", () => {
  const old = module(`(func $a) (func $b)
    (func call $a i32.const 1 drop) (func call $b i32.const 2 drop)`);
  const next = module(`(func $b) (func $a)
    (func call $b i32.const 2 drop) (func call $a i32.const 1 drop)`);
  expect([...matchBuilds(old, next)]).toEqual([
    [2, { index: 3, via: "fingerprint" }],
    [3, { index: 2, via: "fingerprint" }],
    [0, { index: 1, via: "call-graph" }],
    [1, { index: 0, via: "call-graph" }],
  ]);
});

test.each([
  ["one source claims two targets", "$a", "$a", "$a", "$b"],
  ["two sources claim one target", "$a", "$b", "$a", "$a"],
])("refuses call-graph proposals when %s", (_, oldFirst, oldSecond, nextFirst, nextSecond) => {
  const old = module(`(func $a) (func $b)
    (func call ${oldFirst} i32.const 1 drop) (func call ${oldSecond} i32.const 2 drop)`);
  const next = module(`(func $a) (func $b)
    (func call ${nextFirst} i32.const 1 drop) (func call ${nextSecond} i32.const 2 drop)`);
  expect([...matchBuilds(old, next)]).toEqual([
    [2, { index: 2, via: "fingerprint" }],
    [3, { index: 3, via: "fingerprint" }],
  ]);
});

test("matches imports by qualified name when import order changes", () => {
  const old = module('(import "env" "a" (func)) (import "other" "a" (func))');
  const next = module('(import "other" "a" (func)) (import "env" "a" (func))');
  expect([...matchBuilds(old, next)]).toEqual([
    [0, { index: 1, via: "fingerprint" }],
    [1, { index: 0, via: "fingerprint" }],
  ]);
});

const corpus = process.env.MOXI_CORPUS;
describe.skipIf(!corpus)("official build matching", () => {
  test("relocates official builds without assigning exports to the wrong function", () => {
    if (!corpus) throw new Error("MOXI_CORPUS is required");
    const started = performance.now();
    const files = readdirSync(corpus)
      .filter((file) => /^B[1-7]-.*\.wasm$/.test(file))
      .sort();
    expect(files).toHaveLength(7);
    const expected = [91.6, 86.3, 92.2, 92.2, 91.9, 77.4];
    const rows = [];
    let old = parseModule(readFileSync(join(corpus, files[0] ?? "")));
    for (let i = 1; i < files.length; i++) {
      const next = parseModule(readFileSync(join(corpus, files[i] ?? "")));
      const matches = matchBuilds(old, next);
      let right = 0,
        wrong = 0,
        missing = 0;
      for (const [name, source] of old.exports) {
        const target = next.exports.get(name);
        if (source.kind !== "function" || target?.kind !== "function") continue;
        const match = matches.get(source.index);
        if (!match) missing++;
        else if (match.index === target.index) right++;
        else wrong++;
      }
      const defined = [...matches.keys()].filter((index) => index >= old.importedFuncs).length;
      rows.push({
        update: `B${i}→B${i + 1}`,
        matched: defined,
        functions: old.funcs.length - old.importedFuncs,
        percent: (100 * defined) / (old.funcs.length - old.importedFuncs),
        right,
        wrong,
        missing,
      });
      old = next;
    }
    console.table(rows);
    console.info(`Corpus matching runtime: ${(performance.now() - started).toFixed(0)} ms`);
    for (const [i, row] of rows.entries()) {
      expect(row.wrong, row.update).toBe(0);
      expect(Math.abs(row.percent - (expected[i] ?? 0)), row.update).toBeLessThanOrEqual(0.1);
    }
  }, 120000);
});
