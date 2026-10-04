import { decodeBody } from "../wasm/decode";
import type { WasmModule } from "../wasm/module";
import { fingerprints } from "../match/fingerprint";
import { matchBuilds } from "../match/match";
import type { Locator, RoleSpecs } from "./specs";

export type Refusal = {
  reason: "changed" | "ambiguous" | "signature" | "caller-moved" | "called-by";
  detail: string;
};

async function clientHash(module: WasmModule): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(module.bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function locate(
  specs: RoleSpecs,
  reference: { module: WasmModule; locator: Locator },
  target: WasmModule,
): Promise<{ locator: Locator; refused: Record<string, Refusal> }> {
  if ((await clientHash(reference.module)) !== reference.locator.client)
    throw new Error("Reference locator belongs to a different client");
  const source = fingerprints(reference.module);
  const next = fingerprints(target);
  for (const [name, role] of Object.entries(reference.locator.roles))
    if (source.values[role.index] !== role.fingerprint)
      throw new Error(`Reference fingerprint does not match ${name}`);
  const matches = matchBuilds(reference.module, target);
  const roles = new Map<string, Locator["roles"][string]>();
  const refused = new Map<string, Refusal>();
  const roleValues = new Map<string, Map<string, number>>();
  const callers = new Map<number, Set<number>>();
  source.calls.forEach((calls, index) => {
    for (const callee of calls) {
      const incoming = callers.get(callee) ?? new Set<number>();
      incoming.add(index);
      callers.set(callee, incoming);
    }
  });
  for (const [name, spec] of Object.entries(specs)) {
    const old = Object.hasOwn(reference.locator.roles, name)
      ? reference.locator.roles[name]
      : undefined;
    const match = old && matches.get(old.index);
    if (!old || !match) {
      const value = old && source.values[old.index];
      const ambiguous = value !== undefined && next.values.includes(value);
      refused.set(name, {
        reason: ambiguous ? "ambiguous" : "changed",
        detail: ambiguous ? "No unique function match" : "Reference function did not match",
      });
      continue;
    }
    const func = target.funcs[match.index];
    if (!func || target.types[func.typeIndex] !== spec.signature) {
      refused.set(name, { reason: "signature", detail: `Expected ${spec.signature}` });
      continue;
    }
    let unmatched: number | undefined;
    let moved: number | undefined;
    for (const caller of callers.get(old.index) ?? []) {
      const matchedCaller = matches.get(caller);
      if (!matchedCaller) unmatched ??= caller;
      else if (!next.calls[matchedCaller.index]?.includes(match.index)) {
        moved = caller;
        break;
      }
    }
    if (moved !== undefined || (spec.kind === "action" && unmatched !== undefined)) {
      refused.set(name, {
        reason: "caller-moved",
        detail:
          moved !== undefined
            ? `Matched caller ${moved} no longer calls the function`
            : `Reference caller ${unmatched} did not match uniquely`,
      });
      continue;
    }
    const values = new Map<string, number>();
    const instructions = spec.reads ? decodeBody(target, match.index) : [];
    let invalid: string | undefined;
    for (const [value, read] of Object.entries(spec.reads ?? {})) {
      const instruction = instructions[read.instr];
      const operand =
        read.operand === "offset"
          ? instruction?.memarg?.offset
          : instruction && instruction.op >= 0x41 && instruction.op <= 0x44
            ? instruction.imm[0]
            : undefined;
      const number = typeof operand === "bigint" ? Number(operand) : operand;
      if (
        typeof number !== "number" ||
        !Number.isFinite(number) ||
        (typeof operand === "bigint" && !Number.isSafeInteger(number))
      ) {
        invalid = value;
        break;
      }
      values.set(value, number);
    }
    if (invalid !== undefined) {
      refused.set(name, {
        reason: "changed",
        detail: `Missing numeric operand witness for ${invalid}`,
      });
      continue;
    }
    const fingerprint = next.values[match.index];
    if (fingerprint === undefined) throw new Error("Matched function has no fingerprint");
    roles.set(name, {
      index: match.index,
      fingerprint,
      confidence: unmatched === undefined ? "proved" : "matched",
    });
    roleValues.set(name, values);
  }
  // A refused caller also removes its dependents, including chains declared out of order.
  let removed: boolean;
  do {
    removed = false;
    for (const [name, spec] of Object.entries(specs)) {
      const located = roles.get(name);
      if (!located) continue;
      for (const relation of spec.calledBy ?? []) {
        const caller = roles.get(relation.role);
        if (!caller || next.calls[caller.index]?.[relation.call] !== located.index) {
          refused.set(name, {
            reason: "called-by",
            detail: `Caller ${relation.role} does not prove call ${relation.call}`,
          });
          roles.delete(name);
          removed = true;
          break;
        }
      }
    }
  } while (removed);
  const values = [...roles.keys()].flatMap((name) => [...(roleValues.get(name) ?? [])]);
  return {
    locator: {
      client: await clientHash(target),
      roles: Object.fromEntries(roles),
      values: Object.fromEntries(values),
    },
    refused: Object.fromEntries(refused),
  };
}
