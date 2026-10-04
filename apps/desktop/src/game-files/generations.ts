import { type } from "arktype";

const token = type("string.uuid");
const diskState = type({
  active: token.or("null"),
  candidate: token.or("null"),
  previous: token.or("null"),
  "failed?": token.or("null"),
});

export type Generations = { readonly failed: string | null } & (
  | { readonly active: null; readonly candidate: string | null; readonly previous: null }
  | {
      readonly active: string;
      readonly candidate: string | null;
      readonly previous: string | null;
    }
);

export function parseGenerations(value: unknown): Generations {
  const state = diskState(value);
  if (state instanceof type.errors || (state.active === null && state.previous !== null))
    throw new Error("Invalid client generation state.");
  const failed = state.failed ?? null;
  if (failed !== null && [state.active, state.candidate, state.previous].includes(failed))
    throw new Error("Client generation slots must be distinct.");
  if (state.active === null)
    return { active: null, candidate: state.candidate, previous: null, failed };
  if (
    state.candidate === state.active ||
    (state.previous !== null &&
      (state.previous === state.active || state.previous === state.candidate))
  )
    throw new Error("Client generation slots must be distinct.");
  return { active: state.active, candidate: state.candidate, previous: state.previous, failed };
}

export function stageCandidate(
  input: Generations | { readonly active: null; readonly candidate: null; readonly previous: null },
  generationToken: string,
): Generations {
  const state = parseGenerations(input);
  if (token(generationToken) instanceof type.errors) throw new Error("Invalid generation token.");
  if (state.active === generationToken || state.previous === generationToken)
    throw new Error("Cannot stage an existing healthy generation.");
  if (state.failed === generationToken)
    throw new Error("This client generation failed. Wait for a new client update.");
  return { ...state, candidate: generationToken, failed: null };
}

export function confirmHealthy(state: Generations, generationToken: string): Generations {
  if (state.candidate === null || state.candidate !== generationToken)
    throw new Error("Stale client generation token.");
  return { active: generationToken, candidate: null, previous: state.active, failed: null };
}
