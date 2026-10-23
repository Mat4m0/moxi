import { type } from "arktype";

export const accountId = type("string & /^[A-Za-z0-9-]{1,64}$/");
export const accountAppearance = type({
  icon: "'swords' | 'archive' | 'map' | 'scroll' | 'shield' | 'star' | 'crown' | 'flame'",
  color: "string & /^#[0-9a-fA-F]{6}$/",
});
// Runtime state comes from the game windows, never from storage.
export const account = type({
  id: accountId,
  name: "string",
  archived: "boolean",
  appearance: accountAppearance,
  state: "'closed' | 'running' | 'failed'",
  "failure?": "'renderer-crash'",
});
export type Account = typeof account.infer;
export const accountSave = type({ id: accountId, name: "string", appearance: accountAppearance });
export type AccountSave = typeof accountSave.infer;
export const accountList = account.array();
