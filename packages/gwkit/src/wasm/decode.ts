import { reader, WasmError, type Reader } from "./reader";
import type { WasmModule } from "./module";

export type Instruction = {
  op: number;
  imm: (number | bigint)[];
  at: number;
  blockType?:
    | { kind: "empty" }
    | { kind: "value"; valueType: number }
    | { kind: "type"; typeIndex: number };
  memarg?: { align: number; offset: number };
};

export function instruction(r: Reader): Instruction {
  const at = r.pos;
  let op = r.u8();
  const imm: (number | bigint)[] = [];
  let blockType: Instruction["blockType"];
  let memarg: Instruction["memarg"];
  if (op >= 2 && op <= 4) {
    const bt = r.leb(33, true);
    if (bt < 0 && ![-64, -1, -2, -3, -4, -16, -17].includes(bt)) r.fail("Invalid block type");
    blockType =
      bt === -64
        ? { kind: "empty" }
        : bt < 0
          ? { kind: "value", valueType: bt + 128 }
          : { kind: "type", typeIndex: bt };
    // Single-byte value types keep the probe's byte representation; type indices are signed LEB33.
    imm.push(bt < 0 ? bt + 128 : bt);
  } else if (op === 0x0c || op === 0x0d || op === 0x10 || (op >= 0x20 && op <= 0x26) || op === 0xd2)
    imm.push(r.u32());
  else if (op === 0x0e) {
    for (let n = r.u32(); n > 0; n--) imm.push(r.u32());
    imm.push(r.u32());
  } else if (op === 0x11) imm.push(r.u32(), r.u32());
  else if (op === 0x1c) {
    for (let n = r.u32(); n > 0; n--) imm.push(valueType(r));
  } else if (op >= 0x28 && op <= 0x3e) {
    const align = r.u32(),
      offset = r.u32();
    imm.push(align, offset);
    memarg = { align, offset };
  } else if (op === 0x3f || op === 0x40) imm.push(r.u32());
  else if (op === 0x41) imm.push(r.s32());
  else if (op === 0x42) imm.push(r.s64());
  else if (op === 0x43) imm.push(r.float(4));
  else if (op === 0x44) imm.push(r.float(8));
  else if (op === 0xd0) imm.push(valueType(r));
  else if (op === 0xfc) {
    const sub = r.u32();
    op = 0xfc00 | sub;
    if (sub <= 7) {
      /* Saturating conversions have no immediates. */
    } else if (sub === 8 || sub === 10 || sub === 12 || sub === 14) imm.push(r.u32(), r.u32());
    else if (sub >= 9 && sub <= 17) imm.push(r.u32());
    else r.fail("Unsupported FC opcode");
  } else if (
    !(
      op <= 1 ||
      op === 5 ||
      op === 0x0b ||
      op === 0x0f ||
      op === 0x1a ||
      op === 0x1b ||
      (op >= 0x45 && op <= 0xc4) ||
      op === 0xd1
    )
  ) {
    throw new WasmError(`Unsupported opcode ${op}`, at);
  }
  const out: Instruction = { op, imm, at };
  if (memarg) out.memarg = memarg;
  if (blockType) out.blockType = blockType;
  return out;
}

export function valueType(r: Reader): number {
  const value = r.u8();
  if (![0x7f, 0x7e, 0x7d, 0x7c, 0x70, 0x6f].includes(value)) r.fail("Invalid value type");
  return value;
}

export function decodeBody(module: WasmModule, funcIndex: number): Instruction[] {
  const func = module.funcs[funcIndex];
  if (!func) throw new WasmError("Unknown function", 0);
  if (func.bodyStart === null || func.bodyEnd === null) return [];
  const r = reader(module.bytes, func.bodyStart, func.bodyEnd);
  for (let n = r.u32(); n > 0; n--) {
    r.u32();
    valueType(r);
  }
  const out: Instruction[] = [];
  let depth = 1;
  while (r.pos < r.end) {
    const ins = instruction(r);
    out.push(ins);
    if (ins.op >= 2 && ins.op <= 4) depth++;
    if (ins.op === 0x0b) depth--;
    if (depth === 0 && r.pos !== r.end) r.fail("Bytes after function end");
  }
  if (depth !== 0) r.fail("Missing function end");
  return out;
}
