# 04 Catalog and manifest

## Purpose

One capability catalog and one manifest schema; page text, grants, enforcement, generated types and the
test kit derive from them. This file owns the catalog types, every fact and action entry, the result
unions, the read-or-internet rule, the manifest schema api 1 and the generated `Register`. Exports and
import rules: spec 02.

## 1. Rules in force

1. `packages/sdk/src/host/catalog.ts` is the only place a capability exists; parsing, generated types, page
   wording (spec 12), enforcement tables, kit fakes, P36 and the SDK docs table read it.
2. A new fact touches the catalog, its gwkit reader and its simulator fake; a new action, the catalog, its
   executor and its simulator fake (P78; counting: spec 01 §4).
3. OD1: no combat or economy automation; the catalog holds no such action (§6.4). No action starts from
   code: one trusted press (spec 01 §2) starts at most one action or one chain (§8.4), except an
   `origin: "agent"` request in a Dev QA run that passes Main's QA allowlist (spec 01 I2, 13).
4. Facts are display data: no code path leads from a fact to an action, `game.vitals` included (OD3; import
   rule: spec 02; the executor is reachable only from a press: spec 13).
5. Requested is not granted; Main's grant store decides (spec 12).
6. Read or internet, never both (§7).
7. Every capability fails closed on its own: no reader for this game build, or a kill switch, makes that fact
   `unsupported` and that action `refused unsupported`; nothing else changes. The compat feed can turn a
   fact or action off, never add one (P80, spec 15).
8. api 1 is additive from 1.0.0; every catalog id, anchor, setting type and SDK export has a `since` (§10.3).
9. Every number lives in spec 05: runtime limits, `budgets.manifest.*` bounds and the per-entry `rateHz`,
   `minIntervalMs`, `effectTimeoutMs`. This file holds fields, key names, patterns and the value schemas
   (§5.2, §6.2).
10. ArkType runs only at edges: the manifest parser, Main's action authority, the decoder and the P52
    checks. The worker runtime uses `import type` only.

## 2. Files

| File | Holds | Slice |
| --- | --- | --- |
| `packages/sdk/src/host/catalog.ts` | §3 shared types, §4 entry types, §5 facts, §6 actions, §7 other entries and the personal/outbound helpers, `HOST_API`, `RUNTIME_VUE`, `SDK_SINCE`, `REFUSAL_TEXT`, `regionText` | M1-01 |
| `packages/sdk/src/register.ts` | `Register` and the helper types of §10.1, exported by `@moxi/sdk` | M1-01 |
| `packages/sdk/src/host/icons.ts` | `GLYPHS`, `Glyph`, `GameArtRef`, `IconRef` (§9) | M1-03 |
| `packages/sdk/src/host/manifest.ts` | §8 types, `parseManifest`, `ManifestError`, `classOf`, `checkHost` | M1-03 |
| `packages/sdk/src/host/register-text.ts` | `renderRegister(manifest)` (§10.2) | M1-03 |

## 3. Shared types

```ts
// catalog.ts. @moxi/sdk re-exports these as types.
export type SemVer = string;   // SEMVER pattern, §8.2
export type EpochMs = number;  // ms since 1970-01-01 UTC: the base of Date.now() in worker and host
export type MapArea = "outpost" | "explorable" | "pvp";
// outpost: every outpost, town and Guild Hall, PvP outposts included. explorable: explorable areas
// and missions. pvp: PvP battle maps.
export type Profession = "warrior" | "ranger" | "monk" | "necromancer" | "mesmer" | "elementalist"
  | "assassin" | "ritualist" | "paragon" | "dervish";
export type Campaign = "prophecies" | "factions" | "nightfall";
export type Vec2 = { readonly x: number; readonly y: number }; // game world units
export type RefTable = "skills" | "maps" | "items" | "professions" | "heroes";
export type Unavailable = "loading" | "unsupported" | "not-permitted" | "restricted-area";
// loading: map transition. unsupported: no reader (fact) or executor (action) for this game build, or a kill
// switch. not-permitted: not granted, or switched off on the plugin page. restricted-area: withheld on this map kind.
export type Observed<T> = { readonly ok: true; readonly value: T; readonly at: EpochMs } // at = the read that produced value
  | { readonly ok: false; readonly reason: Unavailable };
export type Refusal = Unavailable  // restricted-area: the map kind is not in ActionEntry.regions
  | "busy"             // another game action of this session is running (spec 13)
  | "rate"             // minIntervalMs not over
  | "invalid"          // args fail the schema, or an input rule (§6.3) fails
  | "empty-input"      // a host input the action needs is empty
  | "agent-blocked";   // Dev QA run: origin "agent" and the QA allowlist refuses (spec 13)
export type ActionResult = { readonly status: "done" }                          // effect observed
  | { readonly status: "refused"; readonly reason: Refusal; readonly message: string } // nothing sent
  | { readonly status: "failed"; readonly message: string };                     // sent, no effect seen
export type DeepReadonly<T> = T extends Uint32Array ? T : T extends readonly (infer E)[] ? readonly DeepReadonly<E>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export const REFUSAL_TEXT: Record<Exclude<Refusal, "restricted-area">, string> = {
  "not-permitted": "Turned off in plugin settings", unsupported: "Not available with this game version",
  loading: "Wait until the map has loaded", busy: "Another game action is still running",
  rate: "Too soon after the last one. Try again in a moment", invalid: "This action is not valid",
  "empty-input": "Fill in the field first", "agent-blocked": "Not allowed for agents",
};
export function regionText(regions: readonly MapArea[]): string; // the restricted-area text:
// ["outpost"] → "Only in outposts, towns and Guild Halls"; ["outpost", "explorable"] → "Not in PvP";
// ["explorable"] → "Only in explorable areas and missions"; any other set → "Not here"
```

- `Unavailable` precedence when several apply: `not-permitted`, `unsupported`, `loading`, `restricted-area`
  (the fact publisher, spec 13, and the test kit).
- A chain adds no `Refusal`: it is a host flow and no plugin receives its result (step states: spec 13).
  `message` is host text (`REFUSAL_TEXT`); Main may put the compat feed's kill-switch reason into `unsupported`.

## 4. Entry types

```ts
import type { Type } from "arktype";
export type FactEntry<T> = {
  kind: "fact"; id: `game.${string}`; group: "reads";
  label: string;                  // the page line (READS group), §5.1
  schema: Type<T>; example: T;    // ArkType (validates simulator, kit fakes, examples, reader output: P52); example: one valid value (sim default, docs)
  rateHz: 1 | 10 | 20;            // most publishes per second; value: spec 05 §4.1
  regions: readonly MapArea[]; since: SemVer; // published only in these map kinds; elsewhere `restricted-area`
};
type Inputs<A> = { readonly [K in keyof A]?: "required" | "or-social" };
type Draft<A, I> = { readonly [K in keyof A]: K extends keyof I ? A[K] | null : A[K] }; // null: the player's input fills it at press time
export type HostFacts<N extends FactId> = { readonly area: MapArea;               // gwkit game state (spec 13)
  readonly facts: { readonly [F in N]: Observed<FactValue<F>> } };                 // the host's own reads
export type RefNames = { name(table: RefTable, id: number): string | undefined }; // English names from the reference data (spec 14); undefined while not loaded

export type ActionEntry<A extends object, N extends FactId, I extends Inputs<A>> = {
  kind: "action"; id: `game.${string}`; group: "acts";
  label: string; detail?: string; // the page line (ACTS group) and an optional second line
  args: Type<A>;                  // resolved args; Main and the executor check them; unknown keys rejected
  inputs: I;                      // keys that come from host inputs (§6.3); {} for most ops
  needs: readonly N[];            // facts that describe/available/confirm read
  describe(args: Draft<A, I>, ref: RefNames): string;            // the control label and receipt
  available?(args: Draft<A, I>, facts: HostFacts<N>): true | string; // string: shown, control disabled
  confirm?(args: Draft<A, I>, facts: HostFacts<N>): string | null;   // string: host confirm sheet text
  flow: "single" | "host-flow"; chainable: boolean; // host-flow = several game steps with progress (spec 13); chainable: may be a step of a chain (§8.4)
  regions: readonly MapArea[];    // allowed map kinds; else refused `restricted-area`
  automation: "quality-of-life";  // the only value (OD1, P83)
  minIntervalMs: number; effectTimeoutMs: number; since: SemVer; // values and scope: spec 05 §4.1; the effect predicate is the executor's (spec 13)
};
export type NoteEntry = { kind: "note"; id: "game.note"; group: "shows"; label: string; args: Type<{ text: string; chime: boolean }>; since: SemVer };
export type SearchEntry = { kind: "search"; id: "hub.search"; group: "hub"; label: string; since: SemVer };
export type HostEntry = { kind: "net" | "link"; prefix: "net:" | "link:"; group: "internet"; label(host: string): string; since: SemVer };
```

- The host's own reads (`HostFacts`) ignore `FactEntry.regions`; only `loading` and `unsupported` apply. An
  unavailable fact means "no objection": `available` returns `true`, `confirm` returns `null`.
- Host reads: the game renderer reads `game.map`, the `needs` of every op an enabled install holds, and the
  executor's `watch` while it runs (spec 13).
- Builders `fact()` and `action()` infer `T`, `A`, `N`, `I` per entry, so no entry needs `any`:

```ts
export const FACTS = { "game.player": fact({ /* … */ }), /* §5 */ } as const;
export const ACTIONS = { "game.travel": action({ /* … */ }), /* §6 */ } as const satisfies NoForbiddenOps; // §6.4
export const OTHERS = { "game.note": /* NoteEntry */, "hub.search": /* … */, "net:": /* … */, "link:": /* … */ } as const;
export type FactId = keyof typeof FACTS; export type ActionId = keyof typeof ACTIONS;
export type CapabilityId = FactId | ActionId | "game.note" | "hub.search" | `net:${string}` | `link:${string}`;
export type CatalogKey = FactId | ActionId | "game.note" | "hub.search" | "net:" | "link:";
export type FactValue<F extends FactId> = DeepReadonly<(typeof FACTS)[F]["schema"]["infer"]>;
export type ActionArgs<O extends ActionId> = (typeof ACTIONS)[O]["args"]["infer"];
export function keyOf(id: CapabilityId): CatalogKey;   // "net:a.example" → "net:"
export function isPersonal(id: CapabilityId): boolean; // every fact, and hub.search
export function isOutbound(id: CapabilityId): boolean; // net:<host>, link:<host>
```

Every exhaustive table is a `Record<CatalogKey, …>`: denial probes (P36, e2e), simulator fakes (test kit,
spec 08), executors `Record<ActionId, Executor>` and readers (`apps/game`) keyed by `FactId` (spec 13). A key without a row
fails the type check (P32).

## 5. Facts (api 1)

### 5.1 Entries

| Id | Page line (`label`) | `regions` |
| --- | --- | --- |
| `game.player` | Your character: name, professions, level, campaign and position | all |
| `game.map` | Where you are: map, district, outpost, explorable area or PvP, and your Guild Hall | all |
| `game.target` | Your current target: name, kind and position | outpost, explorable |
| `game.party` | Your party: players, heroes, henchmen and their builds, and the heroes on your account | all |
| `game.skills` | Your skill bar, recharge times and effects on you | outpost, explorable |
| `game.progress` | Unlocked outposts, missions, titles and skills | all |
| `game.social` | Your friends, who is online and where, your whispers, and names seen in chat | all |
| `game.vitals` | Health, energy, morale, death and the skill being cast, for you and your heroes | outpost, explorable |

- "all" = outpost, explorable and pvp. `rateHz`: spec 05 §4.1. `since` is `"1.0.0"` for every entry. Every
  fact says `loading` during a map transition. Withheld in PvP battle maps: `game.target`, `game.skills` (v1
  parity) and `game.vitals` (BD2).
- Every object schema below ends with `.onDeepUndeclaredKey("reject")`, so a producer that adds a field
  fails P52.

### 5.2 Value schemas

```ts
import { type } from "arktype";
const id = "number.integer > 0";          // map, skill, hero, title, effect and agent ids
const ms = "number.integer > 0";          // EpochMs
const generation = "number.integer >= 1"; // map-load generation in this session (spec 13)
const level = "1 <= number.integer <= 20";
const charName = /^[^\x00-\x1f\x7f]{1,32}$/;
const profession = type.enumerated("warrior", "ranger", "monk", "necromancer", "mesmer", "elementalist", "assassin", "ritualist", "paragon", "dervish");
const vec2 = type({ x: "number", y: "number" });
const idList = type("TypedArray.Uint32").narrow((a, ctx) => a.every((v, i) => i === 0 || (a[i - 1] ?? -1) < v) || ctx.mustBe("ascending without duplicates"));
const skillBar = type("TypedArray.Uint32").narrow((a, ctx) => a.length === 8 || ctx.mustBe("8 skill ids (0 = empty slot)"));
const player = type({ characterKey: /^[0-9a-f]{16}$/, // stable per (account, character); derivation in spec 13
  name: charName, primary: profession, secondary: profession.or("null"), level,
  campaign: "'prophecies' | 'factions' | 'nightfall'", position: vec2 });
const map = type({ mapId: id, area: "'outpost' | 'explorable' | 'pvp'", generation,
  district: type({
    region: "'america' | 'europe-en' | 'europe-fr' | 'europe-de' | 'europe-it' | 'europe-es' | 'europe-pl' | 'europe-ru' | 'korea' | 'china' | 'japan' | 'international'",
    number: "number.integer >= 1" }).or("null"), // null where the map has no districts
  guildHall: "'none' | 'elsewhere' | 'here'" });  // none: your guild has no hall
const target = type({ agentId: id, generation, position: vec2,
  name: "string <= 64",                      // "" when the game shows no name
  kind: "'foe' | 'ally' | 'npc' | 'object'", // foe: hostile. ally: players, heroes, henchmen, your side's spirits, pets, minions. npc: neutral NPCs. object: ground items, chests, signposts, other gadgets.
}).or("null");                               // ok + null: nothing targeted
const build = type({ primary: profession, secondary: profession.or("null"), skills: skillBar,
  attributes: type({ attributeId: "number.integer >= 0", points: "0 <= number.integer <= 12" }).array().atMostLength(12) });
const member = type({ kind: "'player'", agentId: id, self: "boolean", name: charName,
    primary: profession, secondary: profession.or("null"), level, build: build.or("null") })
  .or({ kind: "'hero'", agentId: id, heroId: id, mine: "boolean", level,
    behaviour: "'fight' | 'guard' | 'avoid'", build: build.or("null") })
  .or({ kind: "'henchman'", agentId: id, name: charName, primary: profession, level });
const party = type({ generation,
  members: member.array().atMostLength(12), // party order; build is null where the game hides it
  accountHeroes: type({ heroId: id, primary: profession, level }).array().atMostLength(64) });
const skills = type({
  bar: type({ skillId: "number.integer >= 0", readyAt: type(ms).or("null") }).array().exactlyLength(8), // slot 1 first; skillId 0 = empty; readyAt null = ready
  effects: type({ effectId: id, skillId: id, appliedAt: ms, endsAt: type(ms).or("null") }).array().atMostLength(64) }); // on you; endsAt null = no end shown (maintained, or 3,600 s or more)
const progress = type({
  unlockedMaps: idList,                      // outposts and towns you can travel to
  missions: idList, missionsHard: idList,    // completed in normal / hard mode (map ids)
  skillsLearned: idList, skillsUnlocked: idList, // this character / the account (heroes and PvP)
  titles: type({ titleId: id, points: "number.integer >= 0", tier: "number.integer >= 0" }).array().atMostLength(64) });
const social = type({
  friends: type({ alias: charName, character: type(charName).or("null"),
    status: "'online' | 'away' | 'busy' | 'offline'", mapId: type(id).or("null") }).array().atMostLength(200),
  whispers: type({ id, at: ms, direction: "'in' | 'out'", name: charName, text: "1 <= string <= 200" })
    .array().atMostLength(100),              // this session, oldest first
  chatNames: type(charName).array().atMostLength(50) }); // seen in chat this session, newest first
const vitals = type({ generation,
  agents: type({ agentId: id, heroId: type(id).or("null"), // heroId null = your character
    healthPct: "0 <= number <= 1", dead: "boolean", moralePct: "-60 <= number.integer <= 10",
    energy: "number >= 0 | null", energyMax: "number > 0 | null", // null where the game does not expose it for that agent
    casting: type({ skillId: id, since: ms }).or("null") })
    .array().atMostLength(8) });             // you first, then your heroes in party order
```

- **Time.** Every deadline and time stamp is `EpochMs`. The reader converts the game clock with one offset
  per map load, so a deadline keeps its number while the game value does not change.
- **Lists.** Id lists that can grow past 64 entries are sorted `Uint32Array`s (membership: `includes`); short
  records are plain readonly arrays. A plugin reads the wire value; the runtime converts nothing.
- **Agents.** Agent ids are valid only with the `generation` in the same value. `game.vitals` joins
  `game.party` on `agentId` + `generation`, or on `heroId`.
- **Social names.** `chatNames` are display data and host input suggestions only; they never satisfy
  `or-social` (§6.3).

## 6. Actions (api 1)

### 6.1 Entries

| Id | Page line (`label`) | flow | regions | chainable | needs |
| --- | --- | --- | --- | --- | --- |
| `game.builds.load` | Load a build on you or a hero | single | outpost | yes | `game.party` |
| `game.team.apply` | Set up your party: add heroes and load their builds | host-flow | outpost | yes | – |
| `game.travel` | Travel to an outpost, town or your Guild Hall | host-flow | outpost, explorable | yes | `game.map` |
| `game.storage.open` | Open your Xunlai storage | single | outpost | yes | – |
| `game.whisper` | Send a whisper you type yourself, to a name you type or to a friend or whisper partner | single | all | no | – |
| `game.party.invite` | Invite a player you name, or a friend or whisper partner, to your party | single | outpost | no | – |
| `game.resign` | Resign from the mission (asks first) | single | explorable | no | – |
| `game.target.call` | Call your target to your party | single | all | no | `game.target` |

- `detail` lines: `game.travel`: `You see the place before it runs, for example "Travel to Kamadan, Jewel of
  Istan".`; `game.whisper`: `You type the message yourself. The plugin cannot fill it in.`
- Every entry: `automation: "quality-of-life"`, `since: "1.0.0"`. `regions` follow the game's own rules and
  v1's region table: builds, party changes, storage and invites only in outposts; resign only in explorable
  areas and missions; whisper and target call everywhere.
- Not in the catalog: a combined "travel and invite" (BD27, R21: two presses in 1.0; the People plugin shows
  "Travel to <friend>" and then "Invite <friend>" rows, one trusted press each; no combined flow, no new id; a parity difference,
  listed in `docs/build/parity.md`); host tweaks (chat filters, quick item move, double-click repair, 4 GB
  mode, native cursor); templates on disk (A14: "Save to game templates" is a host command that takes a
  template code the player pastes or a row copied; no plugin API; M13-12).

### 6.2 Args and host functions

```ts
const templateCode = /^[A-Za-z0-9+/]{8,120}={0,2}$/;   // a Guild Wars skill template code
const behaviour = "'fight' | 'guard' | 'avoid'";
"game.builds.load":  type({ code: templateCode, on: type("'self'").or({ hero: id }) })
"game.team.apply":   type({ heroes: type({ heroId: id, "code?": templateCode, "behaviour?": behaviour })
                              .array().moreThanLength(0).atMostLength(7), "self?": templateCode })
                     // after the flow: exactly these heroes in this order, with these builds and
                     // behaviours; your unlisted heroes leave; henchmen are not touched; a full
                     // party fails the step (live check: M11-08); `self` loads your build
"game.travel":       type({ mapId: id }).or({ guildHall: "true" })
"game.whisper":      type({ to: charName, body: /^[^\x00-\x1f\x7f]{1,120}$/ })
"game.party.invite": type({ to: charName })
"game.storage.open": type({}),  "game.resign": type({}),  "game.target.call": type({})
```

Every args schema rejects unknown keys. `heroId` values in `game.team.apply` must be unique (a `.narrow`). The
whisper body limit of 120 characters is the game's chat line (M11-09 confirms it live).

| Op | `describe` (exact text) | `available` | `confirm` |
| --- | --- | --- | --- |
| `game.builds.load` | self: "Load this build on you"; hero: "Load this build on {hero}" | hero not among `members` with `mine` → "{hero} is not in your party" | – |
| `game.team.apply` | "Set up your party: {first three hero names}" + " and N more" when N > 0; with `self`: "Set up your party and your build: …" | – | `Apply team "{name}"? This replaces your heroes and their builds, and loads your build.` |
| `game.travel` | "Travel to {map}"; guildHall: "Travel to your Guild Hall" | same `mapId` → "You are here"; guildHall `here` → "You are here", `none` → "Your guild has no Guild Hall" | area `explorable` → "Leave this explorable area?" |
| `game.storage.open` | "Open your Xunlai storage" | – | – |
| `game.whisper` | "Whisper to {to}"; `to` null → "Whisper to the name you type" | – | – |
| `game.party.invite` | "Invite {to} to your party"; `to` null → "Invite the name you type to your party" | – | – |
| `game.resign` | "Resign" | – | always "Resign from the mission?" |
| `game.target.call` | "Call your target" | target `null` → "You have no target" | – |

`{hero}` = `ref.name("heroes", id) ?? "your hero"`; `{map}` = `ref.name("maps", id) ?? "Map <id>"`. A press on
the confirm sheet's own button is the trusted press that runs the action (spec 01 §2).

### 6.3 Host inputs

```ts
"game.whisper":      inputs: { body: "required", to: "or-social" }
"game.party.invite": inputs: { to: "or-social" }   // every other op: inputs: {}
```

- `required`: the value must come from a host input through `field()` (spec 08, binding in spec 09); the
  host never takes an initial `value` for it from the plugin. A `field()` in any other key or op is `invalid`.
- `or-social`: the value comes from a host input, or it is a literal equal to a `character` of a friend or a
  whisper partner `name` in the latest `game.social` value delivered to this session of this install (exact,
  case-sensitive). Without `game.social` granted, only the input works.
- The Hub resolves inputs when it builds the intent and marks which keys came from inputs; an empty input is
  refused `empty-input`. Main refuses a `game.whisper` intent whose `body` is not marked as input. Intent
  shape: spec 07; flow: spec 13.

### 6.4 Admission (P83)

`automation` has one possible value, `"quality-of-life"`, so an entry without it does not compile. A
compile-time check in `catalog.ts` rejects an op id with a forbidden segment (`ACTIONS` is checked with
`satisfies NoForbiddenOps`, §4):

```ts
type Forbidden = "attack" | "cast" | "use" | "walk" | "move" | "follow" | "interact" | "pickup"
  | "trade" | "merchant" | "trader" | "buy" | "sell" | "craft" | "salvage" | "identify"
  | "drop" | "give" | "gold" | "auction";
type ForbiddenOp = `${string}.${Forbidden}` | `${string}.${Forbidden}.${string}`;
type NoForbiddenOps = Record<string, unknown> & { readonly [K in ForbiddenOp]?: never };
```

- `catalog.test.ts` splits every `ActionId` at "." and asserts no segment is in the same list, and that the
  only `game.target.*` op is `game.target.call`. Bug it catches: a combat or economy op added under a
  harmless group name.
- Moving items between bags and storage, if it ever comes, is a host tweak, never a catalog action.

## 7. Other capabilities and read or internet

| Id | Group | Page line | Personal | Outbound |
| --- | --- | --- | --- | --- |
| `game.note` | shows | Print notes in your chat that only you see, with an optional chime (at most 1 per second) | no | no |
| `hub.search` | hub | Everything you type in the Hub search | yes | no |
| `net:<host>` | internet | Connects to `<host>`. It can send what you type into it and learns your IP address and when you play | no | yes |
| `link:<host>` | internet | Opens pages on `<host>` in your browser, after you see the address | no | yes |

- `game.note` args: `{ text: "string > 0", chime: "boolean" }`. Main cleans the text to printable ASCII and
  cuts it at `budgets.note.chars` with the mark `...` (path: spec 07; rules: spec 13). The rate in the page
  line is `budgets.note.perSecond`; overflow is refused `rate` (P84). It needs no press, changes nothing in
  the world, may follow any fact, and is allowed in `internet`-class installs.
- `hub.search` is valid only in `optional`; the player allows it in context (`RequestAccess`, spec 12).
- `<host>` in `net:` and `link:`: a lowercase ASCII DNS name with at least two labels, IDN in `xn--` form, no
  trailing dot, no IP literal, no port. The manifest must use this form; the parser does not normalize (URL
  rules: spec 14):
  `/^(?=.{1,253}$)(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/`

**The rule.** Over `permissions ∪ optional`:

```text
personal = every game.* fact, hub.search          outbound = every net:<host>, link:<host>
personal ≠ ∅ and outbound ≠ ∅  →  ManifestError("read-and-internet")
classOf(manifest) = outbound ≠ ∅ ? "internet" : "local"   (picks the plugin host, spec 03)
```

Messages (path empty; the first personal and first outbound id in file order, `permissions` first):

- fact: `reads from the game (game.map) and connects to the internet (net:kamadan.gwtoolbox.com). A plugin can do one or the other.`
- `hub.search`: `reads your Hub search (hub.search) and connects to the internet (link:wiki.guildwars.com). A plugin can do one or the other.`

Allowed in an `internet`-class install: game actions without any outcome (types make `onResult` `never`,
spec 08), `game.note`, text after its own scope word, digit-led text with `hub.numbers`, its own inputs (with
the "Sent to <host>" chip, spec 09), documents, settings, reference data. Allowed in a `local` install that
reads: host-built `{ wiki }` links (spec 08), `game.whisper` and `game.party.invite` under §6.3.

## 8. Manifest schema (api 1)

### 8.1 Types

```ts
// manifest.ts. Platform and KeyCode: @moxi/sdk/host, spec 11.
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [k: string]: JsonValue };
export type StaticOp = { readonly op: ActionId; readonly args: JsonValue }; export type HexColor = `#${string}`;
export type Manifest = {
  readonly id: string; readonly name: string; readonly version: SemVer; readonly api: 1; // id matches PLUGIN_ID (spec 01 §3)
  readonly description: string; readonly author: string;
  readonly repository?: string; readonly license?: string; // https URL; SPDX id
  readonly icon?: IconRef; readonly accent?: HexColor;     // icon: §9, absent → { glyph: "command" }
  readonly platforms?: readonly Platform[];                // "macos" | "windows" | "linux"; directory filter only
  readonly stage?: "experimental";   // honoured for official installs only (spec 15)
  readonly permissions?: Readonly<Partial<Record<CapabilityId, string>>>; // id → author's reason
  readonly optional?: Readonly<Partial<Record<CapabilityId, string>>>;
  readonly commands?: readonly Command[]; readonly hud?: readonly HudWidget[]; readonly settings?: readonly Setting[];
  readonly hub?: { readonly items?: boolean; readonly scopes?: readonly string[]; readonly numbers?: boolean };
  // written by the build (@moxi/sdk/vite, moxi build); a package requires them (spec 15)
  readonly minHost?: SemVer; readonly vueCompiler?: SemVer; // §10.3; exact @vue/compiler-sfc version that compiled the code
  readonly references?: readonly RefTable[];                // tables used by useReference
};
export type Command = {
  readonly id: string; readonly title: string; readonly subtitle?: string;
  readonly keywords?: readonly string[]; readonly icon?: IconRef;
  readonly shortcut?: string; readonly presentation?: "view" | "panel"; // shortcut: a suggestion, grammar and assignment: spec 11; presentation: default "view", panel floats inside the game window
  readonly game?: StaticOp | { readonly steps: readonly StaticOp[] };
};
export type HudWidget = { readonly id: string; readonly title: string; readonly anchor: Anchor; readonly default?: boolean };
export type Anchor = "screen:top-left" | "screen:top" | "screen:top-right" | "screen:center"
  | "screen:bottom-left" | "screen:bottom" | "screen:bottom-right"
  | `skill:${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}` | `effect:${number}` | "compass" | "target";
```

### 8.2 Field rules

| Field | Rule |
| --- | --- |
| `id` | `PLUGIN_ID` (`@moxi/sdk/host`, spec 01 §3). The part before the dot is the publisher (the GitHub owner login, lowercased). `moxi.` is checked at install: official source only (spec 15) |
| `name` | 1 to `budgets.manifest.nameChars` characters from U+0020–U+007E and U+00A0–U+00FF; no leading, trailing or double space; not one of `RESERVED_NAMES`, compared case-insensitively: moxi, guild wars, arenanet, hub, plugins, settings, accounts, home, play, news, today, appearance, activity, shortcuts, updates |
| `version`, `minHost`, `vueCompiler` | `SEMVER = /^(0\|[1-9]\d*)\.(0\|[1-9]\d*)\.(0\|[1-9]\d*)(?:-(?:0\|[1-9]\d*\|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0\|[1-9]\d*\|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/` (today's pattern) |
| `api` | `1`. Another integer ≥ 2: `needs-newer-host`. Anything else: malformed |
| `description`, `author` | 1 to `budgets.manifest.descriptionChars` / `budgets.manifest.authorChars` characters, one line |
| `repository` | `https://` URL, at most `budgets.manifest.repositoryChars` characters, no userinfo, no port |
| `license` | `^[A-Za-z0-9.+-]{1,40}$` |
| `accent` | `^#[0-9a-fA-F]{6}$`, stored lowercase. The host corrects contrast (spec 09) |
| `platforms` | non-empty, unique |
| `permissions`, `optional` | keys: capability ids; values: the reason, 1 to `budgets.manifest.reasonChars` characters, one line. At most `budgets.manifest.permissionKeys` keys each. An id in both: malformed "is listed in both permissions and optional". A dotted lowercase id (`^[a-z]+(\.[a-z]+)+$`) not in the catalog: `needs-newer-host`. `net:`/`link:` with a bad host: malformed "must be net:<host> with a lowercase DNS name". Any other key: malformed "is not a capability id". `hub.search` in `permissions`: malformed "hub.search can only be optional" |
| `commands` | at most `budgets.manifest.commands`; ids `^[a-z0-9][a-z0-9-]{0,39}$`, unique; `title` 1 to `budgets.manifest.titleChars`; `subtitle` 1 to `budgets.manifest.subtitleChars`; `keywords` at most `budgets.manifest.keywords`, each 1 to `budgets.manifest.keywordChars`; `presentation` together with `game`: malformed "a command with a game op has no view" |
| `hub.scopes` | at most `budgets.manifest.scopes` words, each `^[a-z]{2,12}$`, unique |
| `hud` | at most `budgets.manifest.hudWidgets`; ids `^[a-z0-9][a-z0-9-]{0,39}$`, unique; `title` 1 to `budgets.manifest.titleChars`; `default` honoured for official installs only (spec 12). How many can be on at once: `budgets.install.hudWidgetsOn` |
| `settings` | §8.5 |

### 8.3 Static game ops (`commands[].game`)

A command with `game` runs on its Hub row or bound shortcut with no plugin code (P46); both are trusted
presses (spec 01 §2).

1. `op` is an `ActionId` listed in `permissions` or `optional`; else malformed "uses game.travel but
   plugin.json does not request it".
2. `args` passes the op's `args` schema at parse time and holds no `field()`: static values only.
3. An op with a non-empty `inputs` cannot be static: `game.whisper` → "game.whisper needs the player's own
   text; use a GameAction in a view"; `game.party.invite` → "game.party.invite needs a name the player types
   or a friend; use a GameAction in a view".
4. The command has no component: `Register["commands"]` leaves it out (§10.1).

### 8.4 Chains (`commands[].game.steps`)

1. 2 to `budgets.install.chainSteps` steps. One step: malformed "A chain has at least 2 steps; use a single
   game op". Too many: the spec 05 message.
2. Every step follows §8.3 rules 1 to 3, and its op has `chainable: true` (api 1: `game.travel`,
   `game.builds.load`, `game.team.apply`, `game.storage.open`); else malformed "game.whisper cannot be part of
   a chain".
3. At run time each step runs only in an outpost, town or Guild Hall, whatever the op's own `regions` allow
   (BD1). Authorization, order, stop and cancel: spec 13. Page lines and the update rule (a new op in a
   chain is an escalation): spec 12. A chain command's shortcut counts in `budgets.install.shortcuts`.
4. `act()` stays single (spec 08); no plugin code sequences actions.

### 8.5 Settings

```ts
export type Setting = {
  readonly key: string;     // ^[a-zA-Z][a-zA-Z0-9]{0,39}$, unique
  readonly label: string; readonly detail?: string; // detail: one help line
  readonly group?: string;  // host heading, groups in order of first use
  readonly when?: { readonly key: string; readonly equals: boolean | number | string };
} & (
  | { readonly type: "toggle"; readonly default: boolean }
  | { readonly type: "number"; readonly default: number; readonly min?: number; readonly max?: number; readonly step?: number; readonly unit?: string }
  | { readonly type: "slider"; readonly default: number; readonly min: number; readonly max: number; readonly step?: number; readonly unit?: string }
  | { readonly type: "select"; readonly default: string; readonly options: readonly SettingOption[]; readonly display?: "menu" | "segmented" }
  | { readonly type: "multi"; readonly default: readonly string[]; readonly options: readonly SettingOption[] }
  | { readonly type: "text"; readonly default: string; readonly maxLength?: number; readonly placeholder?: string }
  | { readonly type: "list"; readonly default: readonly string[]; readonly maxItems?: number; readonly placeholder?: string }
  | { readonly type: "color"; readonly default: HexColor }
  | { readonly type: "key"; readonly default: KeyCode | null } // one KeyCode (spec 11 §3.1) or null
);
export type SettingOption = { readonly value: string; readonly label: string }; // value ^[a-z0-9-]{1,40}$
export type SettingValue = boolean | number | string | readonly string[] | null;
```

| Rule | Detail |
| --- | --- |
| Count and text | at most `budgets.manifest.settings` settings. `label` 1 to `budgets.manifest.titleChars`; `detail` 1 to `budgets.manifest.detailChars`; `group` 1 to `budgets.manifest.groupChars`; option `label` 1 to `budgets.manifest.optionLabelChars`; `unit` 1 to `budgets.manifest.unitChars` |
| `number`, `slider` | finite numbers; `min ≤ default ≤ max`; `step > 0` and `default` on the step grid from `min` |
| `select`, `multi` | 1 to `budgets.manifest.options` options, unique values; `default` is one of them (`multi`: a unique subset) |
| `text` | `maxLength` 1 to `settings.textChars` (default the same); `default` within it; one line |
| `list` | `maxItems` 1 to `settings.listItems` (default the same); items 1 to `settings.itemChars` characters |
| `when` | names an earlier setting of type `toggle`, `select` or `number`; `equals` has that setting's value type. The host shows the setting only while the other one equals the value; the stored value stays |
| Scope and storage | one value per install, for all accounts (per-account data uses documents); Main stores values (spec 12) and the worker reads them as `useSettings()` (spec 08); command key bindings are host shortcuts (spec 11), not settings; `text` and `list` settings of internet installs carry the "Sent to <host>" chip (spec 09) |

### 8.6 Parsing

```ts
export type ManifestWarning = { readonly path: string; readonly message: string };
export class ManifestError extends Error {
  readonly code: "malformed" | "needs-newer-host" | "read-and-internet";
  readonly path: string; readonly rule: string; // path: "commands[1].game.op", "" for whole-manifest rules; message = path ? `${path}: ${rule}` : rule
}
export function parseManifest(value: unknown): { manifest: Manifest; warnings: readonly ManifestWarning[] };
export function classOf(manifest: Manifest): PluginClass; // spec 01 §3
```

- One function serves `moxi build` and `moxi check` (warnings printed), Main install and load (warnings stored
  with the install, shown on dev installs), the test kit, and registry CI (M14). `plugin.json` inside the
  package is the only authority; index entries derive from it. It throws on the first error, checking in the
  order §8.2, §8.3, §8.4, §8.5, §7.
- Unknown keys at any level (top level, `commands[]`, `game`, `hub`, `hud[]`, `settings[]`, options, `when`)
  are removed and reported as `{ path, message: "unknown field, ignored" }`. Exceptions: inside `args` an
  unknown key is an error (args are exact); keys of `permissions` and `optional` follow §8.2. `kind`,
  `tokens`, `activation`, top-level `scopes` and asset paths are unknown keys like any other. An `icon` given
  as a string is malformed.
- An unknown glyph in any `icon`: warning "unknown glyph, shown as dot", and the parsed manifest holds
  `{ glyph: "dot" }` (§9). An unknown anchor matching `^[a-z]+(:[a-z0-9-]+)?$` that the host lacks is
  `needs-newer-host`; any other anchor is malformed.

### 8.7 Host compatibility

```ts
export const HOST_API: SemVer = "1.0.0";    // the plugin API level of this host build
export const RUNTIME_VUE: SemVer = "3.5.43"; // Vue version of the plugin runtime (spec 06)
export function checkHost(m: Manifest, host = { api: HOST_API, vue: RUNTIME_VUE }): true | "needs-newer-host";
// needs-newer-host when m.minHost > host.api, or m.vueCompiler > host.vue (SemVer order)
```

- Main runs `checkHost` at install, at load and before offering an update; the page says "Needs a newer Moxi"
  (spec 12). The test kit runs it in `mountPlugin`.
- The runtime asserts at boot that `version` from `@vue/runtime-core` equals `RUNTIME_VUE`; a mismatch throws
  (a build defect, not a player error).
- A plugin compiled by an older 3.x compiler runs on the newer runtime (P19 gates every Vue bump).
  `@moxi/sdk/vite` pins one exact `@vue/compiler-sfc` and writes it as `vueCompiler` (spec 08).

## 9. Icons

```ts
// icons.ts
export const GLYPHS = ["dot", "command", "plus", "minus", "close", "check", "search", "settings",
  "edit", "copy", "trash", "link", "info", "warning", "star", "pin", "book", "list", "grid", "map",
  "home", "target", "coins", "bolt", "clock", "bell", "chat", "person", "people", "chest", "flag"] as const;
export type Glyph = (typeof GLYPHS)[number];
export type GameArtRef = { readonly skill: number } | { readonly item: number } | { readonly profession: Profession } | { readonly map: number };
export type IconRef = { readonly glyph: Glyph } | GameArtRef;
```

The manifest `icon`, command icons, Hub rows and elements use `IconRef` (spec 08, 09). Game art comes from
the player's `Gw.dat` through the host; a plugin never holds image bytes. `packages/ui` draws each glyph
(spec 09). A glyph name the host lacks renders as `dot`, so new glyphs need no `since`.

## 10. Generated types

### 10.1 `Register`

```ts
// register.ts (exported by @moxi/sdk)
export interface Register {}
type Field<K extends string, D> = Register extends { [P in K]: infer V } ? V : D;
export type RequestedId = Field<"permissions", CapabilityId> | Field<"optional", never>;
export type GrantedFact = RequestedId & FactId; export type GrantedAction = RequestedId & ActionId; // optional facts included; ungranted reads `not-permitted`
export type CommandIdOf = Field<"commands", string>; export type HudIdOf = Field<"hud", string>;   // commands without a game op
export type SettingsOf = Field<"settings", Readonly<Record<string, SettingValue>>>; export type ClassOf = Field<"class", PluginClass>;
```

Without a generated file every id is allowed, so the SDK and its own tests compile; the build's capability
check (spec 08) still holds. With the file, P22's mistakes are type errors.

### 10.2 `renderRegister`

`renderRegister(manifest: Manifest): string` returns the text of `moxi-env.d.ts` (gitignored).
`@moxi/sdk/vite` writes it on every manifest change; `moxi check` writes it first (spec 08).

```ts
// generated by @moxi/sdk from plugin.json; do not edit
declare module "@moxi/sdk" {
  interface Register {
    commands: "favourites";
    hud: "last-trip";
    permissions: "game.progress" | "game.travel";
    optional: never;
    settings: { readonly showRegion: boolean };
    class: "local";
  }
}
```

- Keys in this order; union members sorted; `never` for an empty set; strings as JSON literals.
- Setting types: `toggle` → `boolean`; `number`, `slider` → `number`; `select` → union of option values;
  `multi` → `readonly (<union>)[]`; `text` → `string`; `list` → `readonly string[]`; `color` →
  `` `#${string}` ``; `key` → `import("@moxi/sdk/host").KeyCode | null`. Keys in manifest order.

### 10.3 `since` and `minHost`

- `since` sources: catalog entries (`"1.0.0"`); `ANCHORS` and `SETTING_TYPES` in `manifest.ts` (each
  `"1.0.0"`); `SDK_SINCE: Record<SdkExport, SemVer>` in `catalog.ts` (names: spec 08); element and prop
  entries (spec 09).
- `minHost` = the highest `since` over what the plugin uses: requested ids (`net:`/`link:` by family), static
  ops, anchors, setting types, SDK functions, elements and props. `@moxi/sdk/vite` computes it (spec 08).
- `HOST_API` changes, not the app version, because app versions come from pull request titles at release
  time. After 1.0.0, a change that adds an id, anchor, setting type, SDK export, element or prop raises
  `HOST_API`'s minor and sets that item's `since` to it. A unit test asserts every `since ≤ HOST_API` (bug:
  an item no host accepts).
- Before 1.0.0 everything is `"1.0.0"`; anchors `skill:*`, `effect:*`, `compass` and `target` join the parser
  with M11-11 (until then they parse as `needs-newer-host`).

## 11. Decisions

| Decision | Reason | Rejected |
| --- | --- | --- |
| Catalog schemas are the one definition; value types derive by `import type` | one owner per fact; the three producers cannot drift (P52) | hand-written TS types beside the schemas |
| `regions` as a list of map kinds on facts and actions; `game.target`, `game.skills` and `game.vitals` withheld in PvP battle maps | the publisher withholds by data, not per-reader code; resign is explorable-only, which `"any" \| "non-pvp" \| "outpost-only"` cannot say; v1 parity, no PvP edge from moxi | gating inside each reader; DESIGN's three-value union; every fact everywhere |
| Id lists as sorted `Uint32Array`; deadlines as `EpochMs` | no runtime conversion, cheap to clone; a plugin compares with `Date.now()` and the host ticks countdowns from the same base | typed arrays on the wire and a `ReadonlySet`; the raw game clock, which a worker cannot read |
| `automation: "quality-of-life"` and a denylist checked by type and test (BD4) | the line holds by construction | review only |
| Chains only in the manifest, 2 or more chainable steps with static args (BD1) | one consent shows every step; no plugin code decides when a step runs | plugin-sequenced actions; chains through `act()` |
| `inputs` on the entry marks host-input keys; `chatNames` never satisfy the whisper target rule; effect predicates live with the executors | the whisper and invite rules are data the Hub and Main both read; names from public chat are not people the player chose; the catalog stays free of game-side logic | special cases for two ops in Hub code; chat names as valid targets; a predicate function in each entry |
| Unknown keys ignored with a warning at every level, except inside `args` | an older host meets a newer manifest through `minHost`, not by failing | rejecting unknown keys (today) |
| `hub.search` only in `optional`; `game.note` not personal and allowed in internet installs | the player allows search in context, never at install; a note shows text to the player only and nothing leaves | `hub.search` as a required permission; `game.note` personal |
| `HOST_API` separate from the app version; compiler floor as the build-written field `vueCompiler` | code cannot know the app version a change ships in; the host compares one version it knows | `since` = app version; a host-release → runtime-version table folded into `minHost` |
| Settings per install, no account scope | per-account data already has documents | a `scope` field on settings |
| Refusals: drop `needs-user-action`; add `loading`, `rate`, `empty-input`, `agent-blocked`; chain stops are host states | freshness is structural; every new reason has a cause the player can act on | one `refused` with free text |
| Travel and invite stay two presses, no combined action (BD27) | no new catalog id; each press is one trusted press | a combined travel-and-invite flow |

## 12. Today in code (main 848fb6e) and what changes

M1-00 moves the old SDK to `packages/sdk/src/legacy` (spec 02); M6-03 deletes it. New modules live in
`host/`. Paths below are today's.

| Today | Where | Becomes |
| --- | --- | --- |
| `Unavailable` has `not-in-game`; `Refusal` has `needs-user-action`, no `rate`, `loading`, `empty-input`, `agent-blocked` | `packages/sdk/src/game.ts:3-8`, `:35-41` | §3 unions; sessions follow `GameState` (spec 03) |
| `Player`, `Target`, `MapState`; `Profession` imported from `nodes.ts`; imperative `Game.loadBuild`/`travel`, `SLICES` | `game.ts:1`, `:16-33`, `:48-57`; `packages/sdk/src/nodes.ts:5-15` | §5.2 shapes, `catalog.ts` (names come from reference data); the imperative API is deleted with the old SDK (M6-03) |
| `parseManifest`: unknown top-level key rejects; 5 ids + `net:`; required `activation`; settings `toggle`/`number` only; `ManifestError(path, rule)`; `Manifest` with `activation`, top-level `scopes`; 44-row invalid-manifest table, 46 tests | `packages/sdk/src/manifest.ts:82-210` (`:100`, `:116-123`, `:127-133`, `:179`); `packages/sdk/src/protocol.ts:4-27`; `packages/sdk/src/manifest.test.ts` | `host/manifest.ts` (§8, §8.1); valid test rows move to the new table |
| `Icon = { skill } \| { profession } \| { glyph: string }`; 7 glyphs, unknown → `dot` | `packages/sdk/src/nodes.ts:3`; `apps/game/src/hub/Icon.vue:21-29` | `IconRef`; §9 list drawn in `packages/ui` |
| Permission checks hard-coded in the plugin host | `apps/plugin-host/src/plugin-host.ts:342-348`, `:353-369` | Main authority, membrane fan-out (specs 03, 13) |
| Bundled manifests in the old shape | `plugins/{builds,calculator,target-distance}/plugin.json` | rewritten in M6-01, M6-02 |
| `@moxi/sdk` depends only on `@vue/reactivity` 3.5.43 | `packages/sdk/package.json` | adds `arktype` 2.2.7 (used in contracts, gwkit, desktop, plugin-host) |

## 13. Built by

| Slice | From this spec |
| --- | --- |
| M1-01, M1-02 | §3 to §7 entries and helpers, `REFUSAL_TEXT`, `regionText`, `SDK_SINCE`, `HOST_API`, `RUNTIME_VUE`; `register.ts` (§10.1); admission check and table (§6.4); the spec 05 keys this file names (M1-02) |
| M1-03 | §8 (`parseManifest`, `classOf`, `checkHost`), §9, §10.2 |
| M1-07 | page lines from `label`, `detail`, `describe` (spec 12) |
| M2-04, M2-05, M2-06 | composable types over `Register`; kit fakes and sim from schemas and `example`; `moxi-env.d.ts`, `minHost`, `vueCompiler`, `references` |
| M5-07, M5-08 | publisher: `rateHz`, `regions`, precedence; executors, §6.3 checks in the Hub, chain rules |
| M6-01, M6-02 | bundled `plugin.json` files in the api 1 shape |
| M11-02 to M11-09 | readers and executors that produce and use §5 and §6 live |
| M11-11 | game anchors in the parser |

## 14. Checked by

| Proof | What it checks here | Slice |
| --- | --- | --- |
| P32, P83 | `Record<CatalogKey, …>` tables compile; every key has a non-empty label; an unknown dotted id is `needs-newer-host`; the admission type and test table (§6.4) | M1-01 |
| P52 | each fact schema accepts its `example`, 1,000 simulator states, the kit fakes and the fixture-world reader output | M1-01 (schema half), M5-07 |
| P82 | `game.vitals` schema; withheld in PvP and while loading; agents keyed by id and generation | M1-01, M5-07, M11-05 |
| P34 | read-or-internet table (§7) through the one `parseManifest` at build and install; the B half (pre-filled body, foreign target) in the Hub | M1-03 (N), M7-03 (B) |
| P36 | one denial row per `CatalogKey` | M1-03 (table), M4-04 (N) |
| P22 | missing permission, non-literal id, unknown command id, wrong setting type fail at build | M2-04, M2-06 |
| P19 | `vueCompiler` pin and the newer-compiler refusal | M2-06, M2-07 |
| P81 | chain parse rules of §8.4 (a 9-step chain and a non-chainable step are errors); chains at run time | M1-03 (parse), M5-08, M11-10 |
| P84 | `game.note` rate and queue (`budgets.note.*`); overflow refused `rate` | M5-08 |
| P80 | the compat feed can only turn catalog ids off | M9-11 |
| P78 | files touched per fact and per action | M6-04 |

## 15. Deferred

- `game.inventory` ("Your bags, storage and gold"): not in api 1 at launch (BD15). Slice M11-13 adds it only
  if Matthias says yes.
- Theme packages (`kind: "theme"`, `tokens`): until community or GitHub plugins open (M14-04). Unknown
  top-level keys are ignored, so they can return additively.
- A "skill used" event fact; an alcohol level fact (Timers); a map data fact (Maps): after Beta.
- `hud[].opens` (a HUD widget that opens a panel): no pressable HUD in 1.0 (BD13).
- A host `<Send>` control as an exception to read or internet: not in 1.0; Matthias decides.
