# 07 Wire and IPC

Every message across a process or worker boundary: Electron IPC channels and events, the game
window ↔ plugin host port, membrane ↔ worker messages, op batches, and signs (functions and game
intents inside data).

## 1. Rules in force

1. **Three carriers, three validators.**

   | Link | Carrier | Shapes in | Validated by |
   | --- | --- | --- | --- |
   | Main ↔ launcher, game, plugin host | IPC `invoke` and Main events | `packages/contracts` | ArkType: Main checks requests, asserts responses and event payloads |
   | Game renderer ↔ plugin host | `MessagePort` per (game window, host), brokered by Main | `@moxi/sdk/host` `host/port.ts` | hand-written guards (no ArkType: `host/port.ts` is runtime-safe, spec 02 rule 6) for the envelope at both ends; ops, rows, answers by the registry decoder (6.4) |
   | Membrane ↔ worker | private `postMessage` | `@moxi/sdk/host` `host/wire.ts` | worker → membrane: hand-written decoder; back: trusted |

2. **Every invoke** (`apps/desktop/src/shell/ipc.ts` `handle()`): main frame, channel in the
   sender kind's list, request schema, handler, response schema. A refusal a player can hit is a
   response value; a throw is an invariant failure (Main logs the channel; the renderer gets
   "This app action was rejected.").
3. **Host binding (I7).** A `pluginHost` invoke passes only if its `installKey` is bound to that
   host's `HostKey` and its `sid`, if any, is open in a game window with a port to that host;
   else it is rejected and counted as that host's fault (spec 03).
4. `plugins.*` and `keys.*` are never in the `pluginHost` list: approvals come only from host
   code (P8). Event names and kinds live in `contracts/src/windows.ts`, payloads in contracts;
   Main asserts a payload before `send`; no raw event string exists elsewhere.
5. The game renderer drops a port message with a failing envelope, an `installKey` not bound to that
   port's host, or a `sid` that is not this window's open session; the first two are host faults
   (`plugin.host.fault`). To an `internet` host it uses a writer without `facts` and `result` and
   sends `query` text only for that install's scope words or digit-led text; its `subscribe` is a
   fault (I3).
6. Only `plugin.action.authorize` starts a game action, after a trusted press (spec 01 §2) or a
   Main-witnessed shortcut (spec 13). The wire is private and unversioned (spec 01). A membrane
   budget check is a first pass; the applier (`host/tree.ts`) and Main never rely on it (values
   and owners: spec 05).

## 2. Shared shapes

Ids (`InstallKey`, `HostKey`, `Sid`, `RootId`, `PLUGIN_ID`) are defined only in spec 01 §3
(`host/ids.ts`). `seq`, `qid`, `sign` and `action` are positive integers. Two shapes stay here:

```ts
// host/port.ts (types and guards, no ArkType): a sign space and an ack target (6.2)
export type Target = RootId | "hub";
export const isTarget = (value: unknown): value is Target => value === "hub" || isRootId(value); // isRootId: the ROOT_ID pattern, spec 01 §3
// contracts/src/documents.ts (ArkType: the Main IPC edge)
export const docAddress = type({ scope: "'global'", name: "string > 0" })
  .or({ scope: "'account'", sid, name: "string > 0" });
export type DocAddress = typeof docAddress.infer;
```

All other shapes come from `@moxi/sdk/host` (actions: `host/actions.ts`, spec 13; `DocWriteReply`:
`host/data.ts`, spec 14). Contracts imports and never copies them, and re-exports `Platform`,
`KeyChord` and `GameState` (`GameState` is a game-protocol type and lives in `@moxi/sdk/host`). It owns the IPC records `KeyBinding`, `KeyTarget` (spec 11), `PluginRow` (spec 12)
and, in `contracts/src/hub.ts`, `HubLayout`, `HudPlacement`, `PanelPlacement`, `HubMark` (spec 10
§2.1).

## 3. IPC channels (invoke)

The 16 existing channels stay: `download.pause`, `download.resume`, `client.readiness`,
`client.retry`, `appearance.get`, `appearance.set`, `app.info`, `game.open` (M9-01: the request
names an account), `game.client`, `game.net.connect`, `game.net.write`, `game.net.close`,
`game.net.ack`, `game.dns`, `game.net.healthy`, `game.client.failed`. `plugin.doc.read` and
`plugin.doc.write` change shape; `plugin.bundles` is deleted. Kinds: L launcher, G game, P plugin
host.

| Channel | Kinds | Request | Response |
| --- | --- | --- | --- |
| `plugin.code` | P | `{ installKey }` | `{ sha256: string; code: string } \| null` (null: Main could not load it and marked the install) |
| `plugin.doc.read` | P | `{ installKey; doc: DocAddress }` | `{ value: Json; revision: number } \| null \| { ok: false; reason: "rate" }` (`rate`: over `docs.readsPerSecond`; the only refusal of a read) |
| `plugin.doc.write` | P | `{ installKey; doc: DocAddress; value: Json; expectedRevision: number }` | `DocWriteReply` (spec 14) |
| `plugin.ref.query` | P | `{ installKey; table: RefTable; query: RefQuery }` | `{ ok: true; rows: RefRow[] } \| { ok: false; reason: "rate" }` |
| `plugin.net.subscribe` | P | `{ installKey; sid; url: string; every: number \| null }` | `{ ok: true } \| { ok: false; error: NetError }` |
| `plugin.net.refresh` | P | `{ installKey; url }` | same |
| `plugin.feed.open` | P | `{ installKey; sid; url }` | same |
| `plugin.net.unsubscribe`, `plugin.feed.close` | P | `{ installKey; sid; url }` | `undefined` |
| `plugin.note` | P | `{ installKey; sid; text: string; chime: boolean }` | `{ ok: true } \| { ok: false; reason: "not-permitted" \| "unsupported" \| "rate" }` |
| `plugin.crashed` | P | `{ installKey; kind: CrashKind; detail: string }` | `undefined` |
| `game.state` | G | `{ state: GameState }` (spec 13) | `{ sid: number \| null }` (section 5) |
| `game.locator` | G | `undefined` | `{ build: string; locator: unknown } \| null` (gwkit parses `locator`, spec 13) |
| `plugin.action.authorize` | G | `ActionRequest` | `ActionDecision` |
| `plugin.action.report` | G | `ActionReport` | `undefined` |
| `plugin.link.open` | G | `{ sid; installKey; link: { url: string } \| { wiki: WikiRef } }` (spec 08) | `{ ok: true } \| { ok: false; reason: "not-permitted" \| "invalid" }` |
| `plugin.host.fault` | G | `{ host: HostKey; reason: FaultReason }` | `undefined` |
| `ref.get` | G | `{ table: RefTable; ids: number[] }` | `{ rows: RefRow[] }` (host labels; no plugin budget) |
| `hub.layout.get` | G | `undefined` | `HubLayout` |
| `hub.hud.save`, `hub.panel.save` | G | `HudPlacement`, `PanelPlacement` | `undefined` (Main refuses a value outside the bounds of `hub.maxOffset`, spec 10 §2.1) |
| `hub.hud.on` | L, G | `{ installKey; hudId: string; on: boolean }` | `{ ok: true } \| { ok: false; reason: "limit" }` (`install.hudWidgetsOn`) |
| `hub.marks.get` | G | `undefined` | `HubMark[]` |
| `hub.marks.save` | G | `HubMark[]` (the whole list) | `{ ok: true } \| { ok: false; reason: "invalid" }` (rules: spec 10 §1.12; `hub.marks`, `hub.phraseChars`) |
| `plugins.list` | L, G | `undefined` | `PluginRow[]` |
| `plugins.page` | L, G | `{ installKey }` | `PageModel \| null` (spec 12) |
| `plugins.activity` | L, G | `{ installKey }` | `Activity` (spec 14) |
| `plugins.grant` | L, G | `{ installKey; capability: CapabilityId; state: "granted" \| "denied" }` | `{ ok: true } \| { ok: false; reason: "not-requested" }` |
| `plugins.enable` | L, G | `{ installKey; enabled: boolean }` | `undefined` |
| `plugins.settings.set` | L, G | `{ installKey; key: string; value: SettingValue }` | `{ ok: true } \| { ok: false; reason: "invalid" }` |
| `plugins.update` | L, G | `{ installKey; choice: "allow" \| "not-now" \| "previous" }` | `undefined` |
| `plugins.uninstall` | L, G | `{ installKey; keepData: boolean }` | `undefined` |
| `plugins.run` | L, G | `{ run: boolean }` (false: "Start without plugins" for this app run; true: also resumes paused hosts) | `undefined` |
| `plugins.dev.add` | L | `undefined` (Main opens the folder dialog) | `{ installKey: InstallKey } \| null` |
| `keys.list` | L | `undefined` | `KeyBinding[]` |
| `keys.bind` | L, G | `{ target: KeyTarget; chord: KeyChord \| null }` | `{ ok: true } \| { ok: false; reason: "reserved" \| "taken" \| "invalid"; by?: KeyTarget }` |
| `plugins.install` | L | `{ id: string; version: string }` (M14) | `{ ok: true; installKey: InstallKey } \| { ok: false; reason: string }` (host words, spec 15) |
| `plugins.sources.add` | L | `{ owner: string; repo: string }` (M14) | `{ ok: true } \| { ok: false; reason: string }` (host words, spec 15) |
| `plugins.sources.remove` | L | `{ source: string }` (M14) | `undefined` |

- `CrashKind = "start" | "hang" | "flood" | "batch" | "errors" | "worker"` and
  `FaultReason = "envelope" | "foreign-install" | "bad-batch" | "internet-subscribe"` are in
  `host/port.ts` (crash meaning and policy: spec 03 §1.8; what the player sees: spec 10 §1.14).
  `plugin.crashed.detail`: cut to `crash.detailChars` characters with `...`, Dev log only.
- Action types, ids (positive integers per app run) and origin: spec 13. Main sets the origin; the
  request has no origin field. In a Dev QA run (`MOXI_QA=1`, unpackaged only) every
  `plugin.action.authorize` counts as `agent` (spec 01 I2).
- No renderer or plugin host sends an account id. Main takes it from the sender window
  (`hub.layout.get`, `hub.hud.save`, `hub.panel.save`) or from `sid` (`account` documents);
  `hub.hud.on` and `hub.marks.*` store none (spec 12 §6).

## 4. Main events

`webContents.send(name, payload)`; the preload exposes `on(name, listener)` (section 9).

| Event | Kinds | Payload |
| --- | --- | --- |
| `client.readiness.changed` | L | `Readiness` (existing) |
| `plugins.changed` | L, G | `null`: the plugin list, a page or an activity changed; an open list or page re-reads |
| `game.net.event` | G | `SocketEvent` (existing) |
| `appearance.changed` | G | `AppearanceSettings` (existing) |
| `plugin.state` | L, G | `GamePluginState` (the launcher reads `hosts`, `pluginsOff` and `sandboxRefused`) |
| `hub.toggle` | G | `null` |
| `hub.command` | G | `{ installKey; command: string }` (Main matched the shortcut, spec 11) |
| `game.note` | G | `{ installKey; text: string; chime: boolean }` (Main checked grant and rate) |
| `plugin.host.state` | P | `PluginHostState` |
| `plugin.doc.changed` | P | `{ installKey; doc: { scope: "global" \| "account"; name: string }; sids: number[]; value: Json; revision: number }` |
| `plugin.net.data` | P | `{ installKey; url: string; result: { ok: true; text: string; type: string; at: number } \| { ok: false; error: NetError } }` (`type`: media type) |
| `plugin.feed.message` | P | `{ installKey; url: string; data: string }` |
| `plugin.feed.status` | P | `{ installKey; url: string; status: FeedStatus }` |

```ts
type PluginHostState = {
  host: HostKey;
  runtimeUrl: string; // moxi://app/plugin-host/code/<sha>.js (spec 06)
  installs: HostInstall[]; // enabled installs bound to this host; one that disappears stops
};
type HostInstall = {
  installKey: InstallKey;
  sha256: string; // a new value restarts the worker with fresh plugin.code
  grants: CapabilityId[]; // requested ∩ granted
  settings: Record<string, SettingValue>; // spec 12, defaults filled in
};
type GamePluginState = {
  installs: GameInstall[]; // enabled installs only
  killed: CapabilityId[]; // off(build): kill switches, not located, actions off under a local match (spec 13 §3.3)
  hosts: { host: HostKey; state: HostStatus }[]; // HostStatus: spec 03 §2; a host that does not exist is missing unless paused or refused
  pluginsOff: boolean;     // "Start without plugins" is in force for this run (spec 03 §1.13)
  sandboxRefused: boolean; // this run refuses non-official hosts (spec 03 §1.11)
  bindings: KeyBinding[]; // labels only; Main matches keys (spec 11)
};
type GameInstall = { installKey: InstallKey; host: HostKey; manifest: Manifest; grants: CapabilityId[] };
```

- Each event carries the **whole** state for its receiver and goes to every receiver it concerns
  in the same Main task after any change, layout and mark changes included (P35, spec 12 §1).
  HUD, panel and mark data is not in it: read `hub.layout.get` and `hub.marks.get`. After every
  `plugins.changed` the Hub calls `hub.layout.get` again (HUD switches and placements may have
  changed with the plugin list).
- `grants` = requested ∩ granted for an enabled, not withdrawn install. Main refuses `killed`
  actions; the game renderer publishes a killed fact as `{ ok: false, reason: "unsupported" }` and
  shows killed actions unavailable. `capabilitySupport(specs, locator)` (`@moxi/gwkit/locate`) is
  the one function behind "Works with this game build: N of M" (spec 15).
- `plugin.doc.changed.sids`: the host's open sessions that hold the document (`global`: all of
  the install's; `account`: that account's), except the session whose write caused it.

## 5. Port handoff and sessions

Main makes one `MessageChannelMain` per (game window, plugin host) once both pages have loaded,
and again after a host restart, and posts the ends as `hubPortMessage` (`"moxi-hub-port"`): to a
game window `{ host: HostKey }` with 1 port (to that host) or 0 (host gone; its surfaces show
"restarting", spec 10); to a plugin host `{ window: number }` (game `webContents.id`) with 1 port
(to a game window) or 0 (window gone: its page reloaded, its renderer died or it closed; close
every session of that port). The preload queues
handoffs until the page posts `portReadyMessage` (`"moxi-hub-ready"`, moved into `windows.ts`),
then posts `{ t: hubPortMessage, ...payload }` with the port.

Sessions (lifecycle: spec 03 §1.5):

1. The game renderer invokes `game.state { state }` on every gwkit `GameState` change (`login`,
   `character-select`, `loading`, `in-world`, `unknown`). Main answers `{ sid }`: new on entering
   `in-world`, the same while there, `null` otherwise. `login`, `character-select` and `unknown`
   close the session; `loading` changes nothing (gwkit reports `loading` during a map load, never
   `unknown`). A game page reload (Main closes it first), the game renderer's death and window
   close also close it.
2. On a new `sid` the game renderer sends `{ t: "session", sid, open: true }` on every host port
   before any other message with that `sid`; on `null`, `open: false` for the old one. A new
   port first gets `session` for the live `sid`.
3. The membrane maps `sid` → port. A worker opens the session at session open if the install
   holds a granted `game.note` (spec 06), else on the first mount, hub, query or event it needs.
   On close the membrane sends `session` close to every worker that had it and drops later
   messages for that `sid` without a fault.

## 6. Op batches

### 6.1 Batch and ops

The `ops` field of an `ops` message (sections 7, 8) is one flat array: each op is its code
followed by its operands. Ids are positive integers per root, allocated by the runtime; id `0` is
the root container. Roots are keyed by (`sid`, `RootId`).

| Code | Op | Operands | Effect |
| --- | --- | --- | --- |
| 1 | CREATE | `id, element` | new element node; `element` is a registry index (spec 09) |
| 2 | TEXT | `id, text` | new text node |
| 3 | INSERT | `parent, id, before` | attach or move `id` under `parent` (0 = root), before child `before` (0 = append) |
| 4 | REMOVE | `id` | detach and free `id`, its subtree and every sign bound in it |
| 5 | PROP | `id, prop, value` | set prop index `prop` of the node's element to `value: PropValue`; `null` unsets |
| 6 | EVENT | `id, event, sign` | bind event index `event` of the node's element to `sign`; `0` unbinds |
| 7 | ITEMS | `id, prop, upsert, remove, order` | keyed patch of a collection prop: `upsert: Row[]`, `remove: string[]`, `order: string[] \| null` |
| 8 | SET_TEXT | `id, text` | new text for text node `id` |
| 9 | RESET | – | first op only: forget the root's whole tree, ids and signs; the rest of the batch rebuilds it |

- Vue comment anchors travel as empty TEXT nodes; `setElementText` as REMOVE, TEXT and INSERT
  (spec 06 maps `nodeOps` to ops). Draw lists (`Shape[]`, spec 09) and chart series are ordinary
  PROP values where the registry type allows them.
- ITEMS applies `remove`, then `upsert` (a known id is replaced whole; a new id is appended),
  then `order` (when not `null`: every id exactly once). A collection prop changes only through
  ITEMS; a PROP on it is malformed. A first load larger than one batch streams as several ITEMS
  batches, one per ack; only the last may carry `order`.
- RESET returns a root from a render error: the runtime holds the root's ops while its render
  fails, the host marks the view inert, and the next good batch starts with RESET and a full
  snapshot. The runtime may reuse ids and live signs in it.

### 6.2 Values, rows and signs

```ts
type PropValue =
  | null | boolean | number | string // numbers must be finite
  | readonly PropValue[]
  | { readonly [key: string]: PropValue } // plain object; no key starts with "$"
  | Float32Array | Float64Array | Uint8Array | Uint32Array // only where the prop type allows (spec 09)
  | FnRef | ViewRef | IntentRef;
type FnRef = { $fn: number }; // a plugin function: the host sends event (payload null) or result to this sign
type ViewRef = { $view: number }; // a component with props for push: the host mounts it (section 7)
type IntentRef = { $game: { op: string; args: { [key: string]: Json | FieldRef } } };
type FieldRef = { $field: string }; // only as a direct value of an IntentRef args key
type Row = { id: string } & { readonly [key: string]: PropValue }; // wire form of ItemData, CellData, RowData
```

How each function or value of the SDK types (spec 08, 09) crosses:

| SDK value | Wire | Host use |
| --- | --- | --- |
| element event handler (`@select`, `@reorder`) | EVENT op with a sign | `event { target: root, sign, payload }`; payload schema per registry event (spec 09) |
| `modelValue` prop, `update:modelValue` event | PROP value and event payload are both `[value, revision]` | spec 09 §4.4 |
| `ItemAction.run` | `{ $fn }` | `event { target, sign, payload: null }` on the press |
| `ItemAction.onResult`, `GameAction` `result` | `{ $fn }`, EVENT sign | `result { target, sign, result }`; never `event`, never to an `internet` host |
| `ItemAction.push` + `props` | `{ $view }` | `mount { what: { push: { from: target, sign } } }` |
| `act(op, args)` (`GameIntent`) | `{ $game }` | label from the catalog; `plugin.action.authorize` on a trusted press |
| `field(key)` | `{ $field: key }` | value of the input with that `field` key in the same root at press time (spec 13) |
| copy, link, wiki, open, fill-search actions | plain data | host-only handling (spec 08, 10) |

Sign rules: a **sign space** is `(install, sid, target)`: one per root, and one per install and
session for Hub items and answers (`"hub"`). The runtime allocates signs as positive integers. A
sign is freed when its node is removed, its event is unbound, or the value that held it is
replaced (a PROP, an ITEMS row, a newer items list or answer set); a freed number is never
allocated again in its space, so a stale press can never run another handler. The host sends only
signs it currently holds; the runtime drops an event or result for an unknown sign without an
error.

### 6.3 Wire size

The one definition, in `host/wire.ts`; the runtime (to chunk), membrane, applier and test kit use
it, and spec 05 refers here:

```ts
function wireSize(value: unknown): { plain: number; typed: number };
// plain: string 8 + 2 × length; number, boolean, null 8; array 8 + its members;
//        object 8 + Σ over keys (8 + 2 × key length + value)
// typed: byteLength of each Float32Array, Float64Array, Uint8Array and Uint32Array (not in plain)
```

### 6.4 Decoder

One hand-written, registry-driven decoder in `host/wire.ts`: `createRootDecoder(root: RootId) →
{ decode(ops: unknown[]): Decoded }`, one instance per root, holding the node table (id → element
or text, parent). `decodeRows(rows: unknown[])` in the same module checks `items` upserts and
`answers` against the `ItemData` wire form (spec 08) with the value rules below. Membrane, applier
(`host/tree.ts`, shared with the test kit) and kit run this code, so they decide alike (P69); the
runtime's encoder shares `wire.maxDepth`. Checks in order:

| Check | Outcome |
| --- | --- |
| `wireSize` over `wire.batchBytes` or `wire.batchTypedBytes` | `too-large` |
| op code, arity, ids and signs as positive integers | `malformed` |
| CREATE and TEXT use an id not in the table (RESET clears it); `element` in range and allowed on the root's surface (`view`, `panel`, `hud` from the root id) | `malformed` |
| INSERT: `parent` is 0 or an element, `id` exists, no cycle, `before` is 0 or a child of `parent`, and the parent's registry `children` rule allows the child (`Tab` only in `Tabs`, `Hud` only in a `hud` root; spec 09 rule 6); REMOVE, PROP, EVENT, SET_TEXT name an existing node of the right kind | `malformed` |
| `prop` and `event` indices exist on that element; the value matches the prop type (spec 09) and the PropValue grammar (finite numbers, no `$` keys, `$field` only in `$game.args`, nesting within `wire.maxDepth`); a model prop's value is a `[value, revision]` pair | `malformed` |
| ITEMS: `prop` is a collection prop; row ids are unique strings; `remove` names existing rows; `order` is the full id list | `malformed` |
| RESET anywhere but first; at the batch end a created node left detached, or a non-empty text node under an element whose `children` is not `"text"` (empty text nodes are Vue anchors) | `malformed` |
| node count of the root over `view.nodesPerRoot` | `too-large` |
| strings over `view.titleChars` or `view.textChars` (spec 09 marks which) | truncated with "…", not an error |

`malformed` stops the worker (`CrashKind` `batch`). `too-large` ends that root only: the membrane
sends the worker `unmount` and the game `root { state: "too-large" }`; the plugin keeps running.
Refused batches within `wire.refusedWindowMs` count toward `wire.refusedBatches`, also a `batch`
crash. If the applier finds `malformed` or `too-large` in a batch the membrane passed, it drops
the batch, ends the root itself (`unmount` to the host) and reports `plugin.host.fault`
`bad-batch`.

## 7. Game renderer ↔ plugin host port

```ts
// packages/sdk/src/host/port.ts: types and hand-written guards, no ArkType (runtime-safe). Also
// exported: decodeToHost(raw: unknown): ToHost | null, decodeToGame(raw: unknown): ToGame | null
// (the envelope guards both ends run) and portWriter(class), the writer behind the class rule.
type MountWhat = { command: string } | { hud: string } | { push: { from: Target; sign: number } };
// game renderer → plugin host
type ToHost =
  | { t: "session"; sid: number; open: boolean }
  | { t: "hub"; sid: number; installs: InstallKey[] } // first Hub open in this session: installs with hub.items
  | { t: "mount"; sid: number; installKey: InstallKey; root: RootId; what: MountWhat }
  | { t: "unmount"; sid: number; installKey: InstallKey; root: RootId }
  | { t: "ack"; sid: number; installKey: InstallKey; target: Target; seq: number }
  | { t: "event"; sid: number; installKey: InstallKey; target: Target; sign: number; payload: Json }
  | { t: "query"; sid: number; installKey: InstallKey; qid: number; text: string }
  | { t: "facts"; sid: number; tick: number; slices: Record<FactId, Observed<unknown>> } // local hosts only
  | { t: "result"; sid: number; installKey: InstallKey; target: Target; sign: number; result: ActionResult }; // local hosts only
// plugin host → game renderer; the membrane stamps installKey
type ToGame =
  | { t: "ops"; sid: number; installKey: InstallKey; root: RootId; seq: number; ops: unknown[] }
  | { t: "items"; sid: number; installKey: InstallKey; seq: number; upsert: unknown[]; remove: string[]; order: string[] | null }
  | { t: "answers"; sid: number; installKey: InstallKey; qid: number; items: unknown[] }
  | { t: "subscribe"; sid: number; facts: FactId[] } // full set for this host and session
  | { t: "root"; sid: number; installKey: InstallKey; root: RootId; state: "error" | "too-large" }
  | { t: "stopped"; installKey: InstallKey; reason: CrashKind | "off" | "update" | "idle" }
  | { t: "toast"; sid: number; installKey: InstallKey; text: string; tone: ToastTone } // spec 08
  | { t: "navigate"; sid: number; installKey: InstallKey; root: RootId; to: { push: number } | "pop" };
```

- **Mount.** The Hub assigns the `RootId` (spec 01 §3) and mounts commands, HUD widgets and pushed
  views. A plugin `navigate` counts only for the top root of its stack (spec 10); for a push the
  Hub sends `mount` with `what: { push: { from: root, sign } }`.
- **Backpressure.** One `ops` or `items` message per `(install, sid, target)` is in flight
  (`wire.unackedPerRoot`). The runtime sends at the end of each Vue flush per (session, root) and
  on `ack` (spec 06); the membrane forwards by microtask with a `setTimeout(0)` fallback, never
  `requestAnimationFrame`, holds a batch the install's byte rate does not allow, and forwards
  `ack`. A second batch before the ack is a `batch` crash (P15); the game acks after applying all
  of it.
- **Hub items** start on the first `hub` message and stream as keyed patches (ITEMS rules); rows
  are `Row` values in the `"hub"` sign space.
- **Queries.** One `query` per keystroke to each entitled install (`routeQuery`,
  `host/routing.ts`, spec 10 §1.4); `text` is the text after the scope word for scope queries,
  else all of it. `qid` increases per session; no debounce; answers with an older `qid`, or after
  `hub.queryDeadlineMs`, are ignored; rows beyond `hub.answersPerQuery` are dropped.
- **Facts.** `subscribe` carries a worker's full per-session set; the membrane answers an
  ungranted id at once with `not-permitted` and sends the game the union of granted ids for that
  `sid`. For plugins the game reads only those (action `needs` and `watch`: spec 13) and sends one
  `facts` message per session with the slices changed since its last one, plus newly subscribed
  slices. Each worker gets only its granted slices, one message per session, so a light session
  never waits behind a heavy one. A revoked grant gets `not-permitted` at once and leaves the
  union (P35).
- **Errors.** `root { state: "error" }` marks a view inert until its next batch (it starts with
  RESET). After `stopped` every root of that install on this port is dead; the game shows it
  again only with a new `mount` (not after `off`).

## 8. Membrane ↔ worker

Private to `@moxi/sdk` (`host/wire.ts`). Worker messages carry no `installKey`; the membrane stamps
it. It decodes every worker message with `decodeFromWorker(raw: unknown): FromWorker | null`;
`null` is a `batch` crash. Port messages it only stamps or strips are not repeated:

```ts
type Unstamped<M> = M extends { installKey: InstallKey } ? Omit<M, "installKey"> : M;
type ToWorker =
  | Unstamped<Extract<ToHost, { t: "session" | "mount" | "unmount" | "ack" | "event" | "query" | "result" }>>
  | { t: "hub"; sid: number }
  | { t: "facts"; sid: number; slices: Record<FactId, Observed<unknown>> } // granted slices only
  | { t: "ping"; seq: number }
  | { t: "settings"; values: Record<string, SettingValue> }
  | { t: "reply"; id: number; value: unknown } // answer to a request, typed by its call
  | { t: "doc"; sids: number[]; doc: { scope: "global" | "account"; name: string }; value: Json; revision: number }
  | { t: "net"; url: string; result: { ok: true; text: string; type: string; at: number } | { ok: false; error: NetError } }
  | { t: "feed"; url: string; data: string }
  | { t: "feedStatus"; url: string; status: FeedStatus };

type FromWorker =
  | Unstamped<Extract<ToGame, { t: "ops" | "items" | "answers" | "toast" | "navigate" }>>
  | { t: "ready" }
  | { t: "pong"; seq: number }
  | { t: "subscribe"; sid: number; facts: string[] }
  | { t: "error"; sid: number | null; root: RootId | null; message: string; module?: true } // module: a throw in module evaluation
  | { t: "note"; sid: number; text: string; chime: boolean }
  | { t: "request"; id: number; sid: number; call: Call }
  | { t: "release"; sid: number; call: Release };

type Call = // reply: plugin.* response of the same name
  | { c: "doc.read"; doc: { scope: "global" | "account"; name: string } }
  | { c: "doc.write"; doc: { scope: "global" | "account"; name: string }; value: Json; expectedRevision: number }
  | { c: "ref.query"; table: RefTable; query: RefQuery }
  | { c: "net.subscribe"; url: string; every: number | null }
  | { c: "net.refresh"; url: string }
  | { c: "feed.open"; url: string };
type Release = { c: "net.unsubscribe"; url: string } | { c: "feed.close"; url: string };
```

- A `Call` becomes its `plugin.*` invoke with the stamped `installKey`; `account` documents carry
  `sid` (`doc: { scope: "account", sid, name }`) and Main resolves the account.
- `note` follows spec 13 §9: `plugin.note`, then Main checks grant, kill switch and rate and sends
  `game.note` to the session's window with the line cleaned to printable ASCII (cut mark `...`).
  The worker gets no answer (`useNote`, spec 08). `toast` and `navigate` go to the session's port
  as they are: the membrane only forwards. The Hub owns the toast queue, rate and display
  (spec 10 §1.7).
- `error` with a `root` holds that root (`root { state: "error" }` to the game). `module: true` is
  charged as a `start` crash; any other `error` counts toward the `errors` crash rule.

**Document writes.** Per `(install, sid, document)` a write goes out at once when none is in
flight and none went out within `docs.coalesceMs`; otherwise the membrane holds it, a newer write
replaces the held one and the replaced request joins it. When the in-flight write returns, its
requests get its result and the held write goes out after the window, with `expectedRevision` set
to the returned revision if that write succeeded. So every `set()` resolves with the result of
the write that carried its value or a later one of the same session. Writes over
`docs.writesPerSecond` get `{ ok: false, reason: "rate" }` from the membrane; Main repeats every
quota and rate check.

## 9. Contracts package layout

In `packages/contracts/src/`: `windows.ts` (`windowChannels`, `windowEvents` per kind,
`hubPortMessage`, `portReadyMessage`; no ArkType, so preloads stay small), `index.ts` (`channels`
via `defineChannel`, `events` via `defineEvent(payload)`, `validateRequest`, `Bridge<K>`),
`documents.ts` (`docAddress`; schemas of `plugin.doc.*` and `plugin.doc.changed`, replacing
`documentRef`, keyed by bare plugin id), `hub.ts` (`HubLayout`, `HudPlacement`, `PanelPlacement`,
`HubMark`, types in M3-01 and their `hub.*` ArkType schemas in M4-01; bounds: `hub.maxOffset`
and spec 10 §2.1). No `ids.ts` or `port.ts`: ids are
spec 01's, port shapes are section 7's.

```ts
type Bridge<K extends WindowKind> = {
  invoke<N extends ChannelOf<K>>(name: N, request: RequestOf<N>): Promise<ResponseOf<N>>;
  on<E extends EventOf<K>>(name: E, listener: (payload: PayloadOf<E>) => void): () => void;
};
```

The generic `on` replaces `onReadinessChanged`, `onAppearanceChanged`, `onSocketEvent` and
`onDocumentChanged`; the preload refuses names outside `windowEvents[kind]`.

## 10. Constants

Values are in spec 05. Keys used here: `wire.*`; `view.nodesPerRoot`, `view.titleChars`,
`view.textChars`; `hub.itemsPerSession`, `hub.answersPerQuery`, `hub.queryDeadlineMs`,
`hub.marks`, `hub.phraseChars`, `hub.maxOffset`; `crash.detailChars`; `install.hudWidgetsOn`; `docs.*`
(including `readsPerSecond`); `reference.queriesPerSecond`; `net.*`; `feed.*`; `note.*`;
`worker.readyMs`, `worker.pingMs`, `worker.pongMs`.

## 11. Decisions

Chosen (rejected alternative in brackets; reasons are in the section named):

- Flat op arrays with registry indices, because a plugin cannot name what the host lacks (names on
  the wire; nested trees). Draw lists and series as PROP values (a SCENE op). ITEMS names its prop
  (an implicit collection prop). RESET restores the last good tree (host-side replay; blank
  views). Tagged `$fn`, `$view`, `$game`, `$field` values (a side table per prop type). Signs
  never re-allocated (sign reuse). All in 6.
- One full-state event per receiver (separate `plugin.installs`, `plugin.grants`,
  `plugin.settings` events); kill switches applied where the build is known (grants pushed to
  hosts), because windows of one host can run different builds. Section 4.
- One channel per `HubMain` call, because `HubMain` is the Hub's only link to Main (spec 10 §2.2)
  (`hud.set`, `hub.pin`, `hub.alias`; layout inside `plugin.state`). Commands authorize by id and
  Main returns the steps it approved (the renderer sends the manifest's args). Main derives the
  action origin (an `origin` field). Section 3.
- `sid` in the `game.state` response and `session` on the port, because port order puts
  `session` first (Main→host session events). Section 5.
- `game.note` via Main (via the game port); write coalescing per (install, session, document)
  (per document across sessions); no `plugin.doc.list`, `init`, worker `grants` or `compat.status`
  message, which nothing reads. Section 8.
- Plugin-protocol shapes in `@moxi/sdk/host`, IPC channels and events in contracts (copies of SDK
  shapes in contracts); hand-written guards for the port envelope and a hand-written decoder for ops and
  worker messages (ArkType only at the Main IPC edge in contracts; per-message ArkType for trees, as `worker-messages.ts`). Sections 1, 2.

## 12. Today in code (main 848fb6e; after M1-00 the old SDK files sit under `packages/sdk/src/legacy`)

| Today | Change |
| --- | --- |
| `packages/contracts/src/index.ts:73-121` (19 channels), `Bridge<K>` with four named listeners (`:127-145`), `validateRequest` (`:146`); `windows.ts:1-25`, `hubPortMessage` (`:28`); `documents.ts` (`documentRef` by bare `plugin` id) | section 3 channels, `events`, generic `on`, `windowEvents`, `portReadyMessage`; `install` + `DocAddress` (migration: spec 14) |
| `apps/desktop/src/shell/main.ts:62, 107, 320, 329`, `shell/preload.ts:16, 25, 35, 40` (raw event strings); `"moxi-hub-ready"` in `preload.ts` and `apps/game/src/hub/main.ts` | names and payloads from contracts; Main asserts before `send` |
| `apps/desktop/src/shell/ipc.ts` `handle()`; `shell/main.ts:141-156` (one port per game window; `webContents` id is the session id) | keep `handle()`, add the host binding check and fault count; one port per (game window, host), `sid` from `game.state` |
| `apps/desktop/src/plugin-bundles.ts`, `packages/sdk/src/hub-protocol.ts` (whole-state `HubSnapshot`), `apps/game/src/hub/client.ts`, `packages/sdk/src/protocol.ts:65-95`, `apps/plugin-host/src/worker-messages.ts` (170-line ArkType copy) | deleted: `plugin.code`; section 7 behind `HubPort` (spec 02); section 8 in `host/wire.ts` |
| `vite.config.ts:63` (contracts may import only `arktype`) | also `@moxi/sdk/host` (spec 02) |

## 13. Built by

M1-05 ops, values, signs, `wireSize`, decoder, corpus · M2-01 renderer, RESET · M2-02 sessions,
items, answers · M2-03 ITEMS, backpressure · M3-01 port adapter behind `HubPort`, `hub.ts` types · M3-02 applier
pass · M3-07 authorize and report via a fake executor port · M4-01 contracts: channels, events,
`hub.ts` schemas, `Bridge.on`, and the port envelope guards in `host/port.ts` · M4-02 `plugin.code` · M4-03 document channels, coalescing · M4-04
`plugin.state`, `plugin.host.state`, Main side of `hub.*` (spec 12) · M4-05 port broker, host
binding, faults · M4-07 `plugin.action.*` · M4-08 forged messages · M4-09 membrane: sessions,
identity stamping, first-pass budgets · M5-04 `game.locator` · M5-06 `game.state`, sessions ·
M5-07 `facts`, `subscribe` · M5-08 action path, chains · M5-09 `hub.toggle`, `hub.command` ·
M7-01 `plugin.net.*` · M7-02 `plugin.feed.*` · M7-04 `plugins.*` · M7-05 `plugins.dev.add` ·
M11-01 `ref.get`, `plugin.ref.query` · M11-09 `plugin.note`, `game.note` · M12-07 `keys.*` ·
M14-01 to M14-03 `plugins.install`, `plugins.sources.*`.

## 14. Checked by

- **P6** the applier fuzz feeds the section 6 decoder and applier 100,000 seeded batches.
- **P7** host binding and class rules on the port and in Main; with the official host the
  expected workers are official·local 1, official·internet 1, unverified·local 2.
- **P8** `windowChannels.pluginHost` has no `plugins.*` or `keys.*` channel; host calls reject.
- **P15** a second unacked batch per `(install, sid, target)` is a `batch` crash.
- **P35** one state event per receiver; immediate `not-permitted` and union shrink on revoke.
- **P37** `query` reaches only entitled installs with the right text.
- **P84** note rate `note.perSecond`, queue `note.queued`, overflow refused `rate` (owner M5-08).
- Also P12 (ITEMS cost), P40 (forged `event` and `result` run nothing), P45 (`hostInput`), P69
  (one decoder in kit, membrane and applier), P81 (chain steps in `ActionDecision`, one
  `ActionReport` per step).

## 15. Deferred

- Crash kind `cpu` and its `stopped` reason: with the CPU burner search (spec 03).
- A launcher plugin session: not in 1.0; it would be an additive session kind.
