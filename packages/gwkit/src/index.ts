export { parseModule } from "./wasm/module";
export type {
  WasmModule,
  Func,
  Import,
  Limits,
  Table,
  Global,
  ElementSegment,
  DataSegment,
} from "./wasm/module";
export { decodeBody } from "./wasm/decode";
export type { Instruction } from "./wasm/decode";
export { callGraph } from "./wasm/graph";
export { WasmError } from "./wasm/reader";
export { fingerprint, exactBodyHash } from "./match/fingerprint";
export { matchBuilds } from "./match/match";
export { loadRoleSpecs, loadLocator } from "./locate/specs";
export type { RoleSpecs, Locator } from "./locate/specs";
export { locate } from "./locate/locate";
export type { Refusal } from "./locate/locate";
export { createRuntime } from "./runtime";
export type { Runtime } from "./runtime";
