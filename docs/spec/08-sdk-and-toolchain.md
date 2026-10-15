# 08 SDK and toolchain

The public plugin API (`@moxi/sdk`), the test kit and simulator (`@moxi/sdk/testing`), the build
(`@moxi/sdk/vite`), the `moxi` CLI and `create-moxi-plugin`. Authors depend on all of it, so it is
additive within `api: 1`. Related: catalog and manifest 04, runtime 06, wire 07, elements 09, Hub 10.

## 1. Rules in force

1. Screens are components from `@moxi/sdk` (elements: spec 09), compiled at build time.
2. Collections are data: `List`, `Grid`, `Table`, `Chart` and Hub items take arrays. One row type,
   `ItemData`, serves Hub results, list rows, pins and previews.
3. Facts are `Readonly<Ref<Observed<T>>>`. Render something for every `Unavailable` reason.
4. Game actions are values. `act(op, args)` describes one; the host labels it, runs it on a
   trusted press (spec 01 §2) and reports the result. No SDK function runs one: not module code,
   timers, `onResult`, fact changes, network replies or `run` handlers. The catalog holds no
   combat or economy action (spec 04).
5. Chains exist only in the manifest (`commands[].game.steps`, spec 04) and run as host flows
   (spec 13). The SDK has no chain API.
6. Module scope is session scope: the runtime evaluates plugin code once per plugin session
   (spec 06). `globalThis` is shared by all sessions of an install, so a plugin keeps no state
   there; shared data lives in documents.
7. Composables run only in module scope or synchronously in `setup()`, so every subscription has
   an owning scope that ends it. Elsewhere they throw `TypeError("useFetch() must be called in
   module scope or in setup()")` with their own name; detection: `getCurrentScope()` is undefined.
8. Props carry values only: never HTML, CSS, class names or style objects. Functions inside row
   data (`run`, `push`, `onResult`) cross the wire as signs (spec 07).
9. A plugin never sees the account name, game pixels, HUD positions or another install's data.
10. Read or internet, never both (spec 04 §7). In an `internet`-class install `onResult` has
    type `never` and never runs.
11. Plugin UI stays in the game window as a Hub view or a panel (spec 10); no API opens an OS window.
12. `game.vitals` is a fact like any other: display only. `useNote` may react to any fact.

## 2. Entries and files

Package map, entries and import rules: spec 02. Entries by section: `@moxi/sdk` §3,
`@moxi/sdk/testing` §4, `@moxi/sdk/vite` §5, `@moxi/cli` (bin `moxi`) §6.1, `create-moxi-plugin`
§6.3. Files and their slices: §10.

## 3. `@moxi/sdk`

Types live in `host/sdk-types.ts`, which `@moxi/sdk` re-exports, with the ArkType schemas of
`Json`, `NetError`, `FeedStatus`, `RefQuery` and `RefRow` (spec 07 imports them).
Composable bodies are in `runtime/composables.ts` (mechanics: spec 06).

### 3.1 Definition

```ts
import type { Component } from "vue";
export function definePlugin(def: {
  commands?: { [K in CommandIdOf]?: Component }; // view and panel commands (no `game` op)
  hud?: { [K in HudIdOf]?: Component };
  hub?: {
    items?: () => readonly ItemData[]; // reactive; the host ranks them; changed rows only (spec 06 §7.4)
    answer?: (text: string) => readonly ItemData[] | Promise<readonly ItemData[]>;
  };
}): PluginDefinition; // returns its argument and does nothing else; works outside a session
declare const definition: unique symbol; export type PluginDefinition = { readonly [definition]: true }; // opaque
```

- `answer` gets the text after this plugin's scope word, digit-led text with `"numbers": true`,
  or all Hub text with `hub.search` granted (routing: spec 10 §2.3). Only the newest call counts;
  late answers are ignored (`hub.queryDeadlineMs`, `hub.answersPerQuery`: spec 05).

### 3.2 Types from the generated `Register`

`Register` and its helpers `RequestedId`, `GrantedFact`, `GrantedAction`, `CommandIdOf`,
`HudIdOf`, `SettingsOf`, `ClassOf` are spec 04 §10.1; without `moxi-env.d.ts` every id is allowed.
This spec adds:

```ts
type HostOf<P, Kind extends string> = P extends `${Kind}:${infer H}` ? H : never;
export type GrantedUrl = `https://${HostOf<RequestedId, "net">}/${string}`;
export type GrantedWss = `wss://${HostOf<RequestedId, "net">}/${string}`;
export type GrantedLink = `https://${HostOf<RequestedId, "link">}/${string}`;
type InternetClass = ClassOf extends "internet" ? true : false;
```

- An optional id is in `RequestedId`. Until the player grants it, the fact reads `not-permitted`
  and the action is disabled with `REFUSAL_TEXT["not-permitted"]`.
- If P22 shows that the conditional types give unclear editor errors, drop them and keep the
  build-time capability check (§5.4).

### 3.3 Composables

```ts
export function useFact<F extends GrantedFact>(id: F): Readonly<Ref<Observed<FactValue<F>>>>;
export function useDoc<T extends Json>(name: string, opts: { initial: () => T; scope?: "global" | "account" }): Doc<T>;
export function useSettings(): Readonly<Ref<SettingsOf>>;
export function useReference<K extends RefTable>(table: K): RefData<K>;
export function useFetch<T = unknown>(url: GrantedUrl, opts?: { every?: number; parse?: (body: unknown) => T }): Fetch<T>;
export function useFeed(url: GrantedWss): Feed;
export function useNavigation(): { push(view: Component, props?: Record<string, unknown>): void; pop(): void };
export function useToast(): (text: string, tone?: ToastTone) => void;
export function useNote(): (text: string, opts?: { chime?: boolean }) => void; // needs game.note
export type ToastTone = "neutral" | "good" | "bad";
```

| Composable | Behavior |
| --- | --- |
| `useDoc`, `useReference`, `useFetch`, `useFeed` | §3.5, §3.8, §3.9 |
| `useFact` | Reads `loading` until the first value arrives (spec 06 §7.2). Values are frozen copies; other sessions' facts never reach it. |
| `useSettings` | The values the player set on the plugin page (spec 12); manifest defaults until they arrive. Read-only. |
| `useNavigation` | `push` mounts `view` with `props` on top of the current Hub view or panel stack; `pop` goes back one level, as Escape does. Throws outside a component `setup()` (spec 06) and in a HUD widget: `"useNavigation() is not available in HUD widgets"`. |
| `useToast` | Host toast with a tone; no action button. Rate and length: spec 05 `hub.toast*`. |
| `useNote` | A self-only line in the game chat with an optional chime; no press needed. Without `game.note` granted a call does nothing; with it, the worker session opens at session open (spec 06). Main rate-limits, cleans (printable ASCII) and cuts the text with `...` (spec 05 `note.*`; path: spec 13). |

`ref`, `computed`, `watch` and the other allowed Vue names come from `vue`; the runtime supplies
session-aware versions (spec 06 §4.3, §7.3).

### 3.4 Results and JSON

`Observed`, `Unavailable`, `ActionResult`, `Refusal`, `Profession`, `MapArea`, `Vec2`, `EpochMs`,
`RefTable`, `FactId`, `ActionId`, `CapabilityId`, `FactValue`, `ActionArgs` and `IconRef` are
spec 04 §3, §4 and §9; `Tone`, `Block`, `SkillSlot` and `ElementTag` are spec 09. `@moxi/sdk`
re-exports them as types. `Json` is `null | boolean | number | string | readonly Json[] |
{ readonly [key: string]: Json }`.

### 3.5 Documents

```ts
export type Doc<T> = { readonly value: T; readonly pending: boolean; set(next: T): Promise<DocWriteReply> };
// DocWriteReply: `host/data.ts`, defined in spec 07 §3 (the one write reply; spec 14 §3.2 gives its use).
```

| Part | Rule |
| --- | --- |
| `name` | 1 to `docs.nameChars` characters (spec 05), else `useDoc` throws `TypeError` |
| `scope` | `"global"` (default): one value for all sessions of the install. `"account"`: one per game account; the host resolves the account from the session |
| `value`, `pending` | `value` is `initial()` until the stored value arrives; `pending` is true until then and while a write is in flight |
| `set(next)` | Shows `next` at once; on `ok: false`, `value` returns to the stored value. `conflict`: another window wrote first; `stored` is its value (`null`: no stored document). `quota`, `rate`: spec 05 `docs.*`. A `next` that is not JSON (for example `undefined`, `NaN`, a `Date`) makes `set()` reject with `TypeError` and sends nothing |
| Other sessions | Their writes arrive as changes; own writes are not echoed. A coalesced `set()` resolves with the result of the write that carried its value or a later one (spec 07 §8). `set()` resolves with the wire reply `DocWriteReply` (spec 07 §3; spec 14 §3.2) unchanged |

### 3.6 Game actions and host inputs

```ts
export function act<Op extends GrantedAction>(op: Op, args: IntentArgs<Op>): GameIntent<Op>;
export function field(key: string): FieldRef;
declare const brand: unique symbol;
export type FieldRef = { readonly field: string; readonly [brand]: "field" };
export type GameIntent<Op extends ActionId = ActionId> = { readonly op: Op; readonly args: IntentArgs<Op>; readonly [brand]: "intent" };
type InputsOf<Op extends ActionId> = (typeof ACTIONS)[Op]["inputs"]; // spec 04 §6.3
export type IntentArgs<Op extends ActionId> = ActionArgs<Op> extends infer A // distributes over union args
  ? A extends object ? { [K in keyof A]: K extends keyof InputsOf<Op>
      ? InputsOf<Op>[K] extends "required" ? FieldRef : A[K] | FieldRef : A[K] } : never
  : never;
```

| Function | Rule |
| --- | --- |
| `act`, `field` | Build values, check and run nothing, work outside a session. The runtime marks their results, so plugin code cannot forge one (spec 06 §4.2). Place an intent in an `ItemAction` `{ game }` or on `<GameAction>` (spec 09) |
| `field(key)` | `key` follows the `field` prop pattern (spec 09). A `FieldRef` is allowed only in the keys the catalog marks in `inputs` (`game.whisper` `body` and `to`, `game.party.invite` `to`); a `required` key takes nothing else. At press time the Hub reads the input with that `field` key in the same root (spec 09, spec 13); an empty input is refused `empty-input` |

### 3.7 Rows: `ItemData` and `ItemAction`

```ts
export type ItemData = {
  id: string; // stable and unique in its list: selection, pins and actions follow it
  title: string; subtitle?: string; icon?: IconRef;
  keywords?: readonly string[]; // extra words for host ranking
  accessories?: readonly { text?: string; icon?: IconRef; tone?: Tone; age?: EpochMs }[]; // age: host shows and ticks "2 min ago"
  skills?: readonly SkillSlot[]; // the host draws the skill strip (SkillSlot, Tone, Block: spec 09)
  section?: string; // group heading; the host keeps first-seen order
  preview?: readonly Block[];
  unavailable?: string; // the host shows it and disables game actions
  scope?: string; // Hub items only: shown only after this plugin's scope word
  actions?: readonly ItemAction[]; // actions[0] runs on Enter
};
export type ItemAction =
  | { game: GameIntent; onResult?: InternetClass extends true ? never : (r: ActionResult) => void }
  | { title: string; run: () => void | Promise<void>; shortcut?: Shortcut; tone?: "danger"; confirm?: string; icon?: IconRef; pressed?: boolean }
  | { title?: string; copy: string; shortcut?: Shortcut; icon?: IconRef; pressed?: boolean }
  | { title: string; push: Component; props?: Record<string, unknown>; shortcut?: Shortcut }
  | { link: GrantedLink; shortcut?: Shortcut }
  | { wiki: WikiRef; shortcut?: Shortcut }
  | { open: { plugin: string; item: string }; shortcut?: Shortcut } // plugin = manifest id
  | { search: string; shortcut?: Shortcut }; // fill-search: the Hub search text becomes `search`
export type WikiRef = { skill: number } | { map: number } | { item: number } | { profession: Profession };
export type Shortcut = string; // grammar: spec 11
```

| Topic | Rule |
| --- | --- |
| Presses | What a press does, the labels and the sheets: spec 10 §1.5. `game`, `link`, `wiki`, `open` and `search` carry no plugin title (§8) |
| Plugin code | Runs only for `run` (`run`), `push` (the pushed component) and `game` (`onResult`, local class only). `game` needs the action's grant; `link` needs `link:<host>` |
| `shortcut` | A Hub-local row shortcut. It never runs a `game` action, and the `game` kind has none (spec 01 §2, spec 10 H14) |
| Slices | `skills`, `section` are first drawn by M3-03 (Builds); `age`, `icon`, `pressed` by M13-03 (Trade). The SDK type gains each field in the slice that draws it |
| Wire form | Checked by `decodeRows` (spec 07 §6.4): an `ItemData` crosses as a `Row`; `run` and `onResult` as `$fn`, `push` with `props` as `$view`, `game` as `$game`, all else JSON. A row is `malformed` when `id` or `title` is not a non-empty string, a key is not in the type above, a value has the wrong type, or an action has no kind key or more than one of `game`, `run`, `copy`, `push`, `link`, `wiki`, `open`, `search`, or keys of another kind |
| After 1.0 | A row field or action kind added later gets a `since` in spec 04's `SDK_SINCE` under `ItemData.<field>` or `ItemAction.<kind>` |

### 3.8 Reference data

```ts
export interface RefRows {
  skills: { id: number; name: string; profession: Profession | null; attribute: string | null; elite: boolean };
  maps: { id: number; name: string; region: string; kind: MapArea }; // MapArea: spec 04
  items: { id: number; name: string }; professions: { id: Profession; name: string };
  heroes: { id: number; name: string; profession: Profession };
}
export type RefRow = RefRows[RefTable];
export type RefSearch<K extends RefTable> = { limit?: number; offset?: number } & (K extends "maps" ? { kind?: MapArea }
  : K extends "skills" ? { profession?: Profession; elite?: boolean } : {});
export type RefQuery = { ids: readonly (number | Profession)[] }
  | { text: string; limit: number; offset: number; filter: RefSearch<RefTable> };
export type RefData<K extends RefTable> = {
  get(id: RefRows[K]["id"]): RefRows[K] | undefined; // reactive cache
  search(text: string, opts?: RefSearch<K>): Promise<readonly RefRows[K][]>;
};
```

| Member | Rule |
| --- | --- |
| `get` | Returns `undefined` until the row is loaded, then re-renders. All misses of one tick go to Main as one `{ ids }` query (`plugin.ref.query`, spec 07; rate `reference.*`, spec 05). Loaded rows stay cached for the worker's life |
| `search` | Ranks in the reference service (spec 14). `limit` defaults to `reference.defaultRows`, at most `reference.pageRows` (spec 05); `offset` (default 0) skips that many ranked rows. A `rate` refusal rejects the promise with `Error("rate")` |
| Rows | Names are English; icons go through `IconRef` (`{ skill: id }`), never image bytes. The row fields above are the 1.0 set; M11-01 may add fields (additive) |

### 3.9 Network

```ts
export type Fetch<T> = { readonly data: T | undefined; readonly error: NetError | undefined; readonly pending: boolean; refresh(): void };
export type Feed = { readonly messages: readonly string[]; readonly status: FeedStatus };
export type FeedStatus = "connecting" | "open" | "reconnecting" | "not-permitted" | "rate";
export type NetError = { readonly kind: NetErrorKind; readonly message: string; readonly status?: number };
export type NetErrorKind = "not-permitted" | "rate" | "offline" | "address" | "timeout" | "too-large"
  | "redirect" | "status" | "content-type" | "parse";
```

| Part | Rule |
| --- | --- |
| `useFetch` | A subscription. Main polls once per (install, URL) at `max(every, net.pollFloorMs)` and serves every session from one cache (spec 14); rate limits are per install, the cache per (install, URL). Without `every`: one request on first use. `refresh()` asks again under the same rules |
| Response | Main sends the text and its media type (`type`). The worker parses `application/json` and `*+json` with `JSON.parse`; other types stay strings. Then `parse(body)` runs if given; a throw sets `kind: "parse"`. `data` keeps the last good value when a later request fails |
| `error` | `message` is host wording; `status` is set only for `kind: "status"` (a non-2xx answer). `NetErrorKind` is the one list: specs 05 and 14 use it and map Main's refusals onto it |
| `useFeed` | `messages` holds the newest `feed.keptMessages`, oldest first (spec 05). Main reconnects with backoff; `status` shows it |

### 3.10 Exports and outside a session

`SdkExport` names (`since` values: spec 04 `SDK_SINCE`): `definePlugin`, `act`, `field`,
`useFact`, `useDoc`, `useSettings`, `useReference`, `useFetch`, `useFeed`, `useNavigation`,
`useToast`, `useNote`. The elements are in the registry (spec 09). The runtime's `sdk` keys are
exactly these names plus the elements (spec 06 §4.2).

In plain Node (not through the runtime), `definePlugin`, `act` and `field` work; each composable
throws `Error("useFact() runs only inside a plugin session. Test with mountPlugin from
@moxi/sdk/testing.")` with its own name; element components render nothing.

## 4. Test kit and simulator: `@moxi/sdk/testing`

### 4.1 Rules

- The kit runs a plugin as the host does: the built function body (§4.2), called once per
  session, on `createRuntime` in process (spec 06 §3.4), two sessions by default. A session's
  worker starts as in the host (spec 06).
- Vue runs with production error semantics: `moxi()` in Vitest sets `test.env.NODE_ENV =
  "production"` and leaves `@vue/*` external, so Node loads `runtime-core.cjs.prod.js`. M2-05
  proves it with the spec 06 watcher case.
- The kit has no decision logic of its own. Every accept, refuse, truncate and label decision
  calls the function the host calls, from `@moxi/sdk/host`: `parseManifest`, `checkHost` and the
  catalog (spec 04), `budgets` (05), `worker-guard` (06), `decodeRows` and the root decoder
  (07), `serializeTree` and the tree (§4.5), `routeQuery` (`host/routing.ts`, spec 10),
  `pageModel` (12) and `authorize` (`host/actions.ts`, spec 13). `packages/hub` and Main import
  the same pure functions. P69 proves the parity.
- No real waiting: each method resolves after `settle()` (no scheduled flush, no unacked batch,
  no pending document, reference or network reply). Plugin timers and the answer deadline use
  the global clock, so `vi.useFakeTimers()` controls them. No network, Main or Electron:
  documents, settings, grants, network replies and the game come from mount options and `sim`.

### 4.2 Loading a plugin

`import plugin from "./plugin?moxi"`: in Vitest, `moxi()` resolves `<entry>?moxi`. It bundles
`src/plugin.ts` with the steps of `moxi build` (§5.1) and returns `export default { factory:
function plugin(__moxi, setTimeout, setInterval, clearTimeout, clearInterval) { … } }` with a
source map. Type: `PluginModule = { readonly factory: PluginFactory }` (`PluginFactory`: spec 06
§4.1). The repository's root Vitest config adds `moxi()` for `plugins/**`.

### 4.3 API

```ts
export function mountPlugin(manifest: unknown, plugin: PluginModule, opts?: MountOptions): Promise<TestHost>;
export type MountOptions = {
  game?: SimGame; // session 1; default sim.outpost({ mapId: 55 })
  sessions?: readonly SimGame[]; // 1 to 4 sessions, replaces `game`; default [game, sim.outpost({ mapId: 248 })]
  docs?: Record<string, Json>; // stored documents by name; an account document holds it for every account
  settings?: Partial<SettingsOf>; hud?: readonly HudIdOf[]; // hud: widgets the player turned on; default none
  deny?: readonly CapabilityId[]; // requested permissions the player switched off
  grant?: readonly CapabilityId[]; // optional permissions the player granted; other optional ids stay off
  net?: Record<string, NetReply>; // by exact URL; any other URL fails with kind "offline"
  feeds?: Record<string, readonly string[]>; // messages delivered after the feed opens
  results?: Partial<Record<ActionId, ActionResult>>; // force the executor's result (default §4.4)
  source?: "official" | "community" | "github" | "dev"; // default "dev"
};
export type NetReply = { status?: number; contentType?: string; body: string } | { error: NetErrorKind };
export type TestHost = SessionHandle & { // SessionHandle members act on session 1
  session(n: number): SessionHandle; // 1-based
  readonly gameActions: readonly { sid: number; op: ActionId; args: Json }[]; // executor calls in order, chain steps included
  readonly answerCalls: readonly string[]; readonly requests: readonly string[]; // requests: URLs Main would have fetched
  readonly toasts: readonly { sid: number; text: string; tone: ToastTone }[];
  readonly notes: readonly { sid: number; text: string; chime: boolean }[];
  readonly errors: readonly { sid: number; message: string }[]; // render and handler errors
  readonly status: "running" | "stopped" | "crashed"; // as the plugin page would show it
  doc(name: string, opts?: { account?: number }): Json | undefined; // account default 1
  setSetting<K extends keyof SettingsOf>(key: K, value: SettingsOf[K]): Promise<void>;
  setGrant(id: CapabilityId, on: boolean): Promise<void>;
  settle(): Promise<void>; unmount(): Promise<void>; // unmount ends every session
};
export type SessionHandle = {
  readonly sid: number; readonly game: SimControl;
  readonly roots: readonly { root: RootId; surface: "view" | "panel" | "hud"; id: string }[]; // RootId: @moxi/sdk/host, spec 01
  readonly hub: { // type routes like the Hub and resolves with this plugin's answer rows
    type(text: string): Promise<readonly RowSnapshot[]>; items(): readonly RowSnapshot[];
    press(rowId: string, action?: number): Promise<PressOutcome>;
  };
  openCommand(id: CommandIdOf): Promise<ViewHandle>;
  runCommand(id: string): Promise<PressOutcome>; // a manifest command with a static op or a chain
  hud(id: HudIdOf): ViewHandle | undefined;
  close(): Promise<void>; // the character leaves the world; the session ends
};
export type ViewHandle = {
  readonly root: RootId; tree(): string; // tree: §4.5
  rows(list?: number): readonly RowSnapshot[]; // nth collection in document order, default 0
  row(id: string, list?: number): RowSnapshot; // throws when absent
  press(rowId: string, action?: number, list?: number): Promise<PressOutcome>; // trusted press; default action 0 (Enter)
  click(label: string): Promise<PressOutcome>; // a Button, GameAction or Link by its visible label
  input(field: string, value: string | number | boolean): Promise<void>; // the player types into that input
  emit(target: { tag: ElementTag; nth?: number }, event: string, payload: Json): Promise<void>; // other events (spec 09)
  back(): Promise<void>; // Escape: one level
};
export type RowSnapshot = {
  id: string; title: string; subtitle?: string; section?: string; unavailable?: string;
  enter: string | null; // host words for Enter: the label of actions[0], or why it is disabled
  actions: readonly { label: string; disabled?: string; shortcut?: string }[];
};
export type PressOutcome =
  | { kind: "game"; result: ActionResult }
  | { kind: "chain"; results: readonly ActionResult[] } // one per step that ran
  | { kind: "sheet"; text: string; confirm(): Promise<PressOutcome>; cancel(): Promise<void> }
  | { kind: "disabled"; reason: string }
  | { kind: "run" } | { kind: "copy"; text: string } | { kind: "push"; view: ViewHandle }
  | { kind: "link"; url: string } | { kind: "wiki"; url: string }
  | { kind: "open"; plugin: string; item: string } | { kind: "search"; text: string };
```

- `mountPlugin` runs `parseManifest` and `checkHost` first and throws their error. Session n has
  `sid` n and account n unless its scene sets `account`. `press` and `click` are trusted presses;
  a `sheet` appears wherever the host shows one.

### 4.4 Simulator

```ts
export const sim: { outpost(init: SimInit): SimGame; explorable(init: SimInit): SimGame; pvp(init: SimInit): SimGame;
  loading(init?: Partial<SimInit>): SimGame };
export type SimInit = Partial<Omit<SimScene, "area">> & { mapId: number; facts?: FactOverrides };
export type FactOverrides = { [F in FactId]?: FactValue<F> | Unavailable };
export type SimGame = { readonly scene: SimScene; readonly facts: FactOverrides };
export type SimControl = {
  readonly scene: SimScene;
  update(change: Partial<SimScene>): Promise<void>; // e.g. { area: "loading" }, then { area: "outpost", mapId: 449 }
  setFact<F extends FactId>(id: F, value: FactValue<F> | Unavailable): Promise<void>;
};
export type SimScene = {
  area: MapArea | "loading"; mapId: number;
  unlocked: readonly number[]; // map ids; default every outpost in the fixture tables
  character: { name: string; primary: Profession; secondary: Profession | null; level: number }; // default "Mo Kai", warrior, monk, 20
  heroes: readonly number[]; // hero ids in the party; default []
  target: { id: number; name: string; kind: "foe" | "ally" | "npc"; position: Vec2 } | null; // default null
  position: Vec2; account: number; // defaults { x: 0, y: 0 } and the session number
};
```

| Part | Rule |
| --- | --- |
| Facts | `packages/sdk/src/testing/sim.ts` exports `simFakes: { [F in FactId]: (scene: SimScene, example: FactValue<F>) => FactValue<F> }`: each fake starts from the catalog entry's `example` and applies the scene. A fact without a fake is a type error (P32). Every produced value, overrides included, is checked against the catalog schema (P52); a failing override throws |
| Regions | Gating and precedence: spec 04 §3 (in `loading` every fact reads `loading`; a fact withheld on the scene's area reads `restricted-area`) |
| Executor | Without a `results` entry, an action that passes authorization, `available()` and its region rule returns `done`. `game.travel` then sets `mapId` (or enters the Guild Hall) and `area: "outpost"`; other actions change nothing. A chain runs each step through the same path and stops at the first result that is not `done` |
| Home | `sim` lives only in `@moxi/sdk/testing`; `moxi dev` imports it from there |
| Fixture tables | `testing/reference-fixture.ts` serves `useReference` and catalog `describe` labels: maps 55 Lion's Arch, 449 Kamadan, Jewel of Istan, 248 Great Temple of Balthazar, 857 Embark Beach, one explorable and one PvP map (ids, names and campaigns as regions from `gwonmac/src/shared/travel-destinations.ts`); about 20 skills over 3 professions (`gwonmac/src/shared/skill-catalogue.ts`); the 10 professions; 3 heroes. The kit keeps them after M11-01, so tests stay hermetic |

### 4.5 Host tree and serialization

`packages/sdk/src/host/tree.ts` is the retained host tree, shared by the applier in
`packages/hub` and the kit: it applies decoded batches (spec 07) and enforces the node, row and
retained budgets with their "not shown" outcomes (spec 05). `serializeTree(tree): string` writes
each element as `{ tag, props, events, children }` with sorted keys, event names instead of
signs, and no spaces. P9 compares this string between the kit and the fixture app.

## 5. Build: `@moxi/sdk/vite`

```ts
export default function moxi(opts?: { entry?: string /* default "src/plugin.ts" */ }): Plugin[];
```

Authors add `moxi()` (the default export of `@moxi/sdk/vite`) to `vite.config.ts` as `plugins:
[moxi()]` and no `vue()`: it contains `@vitejs/plugin-vue` (exact version) with the SDK's pinned
`@vue/compiler-sfc` as its `compiler` option and `bindingMetadata` in `compilerOptions`.

### 5.1 Pipeline

Every error is `<file>:<line> <message>`. A run reports every error of a step, then fails.

| Step | Does | Error example |
| --- | --- | --- |
| SFC compile, compile gate | plugin-vue with the pinned compiler; §5.2 | `src/Prices.vue:12 <div> is not available in plugins. Use <Stack>.` |
| Externals | §5.3 | `src/Prices.vue imports withModifiers from "vue", which plugins cannot use` |
| Capability check | §5.4 | `src/places.ts:4 uses useFact("game.target") but plugin.json does not request "game.target"` |
| Manifest | `parseManifest` (spec 04), read-or-internet included | `reads from the game (game.map) and connects to the internet (net:kamadan.gwtoolbox.com). A plugin can do one or the other.` |
| Definition | when `definePlugin`'s argument is an object literal: its keys against `plugin.json` | `plugin.json declares command "favourites", but definePlugin has no component for it`; `definePlugin has hub.items, but plugin.json "hub" does not set "items": true`; `definePlugin has hub.answer, but no text reaches it: add "scopes", "numbers": true or the hub.search permission` |
| Budgets | `code.codeBytes` and the manifest limits (spec 05) | `dist/index.js is 1.3 MiB; a plugin may use 1 MiB` |
| Derived fields, types, output | §5.5, §5.6; `dist/index.js` (function body), `dist/plugin.json` (with derived fields) | – |

### 5.2 Compile gate

A node transform in the template compiler plus checks of `<script setup>` and the SFC blocks.
Exact messages (P21):

| Construct | Message |
| --- | --- |
| lowercase tag other than `template`, `slot`, `component` | `<div> is not available in plugins. Use <Stack>.` |
| `v-html` | `v-html is not available in plugins. Use <Text>.` |
| `v-show` | `v-show is not available in plugins. Use v-if.` |
| event modifier (`@click.stop`, `@keyup.enter`) | `@click.stop: event modifiers are not available in plugins. The host handles keys and propagation.` |
| `<style>` block | `<style> is not available in plugins. Use tone, size and layout props.` |
| `class` or `style` attribute | `class is not available in plugins. Use tone, size and layout props.` |
| `<Teleport>`, `<Transition>`, `<TransitionGroup>`, `<KeepAlive>`, `<Suspense>` | `<Transition> is not available in plugins.` |
| `ref` on an element from `@moxi/sdk` | `ref on <List> is not available in plugins.` |
| unknown component | `<Foo> is not a known component. Import it or use an element from @moxi/sdk.` |
| custom directive | `v-focus: custom directives are not available in plugins.` |
| top-level `await` in `<script setup>` | `await in <script setup> is not available in plugins. Load data with useDoc, useFetch or useReference and show the pending state.` |

Suggestions for lowercase tags: `div`, `section` → `<Stack>`; `span`, `p`, `label` → `<Text>`;
`h1`–`h6` → `<Heading>`; `button` → `<Button>`; `a` → `<Link>`; `input` → `<TextField>`;
`textarea` → `<TextArea>`; `select` → `<Select>`; `img`, `svg` → `<Icon>`; `ul`, `ol`, `li` →
`<List>`; `table` → `<Table>`; `form` → `<Form>`; any other → `an element from @moxi/sdk`.
The last four rows exist because the runtime leaves out `KeepAlive`, `Suspense`,
`withDirectives` and `withAsyncContext` (spec 06 §4.3); the gate names the cause.

### 5.3 Externals and output

| Part | Rule |
| --- | --- |
| `vue`, `@moxi/sdk` | Imports become reads of `__moxi.vue` and `__moxi.sdk` (spec 06 §4.1). A `vue` name that `src/runtime/vue.ts` does not export (spec 06 §4.3) or an `@moxi/sdk` value name not in §3.10 or the element registry fails the build. P21's names: `Transition`, `TransitionGroup`, `vModelText`, `vShow`, `withKeys`, `withModifiers` |
| Others | Type-only imports are erased; other npm packages are bundled into the plugin. Failing imports: `node:*` and Node built-ins, `@moxi/sdk/host`, `/runtime`, `/testing`, `/vite`, CSS, images and other assets: `src/x.ts imports "node:fs", which plugins cannot use` |
| `dist/index.js` | A function body: no `import`, `export`, `import()` or top-level `await`; it reads `vue` and `@moxi/sdk` only from `__moxi`; its last statement returns the `PluginDefinition`. The boot module wraps it (spec 06 §3.2). ES2023, minified, no source map. The same sources and SDK version give the same bytes |

### 5.4 Capability check

On the bundled module graph, every direct call of an `@moxi/sdk` import (aliases followed):

| Call | First argument must be | And `permissions` or `optional` must hold |
| --- | --- | --- |
| `useFact(id)`, `act(op, …)` | a string literal | that id |
| `useFetch(url)`, `useFeed(url)` | a literal, or a template literal that is literal up to the first `/` after the host | `net:<host>` |
| `useReference(table)` | a string literal | – (recorded in `references`) |
| `useNote()` | – | `game.note` |
| `useDoc(name, …)`, `field(key)` | a string literal within §3.5 or §3.6 | – |

Messages: `uses act("game.travel") but plugin.json does not request "game.travel"` (same form
for every id); `useFact needs a literal id, like useFact("game.map")` (same form for every
call). The check helps authors; the host enforces grants regardless.

### 5.5 Derived fields and the compiler pin

| Part | Rule |
| --- | --- |
| Derived fields | `moxi build` writes them into `dist/plugin.json` only, never into the source (fields: spec 04 §8): `references` (the sorted tables passed to `useReference`), `minHost` (the highest `since` over everything the plugin uses; rule and sources: spec 04 §10.3) and `vueCompiler` (the exact `@vue/compiler-sfc` version that compiled the plugin) |
| Compiler pin | `@moxi/sdk` depends on one exact `@vue/compiler-sfc`, equal to `RUNTIME_VUE` (spec 04 §8.7; today 3.5.43). `checkHost` refuses a newer `vueCompiler` ("Needs a newer Moxi"): a newer compiler on an older runtime loses keyed identity of slot content. P19 runs every Vue bump with compiler 3.5.0 and the pinned compiler on the new runtime |

### 5.6 Generated types and pack

| Output | Rule |
| --- | --- |
| `moxi-env.d.ts` | Next to `plugin.json`, gitignored; it is `renderRegister(manifest)` (spec 04 §10.2). Rewritten at the start of every `moxi` command, every Vite build and dev server start, and on every `plugin.json` change. An invalid manifest leaves the old file and reports |
| `moxi pack` | Writes `dist/plugin.moxi` (`MoxiPackage`) and `dist/moxi-release.json` from `dist/` (formats: spec 15). The same `dist/` gives the same bytes |

## 6. CLI, harness and template

### 6.1 `moxi` (`@moxi/cli`)

| Command | Does |
| --- | --- |
| `moxi dev [dirs…] [--port <n>]` | §6.2; default dir `.`, port 0 (a free port); prints `Moxi dev: http://127.0.0.1:<port>/` |
| `moxi check` | `vue-tsc --noEmit`, then every §5.1 step without writing `dist/` |
| `moxi build` | §5.1 → `dist/index.js`, `dist/plugin.json` |
| `moxi pack [--watch]` | `moxi build`, then §5.6 pack. `--watch` rebuilds and repacks on every change (for a developer-mode folder) |

- Exit codes: 0 done, 1 check or build errors, 2 usage error.
- Tools run in process (Vite JS API) or as `process.execPath` with a resolved script path
  (`vue-tsc`); never `spawn("pnpm")` or `npx`, which fails on Windows.

### 6.2 `moxi dev` harness

| Part | Rule |
| --- | --- |
| Page | `packages/hub/dev/` (spec 02): the real Hub, HUD layer, panels and elements in both looks over a placeholder game canvas; a sim panel (§4.4 scene, sessions 1 and 2); an inspector with host tree, op log, facts, documents, budgets, grant switches and settings. `pnpm hub` serves the same page for `plugins/*` in the moxi repository |
| Plugins | Run in module workers on the runtime. The page connects them through the kit's host side (`testing/host.ts`), so the harness decides what the kit decides: one Hub and one decision path, not a harness with its own palette and sim |
| Data | Documents live in the dev server's memory: they survive page reloads and reset when `moxi dev` stops. `useFetch` and `useFeed` reach the real network through the dev server, only for the manifest's `net:` hosts, with the kit's budgets |
| Source change | Rebuild, restart that plugin's worker, reopen the open commands and HUD widgets; pushed views close. Vue HMR in a module worker is not built |

### 6.3 `create-moxi-plugin`

`pnpm create moxi-plugin <dir> [--name <text>] [--owner <github-login>] [--surfaces command,hud,hub] [--yes]`

- Asks for missing values unless `--yes` (then name = `<dir>` in title case, owner `example`,
  surfaces `command`). Plugin id = `<owner>.<dir>`, lowercased. Refuses owner `moxi` (reserved,
  spec 04) and a non-empty `<dir>`. Installs nothing; writes `moxi-env.d.ts`; prints next steps.

| File in `template/` | Content |
| --- | --- |
| `plugin.json` | id, name, version `0.1.0`, `api: 1`, description, author, license `MIT`, command `hello` plus a `hud` or `hub` entry per chosen surface; no permissions, no icon |
| `src/plugin.ts`, `src/Hello.vue` | `definePlugin` for the chosen surfaces; a `List` with two rows, each with a `copy` action |
| `src/plugin.test.ts` | one kit test: open `hello`, check a row, press copy |
| `vite.config.ts`, `tsconfig.json` | `plugins: [moxi()]`; `strict`, `moduleResolution: "bundler"`, includes `src`, `plugin.json`, `moxi-env.d.ts` |
| `package.json` | scripts `dev: moxi dev`, `test: vitest run`, `check: moxi check`, `build: moxi pack`; exact devDependencies `@moxi/sdk`, `@moxi/cli`, `vue`, `vite`, `vitest`, `vue-tsc`, `typescript` from `templateVersions` (in `create-moxi-plugin`'s `package.json`, written from the repository's own versions when the package is built, so the template matches what CI tested) |
| `.gitignore`, `.gitattributes`, `README.md`, `LICENSE` | `.gitignore` lists `node_modules`, `dist`, `moxi-env.d.ts`; `.gitattributes` holds `* text=auto eol=lf`; README covers develop, test, release; LICENSE is MIT with the author's name |
| `.github/workflows/ci.yml`, `.github/workflows/release.yml` | ci: on push and pull request: install, `check`, `test`, `build`. release: on tag `v*`: `build`; attach `dist/plugin.moxi` and `dist/moxi-release.json` to the release |

### 6.4 Template lane (P68)

CI job `template`: Linux on every pull request that changes `packages/sdk/**`, `packages/cli/**`,
`packages/create-moxi-plugin/**`, `packages/hub/**` or `packages/ui/**`; Windows nightly. Steps:
tarballs of `@moxi/sdk`, `@moxi/cli`, `@moxi/hub`, `@moxi/ui` (JavaScript built with `vp pack`,
then `pnpm pack`) → `create-moxi-plugin --yes` in a temporary folder → install with the
tarballs → `test` → `check` → `build` → load `dist/plugin.moxi` as a developer-mode folder into
the fixture app (CI only, never locally) → the `hello` command shows in the Hub. Gate: green.
Measure: job ≤ 5 min; template test ≤ 2 s cold.

### 6.5 Developer mode in the app

Settings → Developer mode → "Load plugin folder…" (Main's dialog; no renderer-chosen path). Main
watches `<folder>/dist/plugin.moxi` and restarts that plugin's worker (timing: spec 05 §4.4,
P70). Dev installs run in an `unverified` host (spec 03), show "Development", and see the consent
page on first load and on every permission change; the CSP stays. Folder rules: spec 15 §5.

## 7. Example: Quick Travel

`plugin.json` requests `game.progress` and `game.travel`; declares command `favourites`, a
static command `guild-hall` (`"game": { "op": "game.travel", "args": { "guildHall": true } }`),
Hub items with scope `tp`, HUD widget `last-trip` and setting `showRegion`; `icon` is `{ "map": 449 }`.

```ts
// src/places.ts: module scope = one plugin session
const progress = useFact("game.progress");
const maps = useReference("maps");
export const lastTrip = useDoc<number | null>("last-trip", { scope: "account", initial: () => null });
export const placeRow = (mapId: number): ItemData => ({
  id: String(mapId),
  title: maps.get(mapId)?.name ?? `Map ${mapId}`,
  icon: { map: mapId },
  unavailable: progress.value.ok && !progress.value.value.unlockedMaps.includes(mapId) ? "Not unlocked on this character" : undefined,
  actions: [{ game: act("game.travel", { mapId }), onResult: (r) => r.status === "done" && void lastTrip.set(mapId) }],
});
export const searchOutposts = async (text: string) =>
  (await maps.search(text, { kind: "outpost", limit: 8 })).map((place) => placeRow(place.id));
// src/plugin.ts: definePlugin({ commands: { favourites: Favourites }, hud: { "last-trip": LastTrip }, hub: { items: () => favourites.value.map(placeRow), answer: searchOutposts } })
// src/plugin.test.ts
import { mountPlugin, sim } from "@moxi/sdk/testing";
import { expect, test } from "vitest";
import manifest from "../plugin.json"; import plugin from "./plugin?moxi";
test("Enter on a favourite travels there and remembers the trip", async () => {
  const p = await mountPlugin(manifest, plugin, { game: sim.outpost({ mapId: 55, unlocked: [55, 449] }), docs: { favourites: [449] } });
  const view = await p.openCommand("favourites");
  expect(view.row("449")).toMatchObject({ title: "Kamadan, Jewel of Istan", enter: "Travel to Kamadan, Jewel of Istan" });
  expect(await view.press("449")).toEqual({ kind: "game", result: { status: "done" } });
  expect(p.gameActions).toEqual([{ sid: 1, op: "game.travel", args: { mapId: 449 } }]);
  expect(p.doc("last-trip")).toBe(449);
});
test("a switched-off travel permission refuses in host words", async () => {
  const p = await mountPlugin(manifest, plugin, { docs: { favourites: [449] }, deny: ["game.travel"] });
  expect((await p.openCommand("favourites")).row("449").enter).toBe("Turned off in plugin settings");
  expect(p.session(2).roots).toEqual([]); // nothing leaked into the second game window
});
```

## 8. Decisions

| Decision | Reason | Rejected |
| --- | --- | --- |
| One `useFact` and one `act`, typed from the catalog | adding a fact adds no SDK function | one composable per fact |
| Game actions are values in rows or `GameAction`; chains only in the manifest | the host owns label, press and result; one press, host-run, listed on the plugin page | imperative `await game.travel()` with plugin-held tokens; plugin-sequenced actions; an SDK chain API |
| The kit imports `?moxi` builds, calls them per session and calls `@moxi/sdk/host` functions, no logic of its own | module scope is session scope, as in the host; a green kit means a working plugin (P69) | importing the definition directly (module code would run once, outside any session); kit-side fakes that skip grants and limits |
| Exact compiler pin written as `vueCompiler` | compiler output changes at patch level | a floor derived from a host-to-Vue table |
| `useFetch`: Main sends text, the worker parses | untrusted JSON is parsed in the plugin's own worker | JSON parsing in Main |
| `RefData.get` is a reactive cache; `search` is async | reference queries go to Main under a rate budget | synchronous search; whole tables in every worker |
| No plugin title on `game`, `link`, `wiki`, `open`, `search` | a label never disguises a press | plugin-written labels |
| Fill-search action | v1 calculators fill the Hub search; no code runs | pushing a prefilled view |
| Toasts without an action button | no 1.0 plugin needs one; one less press path | an Undo button |
| Composables only in module scope or `setup()` (rule 7) | every subscription has an owning scope | calls anywhere |

## 9. Today in code (main 848fb6e) and what changes

| Path | Today | Change | Slice |
| --- | --- | --- | --- |
| `packages/sdk/src/{index,game,nodes,surfaces,protocol,hub-protocol,runtime,host,testing}.ts` | v1 API: `definePlugin(setup)` on `globalThis.__moxiPluginSetup`, imperative `Game.loadBuild/travel`, node factories, whole-tree wire, `startRuntime` on `@vue/reactivity`; `createTestHost` without grant checks, `not-permitted` or budgets | move to `src/legacy/` (spec 02; `testing.ts` as `@moxi/sdk/legacy/testing` so old `plugins/*` tests keep running); `Game` deleted, types → spec 04 §3; replaced by §3, §4 and specs 06, 07, 09 | M1-00; M1-01, M2-04, M2-05; deleted M6-03 |
| `packages/sdk/package.json`, `packages/sdk/README.md` | exports `.`, `./testing`, `./host`; dependency `@vue/reactivity` 3.5.43; README documents the replaced API | entries of spec 02 plus `./legacy`, `./legacy/host`, `./legacy/testing` until M6-03 (the old Hub runs on them until M5-06); `@vue/compiler-sfc` 3.5.43 and `@vitejs/plugin-vue` 6.0.9 exact; `vite` as peer; README banner, then rewritten with §3 to §6 | M0-06, M1-00, M2-04 to M2-06, M7-06 |
| `scripts/build-plugins.ts`, `apps/game/src/hub/dev/*` (`App.vue`, `game-sim.ts`, `main.ts`, `vite.config.ts`), `apps/plugin-host/src/dev/main.ts`, root script `hub` | bundles `startRuntime` into every plugin; browser harness with its own palette and sim | deleted; `plugins/*` build with `moxi()`; harness → `packages/hub/dev` (§6.2) | M6-03 |
| `plugins/{builds,calculator,target-distance}` | v1-API plugins, tests on `createTestHost` | SFC plugins on this SDK | M6-01, M6-02 |
| none | no `vue-tsc` (`.vue` files are not type-checked), no `@moxi/sdk/vite`, `@moxi/cli`, `create-moxi-plugin` | §5, §6; the repository's `pnpm check` type-checks `.vue` too | M2-06, M7-06 |

## 10. Built by

| Slice | Builds (paths in `packages/sdk/src/` unless a package is named) |
| --- | --- |
| M0-06 | README banner "replaced in M2; see docs/spec/08" |
| M1-00, M1-01 | M1-00 moves the old SDK to `packages/sdk/src/legacy` (§9); M1-01 `index.ts` with the public types from `host/` (spec 02) |
| M2-04 | §3: `host/sdk-types.ts`, `index.ts` (types, `definePlugin`, `act`, `field`, composable stubs §3.10, element components), `runtime/composables.ts` |
| M2-05 | §4: `testing/index.ts`, `testing/host.ts`, `testing/sim.ts`, `testing/reference-fixture.ts` (kit, `sim`, fixture tables), `host/tree.ts`; in `vite/` the `?moxi` loader with the function-body bundle (§5.3 without the name check) |
| M2-06 | §5: `vite/*.ts`: compile gate, externals name check, capability, definition and budget checks, derived fields, pin, types, pack |
| M6-01, M6-02 | bundled plugins on this SDK |
| M6-03 | deletes `src/legacy/`, the old harness and `scripts/build-plugins.ts`; `packages/hub/dev` and `pnpm hub` |
| M7-05 | developer mode (§6.5, spec 15) |
| M7-06 | §6.1 to §6.4: `packages/cli/src/moxi.ts`, `packages/create-moxi-plugin/src/index.ts` and `template/`, `moxi dev`, template lane |
| M14-05 | public SDK docs and the template repository |

## 11. Checked by

| Proof | What it checks here | Owner |
| --- | --- | --- |
| P9 (N) | kit `tree()` equals the golden serialization of the kitchen-sink plugin over 40 steps | M2-01 |
| P10 (N) | two sessions by default; module scope per session | M2-02 |
| P13 | 1,000 mounts and unmounts through the kit: sign map 0, shadow nodes 0 | M2-01, M2-04 |
| P14 (kit) | the kit truncates exactly as the host | M2-05 |
| P19 | kitchen sink compiled with 3.5.0 and with the pinned compiler: same op stream on the current runtime | M2-06 (setup), M2-07 |
| P21 | §5.2 and §5.3 messages | M2-06 |
| P22 | §5.4 messages; `vue-tsc` errors for an unknown command id and a wrong setting type | M2-04 (types), M2-06 |
| P68 | §6.4 | M7-06 |
| P69 (kit) | kit decisions equal membrane and applier decisions over the shared corpus | M2-05 (N half M1-05, B half M3-02) |
| P70 | §6.5 | M7-05 |
| P79 | SDK `host`, `runtime` and `index.ts` count in the platform core; `testing` (kit, sim), `vite` and `packages/cli` are reported only (spec 01 §4) | M6-04 |

## 12. Deferred

- npm publication of `@moxi/sdk`, `@moxi/cli`, `create-moxi-plugin` and a public docs site:
  M14-05, after Matthias decides. Until then authors install tarballs from CI.
- Theme packages and the registry's rebuild comparison of packs: M14-04 (`moxi pack` is already
  deterministic).
- Not in 1.0: toast action buttons, pressable HUD widgets, whisper drafts. A host-rendered
  `<Send>` control is a later exception that needs Matthias.
