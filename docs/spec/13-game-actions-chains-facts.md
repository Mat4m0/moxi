# 13 Game actions, chains and facts

## Purpose

Game state, the fact publisher, the action path from press to receipt, Main's authority, the executor, chains,
self-only notes and the CI stand-ins. Catalog and result unions: [spec 04](04-catalog-and-manifest.md). Budget values:
[spec 05](05-budgets.md). Channels and messages: [spec 07](07-wire-and-ipc.md).

## 1. Rules in force

1. Main authorizes every action from every origin before the executor runs it (§6), a chain whole before step 1.
2. Only a trusted press ([spec 01](01-foundations.md) §2) starts a game action; one press starts at most one action or
   one chain, and the Hub marks it consumed. No timer, fact change, network reply, `onResult` handler, drop or module
   code starts one. `act()` only returns data ([spec 08](08-sdk-and-toolchain.md)).
3. The executor makes game calls only inside a gwkit safe-point callback, one per safe point, and reports `done` only
   for an effect it observed (§7). It never queues: a press while an action of that session runs is refused `busy`.
4. The host writes every label: `describe()` (spec 04 §6.2), used by receipts, sheets, Enter hints and chain lists.
5. Facts are display data, `game.vitals` included: `apps/game/src/facts.ts` cannot import `actions.ts` or `hub.ts`
   (lint, [spec 02](02-packages-and-boundaries.md) §3).
6. No plugin surface, fact or action exists outside a plugin session (I8); sessions follow the game state (§3.1).
   `internet` hosts get no facts and no action results (spec 07 rule 7). Every capability fails closed on its own (§3.3).

## 2. Files

The other files are named at their code blocks, with their slices.

| File | Holds | Slice |
| --- | --- | --- |
| `packages/gwkit/src/runtime/index.ts` | safe point over every promising export; main loop by export name | M5-05 |
| `packages/gwkit/src/locate/support.ts` | `capabilitySupport()`, exported by `@moxi/gwkit/locate` (spec 15 calls it for "Works with this game build: N of M") | M5-11 |
| `packages/sdk/src/host/actions.ts` | `ActionRequest`, `ActionDecision`, `ActionReport`, `StepState`, `ChainProgress` (meaning and fields here; channels that carry them: spec 07) and the pure `authorize()` with `AuthorityInput` (Main and the test kit call it) | M3-07 (types), M4-07 (`authorize`) |
| `apps/desktop/src/plugins/authority.ts` | `plugin.action.authorize` handler: builds `AuthorityInput`, origin, QA allowlist, action ids, log | M4-07 |

## 3. Game state, generations and support

### 3.1 Game state

```ts
// packages/gwkit/src/game/state.ts (M5-06)
export type GameState =
  | "login"            // the login screen, or connecting to it
  | "character-select" // logged in, no character in the world
  | "loading"          // a map transition, including the first load after character select
  | "in-world"         // a character is in a loaded map
  | "unknown";         // no locator yet, a `world:` role is missing, or the state cannot be read
export type World = {
  readonly view: DataView;                           // over the current game memory buffer
  readonly values: Readonly<Record<string, number>>; // locator witness values
};
export function gameState(world: World): GameState;
```

- The game renderer calls `gameState()` at every safe point once it has the locator (`game.locator`, spec 07 §3) and
  invokes `game.state { state }` on a change; before the locator the state is `unknown` and nothing is sent. Main
  answers `{ sid: number | null }`: a new sid on entering `in-world`, the same while there, else `null`. The renderer
  announces `{ t: "session", sid, open }` on each (window, host) port before any other message for that sid (spec 07 §5).
- Sessions (lifecycle: [spec 03](03-plugin-hosts-and-lifecycle.md) §1.5): `in-world` opens one when none is open;
  `login`, `character-select` and `unknown` close it; `loading` changes nothing, so map loads keep the session and the
  first load after character select opens it once the map has loaded. gwkit reports `loading` during a map load, never
  `unknown`. A game page reload, the renderer's death and window close also close it. A worker session opens at session
  open for installs with a granted `game.note` (spec 06), else on first mount, hub, query or event.
- A read that throws (`RangeError` from the `DataView`) or meets a null pointer gives `loading` when the last state was
  `loading` or `in-world`, else `unknown`: a world being replaced in a map change must not close the session.
- With the real client, sessions open only once the `world:` roles are located; until then the plain game runs.

### 3.2 Generation, clock and character key

- **Map-load generation.** Per game window: `1` for a session's first map, `+1` each time the state goes from `loading`
  to `in-world`, `1` again in a new session. An agent id is valid only with the `generation` in the same value (spec 04 §5.2).
- **Clock.** At the first read after each map load the publisher sets `offset = Date.now() − gameMs` (`gameMs` from the
  `world:clock` value); for that map `toEpoch(g) = Math.round(g + offset)`. One offset per map keeps an unchanged
  deadline the same number, so diffing works.
- **`characterKey`** (`game.player`): the first 16 lowercase hex characters of SHA-1 over the UTF-8 bytes of
  `"moxi.character\n" + name`, computed with gwkit's synchronous SHA-1 (`packages/gwkit/src/match/hash.ts`, extended
  with a hex output). Character names are unique in Guild Wars, so the key is stable per (account, character); only a
  rename changes it. A document key, not a secret: the plugin also reads `name`.

### 3.3 Capability support per game build

- Role names in `compat/roles/game.jsonc` (M5-11, M11-*) start with what they serve: `world:<name>` (game state, clock,
  context root, agent array; every fact, action and note needs them) or `<capability id>:<name>` (`game.vitals:health`,
  `game.travel:producer`, `game.note:print`); witness value names too. `compat/roles/v1-october.jsonc` stays as corpus
  test data under its old names.
- Main computes support once per game build, after `locate()` or after loading a signed locator:

```ts
// packages/gwkit/src/locate/support.ts, exported by @moxi/gwkit/locate
import type { Locator, RoleSpecs } from "./specs";
/** A capability is supported when every `world:` role, every role with its prefix and every
 *  value those roles read are in the locator. Ids are sorted. */
export function capabilitySupport(specs: RoleSpecs, locator: Locator): {
  readonly supported: readonly string[];
  readonly unsupported: readonly string[];
};
```

- `off(build)` = kill switches for that build ([spec 15](15-distribution-and-compat.md)) ∪ `unsupported` ∪ every
  action id when the locator came from local matching rather than the signed compat feed (facts on, actions off). In
  fixture runs the generated fixture locator counts as signed.
- Main sends `off(build)` to each game window as `GamePluginState.killed` (spec 07 §4) and uses it in `authorize()`
  (§6). The plugin page's "2 of 3 features" (spec 12, P51) counts the same set. Plugins see every off capability as
  `unsupported`.
- Effective grants are per (install, game build); Main uses the build of the window that sent the request. A reader or
  call whose witness value is missing returns `unsupported` itself (defense in depth).

## 4. Fact publisher

### 4.1 What is read

`apps/game/src/facts.ts` (M5-07; also the `GameView` source), per game window, while a session is open, at the safe point:

```text
plugin set = ∪ over local host ports: latest `subscribe.facts` for this sid
             ∩ facts granted to an install bound to that host (GamePluginState; the game distrusts hosts)
host set   = game.map
             ∪ `needs` of every op an enabled install of this window holds (spec 04 §6.1)
             ∪ `watch` of the executor while an action runs (§7.1)
read set   = (plugin set ∪ host set) − off(build)
```

- No subscriber, no read. The host reads `needs` while an enabled install holds the op, not only while its control is
  mounted: `GameBridge` cannot report mounted controls, and the reads are cheap.
- A slice is due when `now − lastRead ≥ 1000 / rateHz` (spec 05 §4.1), never above `budgets.facts.maxHz`. Due slices
  are read at the next safe point, in catalog order.
- While the state is `loading` nothing is read; each subscribed slice publishes `loading` once. Each read calls
  `globalThis.fixtureWorld?.countRead(factId)` (defined only by the fixture glue, §10; the P49 counter).

### 4.2 Publish

- Each slice is an `Observed` (spec 04 §3), `at` = EpochMs of its read. Reasons produced here, in spec 04's precedence:
  `unsupported` (off, or the reader failed), `loading`, `restricted-area` (area not in `FactEntry.regions`).
  `not-permitted` is the membrane's (spec 07 §7).
- Diff per (port, sid, fact) against the last value sent on that port, ignoring `at`; typed arrays compare element by
  element. An unchanged slice is not sent.
- Per tick and local port: one `facts` message for the open sid with every changed and every newly subscribed slice;
  `tick` +1 per message.
- Host reads also update `GameView.facts` (spec 02 §5). They are never withheld by `regions`; facts outside the host
  set read `unsupported` there and host code never uses them.
- Reader failures: an outcome `loading` passes through. A thrown `RangeError` counts as `loading` for that read. Any
  other throw turns that fact `unsupported` in this window until the page reloads, with one Dev log line `[facts] <id>
  reader failed: <message>`.
- Revoke (P35): a `plugin.state` without the grant removes the fact from the plugin set in the same task; with no other
  reader it is not read after that tick. Session close drops all per-session state.

### 4.3 Reader contract

```ts
// packages/gwkit/src/game/readers.ts, one file per fact in src/game/ (M5-07 on fixture-world; M11-02 to M11-07 live)
export type ReadContext = World & {
  readonly generation: number;                  // §3.2
  readonly toEpoch: (gameMs: number) => number; // §3.2
};
export type ReadOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: "loading" | "unsupported" };
export type Reader = (ctx: ReadContext) => ReadOutcome;
/** Keyed by fact id strings. apps/game/src/facts.ts binds `readers satisfies Record<FactId, Reader>`. */
export const readers: { readonly [fact: string]: Reader };
```

- A reader returns exactly what its catalog schema accepts (typed arrays where spec 04 says so, EpochMs, the
  generation); P52 runs the schema over it. It uses only witness values of `world:` and its own prefix, never a constant
  offset (P50), and keeps no state except caches keyed by generation.

### 4.4 What each reader reads

Leads, not facts: prove each with witness reads before use. The B7 values are examples located on build B7.

| Fact | Reads | Live slice |
| --- | --- | --- |
| `game.player` | context root (`0x5a5080` on B7) → player number (offset `0x2b0` on B7) → own agent: name, professions, level, position; campaign | M11-02 |
| `game.map` | map id; area table and stride (`0x1ce000`, `0x7c` on B7) for the area kind; district; Guild Hall state | M11-02 |
| `game.target` | manual and automatic target slots (`0x5a7aec`, `0x5a7ae8` on B7); agent array (`0x5a8ff8` on B7) | M11-02 |
| `game.party` | party members, heroes and their behaviour and builds, henchmen; account heroes | M11-03 |
| `game.skills` | own skill bar and recharge; effects on you | M11-04 |
| `game.vitals` | below | M11-05 |
| `game.progress` | unlocked maps, missions (normal and hard), skills, titles | M11-06 |
| `game.social` | friends and presence, whispers in and out, names seen in chat | M11-07 |

`game.target`, `game.skills` and `game.vitals` are withheld in PvP battle maps (v1 parity; `regions`, spec 04).

**`game.vitals` (OD3).** One entry for you, then one per hero of yours in party order (spec 04 §5.2). Henchmen and
other players are not in api 1. GWCA leads for the native client, to prove for the WASM client: AgentLiving health
fraction `+0x130`, energy fraction `+0x11C` and max energy `+0x120` (your agent), casting skill id `+0x1B4`, dead =
effects bit `0x10` or type-map bit `0x8`, hero energy in MapAgent, morale in WorldContext `+0x624`/`+0x62C` (or the UI
morale-change message).

- `energy = Math.round(fraction × max)` where both exist; else `energy` and `energyMax` are null.
- `casting.since` = EpochMs of the first read that saw that skill id on that agent; a new id or a read without casting
  restarts it. Precision is one read (100 ms at 10 Hz).
- Withheld while loading too. Display only (rule 5).

## 5. Action path

### 5.1 Steps

| # | Where | Step |
| --- | --- | --- |
| 1 | Hub | A trusted press (spec 01 §2) on a `GameAction` element, a game `ItemAction` of a row (it has no `shortcut`), the Hub row of a command with a static `game`, a confirm-sheet button, or Enter in a single-line input of a `Form` (it presses the Form's first `GameAction`, spec 09); or a `hub.command` event (Main matched the shortcut with `isAutoRepeat === false` while a session is open, spec 11) for a command with `game`. A command row comes from the manifest in `GamePluginState`, so no worker starts (P46). Row-action shortcuts never run game actions. |
| 2 | Hub | Builds the `ActionRequest`. Command: `from: { command }`. Otherwise `from: { target, op, args, hostInput }` from the `$game` intent: each `{ $field: key }` takes the current value of the input with that `field` key in the same root (spec 09); those keys go into `hostInput`. |
| 3 | Hub | Local checks, in order; the first failure shows its text on the control (or as the receipt of a Hub row or shortcut) and stops: op not granted (`not-permitted`), op in `off` (`unsupported`), `game.map` is `loading` (`loading`), area not in the op's `regions` (`restricted-area`; for a chain: area not `outpost`), `available()` returns text, an input the op needs is empty (`empty-input`). A command checks every step. |
| 4 | Hub | Confirm sheet when the descriptor guard trips (5.2) or `confirm()` returns text (chain: any step). Only the sheet's own confirm press continues; it runs step 3 again. |
| 5 | `GameBridge.act` | Refuses `busy` if an action of this session runs (§7.3). For each `or-social` key not in `hostInput`, the value must be a friend `character` or whisper `name` in the last `game.social` value the publisher sent to that install's host for this sid, else `invalid`. Neither check calls Main. |
| 6 | Main | `plugin.action.authorize` → `authorize()` (§6). Returns `{ ok, action, steps }` or a typed refusal. |
| 7 | executor | Runs the steps (§7; chains §8), calls `onProgress` (§7.4), sends one `plugin.action.report` per step that ran or stopped the run. |
| 8 | Hub | Shows the receipt (5.3). For `from.target` of a `local` install it sends `result { target, sign, result }` to the worker. Commands and `internet` installs get nothing. |

Refusals in steps 3 to 5 never reach Main and are not logged. A drop on a `DropZone` is never a press.

### 5.2 Descriptor guard and confirm sheet

- The descriptor of a pressable game control is `{ installKey, op, args, label }`, each `$field` kept as the string
  `"$field:<key>"`, compared by value. The Hub keeps `changedAt` per control (element node id, or row id plus action
  index). It moves when the descriptor changes and when the selection lands on a control without player input (the
  selected row vanished). A control that appears in a player-caused update (answers to the player's newest query, the
  first batch of a view the player opened) does not count as changed.
- A press with `now − changedAt < budgets.hub.descriptorGuardMs` opens the confirm sheet instead.
- The sheet: title = the label (a chain: the command title and numbered steps); body = the `confirm()` texts, or "This
  changed just before you pressed it." for the guard; buttons "Run" and "Cancel"; presses are ignored for
  `budgets.hub.confirmArmingMs` after it opens. Hub closed (shortcut press): it opens over the game. Layout: [spec 10](10-hub-hud-panels.md).

### 5.3 Texts

Receipt lines (label = `describe()`; a chain: the command title; layout and "2/4": spec 10):

| Moment | Text |
| --- | --- |
| running | `<label>…` |
| done | `<label>: done` |
| refused | `Not sent: <message>` |
| failed | `<label>: <message>` |

Refusal messages are `REFUSAL_TEXT` and `regionText()` (spec 04 §3). `failed` messages come from the executor:

| Cause | `message` |
| --- | --- |
| no effect within `effectTimeoutMs` | `The game did not show the result in time` |
| a game call returned `rejected` | `The game did not accept it` |
| the session closed during the run | `Stopped: the character left the world` |
| player input, Cancel or Escape during a host flow or chain | `Stopped after <k> of <n> steps` |

## 6. Main authority

### 6.1 `authorize()`

```ts
// packages/sdk/src/host/actions.ts (plain function; P43 table tests it directly)
import type { ActionId, CapabilityId, JsonValue, Manifest, Refusal } from "./index";

export type Origin = "player" | "agent";
export type AuthorityInput = {
  readonly openSid: number | null;                     // the sender window's open session
  readonly install:
    | { readonly enabled: boolean; readonly manifest: Manifest; readonly granted: ReadonlySet<CapabilityId> }
    | undefined;                                       // granted = requested ∩ granted, not withdrawn
  readonly off: ReadonlySet<CapabilityId>;             // off(build) of the sender window (§3.3)
  readonly origin: Origin;                             // §6.2
  readonly qaDestination: (mapId: number) => boolean;  // §6.2
  readonly lastStart: (op: ActionId) => number | undefined; // this install, this sid
  readonly now: number;
};
export type Step = { readonly op: ActionId; readonly args: JsonValue };
export function authorize(request: ActionRequest, input: AuthorityInput):
  | { readonly ok: true; readonly steps: readonly Step[] }
  | { readonly ok: false; readonly reason: Refusal; readonly message: string };
```

Checks in order; the first failure decides:

1. `request.sid !== openSid` → `invalid`.
2. No install, or not enabled → `not-permitted`.
3. Steps: `from.command` → that manifest command's `game` (`{ op, args }` gives one step, `{ steps }` gives those); no
   such command, or no `game` → `invalid`. `from.target` → one step.
4. Each step in order: op not in `granted` → `not-permitted`; op in `off` → `unsupported`; args fail the catalog
   `args` schema, `hostInput` not a subset of the entry's `inputs` keys (or a `required` key missing), or several steps
   with a non-`chainable` op → `invalid`.
5. Origin `agent`: a step fails the QA allowlist (6.2) → `agent-blocked`.
6. A step with `now − lastStart(op) < minIntervalMs` → `rate` (`lastStart` is the state before this request, so steps
   of one chain never count against each other). Else `{ ok: true, steps }`.

The handler (`authority.ts`, M4-07) builds the input from Main's stores and calls `authorize()`. On ok it assigns the
action id (positive, +1 per app run), records `now` as the last start of every step's op for that (install, sid) and
answers `{ ok: true, action, steps }`. Every call appends one action-log entry ([spec 12](12-consent-grants-and-updates.md);
Activity: [spec 14](14-main-data-and-network.md)); each `plugin.action.report` adds its step result. `message` is
`REFUSAL_TEXT[reason]`, except a kill switch's own text for `unsupported` (spec 15).

### 6.2 Origin and QA allowlist

- Agents get no wider path than players. `origin` is `"agent"` for **every** action of an app run started with the QA switch, else `"player"`: CDP input is
  trusted in the page, so the page cannot tell an agent from the player. The switch is `pnpm dev --qa`, which sets env
  `MOXI_QA=1`. Main honours it only when `app.isPackaged` is false (packaged builds refuse the flag) and then writes
  `"qa": true` into `cdp.json` next to the CDP port. The `moxi-dev` MCP (M10-01) starts the Dev app with it and
  refuses to act on a Dev app whose `cdp.json` lacks it.
- The MCP acts only through app UI (Hub rows, `GameAction` controls) with CDP input, so its presses take §5.1 and
  reach Main as agent actions; there is no second entry to the executor. CDP keys never reach `before-input-event`, so
  manifest shortcuts are out of an agent's reach (spec 11).
- Allowlist, from AGENTS "Live game sessions":

| Op | Agent | Rule |
| --- | --- | --- |
| `game.travel` | allowed | `{ guildHall: true }`, or a `mapId` for which `qaDestination` is true: its reference `maps` row (spec 14) is an outpost or town and not a PvP map. Without reference data: refused. No map-type watch is needed (regions plus this check) |
| `game.builds.load`, `game.team.apply`, `game.storage.open` | allowed | – |
| `game.whisper`, `game.party.invite` | refused | messages and invites to players |
| `game.resign` | refused | missions |
| `game.target.call` | refused | combat, and it calls to the party |

- A chain passes only when every step passes. Pace (2 s between agent actions) and "player input pauses the agent" are
  MCP rules (M10-01); `minIntervalMs` still applies.

## 7. Executor

### 7.1 Game calls

```ts
// packages/gwkit/src/game/calls.ts (M5-08 on fixture-actions; M11-08, M11-09, M11-12 live)
export type CallOutcome = "sent" | "rejected" | "unsupported";
// sent: the game took the call. rejected: the game refused it. unsupported: no role for this build.
export type GameCalls = {
  travel(to: { readonly mapId: number } | { readonly guildHall: true }): Promise<CallOutcome>; // any district
  loadTemplate(on: "self" | { readonly heroAgentId: number }, code: string): Promise<CallOutcome>;
  addHero(heroId: number): Promise<CallOutcome>;
  kickHero(heroId: number): Promise<CallOutcome>;
  setHeroBehaviour(heroAgentId: number, behaviour: "fight" | "guard" | "avoid"): Promise<CallOutcome>;
  openStorage(): Promise<CallOutcome>;
  whisper(to: string, body: string): Promise<CallOutcome>;
  invite(name: string): Promise<CallOutcome>;
  resign(): Promise<CallOutcome>;
  callTarget(): Promise<CallOutcome>;
  printChat(line: string): Promise<CallOutcome>; // §9: your own chat log only; nothing is sent
};
export function createCalls(runtime: Runtime, values: Readonly<Record<string, number>>): GameCalls;

// packages/gwkit/src/game/template.ts (M5-08): the Guild Wars skill template format
export function decodeTemplate(code: string): {
  readonly primary: number; readonly secondary: number;
  readonly attributes: readonly { readonly id: number; readonly points: number }[];
  readonly skills: Uint32Array; // 8 slots, 0 = empty
} | null;
```

- A call starts only inside a safe-point callback, else it throws (an invariant). Each goes through the tracked
  promising wrapper of the game's own async exports, so no safe point fires before it settles (P47).
- PB18b (P48) decides whether a call uses an injected export or the game's work queue; the interface does not change.
  The real client has calls only after the export-only patches (M11-12); until then every action is `unsupported`.
- `decodeTemplate` ports v1's knowledge (`gwonmac/src/shared/builds/skill-template.ts`), not code.

### 7.2 Executor table

```ts
// apps/game/src/actions.ts (M5-08): `GameBridge.act`, this table, the chain runner, input cancel
import type { ActionArgs, ActionId, FactId, HostFacts, Refusal } from "@moxi/sdk/host";
import type { CallOutcome, GameCalls } from "@moxi/gwkit";

type CallStep = {
  readonly run: (calls: GameCalls, facts: HostFacts<FactId>) => Promise<CallOutcome>;
  readonly seen?: (facts: HostFacts<FactId>) => boolean; // wait for this before the next call
};
type Executor<O extends ActionId> = {
  readonly watch: readonly FactId[]; // host reads while it runs (§4.1)
  plan(args: ActionArgs<O>, facts: HostFacts<FactId>): readonly CallStep[] | { readonly refused: Refusal };
  done?(args: ActionArgs<O>, facts: HostFacts<FactId>): boolean; // absent: done once every call was sent
};
export const executors: { readonly [O in ActionId]: Executor<O> };
```

| Op | `watch` | Calls | `done` when |
| --- | --- | --- | --- |
| `game.travel` | `game.map` | `travel(args)` | the state went through `loading` and is `in-world`, and `mapId` equals `args.mapId` (Guild Hall: `guildHall` is `"here"`) |
| `game.builds.load` | `game.party` | `loadTemplate(on, code)`, `on` = `"self"` or `{ heroAgentId }` of the hero with `heroId`. `decodeTemplate` returns null, or the hero is not yours in the party → refused `invalid` | the member's `build.skills` equals the template slot by slot, where `0` on the bar matches any template skill (a skill you have not unlocked stays empty) |
| `game.team.apply` | `game.party` | in this order: `kickHero` for each hero of yours not listed (unlisted heroes leave), and for each listed hero from the first position where the party order differs; `addHero` for each listed hero not in the party, in list order; `setHeroBehaviour` where `behaviour` is given and differs; `loadTemplate` for each hero `code`; `loadTemplate("self", self)`. Calls already satisfied at plan time are left out. A full party fails the step (live check in M11-08). `seen` per call: the hero is gone, is present, has the behaviour, has the build | your heroes in the party equal the list, in order, with those behaviours and builds, and your build equals `self`. Henchmen are not touched |
| `game.storage.open` | – | `openStorage()` | sent (no fact shows an effect; done once the game took the call) |
| `game.whisper` | `game.social` | `whisper(to, body)` | `whispers` has a new `out` entry with `name === to` and `text === body` |
| `game.party.invite` | – | `invite(to)` | sent |
| `game.resign` | – | `resign()` | sent |
| `game.target.call` | – | `callTarget()` | sent |

### 7.3 Run rules

- **Busy.** One action or chain runs per session (one per game window). A press while one runs is refused `busy` in
  `GameBridge.act`, before Main, so a double press gives one call (P44). Notes are not actions.
- **Before the first call**, at a safe point: state `loading` → `refused loading`; area not in the op's `regions` →
  `refused restricted-area`; op in `off` → `refused unsupported`; args fail the catalog schema → `refused invalid`;
  `plan()` may refuse too. A later call of the same action waits while the state is `loading`.
- **Calls.** One per safe point, in plan order. `unsupported` → `refused unsupported`; `rejected` → `failed`. After a
  call with `seen`, the next call waits for `seen`.
- **Effect.** After the last call, `done` is checked at each safe point; `effectTimeoutMs` (spec 05 §4.1) runs from the
  first call, no `done` by then → `failed`. Session close during a run → `failed`, no further call.
- **Cancel.** `ActOptions.signal` (Cancel or Escape in the Hub, spec 10) and player game input stop every call and
  step not started; the result is `failed`, "Stopped after k of n steps" (k = calls of a host flow, or steps of a
  chain, that finished).
- **Player game input** = a trusted `keydown` (not Shift, Control, Alt, Meta or AltGraph alone), `pointerdown` or
  `wheel` whose target is outside `#hub-root`, while a host flow or chain runs. The shortcut that started a chain
  never counts: Main swallows it.

### 7.4 Progress

```ts
// packages/sdk/src/host/actions.ts
export type StepState =
  | { readonly state: "pending" }
  | { readonly state: "running"; readonly calls: { readonly done: number; readonly total: number } }
  | { readonly state: "finished"; readonly result: ActionResult }
  | { readonly state: "skipped" }; // not started: an earlier step stopped the run, or the player cancelled
export type ChainProgress = {
  readonly action: number; // ActionDecision.action
  readonly steps: readonly { readonly label: string; readonly status: StepState }[]; // label: describe(args)
};
```

`onProgress` gets the whole value at the start, on every change and at the end, for a chain and for an action with more
than one call (team apply "5/16"); one call gets none.

## 8. Chains

1. Declared only in the manifest (spec 04 §8.4), e.g. `"game": { "steps": [{ "op": "game.travel", "args": { "mapId": 449 } },
   { "op": "game.team.apply", "args": { "heroes": [{ "heroId": 1, "behaviour": "guard" }] } }] }`: 2 to
   `budgets.install.chainSteps` chainable steps with static args. They run from the command's Hub row or its shortcut,
   never from a view, `act()`, a HUD widget or a drop.
2. Hub step 3 checks every step; the area must be `outpost` (outposts, towns, Guild Halls, PvP outposts included),
   whatever each op's own `regions` allow. Main authorizes the whole chain before step 1 (§6.1); `minIntervalMs` per
   step op counts earlier presses only.
3. One run, steps in order. Before each step, at a safe point, the executor waits while the state is `loading`, then
   needs area `outpost`, else that step ends `refused restricted-area` with `regionText(["outpost"])`. The step then
   runs as in §7.
4. The chain stops at the first step whose result is not `done`; later steps are `skipped`. Player game input, Cancel
   or Escape stops it too (§7.3); a step whose call started finishes.
5. Result: `done` when every step is `done`; else the stopping step's result, or `failed` "Stopped after k of n steps"
   on a cancel. No plugin receives it.
6. Progress as `ChainProgress` ("2/4", spec 10). One `plugin.action.report` per step that ran or stopped the chain
   (spec 07); Main logs the chain and each step.
7. A chain is one action for `busy`. Page lines and the update rule for chains: spec 12.

## 9. Notes (`game.note`)

1. Worker: `useNote()` (spec 08) posts `note { sid, text, chime }`; the membrane sends the `plugin.note { installKey,
   sid, text, chime }` invoke (spec 07). Main checks grant, kill switch and rate.
2. Main (`apps/desktop/src/plugins/notes.ts`, M11-09: checks, cleaning, buckets, queues), in order: host binding and open sid (spec 07 rule 3); install not
   enabled or `game.note` not granted → `not-permitted`; `game.note` in `off(build)` → `unsupported`.
3. Line = `"[" + manifest name + "] " + text`. First every UTF-16 unit outside printable ASCII becomes `?`, and so do
   `<` and `>`, which start game markup (v1 `chat-print.ts`); runs of spaces become one. Then the line is cut to
   `budgets.note.chars` by spec 05 rule 7, with the ASCII cut mark `...` (not `…`). A line with no text after cleaning
   answers `{ ok: true }` and prints nothing.
4. Rate: one bucket per (install, game window), capacity 1, refill `budgets.note.perSecond`. A note without a token
   waits in a FIFO per (install, window) of at most `budgets.note.queued`; a note that finds it full is dropped,
   answered `{ ok: false, reason: "rate" }` and counted in Activity (spec 14). Otherwise the answer is `{ ok: true }`.
   A session close drops that session's waiting notes (P84).
   When a token is free, Main sends the `game.note { installKey, text: line, chime }` event (spec 07 §4) to the session's
   window.
5. Game renderer (`apps/game/src/notes.ts`, M11-09): a FIFO; at most one `printChat(line)` per safe point; `unsupported` or
   `rejected` drops the line silently. With `chime`, it plays one tone when it hands the line over: an 880 Hz sine
   through WebAudio, gain 0.08 falling exponentially to 0.001 over 250 ms. A chime within 1,000 ms of the last one
   merges into it (v1 `reminder-chime.ts`). These sound values live in the component.
6. `game.note` is not a game action: it needs no press, may follow any fact (`game.vitals` included), works for
   `internet` installs and in QA runs, and never reaches another player.

## 10. CI stand-ins and live gates

**fixture-world** (M5-01, `tools/fixture-client/world/`):

- A generator writes a fixture client whose memory holds every struct the readers need and whose functions carry the
  witness instructions, plus the role spec and locator. Build A and build B: B shifts every offset and breaks one role,
  so only that capability is unsupported (P51). Game states `login`, `character-select`, `loading`, `in-world`; areas
  outpost, explorable, pvp; deterministic values for every fact; vitals for you and three heroes.
- Test hook, defined only by the fixture glue (the real client never has it):

```ts
// tools/fixture-client/world/hook.ts
type RecordedCall = { readonly call: keyof GameCalls; readonly args: unknown; readonly inFlight: number; readonly frame: number };
interface FixtureWorld {
  set(patch: Partial<FixtureScenario>): void;        // applied to memory at the next frame
  calls(): readonly RecordedCall[];                  // fixture-actions recorder
  reads(): Readonly<Record<string, number>>;         // P49 read counter per fact id
  countRead(fact: string): void;                     // called by the publisher (§4.1)
  effect(call: keyof GameCalls, mode: "apply" | "reject" | "ignore"): void; // default "apply"
}
// FixtureScenario: game state, map (id, area, district, Guild Hall), one value per fact (spec 04 §5.2); M5-01 owns the fields.
```

**fixture-actions** (M5-02): one export per `GameCalls` member behind the tracked promising wrapper. Each records
`{ call, args, inFlight, frame }` (`inFlight` = fixture async exports running then) and, in mode `apply`, changes
fixture-world memory 3 frames later (travel: `loading` for 3 frames, then the new map). `reject` returns `rejected`;
`ignore` returns `sent` and changes nothing (timeout tests).

**Live gates.** After review R1, live session 1 with Matthias: PB18a read spike (P53), then PB18b one action, travel
between two outposts (P48). Each M11 slice then checks its facts against the game screen and runs its actions once
live, within the AGENTS live rules; resign and call target are checked by Matthias.

## 11. Decisions

| Decision | Reason | Rejected |
| --- | --- | --- |
| Main authorizes every action from every origin | one choke point for grants, kill switches, QA allowlist, rate and the log | the executor deciding alone from pushed grant copies; Main tickets plus an input witness |
| Delete plugin-held activation tokens and imperative `travel()`/`loadBuild()` | a token proves "the player clicked something", not "the player agreed to this action" | binding tokens to nodes |
| Static manifest ops and chains run without plugin code | a static op cannot be a confused deputy | a command callback returning op and args; plugin args within a time window |
| Chains: authorized whole, one host flow, outposts only, stop at first failure, player input cancels | multi-step quality of life with one consent per run | plugin-sequenced actions |
| Effect predicates per op in the executor; "sent" for ops no fact shows | `done` means seen where the game shows it, nothing invented elsewhere | a predicate in each catalog entry; `done` on every sent call |
| Player game input cancels the rest of a chain or host flow | player input always wins (AGENTS) | finishing the run regardless |
| Origin from a QA run switch; the MCP acts only through app UI | a renderer cannot claim an origin; no second path into the executor | an `origin` field in the request; detecting a CDP attach per window |
| Support from role-name prefixes, one `off(build)` list | Main's page and the game side agree from one rule | a per-capability role table in code |
| A locator from local matching turns facts on and actions off | a wrong action costs more than a missing readout | actions on matched locators |
| Notes: Main checks, cleans and paces; the game renderer prints at the safe point | Main holds grants, kill switches and rate in one place | the game renderer checking grants |

## 12. Today in code (main 848fb6e) and what changes

| Today | Where | Becomes |
| --- | --- | --- |
| 3 s activation tokens, permission check, `busy` per op, in the plugin host | `apps/plugin-host/src/plugin-host.ts:333-341`, `:350-395` | deleted; §5, §6, §7.3 |
| Imperative `loadBuild`, `travel`; one `activation` slot | `packages/sdk/src/game.ts:48-54`; `packages/sdk/src/runtime.ts:27,33-37,74-75` | deleted in M6-03; `act()` returns data |
| `gameAction` answered `refused unsupported`; one `unsupported` message for player, target, map | `apps/game/src/hub/client.ts:11-13`, `:27-41`, `:42-44`; `hub/main.ts:31-35` | `GameBridge.act` in `actions.ts`; `facts.ts` |
| Safe point tracks five named exports; its only user is the health report; no `game/` in gwkit; fixture client has one memory page | `packages/gwkit/src/runtime/index.ts:1-7`, `:88-91`; `apps/game/src/index.ts:80`; `tools/fixture-client/client.wat` | every promising export; game state, publisher, executor, notes (§3, §4, §7); fixture-world, fixture-actions (§10) |
| 46 roles, `kind` and `signature` only; locator `values` `{}` | `compat/roles/v1-october.jsonc`; `compat/reference/1eb07332632e.json` | `compat/roles/game.jsonc` with prefixes and `reads` |
| Session = the game window's `webContents.id` | `apps/desktop/src/shell/main.ts:141-156` | `sid` from the game state (§3.1) |
| Dev sim refuses `loadBuild` outside outposts | `apps/game/src/hub/dev/game-sim.ts` | test-kit sim (spec 08); deleted in M6-03 |
| Chaos plugin `sneaky-travel` (token model) | `apps/plugin-host/test-fixtures/chaos/index.ts:14-21` | the P40 chaos plugin: timer, `onResult`, network callback, module code, synthetic and replayed events, foreign root, port forger |

## 13. Checked by

| Proof | What it checks here | Kind | Slice |
| --- | --- | --- | --- |
| P40 | executor calls = trusted presses, or chain steps of one press; every chaos source runs nothing | B + E | M5-08 |
| P41 | the control, hint, sheet and receipt all show the `describe()` label | B | M3-07 |
| P42 | descriptor change 100 ms before Enter → sheet; 600 ms → runs | B | M3-07 |
| P43 | `authorize()` decision table (N); stale grant copy in the game renderer and an agent travel to an explorable map (E) | N + E | M4-07 (N), M5-08 (E) |
| P44 | `restricted-area`, `loading`, `busy`; the recorder shows 1 call | N + E | M5-08 |
| P45 | `field()` value at press time; whisper body only from the input | B + E | M3-04, M3-07 (B), M5-08 (E) |
| P46 | static op: 0 worker messages; sheet first; 1 call per press | E | M5-08 |
| P47 | no safe point while an export is suspended; every call at `inFlight` 0; refused while loading | N + E | M5-05 |
| P49 | reads only for subscribed and granted slices; no message for equal values; typed arrays | E | M5-07 |
| P50 | witness reads on 7 builds | C | M5-11 |
| P51 | builds A and B; the broken role turns off one capability; "2 of 3 features" | E | M5-06 |
| P52 | catalog schema over reader output | N | M5-07 |
| P35 (E half) | a revoke stops the reads and refuses the next press | E | M5-07 |
| P81 | chains: order, stop, outposts only, cancel, no step without the press | N + E, Live | M1-03 (parse), M5-08, M11-10 |
| P82 | `game.vitals` on fixture-world: per agent, keyed by generation, withheld in PvP and loading | E, Live | M5-07, M11-05 |
| P84 | note rate (`budgets.note.perSecond`), queue (`budgets.note.queued`), overflow refused `rate` | E | M5-08 |
| P48, P53 | one live action; live reads | Live | live session 1 after R1 |

## 14. Deferred

- A "skill used" event fact (instant skills, back-to-back casts of one skill): after Beta.
- `game.inventory`: slice M11-13, only if Matthias says yes (Q7).
- A combined "travel and invite": two presses in 1.0 (the People plugin shows "Travel to <friend>", then "Invite
  <friend>"; no combined flow, no new catalog id; spec 04 §6.1).
