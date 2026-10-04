import { type } from "arktype";

const token = type("string.uuid");
const diskState = type({
  active: token.or("null"),
  candidate: token.or("null"),
  previous: token.or("null"),
});

export type Generations =
  | { readonly active: null; readonly candidate: string | null; readonly previous: null }
  | {
      readonly active: string;
      readonly candidate: string | null;
      readonly previous: string | null;
    };

export function parseGenerations(value: unknown): Generations {
  const state = diskState(value);
  if (state instanceof type.errors || (state.active === null && state.previous !== null))
    throw new Error("Invalid client generation state.");
  if (state.active === null) return { active: null, candidate: state.candidate, previous: null };
  if (
    state.candidate === state.active ||
    (state.previous !== null &&
      (state.previous === state.active || state.previous === state.candidate))
  )
    throw new Error("Client generation slots must be distinct.");
  return { active: state.active, candidate: state.candidate, previous: state.previous };
}

export function stageCandidate(state: Generations, generationToken: string): Generations {
  if (token(generationToken) instanceof type.errors) throw new Error("Invalid generation token.");
  if (state.active === generationToken || state.previous === generationToken)
    throw new Error("Cannot stage an existing healthy generation.");
  return { ...state, candidate: generationToken };
}

export function confirmHealthy(state: Generations, generationToken: string): Generations {
  if (state.candidate === null || state.candidate !== generationToken)
    throw new Error("Stale client generation token.");
  return { active: generationToken, candidate: null, previous: state.active };
}
