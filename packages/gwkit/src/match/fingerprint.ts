import { decodeBody } from "../wasm/decode";
import type { WasmModule } from "../wasm/module";
import { hash } from "./hash";

export function exactBodyHash(module: WasmModule, index: number): string {
  const f = module.funcs[index];
  if (!f || f.bodyStart === null || f.bodyEnd === null) throw new Error("Function has no body");
  let body = "";
  for (const byte of module.bytes.subarray(f.bodyStart, f.bodyEnd))
    body += String.fromCharCode(byte);
  return hash(body);
}

export function fingerprints(module: WasmModule) {
  const imports = module.imports.filter((entry) => entry.kind === "function");
  const calls: number[][] = module.funcs.map(() => []);
  const base: string[] = [];
  const isAddress = (value: number | bigint | undefined) =>
    typeof value === "number" && value >= module.dataStart && value < 256 * 1024 * 1024;
  for (const f of module.funcs) {
    if (f.index < module.importedFuncs) {
      const entry = imports[f.index];
      if (!entry) throw new Error("Missing function import");
      base.push(hash(JSON.stringify([entry.module, entry.name])));
      continue;
    }
    const tokens = [module.types[f.typeIndex]];
    const direct: number[] = [];
    for (const ins of decodeBody(module, f.index)) {
      const value = ins.imm[0];
      if (ins.op === 0x10) {
        if (typeof value !== "number" || !module.funcs[value])
          throw new Error("Invalid direct call");
        const callee = module.funcs[value];
        tokens.push(
          `call(${value < module.importedFuncs ? `imp:${value}` : module.types[callee.typeIndex]})`,
        );
        direct.push(value);
      } else if (ins.op === 0x11) {
        if (typeof value !== "number") throw new Error("Invalid indirect call");
        tokens.push(`ci(${module.types[value]})`);
      } else if (ins.op === 0x41) tokens.push(isAddress(value) ? "kADDR" : `k${value}`);
      else if (ins.memarg)
        tokens.push(
          `${ins.op}:${ins.memarg.align}.${isAddress(ins.memarg.offset) ? "ADDR" : ins.memarg.offset}`,
        );
      else if (ins.op === 0xd2) tokens.push("ref.func");
      else {
        let operands = ins.imm.join(".");
        // Preserve the probe's raw constant representation, including NaN payloads.
        if (ins.op === 0x43 || ins.op === 0x44) {
          const view = new DataView(module.bytes.buffer, module.bytes.byteOffset + ins.at + 1);
          operands = String(
            view.getInt32(0, true) ^ (ins.op === 0x44 ? view.getInt32(4, true) : 0),
          );
        } else if (ins.op === 0x42 || ins.blockType?.kind === "type") {
          let raw = 0;
          for (let at = ins.at + 1; ; at++) {
            const byte = module.bytes[at];
            if (byte === undefined) throw new Error("Truncated constant");
            raw = (raw * 31 + byte) | 0;
            if (!(byte & 0x80)) break;
          }
          operands = String(raw);
        }
        tokens.push(`${ins.op}:${operands}`);
      }
    }
    base.push(hash(tokens.join(" ")));
    calls[f.index] = direct;
  }
  const values = base.map((value, index) =>
    index < module.importedFuncs
      ? value
      : hash(
          value +
            "|" +
            (calls[index] ?? [])
              .map((callee) => (callee < module.importedFuncs ? `imp${callee}` : base[callee]))
              .join(","),
        ),
  );
  return { values, calls };
}

export function fingerprint(module: WasmModule, index: number): string {
  if (!module.funcs[index]) throw new Error("Unknown function");
  const value = fingerprints(module).values[index];
  if (value === undefined) throw new Error("Missing fingerprint");
  return value;
}
