# 06 Worker runtime

How plugin code runs in its worker: boot from the host-supplied runtime, what a plugin module
receives (`__moxi`), how one worker serves many plugin sessions, and how Vue output becomes op
batches (flush, backpressure, last good tree). It also fixes the worker lifecycle rules the
membrane applies.

Owners elsewhere: numbers 05 (by key); wire shapes, signs, decoder 07; SDK and test kit 08; elements 09.

## 1. Rules in force

1. One worker per install for the whole app, in the plugin host of its `HostKey`. It evaluates the
   plugin module once per plugin session: module scope is session scope.
2. Sessions of an install share one realm (`globalThis`, built-in prototypes); a write in one is
   visible in the others (08 documents this).
3. The host supplies the runtime (`moxi://app/plugin-host/code/<sha>.js`). A package carries, and
   the `data:` URL transports, only plugin code.
4. No worker message starts a game action (OD1): a value from `act()` is inert data, and only a
   trusted press in the game renderer runs it (13).
5. The membrane, the applier and Main enforce budgets, never the runtime (05 rule 3).
6. The runtime bundle has no ArkType and no DOM code. From `packages/sdk/src/host/` it imports only
   `budgets.ts` (05), the `wireSize` and op-code exports of `wire.ts` (07), the registry index
   tables (09) and types. `scripts/build-runtime.ts` fails if `arktype` is in the module graph.

## 2. Files

| File | Holds | Slice |
| --- | --- | --- |
| `packages/sdk/src/runtime/{renderer,encode,prelude}.ts` | custom renderer, shadow tree, sign spaces, buffers, send, hold (8); encoder and sign reuse (8.2); prelude (3.3) | M2-01 |
| `packages/sdk/src/runtime/{runtime,session}.ts` | `createRuntime(port)`, message loop, sessions, roots, Hub items, answers, requests (6, 7); per-session `__moxi`, timers, wrapped watchers (4, 7.3) | M2-02 |
| `packages/sdk/src/runtime/rows.ts`, `packages/sdk/src/host/worker-guard.ts` | keyed row diff against the host copy, chunking (8.3, 8.4); the membrane's per-worker checks (5) | M2-03; `worker-guard.ts` also M4-09 |
| `packages/sdk/src/runtime/composables.ts` | bodies of `useFact` … `useNote` on the 07 §8 messages | M2-04 |
| `packages/sdk/src/runtime/{worker,vue}.ts`, `packages/sdk/src/host/boot.ts`, `scripts/build-runtime.ts` | worker entry (built, never imported); Vue allowlist (4.3); `bootModule` (3.2); runtime file and `runtime.json` build (3.1) | M2-07 |

`@moxi/sdk/runtime` (entry, 02) points at `src/runtime/runtime.ts` for the test kit and `moxi dev`.
`packages/sdk` adds `@vue/runtime-core` pinned exactly to `RUNTIME_VUE` (04 §8.7).

## 3. Boot

### 3.1 Runtime file

- `scripts/build-runtime.ts` bundles `src/runtime/worker.ts` into one minified ES module with no
  imports (target `es2023`), defining `process.env.NODE_ENV = "production"`,
  `__VUE_OPTIONS_API__`, `__VUE_PROD_DEVTOOLS__` and `__VUE_PROD_HYDRATION_MISMATCH_DETAILS__` as
  `false`, and `__MOXI_RUNTIME_VUE__` = `RUNTIME_VUE` (read from `packages/sdk/src/host/catalog.ts`).
- Output: `apps/plugin-host/dist/code/<sha>.js` (`<sha>` = lowercase hex SHA-256 of the file) and
  `apps/plugin-host/dist/code/runtime.json` = `{ "sha": "<sha>" }`. It runs after the plugin-host
  page build (which empties `dist/`), in `pnpm build` and `scripts/dev.ts`.
- Main reads `runtime.json` once at start, checks the hash and sends
  `runtimeUrl = "moxi://app/plugin-host/code/<sha>.js"` in `plugin.host.state` (07 §4). The
  plugin-partition handler serves it as `text/javascript`; the `moxi` scheme carries
  `corsEnabled: true`; Dev is the same (03 §1.10). It is the only `moxi` URL a plugin worker loads
  (P1).

### 3.2 Boot module

```ts
// packages/sdk/src/host/boot.ts
export const bootModule = (runtimeUrl: string, code: string): string =>
  `import { boot } from ${JSON.stringify(runtimeUrl)};\n` +
  `boot(function plugin(__moxi, setTimeout, setInterval, clearTimeout, clearInterval) {\n${code}\n});\n`;
// membrane (apps/plugin-host/src/membrane.ts)
const url = `data:text/javascript;base64,${base64OfUtf8(bootModule(runtimeUrl, code))}`;
const worker = new Worker(url, { type: "module", name: installKey });
```

- `code` is the package's `index.js`: a function body that reads `vue` and `@moxi/sdk` from
  `__moxi` and ends with `return <definition>;` (08).
- The import is static, so it runs before any statement of the module: the prelude runs first even
  if plugin text breaks out of its function (PB4).
- With `index.js` at `code.codeBytes`, the URL stays below Chromium's 2,097,152-character cap for
  a `data:` worker (PB4).

### 3.3 Prelude

```ts
// packages/sdk/src/runtime/prelude.ts; worker.ts imports it before anything else
const removed = ["Worker", "RTCPeerConnection", "webkitRTCPeerConnection"] as const;
for (const name of removed) Reflect.deleteProperty(globalThis, name);
if (removed.some((name) => name in globalThis)) throw new Error("moxi runtime: a removed global remains");
```

- The prelude runs before any plugin statement and refuses to boot if a removed global remains (no
  `ready`; the ready deadline turns that into crash `start`, spec 10 §1.14). `Worker`: a nested
  `data:` worker runs code built at runtime under `worker-src data:` (PB3). `RTCPeerConnection`,
  `webkitRTCPeerConnection`: absent in Chromium 152 workers, deleted so an Electron update cannot
  bring them in. Main's device handler closes device APIs (03).

### 3.4 `boot` and `createRuntime`

```ts
// packages/sdk/src/runtime/runtime.ts
import type { FromWorker, ToWorker } from "../host/wire.ts"; // 07 §8 shapes, types only
export type RuntimePort = { post(message: FromWorker): void; listen(handler: (message: ToWorker) => void): void };
export function createRuntime(port: RuntimePort): {
  boot(plugin: PluginFactory): void;                    // throws on a second call
  stats(sid: number): { nodes: number; signs: number }; // test kit only (P13); 0 for a closed sid
};
```

`worker.ts` imports the prelude first, binds `self.postMessage` and `self.addEventListener` before
plugin code can replace them, and exports `boot(plugin: PluginFactory): void`, which runs
`createRuntime({ post, listen }).boot(plugin)`. `boot` checks `version` of `@vue/runtime-core`
against `__MOXI_RUNTIME_VUE__` (04 §8.7; a mismatch throws), installs the message listener and the
`error` and `unhandledrejection` listeners (each calls `preventDefault()` and posts
`error { sid: null, root: null }`), then posts `ready`. The test kit runs `createRuntime` in
process, without the prelude.

## 4. `__moxi`

### 4.1 Shape

```ts
export type SessionTimers = {
  setTimeout(fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): number;
  setInterval(fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): number;
  clearTimeout(id?: number): void;
  clearInterval(id?: number): void;
};
export type PluginFactory = (
  __moxi: { readonly vue: VueApi; readonly sdk: SdkApi },
  setTimeout: SessionTimers["setTimeout"], setInterval: SessionTimers["setInterval"],
  clearTimeout: SessionTimers["clearTimeout"], clearInterval: SessionTimers["clearInterval"],
) => unknown; // the definePlugin(...) value, checked at session open (7.1)
type VueApi = typeof import("./vue.ts"); // 4.3
type SdkApi = ReturnType<typeof sdkFor>; // session.ts; same keys as the @moxi/sdk value exports (08), elements are tag strings
```

The runtime calls the factory once per session with a fresh `__moxi` and fresh timers; session
functions reach plugin code only this way, so there is no ambient "current session". `vue` is the
allowlist namespace (4.3) with `watch`, `watchEffect`, `watchPostEffect` and `watchSyncEffect`
replaced by the wrapped versions (7.3). The timer parameters shadow the globals; timers reached
through `globalThis.setTimeout` are not tracked (rule 2).

### 4.2 `sdk` keys

| Key | Per session | Signature |
| --- | --- | --- |
| `useFact`, `useDoc`, `useSettings`, `useReference`, `useFetch`, `useFeed`, `useToast`, `useNote` | yes | 08 |
| `useNavigation` | yes; reads the current root through `inject`; throws outside a component `setup` | 08 |
| `definePlugin` (identity), `act`, `field`; one key per element (`Stack`, `List`, …) | no; an element's value is its tag string from the registry | 08; elements 09 |

`act()` and `field()` record their results in runtime-private `WeakSet`s, so the encoder (8.2)
recognizes them and plugin code cannot forge one from a plain object. Composables run only in
module scope or synchronously in a component `setup` (08 rule 7): each `use*` body throws 08's
`TypeError` when `getCurrentScope()` is undefined (a handler, a timer, after an `await`); module
code runs inside the session scope, so module scope passes.

### 4.3 Vue allowlist

`src/runtime/vue.ts` re-exports these names from `@vue/runtime-core`, and nothing else.
`@moxi/sdk/vite` fails the build on any other `vue` import (08). Adding a name is additive within
`api: 1`; removing one needs `api: 2`.

- Compiler helpers: `Fragment`, `openBlock`, `createBlock`, `createElementBlock`, `createVNode`,
  `createElementVNode`, `createCommentVNode`, `createTextVNode`, `resolveComponent`,
  `resolveDynamicComponent`, `renderList`, `renderSlot`, `createSlots`, `toDisplayString`,
  `mergeProps`, `normalizeProps`, `guardReactiveProps`, `toHandlers`, `toHandlerKey`, `camelize`,
  `capitalize`, `setBlockTracking`, `withCtx`, `withMemo`, `isMemoSame`, `mergeDefaults`,
  `mergeModels`, `useModel`, `createPropsRestProxy`.
- Reactivity: `ref`, `shallowRef`, `reactive`, `shallowReactive`, `readonly`, `shallowReadonly`,
  `computed`, `isRef`, `unref`, `toRef`, `toRefs`, `toValue`, `toRaw`, `markRaw`, `isProxy`,
  `isReactive`, `isReadonly`, `isShallow`, `triggerRef`, `customRef`, `proxyRefs`,
  `effectScope`, `getCurrentScope`, `onScopeDispose`, `watch`, `watchEffect`, `watchPostEffect`,
  `watchSyncEffect`, `onWatcherCleanup`.
- Components: `defineComponent`, `h`, `nextTick`, `provide`, `inject`, `hasInjectionContext`,
  `onBeforeMount`, `onMounted`, `onBeforeUpdate`, `onUpdated`, `onBeforeUnmount`, `onUnmounted`,
  `onErrorCaptured`, `useId`, `useTemplateRef`, `useSlots`, `useAttrs`, `getCurrentInstance`,
  `version`.

Left out on purpose: `Teleport`, `Suspense`, `KeepAlive`, `BaseTransition` and its helpers;
`withDirectives`, `resolveDirective` (a custom directive would receive internal shadow nodes);
`withAsyncContext`, `defineAsyncComponent`; `createStaticVNode`, `normalizeClass`, `normalizeStyle`,
scope-id helpers (no HTML, classes or styles); `createRenderer`, hydration and SSR names,
`registerRuntimeCompiler`; scheduler and error internals; `effect`, `stop`, `ReactiveEffect`;
`onActivated`, `onDeactivated`, `onServerPrefetch`, `onRenderTracked`, `onRenderTriggered`;
devtools and compat names.

## 5. Worker lifecycle (membrane)

The membrane (`apps/plugin-host/src/membrane.ts`, M4-09) applies these rules with
`packages/sdk/src/host/worker-guard.ts`, a pure module with an injected clock that the test kit
shares so both refuse the same things (P15, P69).

A worker session opens at the plugin session's open for an install with a granted `game.note`
(nothing is mounted; module timers run and may call `useNote`) or a `hud` widget the player turned
on (`mount` of one HUD root per widget that is on). Otherwise it opens on the first `mount`, `hub`,
`query` or `event` for that `sid` (07 §5): `hub` when the Hub first opens in that session and the
install has `hub.items`, `query` when a query routes to its `hub.scopes` or `hub.numbers`, `mount`
when a command with a component runs. `settings` goes right after `ready` and after every change.

| Check | Rule | Result |
| --- | --- | --- |
| Ready | `ready` within `worker.readyMs` of `new Worker` | else crash `start` (player text: spec 10 §1.14) |
| Ping | `ping` every `worker.pingMs`; the runtime answers `pong` at once, in the message handler; only `pong` refreshes liveness | no `pong` for `worker.pongMs`: worker terminated, crash `hang` (player text: spec 10 §1.14) |
| Late tick | a watchdog tick that runs `worker.lateTickMs` or more after its due time (the host thread stalled); the watchdog runs in the host page and relies on `backgroundThrottling: false` (03 §1.7) | no verdict; every worker's last pong counts as now |
| Unused | no open session has a mounted root or has received `hub`, the install holds no granted `game.note`, and no `query` or `request` is pending | after `worker.idleStopMs` without a break the worker is terminated (not a crash); the next need starts a new worker; module state comes back only from documents |

After a crash a worker restarts on its next need (at once with a HUD widget on or a granted
`game.note`); the crash policy is 03 §1.8 (`CrashKind`: 07, `host/port.ts`).

## 6. Message handling in the runtime

Shapes: 07 §8 (`ToWorker`, `FromWorker`, `Call`, `Release`). Messages run in arrival order, one per
task, so each message's Vue flush holds one session's work. Messages for a `sid` not open in this
worker are dropped, except `session` open.

| `ToWorker` | Runtime action |
| --- | --- |
| `settings` | replaces one worker-wide `shallowRef`; `useSettings()` reads it in every session |
| `session`, `mount`, `unmount`, `ack`, `hub`, `query` | `session` open 7.1, close 7.6; `mount`, `unmount` 7.5; `ack` 8.4; `hub`, `query` 7.4 |
| `facts` | sets each listed slice's `shallowRef` in that session (7.2) |
| `event` | looks up `sign` in the target's sign space; a `handler` entry runs `fn(payload)` (8.2). For `update:modelValue` the payload is `[value, revision]`: the runtime keeps the revision for the node and runs `fn(value)` (09) |
| `result` | a `result` entry runs `fn(result)`; never sent to an `internet` host (07 rule 7) |
| `reply`, `doc` | `reply` settles the pending request with that `id`; `doc` updates that document in each listed `sid` |
| `net`, `feed`, `feedStatus` | updates every `useFetch` or `useFeed` of that URL in every session |
| `ping` | posts `pong` with the same `seq` |

Outgoing: the `FromWorker` set (07 §8). `subscribe` carries the session's full fact set, sent each
time it grows; each `Call` goes as a `request` (per session) and each `Release` as a `release`. A
session-scoped composable posts its `release` when the session scope stops. Reference rows are
cached per worker and table, shared by all sessions.

## 7. Sessions

### 7.1 Open

On `session { sid, open: true }`:

1. Create the session record `{ scope: effectScope(true), timers, facts, roots, signSpaces,
   pending, state: "open" }`.
2. `def = scope.run(() => factory(moxiFor(session), ...timersFor(session)))` (module-level effects
   belong to the session scope). `def` must be an object; `commands` and `hud` absent or objects;
   `hub` absent or an object whose `items` and `answer` are absent or functions.
3. A throw or a bad `def`: post `error { sid, root: null, module: true, message }` (`module?: true`
   of `FromWorker.error`, 07 §8: the membrane charges crash `start`, 03 §1.8, and keeps serving
   the other sessions), set `state: "failed"` and run 7.6 steps 1 and 2. Later `mount`s for that
   `sid` answer `error { sid, root, message }` with the `start` text of spec 10 §1.14; `hub` does
   nothing; `query` answers `answers { items: [] }`.

### 7.2 Facts

The first `useFact(id)` in a session creates `shallowRef<Observed<unknown>>({ ok: false,
reason: "loading" })`, posts `subscribe` with the grown set and returns a read-only `computed` of
it; later calls with that id return the same ref. A subscription lasts until the session closes.
`facts` sets the listed slices as received (04: id lists are `Uint32Array` in both places).

### 7.3 Timers and watchers

- `setTimeout` and `setInterval` record their id in the session's set (a timeout drops it when it
  fires) and run the callback in `try`/`catch`; a throw posts `error { sid, root: null }`. A
  non-function `fn` throws `TypeError` (a string would need `eval`, which CSP blocks). Closing the
  session clears every id.
- Wrapped `watch`, `watchEffect`, `watchPostEffect`, `watchSyncEffect`: getter and callback run in
  `try`/`catch` and report like a timer; a getter that throws yields its last value. With no
  `getCurrentScope()` (in a timer, after an `await`) the watcher is created inside the session
  scope, so closing the session stops it; inside a component `setup` it belongs to the component.
  With an `errorHandler` on every app (8.5), a throwing module-level watcher never drops another
  session's flush.

### 7.4 Hub items and answers

- `hub { sid }`: the first one in a session starts a session-scoped effect that reads
  `def.hub.items()` and marks the session's Hub items dirty (8.3). It runs for the rest of the
  session, Hub open or not; later `hub` messages do nothing (07 §7). A throw keeps the host's last
  items and posts `error { sid, root: null }`.
- `query { sid, qid, text }`: calls `def.hub.answer(text)` in `try`/`catch` and awaits the promise.
  A result is dropped if a newer `query` for that `sid` arrived meanwhile; otherwise
  `answers { sid, qid, items }` goes out with at most `hub.answersPerQuery` rows in sign space
  `"hub"` (that frees the previous answer set's signs). A throw or rejection posts
  `error { sid, root: null }` and empty `items`; no `answer` function gives empty `items`.

### 7.5 Roots and navigation

- `mount { sid, root, what }`: the component is `def.commands[id]`, `def.hud[id]`, or the `view`
  entry of `what.push` (`{ from, sign }`, 8.2). Missing, or `root` already mounted: post
  `error { sid, root, message }` (the host marks that root failed). Otherwise
  `createApp(component, props)` with `app.config.errorHandler` (8.5) and
  `app.provide(ROOT, { sid, root })`, then `app.mount(container)` on node 0 of the root.
- `unmount { sid, root }`: mark the root `discard`, `app.unmount()`, free its sign space and
  nodes; a later `ack` for it is ignored.
- `useNavigation().push(view, props)` allocates a one-shot `view` sign in the current root and
  posts `navigate { root, to: { push: sign } }`. The Hub mounts a new root with
  `what: { push: { from: root, sign } }` (07 §7, 10), which frees the sign. `pop()` posts
  `navigate { root, to: "pop" }`. Each pushed level is its own root; the host owns the stack.

### 7.6 Close

On `session { sid, open: false }` (sent when the session ends: character select, login, `unknown`,
page reload, game renderer death, window close; 07 §5):

1. Mark every root of the session `discard`, unmount each app (no op is posted), stop the session
   scope and clear the session timers.
2. Free every sign space of the session; settle pending requests with each composable's failure
   value (08); post `release` for its open URL subscriptions.
3. Delete the session; leftover plugin code (a late promise) posts nothing for it. The host drops
   the session's roots itself (10); a closed session's objects are collectable (P10, P13).

## 8. Renderer

### 8.1 Shadow tree and ops

`createRenderer(nodeOps)` from `@vue/runtime-core`. Elements are tag strings (4.2), so `<List>`
makes a renderer element directly. Node ids are positive integers per root from 1, never reused
while the root lives; the root container is node 0; detached nodes emit nothing. `nodeOps` never
throw (a throw inside Vue's patch desynchronizes Vue and the shadow tree), so unknown tags and
undeclared names are dropped and reported. Op codes: 07 §6.1.

| `nodeOps` call | Shadow tree | Ops (only when the node is or becomes attached to a root) |
| --- | --- | --- |
| `createElement(tag)` | element with the tag's registry index; an unknown tag makes an inert node that is never sent (and posts `error { root: null }`) | none yet |
| `createText(text)`, `createComment()` | text node (`createComment` makes `""`: Vue uses comments as insert anchors) | none yet |
| `insert(child, parent, anchor)` | moves `child` | child not attached yet: its subtree first (CREATE or TEXT, its PROPs and EVENTs, an ITEMS entry for a collection, then each child's subtree followed by `INSERT(node, child, 0)`), then `INSERT(parent, child, anchor ?? 0)`; already attached: the INSERT only |
| `remove(child)` | detaches | `REMOVE(child)`; frees the subtree's signs |
| `setText(node, text)` | | `SET_TEXT` |
| `setElementText(el, text)` | children replaced by one new text node | `REMOVE` per old child, `TEXT`, `INSERT` |
| `patchProp(el, key, prev, next)` | stores `next` | `on<Event>` declared for the element → `EVENT`; the element's collection prop → ITEMS entry (8.3); any other declared prop → `PROP` (8.2); undeclared → dropped, `error { root: null }` once per (root, tag, name) |
| `parentNode`, `nextSibling` | reads | none |

### 8.2 Values and signs

The encoder turns a prop value, a row or an answer into a `PropValue` or `Row` (07 §6.2):

| Value in the worker | Encoded |
| --- | --- |
| `null`, booleans, finite numbers | as is |
| strings | as is; longer than `view.textChars`: cut by 05 rule 7 (the applier makes the exact cut) |
| `undefined` as an object field | field left out |
| arrays; objects with prototype `Object.prototype` or `null` | member by member; a key starting with `$` is an encode error |
| `Float32Array`, `Float64Array`, `Uint8Array`, `Uint32Array` | as is (cloned, never transferred) |
| a `modelValue` prop (registry `model: true`, 09) | `[value, revision]`: `revision` is the newest the runtime received in `update:modelValue` for that node (0 before any) |
| a function | `{ $fn }`; sign kind `result` under the key `onResult`, else `handler` |
| an object or function under the key `push` (a component) | `{ $view }`, sign kind `view` holding `{ component, props }`; `props` stays in the worker |
| a value from `act()` | `{ $game: { op, args } }`; an args value from `field()` becomes `{ $field }` |
| anything else: `NaN`, `Infinity`, bigint, symbol, `Map`, `Set`, `Date`, other typed arrays, class instances, a `field()` outside `act()` args, cycles, nesting deeper than `wire.maxDepth` | encode error |

An encode error in a PROP holds the root (8.5) and the value is not sent. An encode error in a row
leaves that row out and posts `error { root: null }`.

```ts
type SignEntry =
  | { kind: "handler"; fn: (payload: unknown) => unknown }
  | { kind: "result"; fn: (result: ActionResult) => unknown } // ActionResult (spec 04, `host/catalog.ts`): the executor's outcome of one game action as the worker sees it; the per-step report to Main is `ActionReport` (spec 13)
  | { kind: "view"; component: object; props?: object };
// One Map<number, SignEntry> per sign space (07 §6.2: each root, "hub" per session); numbers count up from 1, never reused.
```

- **Element events:** one sign per (node, event); a new handler replaces `fn` and sends nothing
  (handler identity de-duplication, P12).
- **Signs inside values:** per holder (a node's prop, a collection row by id, a Hub item by id) the
  runtime keeps the last sent encoding and compares it with the new one, `$fn` and `$view` numbers
  masked. Equal: nothing is sent; the existing signs get the new functions, components and props by
  path. Different: the whole value goes out with new signs for every function in it and the old
  signs are freed, so a press on an action whose row changed finds no sign.
- An `event` or `result` for a missing sign, or one of another kind, is dropped silently; a throw
  or rejection from `fn` posts `error { sid, root: null }`. A mount with `what.push` takes the
  `view` entry from space `from`; a `navigate` push sign is freed by that mount, a row's `push` sign
  lives as long as the row.

### 8.3 Collections and Hub items

Rows are objects with a string `id`, unique in the collection (08, 09). Each collection node, and
each session's Hub items, keeps the **host copy**: the encoded rows and id order that sent batches
have given the host. A changed collection prop only marks the node dirty (one ITEMS entry in the
root's queue); the diff runs at send time, so any burst of changes while a batch is in flight
becomes one valid ITEMS patch:

- rows whose source object differs from the last diff are encoded and compared as in 8.2; changed
  or new rows are upserts, in the new array's order;
- ids missing from the new array are removed;
- `order` is `null` when the new id sequence equals the host's ids (minus removed ones, in host
  order) followed by the new ids (in new order); else the full new sequence.

A row without a string `id`, or a repeated id, is left out and posts `error { root: null }`. Rows
beyond `view.rowsPerCollection` or `hub.itemsPerSession` are still sent; the host counts them and
shows "N more not shown" (05).

### 8.4 Send and backpressure

- **Buffers:** one op queue per (session, root) and one dirty flag per session for Hub items; no
  batch or worker message mixes sessions or roots (07 §7).
- **Send point:** the first op written into any queue during a Vue flush registers one
  `queuePostFlushCb(send)`. `send` runs at the end of that flush (a microtask; for a `mount` or
  `unmount` at the latest in that message task's microtask checkpoint) and posts one `ops` (with
  `seq` + 1) or `items` message per dirty target with nothing in flight: at most one unacked `ops`
  message per root (`wire.unackedPerRoot`) and one `items` message per session. An `ack` with the
  matching `seq` clears the in-flight mark and sends that target's waiting ops at once. The worker
  uses no timer chain and no `requestAnimationFrame`: Vue's post-flush callback is always a
  microtask, so it needs no `setTimeout(0)` fallback. The membrane forwards by microtask with a
  `setTimeout(0)` fallback, never `requestAnimationFrame` (07 §7; 01 decision 32).
- **Merge while waiting:** a PROP, SET_TEXT or EVENT for a (node, key) already in the unsent queue
  replaces that entry's value in place (freeing signs it held); ITEMS entries merge by construction
  (8.3); CREATE, TEXT, INSERT and REMOVE keep their order. Invariant (P15): the sent batches,
  applied in order, give the same host tree as every change applied one by one, and each is valid
  for the decoder (07 §6.4).
- **Size:** a batch stays within `wire.batchBytes` and `wire.batchTypedBytes` (`wireSize`, 07 §6.3)
  and ends only where no node created in it is still detached. An ITEMS entry that does not fit is
  split by upserts into parts of at most `wire.itemsChunkBytes` (`remove` in the first part,
  `order` only in the last), one per `ack`; a part that cannot be cut smaller (one huge subtree) is
  sent whole, and the decoder ends that root as too large (07 §6.4).
- **Answers** are not acked and not merged; a newer `qid` replaces them.

### 8.5 Errors and the last good tree

`app.config.errorHandler(err, instance, info)`: in Vue's production build `info` is
`https://vuejs.org/error-reference/#runtime-<code>`.

- Code `0` (setup) or `1` (render): **hold** the root and post `error { sid, root, message }`.
- Any other code (watchers inside components, component event handlers, lifecycle hooks): post
  `error { sid, root: null, message }`.

A held root keeps its last good tree on the host (PB6). In the flush where the root is held, its
queued ops are dropped and nothing is sent for it. Vue has replaced the failed subtree with a
comment; the host marks the kept tree inert and shows the error mark (07 §7, 10); the removed
nodes' signs are already freed, so presses on the held view find no sign. The root is marked
`stale` (an encode error in a PROP, 8.2, holds a root the same way). The next flush that writes
ops for that root without a new hold sends `RESET`, then the whole current subtree, built as in
8.1 (ITEMS from an empty host copy) and chunked as in 8.4; existing ids and live signs are reused
(07 §6.1).

`error.message` is cut to `view.textChars`. Every `error` counts toward `worker.errorsPerMinute`
(05, 07 §8; crash `errors`).

## 9. Memory and Vue version

- `M = H × b + P × w + S × P × s`: H plugin hosts (1 to `host.max`), b ≈ 19 MiB per empty host, P
  running plugins, w ≈ 6 MiB per worker with the runtime, S sessions, s per extra session (PB1: w
  5.95–6.77 MiB, s 0.85–0.94 MiB; PB6 heap 47–439 KiB). Targets and the P11 rule (w above 6 MiB on
  the pruned runtime → slim HUD runtime): 01 §1.6.
- The runtime's Vue is `RUNTIME_VUE` (04 §8.7). Main refuses a package whose `vueCompiler` is
  newer (`checkHost`, 04). Every Vue bump runs P19 with the oldest supported compiler (3.5.0) and
  the newest.

## 10. Decisions

| Decision | Reason | Rejected |
| --- | --- | --- |
| Factory per session in one worker per install | memory grows with plugins, not plugins × accounts; module state cannot cross accounts (PB6) | one shared module scope (per-account state leaks between windows); a worker per (install, window) |
| Runtime from `code/<sha>.js`, only plugin code in `data:`; static `import` in the boot module | runtime fixes reach every plugin; the wire stays private; the `data:` cap is 2,097,152 characters; the prelude runs before any plugin statement (PB4) | runtime inside each bundle (freezes the wire); runtime inside the `data:` URL (code budget would fall to 0.75 MiB); dynamic `import()` |
| Session functions through `__moxi`; timers through shadowing parameters | no ambient session to get wrong after `await` or in a timer; timers stop with their session | a global current session; patching `globalThis.setTimeout` (changes the runtime and every session) |
| Buffers per (session, root), sent at the end of each Vue flush; ITEMS diff at send time against the host copy | one global buffer corrupts trees; a later send point makes a light session wait for a heavy one (PB6 review: 41.6 ms against 3.0 ms); any burst becomes one valid patch, no merge algebra | one global buffer; a `setTimeout(0)` or frame-based send point in the worker; merging queued ITEMS ops |
| Last good tree by hold, then `RESET` and a snapshot | stock Vue blanks a view whose render throws (PB6) | stock Vue; replaying from Vue internals |
| Signs kept when the value is equal with signs masked | 0 ops for re-created closures (P12); a changed value gets new signs, so a stale press runs nothing | signs keyed by path only (a stale press could run another action) |
| Elements are tag strings; an explicit Vue allowlist; Options API off in the runtime build (authors use Composition API) | no component instance per element; a Vue bump cannot widen `api: 1` by accident; smaller runtime while w is borderline, and turning the Options API on later is additive | a Vue component per element; every `runtime-core` export; Options API on |
| Each pushed view is its own root | the host owns the stack and the Escape ladder; levels keep their trees | a stack inside one root (the host cannot pop without the worker) |
| A granted `game.note` keeps the worker running in a session | reminders and timers fire without any surface | a `background` manifest field (a second owner for one fact) |
| Membrane worker checks in a pure module shared with the kit | kit and host refuse the same things (P15, P69) | a kit that re-implements the checks |

## 11. Today in code (main 848fb6e) and what changes

M1-00 moves the old SDK files under `packages/sdk/src/legacy/` (so `src/runtime.ts` and the new
`src/runtime/` do not clash); M6-03 deletes them.

| Today | Change |
| --- | --- |
| `packages/sdk/src/runtime.ts:11-214`: `startRuntime(port, setup)`, one plugin instance per worker; `:141-146` `init` posts `ready` even after a throw | `packages/sdk/src/runtime/` (this spec); `ready` from `boot`, module errors per session (7.1) |
| `packages/sdk/src/surfaces.ts:12-37`: whole trees re-serialized per change; `:15-22` a throwing render keeps the previous tree | op batches per (session, root); hold and `RESET` |
| `scripts/build-plugins.ts:21-25`: runtime bundled into every plugin; `apps/desktop/src/shell/main.ts:42-47`: scheme without `corsEnabled` | `code/<sha>.js` from `scripts/build-runtime.ts`; `corsEnabled: true` (M2-07, 03) |
| `apps/plugin-host/src/index.ts:12-20`: `data:` URL of `encodeURIComponent(whole bundle)`; `:36-69` one `PluginHost` and worker per plugin per game window | base64 `data:` URL of `bootModule()`; one worker per install, sessions inside it (`membrane.ts`, M4-09) |
| `apps/plugin-host/src/plugin-host.ts:149-163`: watchdog 1 s / 2.5 s, any message is a pong, no late-tick rule, ready deadline or idle stop; `:54-55` batching by `requestAnimationFrame` | section 5 in `worker-guard.ts`; no frame-based batching anywhere |
| `packages/sdk/src/index.ts:5-7, 51-54`: `definePlugin` stores `globalThis.__moxiPluginSetup`; `package.json`: `@vue/reactivity` 3.5.43 only | `__moxi` argument, deleted in M6-03; adds `@vue/runtime-core` 3.5.43, exact |

Port closely, with tests (`docs/build/README.md`): the PB6 prototype
`rewrite-research/probes/04-session-factory/src/{ops-renderer.mjs,runtime.mjs}` and the PB4
bootstrap and handler in `probes/PB1-PB4/main.cjs` on branch `probe/PB1-PB4` (tag
`archive/probe-PB1-PB4` after M0-07).

## 12. Built by

| Slice | Builds from this spec | Budget |
| --- | --- | --- |
| M2-01 Runtime renderer | 3.3, 8.1, 8.2, 8.4 send point, 8.5 | ≤ 500 |
| M2-02 Plugin sessions | 4.1, 6, 7 (open, facts, timers, watchers, Hub items, answers, roots, close) | ≤ 350 |
| M2-03 Collections and backpressure | 8.3, 8.4 merge and size; `worker-guard.ts` (in flight, flood) | ≤ 300 |
| M2-04 Composables | `composables.ts` on the 07 §8 messages; 4.2 keys | ≤ 400 |
| M2-05 Test kit | the kit runs `createRuntime`, `worker-guard.ts` and the 07 decoder in process | ≤ 450 |
| M2-07 Runtime bundle and boot | 3.1, 3.2, 3.4, 4.3; `corsEnabled`; the P11 Measure job | ≤ 250 |
| M4-09 Membrane | adds the ready, ping, late-tick and idle checks to `worker-guard.ts`; the worker lifecycle (section 5) in `apps/plugin-host/src/membrane.ts` | ≤ 350 (whole slice) |

## 13. Checked by

| Proof | Half | Owner | What it checks here |
| --- | --- | --- | --- |
| P9 | N, E | M2-01, M6-02 | N: the kit's serialization equals the host tree the runtime's ops build, 40 of 40 steps; a render error keeps the last good tree on both sides. E: the same in the fixture app (CI) |
| P10 | N, E | M2-02, M5-06 | N: `packages/sdk/src/runtime/sessions.test.ts`: 3 sessions with distinct facts and a module counter; a throw in session 2 leaves 1 and 3 rendering; `globalThis` and `Array.prototype` writes in session 1 are visible in session 2. E: 1 worker per install for 2 windows; character select and window close end 1 session and 0 workers |
| P12 | N | M2-03 | HUD fact change ≤ 2 ops; renaming 1 row of 1,000 = 1 ITEMS with 1 upsert, 0 other ops (B half, theme switch: M3-02) |
| P13 | N | M2-01 | 1,000 mounts and unmounts of a 200-row view: `stats(sid)` nodes 0 and signs 0 after each unmount (Gate); heap growth ≤ 1 MiB after forced GC (Measure) |
| P15 | N | M2-03 | flood: at most 1 batch in flight per root; final host tree = final worker tree; a raw `postMessage` bypass crashes at its second unacked batch (B half with the applier: M3-02) |
| P19 | N | M2-07 | kitchen sink built with compiler 3.5.0 and the newest: op streams equal the golden P9 stream |
| P11 | Measure | M2-07 | w, s and host memory on the pruned runtime, median of 5, CI |
| P3 | E | M5-10 | nested `new Worker(data:)` row: the prelude removed `Worker` (16) |
| P80–P83 | – | – | test nothing here; P81 and P82 rely on rule 4: no worker message starts an action |

| Regression test (N, `pnpm gate`) | Bug it catches |
| --- | --- |
| an update whose render throws sends no ops for that root; the next good update starts with `RESET`; a press on a sign of the held tree runs nothing | stock Vue blanks the view; a stale press runs a handler of the failed tree |
| on a fake clock, a session's `setInterval` callback never runs after `session` close | a closed session keeps running and stays in memory |
| a throwing module-level `watch` in session 1 does not stop session 2's update in the same flush | Vue's dev build drops the whole flush (PB6) |
| a row whose action title changes gets a new sign; the old sign runs nothing | a stale press runs a different action |
| 5,000 list changes while a batch is unacked give one ITEMS patch, valid for the decoder | merged patches remove unknown ids or grow without bound |
| a module throw in session 2: session 1 keeps rendering; session 2's mounts answer `error` | one session's failure stops the install everywhere, or its views hang empty |

## 14. Deferred

- **Slim HUD runtime** (reactivity and HUD ops, no `runtime-core`) for HUD-only plugins: only if
  the P11 Measure shows w above 6 MiB on the pruned runtime (01 §1.6).
- **Busy-time reports** from the runtime, as a hint for the CPU burner search: with that search
  (M14-04, 03 §8).
