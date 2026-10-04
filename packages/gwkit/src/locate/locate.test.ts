import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, test } from "vite-plus/test";
import wabtFactory from "wabt";
import { parseModule, fingerprint, loadRoleSpecs, loadLocator, locate } from "../index";
import type { RoleSpecs, WasmModule } from "../index";

const wabt = await wabtFactory();
function module(wat: string) {
  const parsed = wabt.parseWat("locate.wat", `(module ${wat})`);
  try {
    parsed.validate();
    return parseModule(parsed.toBinary({}).buffer);
  } finally {
    parsed.destroy();
  }
}
function reference(module: WasmModule, roles: Record<string, number>) {
  return {
    module,
    locator: loadLocator(
      JSON.stringify({
        client: createHash("sha256").update(module.bytes).digest("hex"),
        roles: Object.fromEntries(
          Object.entries(roles).map(([name, index]) => [
            name,
            {
              index,
              fingerprint: fingerprint(module, index),
              confidence: "proved",
            },
          ]),
        ),
        values: {},
      }),
    ),
  };
}

const leaves = `(func $a (result i32) i32.const 7) (func $b (result i32) i32.const 8)
  (func $role (result i32) call $a) (func $other (result i32) call $b)`;

test.each([
  {
    bug: "changed body does not silently keep its old index",
    before: "(func (result i32) i32.const 7)",
    after: "(func (result i32) i32.const 8)",
    roles: { role: 0 },
    specs: { role: { kind: "fact", signature: "->i32" } },
    reason: "changed",
  },
  {
    bug: "duplicate target functions cannot be chosen arbitrarily",
    before: "(func (result i32) i32.const 7)",
    after: "(func (result i32) i32.const 7) (func (result i32) i32.const 7)",
    roles: { role: 0 },
    specs: { role: { kind: "fact", signature: "->i32" } },
    reason: "ambiguous",
  },
  {
    bug: "a unique match with the wrong role signature is refused",
    before: "(func (result i32) i32.const 7)",
    after: "(func (result i32) i32.const 7)",
    roles: { role: 0 },
    specs: { role: { kind: "fact", signature: "i32->i32" } },
    reason: "signature",
  },
  {
    bug: "a stale twin is refused when a matched caller switched to the other function",
    before: `${leaves} (func (result i32) call $role i32.const 11 i32.add)`,
    after: `${leaves} (func (result i32) call $other i32.const 11 i32.add)`,
    roles: { role: 2 },
    specs: { role: { kind: "fact", signature: "->i32" } },
    reason: "caller-moved",
  },
  {
    bug: "an unmatched caller cannot hide a later matched caller that switched away from a fact",
    before: `${leaves} (func (result i32) call $role i32.const 11 i32.add)
      (func (result i32) call $role i32.const 13 i32.add)`,
    after: `${leaves} (func (result i32) call $role i32.const 12 i32.add)
      (func (result i32) call $other i32.const 13 i32.add)`,
    roles: { role: 2 },
    specs: { role: { kind: "fact", signature: "->i32" } },
    reason: "caller-moved",
  },
  {
    bug: "an unmatched reference caller cannot leave an action and its values enabled",
    before:
      "(func $role (result i32) i32.const 7) (func (result i32) call $role i32.const 11 i32.add)",
    after:
      "(func $role (result i32) i32.const 7) (func (result i32) call $role i32.const 12 i32.add)",
    roles: { role: 0 },
    specs: {
      role: {
        kind: "action",
        signature: "->i32",
        reads: { value: { instr: 0, operand: "const" } },
      },
    },
    reason: "caller-moved",
  },
  {
    bug: "a call at another ordinal does not satisfy the declared caller proof",
    before: `${leaves} (func call $role drop call $other drop)`,
    after: `${leaves} (func call $other drop call $role drop)`,
    roles: { role: 2, caller: 4 },
    specs: {
      role: { kind: "fact", signature: "->i32", calledBy: [{ role: "caller", call: 0 }] },
      caller: { kind: "fact", signature: "->" },
    },
    reason: "called-by",
  },
])("$bug", async ({ before, after, roles, specs, reason }) => {
  const result = await locate(
    loadRoleSpecs(JSON.stringify(specs)),
    reference(module(before), roles),
    module(after),
  );
  expect(result.refused.role?.reason).toBe(reason);
  expect(result.refused.role?.detail.length).toBeGreaterThan(0);
  expect(result.locator.roles.role).toBeUndefined();
  expect(result.locator.values).toEqual({});
});

test("moved roles read current constants and offsets instead of carrying reference values", async () => {
  const old = module(`(memory 1) (data (i32.const 1024) "x")
    (func $reader (result i32) i32.const 1024 i32.load offset=4)
    (func (result i32) call $reader)`);
  const next = module(`(memory 1) (data (i32.const 2048) "x") (func)
    (func $reader (result i32) i32.const 2048 i32.load offset=4)
    (func (result i32) call $reader)`);
  const specs = loadRoleSpecs(`{
    // A string containing comment markers remains intact.
    "reader//role": { "kind":"fact","signature": "->i32", "calledBy": [{ "role": "caller", "call": 0 }],
      "reads": { "base": { "instr": 0, "operand": "const" }, "field": { "instr": 1, "operand": "offset" }, }, },
    "caller": { "kind":"action","signature": "->i32" }, /* trailing comma */
  }`);
  const result = await locate(specs, reference(old, { "reader//role": 0, caller: 1 }), next);
  expect(result.refused).toEqual({});
  expect(result.locator.client).toBe(createHash("sha256").update(next.bytes).digest("hex"));
  expect(result.locator.roles["reader//role"]?.index).toBe(1);
  expect(result.locator.roles.caller?.index).toBe(2);
  expect(result.locator.roles["reader//role"]?.fingerprint).toBe(fingerprint(next, 1));
  expect(result.locator.values).toEqual({ base: 2048, field: 4 });
  expect(result.locator.roles["reader//role"]?.confidence).toBe("proved");
  expect(result.locator.roles.caller?.confidence).toBe("proved");
});

test("a fact keeps witnessed values with matched confidence when only undeclared callers are unmatched", async () => {
  const old = module(`(func $reader (result i32) i32.const 7)
    (func (result i32) call $reader)
    (func (result i32) call $reader i32.const 11 i32.add)`);
  const next = module(`(func $reader (result i32) i32.const 7)
    (func (result i32) call $reader)
    (func (result i32) call $reader i32.const 12 i32.add)`);
  const specs: RoleSpecs = {
    reader: {
      kind: "fact",
      signature: "->i32",
      calledBy: [{ role: "caller", call: 0 }],
      reads: { value: { instr: 0, operand: "const" } },
    },
    caller: { kind: "action", signature: "->i32" },
  };
  const result = await locate(specs, reference(old, { reader: 0, caller: 1 }), next);
  expect(result.refused).toEqual({});
  expect(result.locator.roles.reader?.index).toBe(0);
  expect(result.locator.roles.reader?.confidence).toBe("matched");
  expect(result.locator.roles.caller?.confidence).toBe("proved");
  expect(result.locator.values).toEqual({ value: 7 });
});

test("a refused caller removes dependent roles and their values even in reverse declaration order", async () => {
  const old = module(`(func $leaf (result i32) i32.const 7)
    (func $middle (result i32) call $leaf)
    (func (result i32) call $middle)`);
  const specs: RoleSpecs = {
    leaf: {
      kind: "fact",
      signature: "->i32",
      calledBy: [{ role: "middle", call: 0 }],
      reads: { value: { instr: 0, operand: "const" } },
    },
    middle: { kind: "fact", signature: "->i32", calledBy: [{ role: "root", call: 0 }] },
    root: { kind: "fact", signature: "i32->i32" },
  };
  const result = await locate(specs, reference(old, { leaf: 0, middle: 1, root: 2 }), old);
  expect(result.locator.roles).toEqual({});
  expect(result.locator.values).toEqual({});
  expect(
    Object.fromEntries(
      Object.entries(result.refused).map(([name, refusal]) => [name, refusal.reason]),
    ),
  ).toEqual({
    root: "signature",
    middle: "called-by",
    leaf: "called-by",
  });
});

test.each([
  ["missing instruction", 4, "const"],
  ["non-constant instruction", 1, "const"],
  ["non-memory instruction", 0, "offset"],
] as const)(
  "refuses a value with a %s witness instead of emitting fabricated data",
  async (_, instr, operand) => {
    const old = module("(func (result i32) i32.const 7)");
    const result = await locate(
      { role: { kind: "fact", signature: "->i32", reads: { value: { instr, operand } } } },
      reference(old, { role: 0 }),
      old,
    );
    expect(result.refused.role?.reason).toBe("changed");
    expect(result.locator.roles).toEqual({});
    expect(result.locator.values).toEqual({});
  },
);

test.each([
  ["missing role kind", '{"role":{"signature":"->"}}'],
  ["unknown role kind", '{"role":{"kind":"command","signature":"->"}}'],
  [
    "negative call ordinal",
    '{"role":{"kind":"fact","signature":"->","calledBy":[{"role":"role","call":-1}]}}',
  ],
  [
    "fractional instruction index",
    '{"role":{"kind":"fact","signature":"->","reads":{"value":{"instr":0.5,"operand":"const"}}}}',
  ],
  [
    "unknown operand",
    '{"role":{"kind":"fact","signature":"->","reads":{"value":{"instr":0,"operand":"index"}}}}',
  ],
  [
    "unknown caller",
    '{"role":{"kind":"fact","signature":"->","calledBy":[{"role":"absent","call":0}]}}',
  ],
  ["invalid signature", '{"role":{"kind":"fact","signature":"i33->"}}'],
  [
    "duplicate value owner",
    '{"a":{"kind":"fact","signature":"->","reads":{"v":{"instr":0,"operand":"const"}}},"b":{"kind":"fact","signature":"->","reads":{"v":{"instr":0,"operand":"const"}}}}',
  ],
])("rejects a role file with %s at load", (_, text) => {
  expect(() => loadRoleSpecs(text)).toThrow();
});

test.each([
  [
    "missing confidence",
    `{"client":"${"0".repeat(64)}","roles":{"role":{"index":0,"fingerprint":"x"}},"values":{}}`,
  ],
  [
    "unknown confidence",
    `{"client":"${"0".repeat(64)}","roles":{"role":{"index":0,"fingerprint":"x","confidence":"verified"}},"values":{}}`,
  ],
  ["invalid client hash", '{"client":"B6","roles":{},"values":{}}'],
  [
    "negative function index",
    `{"client":"${"0".repeat(64)}","roles":{"role":{"index":-1,"fingerprint":"x","confidence":"proved"}},"values":{}}`,
  ],
])("rejects a locator file with %s at load", (_, text) => {
  expect(() => loadLocator(text)).toThrow();
});

test.each(["client", "fingerprint"] as const)(
  "refuses a reference with stale %s identity before matching",
  async (field) => {
    const old = module("(func)");
    const ref = reference(old, { role: 0 });
    if (field === "client") ref.locator.client = "0".repeat(64);
    else if (ref.locator.roles.role) ref.locator.roles.role.fingerprint = "stale";
    await expect(locate({ role: { kind: "fact", signature: "->" } }, ref, old)).rejects.toThrow(
      /Reference/,
    );
  },
);

const corpus = process.env.MOXI_CORPUS;
describe.skipIf(!corpus)("official role location", () => {
  test("locates facts at either confidence and only proved actions without a wrong index", async () => {
    if (!corpus) throw new Error("MOXI_CORPUS is required");
    const build = (file: string) => parseModule(readFileSync(join(corpus, "ground-truth", file)));
    const specs = loadRoleSpecs(
      readFileSync(new URL("../../../../compat/roles/v1-october.jsonc", import.meta.url), "utf8"),
    );
    const locator = loadLocator(
      readFileSync(
        new URL("../../../../compat/reference/1eb07332632e.json", import.meta.url),
        "utf8",
      ),
    );
    const result = await locate(
      specs,
      { module: build("B6-compat-1eb07332632e.wasm"), locator },
      build("B7-compat-266b5a8aa88f.wasm"),
    );
    const expected: Record<string, number> = {
      ".hookFunction": 446,
      "playerSkillbarObservation.worldLifecycle.functionIndex": 8818,
      "playerSkillbarObservation.update.functionIndex": 8704,
      "playerSkillbarObservation.rowReader.functionIndex": 8707,
      "playerSkillbarObservation.slotReader.functionIndex": 8708,
      "cursorEvent.functionIndex": 2469,
      "cursorEvent.producerFunctions[0]": 2828,
      "cursorEvent.producerFunctions[1]": 2834,
      "uiDispatcher.functionIndex": 6842,
      "accessProof.readers.?.functionIndex[0]": 8945,
      "accessProof.readers.?.functionIndex[1]": 9203,
      "accessProof.readers.?.functionIndex[2]": 9212,
      "xunlaiAction.handler.functionIndex": 8984,
      "travelAction.guildHall.keyAccessor.functionIndex": 7964,
      "travelAction.guildHall.areaTypeAccessor.functionIndex": 9542,
      "travelAction.guildHall.producer.functionIndex": 15487,
      "travelAction.unlockProof.accessor.functionIndex": 9191,
      "travelAction.unlockProof.consumer.functionIndex": 16010,
      "travelAction.producer.functionIndex": 16231,
      "travelAction.contextResolver.functionIndex": 11661,
      "chatAliases.parser.functionIndex": 13720,
      "chatFiltering.producer.functionIndex": 7884,
      "gameThread.drain.functionIndex": 6661,
      "teamApply.professionTrace.sender.functionIndex": 5951,
      "teamApply.entries.functionIndex": 6887,
      "teamApply.label.functionIndex[0]": 6886,
      "teamApply.label.functionIndex[1]": 6878,
      "teamApply.label.functionIndex[2]": 6943,
      "teamApply.label.functionIndex[3]": 6917,
      "teamApply.label.functionIndex[4]": 6873,
      "teamApply.label.functionIndex[5]": 10661,
      "skillSlotGeometry.initializer.functionIndex": 15775,
      "skillSlotGeometry.constructor.functionIndex": 6676,
      "preGameControls.characterSwitchAction.frameChild.functionIndex": 6796,
      "preGameControls.characterSwitchAction.frameParent.functionIndex": 6797,
      "preGameControls.characterSwitchAction.frameResolver.functionIndex": 6534,
      "preGameControls.characterSwitchAction.frameDispatch.functionIndex": 6508,
      "preGameControls.characterSwitchAction.logoutProducer.functionIndex": 12445,
      "preGameControls.hashFunction.functionIndex": 365,
      "quickItemMove.inventorySlot.functionIndex": 14969,
      "quickItemMove.materialStorageSlot.functionIndex": 15007,
      "quickItemMove.numberPreference.functionIndex": 10818,
      "quickItemMove.timer.functionIndex": 249,
      "quickItemMove.moveItem.functionIndex": 13651,
      "skillCooldownObservation.reader.functionIndex": 8710,
      "skillCooldownObservation.timer.functionIndex": 249,
    };
    const wrong = Object.entries(result.locator.roles).filter(
      ([name, role]) => role.index !== expected[name],
    );
    console.table(
      Object.entries(expected).map(([role, expected]) => ({
        role,
        expected,
        kind: specs[role]?.kind,
        confidence: result.locator.roles[role]?.confidence,
        got: result.locator.roles[role]?.index ?? result.refused[role]?.reason,
      })),
    );
    console.info(
      `October roles: ${Object.keys(result.locator.roles).length} correct, ${Object.keys(result.refused).length} refused, ${wrong.length} wrong`,
    );
    const counts = {
      fact: { proved: 0, matched: 0, refused: 0 },
      action: { proved: 0, matched: 0, refused: 0 },
    };
    for (const [name, spec] of Object.entries(specs)) {
      const role = result.locator.roles[name];
      counts[spec.kind][role?.confidence ?? "refused"]++;
    }
    expect(counts).toEqual({
      fact: { proved: 4, matched: 15, refused: 2 },
      action: { proved: 12, matched: 0, refused: 13 },
    });
    expect(Object.keys(result.locator.roles)).toHaveLength(31);
    expect(Object.keys(result.refused)).toHaveLength(15);
    expect(wrong).toEqual([]);
    expect(Object.keys(specs)).toEqual(Object.keys(expected));
    expect(
      Object.fromEntries(
        Object.entries(result.refused).map(([name, refusal]) => [name, refusal.reason]),
      ),
    ).toEqual({
      "cursorEvent.functionIndex": "ambiguous",
      "uiDispatcher.functionIndex": "caller-moved",
      "travelAction.guildHall.producer.functionIndex": "changed",
      "travelAction.unlockProof.consumer.functionIndex": "changed",
      "travelAction.producer.functionIndex": "caller-moved",
      "travelAction.contextResolver.functionIndex": "changed",
      "chatAliases.parser.functionIndex": "changed",
      "chatFiltering.producer.functionIndex": "caller-moved",
      "teamApply.professionTrace.sender.functionIndex": "caller-moved",
      "teamApply.label.functionIndex[0]": "changed",
      "teamApply.label.functionIndex[1]": "changed",
      "skillSlotGeometry.initializer.functionIndex": "changed",
      "preGameControls.characterSwitchAction.logoutProducer.functionIndex": "changed",
      "quickItemMove.inventorySlot.functionIndex": "changed",
      "quickItemMove.moveItem.functionIndex": "caller-moved",
    });
    expect(Object.values(result.refused).every((refusal) => refusal.detail.length > 0)).toBe(true);
    expect(result.locator.values).toEqual({});
  }, 120000);
});

test("preserves role and value names that coincide with object prototype keys", async () => {
  const old = module("(func (result i32) i32.const 7)");
  const specs = loadRoleSpecs(
    '{"__proto__":{"kind":"fact","signature":"->i32","reads":{"__proto__":{"instr":0,"operand":"const"}}}}',
  );
  const result = await locate(specs, reference(old, JSON.parse('{"__proto__":0}')), old);
  expect(result.refused).toEqual({});
  expect(Object.keys(result.locator.roles)).toEqual(["__proto__"]);
  expect(Object.keys(result.locator.values)).toEqual(["__proto__"]);
  expect(result.locator.values["__proto__"]).toBe(7);
});
