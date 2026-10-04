import { type } from "arktype";

export const documentRef = type({
  plugin: "string > 0",
  scope: "'global'",
  account: "null",
  name: "string > 0",
}).or({ plugin: "string > 0", scope: "'account'", account: "string > 0", name: "string > 0" });
export type DocumentRef = typeof documentRef.infer;
export const jsonValue = type("object.json | string | number | boolean | null");
export type Json = typeof jsonValue.infer;
export const documentValue = type({ value: jsonValue, revision: "number.safe > 0" });
export const documentChange = type({
  ref: documentRef,
  value: jsonValue,
  revision: "number.safe > 0",
});
export type DocumentChange = typeof documentChange.infer;
export const documentWrite = type({
  ref: documentRef,
  value: jsonValue,
  expectedRevision: "number.safe >= 0",
});
export const documentWriteResult = type({ ok: "true", revision: "number.safe > 0" }).or({
  ok: "false",
  revision: "number.safe >= 0",
});
