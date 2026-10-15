# 02 Packages and boundaries

Which packages exist, what each may import, and the Hub's three typed inputs (game, plugin hosts,
Main). Every rule is a lint rule in the root `vite.config.ts` or a type; no test reads source text.

## 1. Rules in force

1. Code imports another workspace package only through a package entry (`@moxi/<name>` or a
   listed subpath), never a relative path.
2. The allowed imports (section 3) have no cycles (review refuses one); `package.json` follows them.
3. `packages/hub` reaches the game only through `GameBridge`, the plugin hosts only through
   `HubPort`, Main only through `HubMain` (section 5), and never imports `@moxi/gwkit`,
   `electron` or a value from `@moxi/contracts`: an applier bug has no code path to game memory,
   sockets or IPC.
4. `@moxi/sdk/host` defines every plugin-protocol shape once: ids, catalog, manifest, package,
   element registry, wire ops, port and worker protocols, intents, page model, action types,
   `Platform`, `KeyChord`, `KeyCode`, `GameState` (values: spec 13). `packages/contracts` owns the
   IPC channels, the Main→renderer events and the records only they carry (`KeyBinding`,
   `AppearanceSettings`, the Hub layout records); it imports SDK types and re-exports `Platform`,
   `KeyChord` and `GameState`.
   `packages/ui` and `packages/hub` import contract types only. The `key` setting and `KeyField`
   hold `KeyCode | null`, not `KeyBinding` (spec 11).
5. `@moxi/sdk/host` uses only ECMAScript and web-standard globals present in Node 24, renderers
   and workers (`URL`, `TextEncoder`, `crypto.subtle`, `structuredClone`): it loads in Main, every
   renderer and Vitest.
6. Four host modules are **runtime-safe**: `host/budgets.ts`, `host/elements.ts`, `host/wire.ts`,
   `host/port.ts`. They import no external module and value-import only each other. The worker
   runtime value-imports only these from `host/`, so its bundle carries no ArkType.
7. The packaged app ships no `node_modules`: every package Main imports is in `alwaysBundle` in
   `apps/desktop/vite.config.ts`, added in the change that adds the import.
8. Relative imports in new packages and files end in `.ts` (Node runs TypeScript in tools);
   packages with another style keep it (contracts `.js`, gwkit none).
9. No folder inside a package carries a sibling package's directory name, and a folder named
   `apps`, `packages`, `plugins` or `tools` inside a package has no sub-folders (the regex in
   section 7 relies on both).
10. A new package, entry or dependency adds its lint row in the same pull request.

## 2. Package map

| Directory | Package | Job | P79 counts |
| --- | --- | --- | --- |
| `apps/desktop` | `@moxi/desktop` | Main; plugin services in `src/plugins/` (specs 03, 12, 13, 14, 15), `src/feeds.ts` (15); Electron only in `src/shell/` (`input.ts`: 11) | core: `src/plugins/**` |
| `apps/launcher` | `@moxi/launcher` | launcher; Plugins section in `src/plugins/` (M7-04) | core: `src/plugins/**` |
| `apps/game` | `@moxi/game` | client host, gwkit runtime, port router, fact publisher, executor; mounts `@moxi/hub` | – |
| `apps/plugin-host` | `@moxi/plugin-host` | hidden renderer: membrane only | core: `src/**` |
| `packages/contracts` | `@moxi/contracts` | IPC channels, Main→renderer events, ArkType schemas, IPC-only records | – |
| `packages/gwkit` | `@moxi/gwkit`, `@moxi/gwkit/locate` | game side (runtime, readers, action calls, game state); build side (parse, match, locate) | – |
| `packages/sdk` | `@moxi/sdk`, `/host`, `/runtime`, `/testing`, `/vite` | author API, host tables, worker runtime, test kit and sim, Vite plugin | core: `src/{host,runtime}/**`, `src/index.ts`; report only: `src/{testing,vite}/**` |
| `packages/ui` | `@moxi/ui` | tokens, theme, one component per element, `PluginPage.vue` | elements: `src/elements/**` |
| `packages/hub` (new) | `@moxi/hub` | Hub shell, applier, HUD layer, panels, toasts, action UI, dev page | report only |
| `packages/cli` (new) | `@moxi/cli` | bin `moxi` (spec 08) | report only |
| `packages/create-moxi-plugin` (new) | `create-moxi-plugin` | scaffolder and `template/` (spec 08) | – |
| `plugins/*` | `@moxi/plugin-<name>` | official SFC plugins | – |
| `tools/fixture-client` | `@moxi/fixture-client` | fixture client, fixture-world, fixture-actions | – |
| `compat/` | – | role specs; signed locator and capability files (generated) | – |

P79 counts product code that runs; `src/legacy/`, tests, fixtures and generated tables never
count. Groups, caps and counting rules: spec 01 §4 (`pnpm lines`, built in M1-00).

## 3. Allowed imports

Bare specifiers are exact (a subpath is its own entry). Relative imports inside one package are
free unless the last column restricts them.

| Files | May import | Types only | Restricted relative imports |
| --- | --- | --- | --- |
| `packages/sdk/src/host/**` | `arktype`; the files `{budgets,elements,wire,port}.ts` import none | – | no `../runtime/`, `../testing/`, `../vite/`, `../legacy/`, `../index.ts`; the four files take values only from each other |
| `packages/sdk/src/runtime/**` | `@vue/runtime-core` | – | values from `../host/` only the four runtime-safe files; no `../testing/`, `../vite/`, `../legacy/` |
| `packages/sdk/src/index.ts` | – | – | values from `./runtime/`; types only from `./host/` |
| `packages/sdk/src/testing/**` | `@vue/runtime-core` | – | no `../vite/`, `../legacy/` |
| `packages/sdk/src/vite/**` | `vite`, `@vitejs/plugin-vue`, `@vue/compiler-sfc`, `node:*`, builtins | – | no `../runtime/`, `../testing/`, `../legacy/` |
| `packages/sdk/src/legacy/**` (until M6-03) | `@vue/reactivity` | – | – |
| `packages/contracts/**` | `arktype`, `@moxi/sdk/host` | – | `src/windows.ts` imports nothing (preloads bundle it) |
| `packages/gwkit/**` | `arktype` | – | – |
| `packages/ui/**` | `vue` | `@moxi/sdk/host`, `@moxi/contracts` | – |
| `packages/hub/**` | `vue`, `@moxi/ui`, `@moxi/ui/*`, `@moxi/sdk/host`; `dev/**` adds `@moxi/sdk/testing`, `@moxi/sdk/runtime` | `@moxi/contracts` | – |
| `packages/cli/**` | `@moxi/sdk/host`, `@moxi/sdk/vite`, `@moxi/sdk/testing`, `@moxi/hub`, `vite`, `node:*`, builtins | – | – |
| `packages/create-moxi-plugin/**` | `node:*`, builtins | – | – |
| `plugins/**`, `packages/create-moxi-plugin/template/**` | `@moxi/sdk`, `vue` | – | – |
| `apps/desktop/**` | `@moxi/contracts`, `@moxi/contracts/windows`, `@moxi/sdk/host`, `@moxi/gwkit/locate`, `arktype`, `ws` (M7-02), `node:*`, builtins; `src/shell/**` adds `electron`, `electron-updater` (M9-10) | – | – |
| `apps/launcher/**` | `vue`, `@moxi/contracts`, `@moxi/ui`, `@moxi/ui/*`, `lucide-vue-next` | – | – |
| `apps/game/**` | `@moxi/contracts`, `@moxi/gwkit`, `@moxi/hub`, `@moxi/sdk/host` (no `vue`, no `@moxi/ui`) | – | `src/facts.ts`: no `./actions.ts`, `./hub.ts` (P82: no path from facts to actions) |
| `apps/plugin-host/**` | `@moxi/contracts`, `@moxi/sdk/host` | – | – |
| `tools/**` | `@moxi/desktop/game-files`, `@moxi/gwkit`, `@moxi/gwkit/locate`, `wabt`, `node:*`, builtins | – | – |
| `**/*.test.ts`, `**/test/**`, `e2e/**`, `scripts/**`, `**/vite.config.ts` | any | – | never into another package |

Until M6-03 the old SDK stays usable (rows added in M1-00): `plugins/**` may also import
`@moxi/sdk/legacy` and `@moxi/sdk/legacy/testing` (tests); `apps/game/**`, `apps/plugin-host/**`
and `scripts/build-plugins.ts` may also import `@moxi/sdk/legacy/host`. The old Hub
(`apps/game/src/hub/`) runs on it until M5-06 switches the game window to `@moxi/hub`.

## 4. Files inside the packages

Paths are under `packages/sdk/src/` unless a package is named; `*` = runtime-safe (rule 6).

| File | Holds | Owner (spec) | Slice |
| --- | --- | --- | --- |
| `index.ts`, `host/index.ts`, `host/ids.ts` | `@moxi/sdk`: public types from `host/`, author API (M2-04); `@moxi/sdk/host` entry; ids with their patterns (`PLUGIN_ID`, `SOURCE_KEY`, `INSTALL_KEY`, `ROOT_ID`) and schemas | 08, 01 | M1-01 |
| `host/catalog.ts`, `host/manifest.ts` | catalog, fact value types and schemas, `Observed`, `Unavailable`, `ActionResult`, `Refusal`, `Profession`; manifest v1 | 04 | M1-01; M1-03 |
| `host/budgets.ts` *, `host/elements.ts` *, `host/wire.ts` *, `host/port.ts` * | budget constants; element registry; `wire.ts`: op batch codec, signs, `PropValue`, `Row`, `wireSize`, decoder, worker protocol; `port.ts`: game renderer ↔ plugin host messages, `CrashKind`, decoders | 05, 09, 07 | M1-02; M1-04; M1-05, M2-01, M2-02, M4-01 |
| `host/package.ts`, `host/page.ts`, `host/updates.ts` | `.moxi` format; `pageModel()`, `decideUpdate()` (Main calls both; no `page.ts` or `updates.ts` under `apps/desktop/src/plugins/`) | 15, 12 | M1-06, M1-07 |
| `host/tree.ts`, `host/routing.ts`, `host/actions.ts` | retained host tree (apply, budgets, `serializeTree`) shared by the applier and the test kit; pure `routeQuery`, imported by `packages/hub`; `ActionRequest`, `ActionDecision`, `ActionReport`, `StepState`, `ChainProgress` and pure `authorize(input: AuthorityInput)` (Main and the test kit call it) | 08, 10, 13 | M2-05; M3-01; M3-07, M4-07 |
| other `host/*.ts` | `worker-guard.ts` (the membrane's per-worker checks; M2-03, M4-09), `keys.ts` (11), `grants.ts`, `settings.ts` (12), `icons.ts`, `register-text.ts` (04), `bucket.ts` (05), `boot.ts` (06), `sdk-types.ts` (08), `data.ts`, `urls.ts` (14) | owner spec | its file table |
| `runtime/` | worker runtime; the `./runtime` entry is `runtime.ts` (tooling only: dev page worker, runtime build; Main serves the built `runtime-api1.js`, whose build entry is `worker.ts`) | 06 | M2-01..M2-04, M2-07 |
| `testing/`, `vite/` | `mountPlugin`, `sim` (exported by `@moxi/sdk/testing`), fixture reference tables; Vite plugin | 08 | M2-05; M2-06 |
| `legacy/` | old SDK; entries `./legacy`, `./legacy/host`, `./legacy/testing` | – | M1-00; deleted M6-03 |
| `packages/hub/src/{index,bridges,main-link}.ts`, `hub.contract.test.ts`, `test/vite.config.ts` | `mountHub(roots, deps)` (section 5; the one shape, also in spec 10 §2.2); `HubMain` (spec 10 §2.2) with its records in `packages/contracts/src/hub.ts` (types: M3-01; ArkType schemas: M4-01); the Hub suite, which `test:hub` runs; other Hub files: spec 10 | 02, 10 | M3-01; M4-01 (`hub.ts` schemas) |
| `packages/hub/src/applier.ts`, `packages/hub/dev/` | op applier over `host/tree.ts`, second decode pass; page for `pnpm hub` and `moxi dev`: section 5 over `sim` | 07, 09 | M3-02; M6-03 |
| `apps/game/src/{hub,ports,facts,actions}.ts` | `hub.ts` builds `GameBridge` and the multiplexed `HubPort`, implements `HubMain` over `window.moxi`, calls `mountHub(roots, deps)` with the four layer elements of spec 10 §1.1; `ports.ts` is the port router (section 6); `facts.ts` is the fact publisher, binding gwkit's `readers` (keyed by fact id strings, `"game.player"`) with `satisfies Record<FactId, Reader>`, so a fact without a reader is a type error and adding a fact changes no `apps/game` file; `actions.ts` is the executor implementing `GameBridge.act` | 02, 13 | M5-06; M5-07; M5-08 |
| `packages/gwkit/src/index.ts`, `src/locate/index.ts` | entries `.` and `./locate`. `.`: `createRuntime`, game state, `readers` (`src/game/`), action calls, type `Locator`. `./locate`: `parseModule`, `decodeBody`, `callGraph`, `fingerprint`, `exactBodyHash`, `matchBuilds`, `loadRoleSpecs`, `loadLocator`, `locate`, `capabilitySupport` (the one "Works with this game build: N of M" function; spec 15 calls it), `WasmError` | 13 | M5-04 |
| `apps/plugin-host/src/membrane.ts` | replaces `plugin-host.ts`, `worker-messages.ts`, `documents.ts`, `dev/main.ts`; adds Workers, IPC and the watchdog to the membrane decisions the test kit repeats (decode, budgets, backpressure, fan-out by grant), which are pure functions in `@moxi/sdk/host` | 03, 06 | M4-09 |
| `packages/cli/src/moxi.ts`, `packages/create-moxi-plugin/src/index.ts`, `template/` | bin and scaffolder | 08 | M7-06 |

## 5. The Hub's three inputs

```ts
// packages/hub/src/bridges.ts
import type { ActionRequest, ActionResult, Anchor, ChainProgress, HostFacts, Sid, ToGame,
  ToHost } from "@moxi/sdk/host";
import type { HubMain } from "./main-link.ts";
export type Subscribable<T> = { subscribe(listener: (value: T) => void): () => void }; // calls at once, then on change
export type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
/** What the Hub may know about the game in its window. Host copies; never sent to a plugin host. */
export type GameView = {
  readonly session: { readonly sid: Sid } | null;  // null: no open session (`loading` changes nothing, spec 07 §5)
  readonly facts: HostFacts;                        // for available(), confirm(), whisper targets, chain region
  readonly anchors: ReadonlyMap<Anchor, Rect>;      // game anchors in page CSS pixels; empty until M11-11
};
export type ActOptions = {
  readonly signal: AbortSignal;                                // cancels every step not yet started
  readonly onProgress: (progress: ChainProgress) => void;      // chains and multi-call actions ("2/4"); spec 13 §7.4
};
/** The Hub's only path to the game. */
export interface GameBridge {
  readonly view: Subscribable<GameView>; // facts out
  /** Game clock in ms: monotonic, read from the game renderer; a fake clock in tests.
   *  Countdowns tick on it (spec 10 §1.9). */
  now(): number;
  /** Action requests in, after a trusted press. Asks Main (`plugin.action.authorize`, origin "player";
   *  a Dev QA run makes Main treat it as "agent", spec 13); only on `ok` runs the executor at a
   *  safe point. Rejects only on an invariant failure. */
  act(request: ActionRequest, options: ActOptions): Promise<ActionResult>;
}
export type HubToHost = Extract<ToHost, { t: "hub" | "mount" | "unmount" | "event" | "query" | "result" | "ack" }>;
export type HostToHub = Extract<ToGame, { t: "ops" | "items" | "answers" | "root" | "stopped" | "toast" | "navigate" }>;
/** Every plugin host of this window as one object. `apps/game` multiplexes the per-host ports
 *  (section 6): `post` goes to the host the message's install is bound to (a `hub` message is
 *  split per host); `listen` receives from all hosts. Incoming messages are decoded and
 *  install-checked (section 6). A restarted host is a new port inside; the Hub shows its state
 *  from `HubInstall.state` (spec 10). */
export interface HubPort {
  post(message: HubToHost): void;
  listen(handler: (message: HostToHub) => void): () => void;
}
// packages/hub/src/index.ts: mounts Hub, HUD layer, panels and toasts into the four layer
// elements (spec 10 §1.1); the platform comes from HubMain.platform
export declare function mountHub(
  roots: { hud: HTMLElement; panels: HTMLElement; hub: HTMLElement; toasts: HTMLElement },
  deps: { plugins: HubPort; game: GameBridge; main: HubMain },
): { unmount(): void };
```

Type owners (all in `@moxi/sdk/host`): `Sid` spec 01; `HostFacts`, `Anchor`, `ActionResult`
spec 04; `ToHost`, `ToGame` spec 07; `Platform` spec 11; `ActionRequest`, `ChainProgress`
spec 13. `HubMain` and its records (`HubLayout`, `HudPlacement`, `PanelPlacement`,
`HubMark`, in `packages/contracts/src/hub.ts`): spec 10 §2.

`HubMain` gives the Hub only (channel and event names are spec 07's): events for chord presses
(`hub.toggle`, `hub.command`), `plugins.changed`, `plugin.state` (installs with host binding,
grants and host states; `killed`, the game-build compatibility status; key binding labels) and
`appearance.changed`; calls for the page model (`plugins.page`), grant, deny and enable
(`plugins.grant`, `plugins.enable`), key binding (`keys.bind`), the layout, HUD and panel
placements, the HUD switch and the marks (`hub.layout.get`, `hub.hud.save`, `hub.panel.save`,
`hub.hud.on`, `hub.marks.get`, `hub.marks.save`), reference names for host labels (`ref.get`),
opening a `link:` or wiki address (`plugin.link.open`), "Start plugins" (`plugins.run`) and
`appearance.get` (the Hub applies the look of what it draws). Never `plugin.action.authorize` (inside `act`), `game.net.*`,
`game.dns`, `game.client*`. `apps/game/src/hub.ts` implements it over `window.moxi`; the type
checker proves every call has a channel in the game window's list.

## 6. Port routing in the game renderer

One `MessagePort` per (game window, plugin host), brokered by Main; every message carries `sid`.
`apps/game/src/ports.ts` owns each port:

1. Decodes every incoming message with the decoder in `host/port.ts` (spec 07). A message that
   fails, or names an install Main did not bind to this host (I7), is dropped and reported as a
   fault of that host (spec 03).
2. Host → game: `ops`, `items`, `answers`, `root`, `stopped`, `toast`, `navigate` go to the Hub;
   `subscribe` goes to `facts.ts`. A note does not use the port (worker → membrane →
   `plugin.note` → `game.note` event, spec 13).
3. Game → host: `hub`, `mount`, `unmount`, `event`, `query`, `result`, `ack` come from the Hub;
   `facts` only from `facts.ts`; `session` only from the game side, before any other message
   for its `sid` (spec 07 §5).
4. Class guard (I3, spec 07): toward an `internet` host it throws on `facts`, `result` and a
   `query` on the `hub.search` route (it carries its route): a host bug, never a plugin fault.

## 7. Lint configuration

```ts
// root vite.config.ts
const packageDirs = ["cli", "contracts", "create-moxi-plugin", "gwkit", "hub", "sdk", "ui"];
const appDirs = ["desktop", "game", "launcher", "plugin-host"];

// A relative path never leaves its package: no `<apps|packages|plugins|tools>/<name>/…`, no sibling dir.
// `siblings`: packageDirs minus self under packages/, appDirs minus self under apps/, [] elsewhere.
function reach(siblings: string[]) {
  const names = siblings.length ? `|(?:${siblings.join("|")})(?:/|$)` : "";
  return { regex: `^\\.{1,2}/(?:.*/)?(?:(?:apps|packages|plugins|tools)/[^/]+/${names})`,
    message: "Use the permitted workspace entry points for other packages." };
}
function boundary(siblings: string[], o: { allow: string[]; typesOnly?: string[]; local?: RestrictedPattern[] }) {
  const typesOnly = o.typesOnly ?? [];
  const bare = [...o.allow, ...typesOnly];
  const scopes = [...new Set(bare.filter((n) => n.startsWith("@")).map((n) => n.slice(0, n.indexOf("/"))))];
  return { "no-restricted-imports": ["error", {
    paths: typesOnly.map((name) => ({ name, allowTypeImports: true, message: `Only types from ${name} here.` })),
    // Oxlint stops at an allowlist match, so relative restrictions come first.
    patterns: [reach(siblings), ...(o.local ?? []), {
      group: ["*", "!./**", "!../**", ...scopes.map((s) => `!${s}`), ...bare.map((n) => `!${n}`)],
      message: `Allowed external imports: ${o.allow.join(", ") || "none"}.` }],
  }] } satisfies OxlintOverride["rules"];
}
```

- One override per row (and named sub-path) of section 3, in table order. A later override
  replaces the whole rule, so a narrower one repeats its package's lists. The tests row stays last.
- Restricted relative imports become `local` patterns (gitignore style, `allowTypeImports: true`
  where the table says "values"), e.g. `{ group: ["../host/*", "!../host/budgets.ts",
  "!../host/elements.ts", "!../host/wire.ts", "!../host/port.ts"], allowTypeImports: true }`.
- `no-restricted-globals` in `packages/sdk/src/host/**`: `window`, `document`, `navigator`,
  `process`, `Buffer`, `require` (rule 5). `no-restricted-properties` in `packages/hub/**` and
  `packages/ui/**`: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` (P6, M3-02).
- Oxlint does not read templates, and review alone is not enough. `scripts/host-vue.ts` exports
  `hostVue()`: `vue()` with a template node transform that throws `v-html is not allowed in host
  components.` (M3-02). The root, `apps/game`, `apps/launcher` and `packages/hub/test` configs use
  it. Plugin SFCs are covered by the compile gate of `@moxi/sdk/vite` (spec 08).

## 8. Constants

No numeric values here: limits are in spec 05, the P79 cap in spec 01 §4. The lists in sections 3
and 7 live only in `vite.config.ts`.

## 9. Decisions

| Decision | Reason | Rejected |
| --- | --- | --- |
| `packages/hub` exists; the Hub has exactly three inputs: `GameBridge`, `HubPort`, `HubMain` | two real uses (game window, `moxi dev`); no path from the applier to memory, sockets or IPC; same Hub in app, suite and dev page; all async, so a panel-view move (PB17) changes only the mount | Hub in `apps/game` plus a dev harness with a third palette; Hub code importing contracts and gwkit (today) |
| `GameBridge.act` asks Main, then executes; I3 guard in the port router | one path to the executor for every origin; P7 holds even with a Hub routing bug | the Hub authorizes and the executor trusts its claim; checks in Hub code only |
| Plugin shapes and the port protocol (hand-written decoder) live in `@moxi/sdk/host`; contracts imports them; `ui` and `hub` import contract types only | the Hub, the kit and the dev page speak the protocol and may not depend on contracts; IPC reuses one schema; one owner for `AppearanceSettings` | ArkType port schemas in contracts; copies in contracts; local copies (today: two appearance types) |
| bin `moxi` in `@moxi/cli`; gwkit has two entries; `readers` keyed by fact id strings | a bin in the SDK is a cycle (`moxi dev` needs `@moxi/hub`, which needs `@moxi/sdk`); no renderer can import `locate()` (P77); gwkit stays free of the catalog, the type checker still joins facts and readers | bin in `@moxi/sdk`; one entry with an import-name ban; gwkit imports catalog ids |
| Old SDK under `src/legacy/` first; four runtime-safe host modules; `sim` in `@moxi/sdk/testing`; `pageModel`, `decideUpdate` in `@moxi/sdk/host` | old and new `definePlugin` and `/host` cannot share names, deletion is one folder; one registry and codec everywhere, no ArkType in the worker; the kit and dev page behave like the app | mixed exports in one entry; a second codec in the runtime; `@moxi/sdk/sim`; Main-only `page.ts`, `updates.ts` |

## 10. Today in code (main 848fb6e) and what changes

| Item | Today | Changes to | Slice |
| --- | --- | --- | --- |
| `packages/sdk` and the lint helper | lint helper `imports(allowed, otherPackages, sdkTypesOnly)`, `vite.config.ts:6-38`, overrides `:57-131`, flags any relative path with a `plugins` segment; entries `.`, `./testing`, `./host` → `src/index.ts`, `src/testing.ts`, `src/host.ts`; dep `@vue/reactivity`; one lint row (`:59-62`); `Observed`, `Unavailable`, `ActionResult`, `Refusal` in `src/game.ts:3-46` (`:1` imports `Profession` from `nodes.ts`) | section 7 (`../plugins/registry.ts` inside `apps/desktop/src/` passes); old files to `src/legacy/`, imports updated in `apps/game`, `apps/plugin-host`, `plugins/*`, `scripts/build-plugins.ts`; layout of section 4; the kept types move to `host/catalog.ts` (spec 04), re-exported as types by `@moxi/sdk` | M1-00 (move), M1-01; M6-03 deletes `legacy/` |
| Hub boundary and location | whole-state `HubPort`, `HostPort` in `packages/sdk/src/hub-protocol.ts:56-68`; only `publishFacts`, `onGameAction` in `apps/game/src/hub/client.ts:39-44`; Hub in `apps/game/src/hub/`, `test:hub` → `apps/game/src/hub/test/vite.config.ts` | section 5; `packages/hub`; game window on `mountHub`; old Hub and `apps/game/hub.html` deleted | M3-01, M5-06, M6-03 |
| `apps/game` and `apps/plugin-host` rows | game allows `vue`, `@moxi/ui`, `@moxi/sdk`, `@moxi/sdk/host`, gwkit everywhere incl. `src/hub/` (`:84-98`), its only gwkit use is `createRuntime` (`apps/game/src/index.ts:3`); plugin-host allows `vue`, `arktype`, `@moxi/ui`, `@moxi/sdk` (`:99-113`), uses only `arktype`, contracts, `@moxi/sdk/host` | section 3 rows | M5-06; M4-09 |
| `packages/ui`, `packages/contracts`, `packages/gwkit` | ui: `vue` + `@moxi/sdk` types (`:64-67`), declared deps unused, appearance type twice (`packages/ui/src/appearance.ts:3-23`, `packages/contracts/src/index.ts:19-43`); contracts: `arktype` only (`:63`); gwkit: one entry exports parse, match, locate, runtime (`src/index.ts:1-23`) | ui: types from `@moxi/sdk/host`, `@moxi/contracts`, one appearance type; contracts: plus `@moxi/sdk/host` and `src/hub.ts`; gwkit: two entries | M3-03; M4-01; M5-04 |
| `apps/desktop`, `tools/**` | desktop declares `@moxi/gwkit`, never imports it, dead `src/index.ts`; tools has no row, `tools/fixture-client/seed.ts` imports `@moxi/desktop/game-files` | desktop: both removed (M0-06), `@moxi/gwkit/locate` and its `alwaysBundle` (M5-04); tools: section 3 row | M0-06, M5-04; M5-01 |
| `docs/ARCHITECTURE.md` | "Packages" and "Import rules" show the old SDK and a missing `tools/gwkit-cli` | rewritten from this spec | Opus |

Kept: opaque `data:` workers and permission denial (`apps/plugin-host/src/index.ts:44-55`,
`apps/desktop/src/shell/main.ts:277-281`); the Main-brokered port, now per (window, host)
(`main.ts:141-156`); watchdog and crash numbers (`apps/plugin-host/src/plugin-host.ts:149-163,
297-302`), now in `host/budgets.ts`; `packages/ui/src/{tokens.css,appearance.ts,color.ts}`; gwkit
parse, match, locate, runtime.

## 11. Built by

The Slice columns of sections 4 and 10 name the slice for every file and lint row; sections 2, 3
and 7 name M7-04, M7-02, M9-10 and M3-02. M5-08 builds `act`; M6-03 the deletions.

## 12. Checked by

- `pnpm check`: lint enforces sections 3 and 7; types enforce section 5 (`HubMain` over
  `window.moxi` included) and the `readers` binding.
- P6 lint half (M3-02); P25 Hub suite over fakes of the three inputs (M3-01); P69 shared host
  decisions (M2-05, M3-02); P7 guards in `ports.ts` (M4-05, M5-06); P77 `locate()` unreachable
  from renderers (M5-04); P78 a fact adds no `apps/game` file; P79 counted paths (M1-00 tool,
  M6-04); P82 lint half (M5-07); P81 chain progress and cancel through `act` (M5-08).

## 13. Deferred

- npm publication of `@moxi/sdk`, `@moxi/cli`, `@moxi/hub`, `@moxi/ui`, `create-moxi-plugin`
  (Matthias; M14-05). Until then every package is `private: true` and exports TypeScript source.
- Hub in a panel view (PB17): a mount change; the three inputs then cross a process.
- Slim HUD runtime (if the P11 Measure needs it): a second build entry in `src/runtime/`.
