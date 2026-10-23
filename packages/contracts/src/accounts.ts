import { type } from "arktype";

export const accountId = type("string & /^[A-Za-z0-9-]{1,64}$/");
// Runtime state comes from the game windows, never from storage.
export const account = type({
  id: accountId,
  name: "string",
  archived: "boolean",
  // Marked for "Play selected"; Main keeps the marks so they survive a restart.
  selected: "boolean",
  state: "'closed' | 'running' | 'failed'",
  "failure?": "'renderer-crash'",
});
export type Account = typeof account.infer;
export const accountSave = type({ id: accountId, name: "string" });
export type AccountSave = typeof accountSave.infer;
export const accountList = account.array();
export const accountSelection = type({ ids: accountId.array().atMostLength(64) });
