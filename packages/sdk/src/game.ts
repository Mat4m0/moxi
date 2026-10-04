import type { Profession } from "./nodes.ts";

export type Unavailable =
  | "not-in-game" // launcher context, login, character select
  | "loading" // map transition
  | "unsupported" // this ArenaNet build is not (yet) supported for this fact
  | "not-permitted" // the manifest does not declare the permission
  | "restricted-area"; // e.g. PvP: the host withholds the fact here

export type Observed<T> =
  | { readonly ok: true; readonly value: T; readonly at: number }
  | { readonly ok: false; readonly reason: Unavailable };

export type Vec2 = { readonly x: number; readonly y: number };

export type Player = {
  readonly name: string;
  readonly profession: Profession;
  readonly position: Vec2;
};

export type Target = {
  readonly id: number; // agent id; valid until the next map load
  readonly name: string;
  readonly kind: "foe" | "ally" | "npc";
  readonly position: Vec2;
} | null; // ok + null: nothing targeted

export type MapState = {
  readonly id: number;
  readonly name: string;
  readonly area: "outpost" | "explorable" | "pvp";
};

export type Refusal =
  | "needs-user-action" // not started by a fresh, explicit player action
  | "not-permitted"
  | "unsupported"
  | "restricted-area"
  | "busy" // another action of this kind is running
  | "invalid";

export type ActionResult =
  | { readonly status: "done" } // the host observed the effect in the game
  | { readonly status: "refused"; readonly reason: Refusal; readonly message: string } // nothing was sent
  | { readonly status: "failed"; readonly message: string }; // sent, effect not observed

export type Game = {
  player(): Observed<Player>;
  target(): Observed<Target>;
  map(): Observed<MapState>;
  loadBuild(build: { code: string; on?: "self" | { hero: number } }): Promise<ActionResult>;
  travel(to: { mapId: number }): Promise<ActionResult>;
};

export const SLICES = ["player", "target", "map"] as const;
export type Slice = (typeof SLICES)[number];
