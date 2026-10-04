import { type } from "arktype";

const ordinal = type("number.integer >= 0");
const role = type({
  "+": "reject",
  signature: "string",
  "calledBy?": type({ "+": "reject", role: "string", call: ordinal }).array(),
  "reads?": type({
    "[string]": { "+": "reject", instr: ordinal, operand: "'const' | 'offset'" },
  }),
});
const specsType = type({ "[string]": role });
const locatorType = type({
  "+": "reject",
  client: /^[a-f0-9]{64}$/,
  roles: { "[string]": { "+": "reject", index: ordinal, fingerprint: "string > 0" } },
  values: { "[string]": "number" },
});

export type RoleSpecs = typeof specsType.infer;
export type Locator = typeof locatorType.infer;

export function loadRoleSpecs(text: string): RoleSpecs {
  // Keep quoted strings intact while removing JSONC comments and trailing commas.
  const json = text
    .replace(/^\uFEFF/, "")
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, (token) =>
      token.startsWith('"') ? token : " ",
    )
    .replace(/"(?:\\.|[^"\\])*"|,\s*(?=[}\]])/g, (token) => (token.startsWith('"') ? token : " "));
  const specs = specsType.assert(JSON.parse(json));
  const values = new Set<string>();
  for (const [name, spec] of Object.entries(specs)) {
    if (
      !/^(?:(?:i32|i64|f32|f64|funcref|externref)(?:,(?:i32|i64|f32|f64|funcref|externref))*)?->(?:(?:i32|i64|f32|f64|funcref|externref)(?:,(?:i32|i64|f32|f64|funcref|externref))*)?$/.test(
        spec.signature,
      )
    )
      throw new Error(`Invalid signature for ${name}`);
    for (const caller of spec.calledBy ?? [])
      if (!Object.hasOwn(specs, caller.role)) throw new Error(`Unknown caller role ${caller.role}`);
    for (const value of Object.keys(spec.reads ?? {})) {
      if (values.has(value)) throw new Error(`Duplicate value witness ${value}`);
      values.add(value);
    }
  }
  return specs;
}

export function loadLocator(text: string): Locator {
  return locatorType.assert(JSON.parse(text));
}
