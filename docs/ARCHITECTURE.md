# Architecture

Moxi hosts ArenaNet's official Guild Wars WebAssembly client on macOS, Windows
and Linux. It adds a launcher, a Hub, and plugins. This document owns the
process model, package boundaries and the rules that keep them small. Code and
tests own exact values.

## Principles

1. **The official client stays untouched.** Downloaded ArenaNet files are
   canonical. Anything derived from them (patched modules, fonts) is rebuilt
   from them and can be deleted at any time.
2. **Every capability fails closed on its own.** A missing locator, a refused
   patch or a crashed plugin turns off one feature. The plain game always
   stays playable.
3. **Game integration is data.** Function locations and memory offsets come
   from locator data per client build, never from constants in code.
4. **One owner per fact.** Each piece of state has one writer. Other processes
   receive copies.
5. **Rules live in code and tests, not in prose.** If a rule matters, a type,
   a lint rule or a test enforces it.

## Processes

```text
Main (Node, apps/desktop)
  lifecycle · windows · storage (SQLite) · credentials · game files
  game TCP and DNS · plugin registry · compatibility data · app updates
   │
   ├── Launcher renderer (apps/launcher)     accounts, Play, settings, plugins
   ├── Game renderer, one per account        official client + gwkit runtime
   │   (apps/game)                           Hub, HUD (host code only)
   │        ▲ facts out, UI trees in (MessagePort, direct)
   │        ▼
   └── Plugin host renderer (apps/plugin-host, hidden, one per app)
            one module Worker per enabled plugin
```

- Main is the only process with Node and the only owner of disk, network
  sockets and secrets.
- Renderers run with `contextIsolation`, `sandbox: true`, no Node. Each window
  kind gets one preload that exposes only its channels.
- No plugin code runs in a game renderer. The plugin host talks to each game
  renderer over a `MessagePort` that Main hands out. Its messages are defined
  once in `@moxi/sdk/host`, which both renderers may import.

## Packages

```text
apps/desktop        Electron main and preloads
apps/launcher       launcher renderer (Vue)
apps/game           game renderer: client host, Hub, HUD (Vue)
apps/plugin-host    hidden renderer that runs plugin workers
packages/contracts  IPC channel definitions and ArkType schemas (main ↔ renderers)
packages/gwkit      WASM reading, matching, patching, runtime, game facts. No Electron
packages/sdk        @moxi/sdk: public plugin contract, worker runtime, test kit
packages/ui         design tokens, Vue components, Guild Wars widgets
plugins/*           bundled plugins; each one is built like a community plugin
tools/gwkit-cli     match builds, rebase locators, sign compatibility data
compat/             role specs (source) and signed locator files (generated)
```

Import rules (enforced by lint, not by tests):

| Package | May import |
| --- | --- |
| `packages/gwkit` | nothing from this repo; no `electron`, no `vue` |
| `packages/sdk` | `@vue/reactivity` only |
| `packages/contracts` | `arktype` only |
| `packages/ui` | `vue`, `packages/sdk` types |
| `plugins/*` | `@moxi/sdk` only |
| `apps/desktop` | `packages/contracts`, `packages/gwkit`; `electron` only in `src/shell/**` |
| `apps/*` renderers | `packages/contracts`, `packages/ui`, `packages/gwkit` (game only), `packages/sdk` (plugin-host and game) |

`apps/desktop/src/shell/**` is the only code that touches Electron APIs. All
other Main code is plain Node, so Vitest runs it without Electron.

## IPC

- `packages/contracts` defines each channel once: name, direction, request
  schema, response schema. Main validates every renderer message with ArkType
  before it reaches domain code. Renderers trust Main.
- Calls are request/response (`invoke`) or Main-to-renderer events. No channel
  carries a callback, a secret or a file path chosen by a renderer.
- The preload exposes `window.moxi` with the channels of its window kind only.

## Storage

- One SQLite database per data folder (`node:sqlite`), opened only by Main.
- Migrations are numbered SQL files applied in one transaction at startup.
  Before applying any migration, Main copies the database file to
  `backups/<version>-<timestamp>.sqlite` and keeps the last three.
- Settings are rows `(key, json)`. Each key has an ArkType schema and a
  default in code. An invalid stored value is logged and read as the default;
  nothing quarantines a whole file.
- Plugin documents are rows `(plugin, scope, account, name) → json, revision`.
  Main serializes writes and broadcasts changes.
- Credentials are stored with `safeStorage`. On Linux, saving is refused when
  the backend is `basic_text`.

## Data folders

| Folder | Content | Dev default |
| --- | --- | --- |
| Data | database, backups, logs, per-account browser partitions | `<worktree>/.data/` |
| Game cache | content-addressed ArenaNet chunks and client artifacts | shared per machine: `<OS cache dir>/moxi-dev/game` |

Release builds use the OS app-data folder for both. The game cache is safe to
share between dev worktrees because chunks are content-addressed and published
atomically. `MOXI_DATA_DIR` and `MOXI_GAME_CACHE` override both.

## Game files

```text
ArenaNet manifest → bounded parse → executable artifacts (hash-verified)
  → content-addressed chunk store → client generation → active client → moxi://app
```

- Main downloads with at most 8 concurrent requests, bounded retries and
  a size limit per response. Bytes are verified before an atomic rename.
- The snapshot stays chunked. The renderer reads ranges on demand through the
  `moxi://app` protocol; a full background download fills the rest.
- A new client generation becomes the default only after one session showed a
  frame and opened a game connection. Until then the previous generation stays.

## Game host and gwkit

`packages/gwkit` has five parts:

| Part | Job |
| --- | --- |
| `wasm` | Parse modules, decode function bodies, fingerprint functions, build call graphs |
| `locate` | Evaluate role specs against a module; produce or verify a locator file |
| `patch` | Apply the few declarative binary patches; validate output with `WebAssembly.validate` |
| `runtime` | Instantiate the client via `Module.instantiateWasm`, wrap the main-loop export to get one safe point per frame, read memory, call table functions, run queued actions at the safe point |
| `game` | Domain readers that turn memory into `Observed<T>` facts and implement named actions |

- The game renderer owns the Emscripten `Module`. It loads the official glue
  and module from `moxi://app`, mounts IDBFS for templates and screenshots,
  and forwards TCP and DNS to Main.
- Every memory address or struct offset used by `game` comes from a locator
  value, which comes from an operand of a located function (the witness rule).
  If ArenaNet changes a struct, its reader stops matching and only that fact
  turns `unsupported`.
- Locator files are ed25519-signed and fetched from the compatibility feed.
  Without one, the app matches locally: read-only facts with a unique match
  turn on; actions wait for signed data.

## Plugins

See `packages/sdk/README.md` for the contract. The host rules:

- A plugin is a manifest (`plugin.json`) plus one ES module. The host reads the
  manifest without running code; commands, scopes and settings are visible
  before the plugin starts.
- Each enabled plugin runs in its own module Worker in the plugin host. Its
  render functions return UI nodes; the host renders them. Plugins never touch
  the DOM, Node, game memory, input or the network outside declared hosts.
- Facts are pushed per permission at 10–20 Hz. A game action needs the
  permission and one activation token from a click or key press on that
  plugin's UI (3 s, single use). Multi-step flows are host actions.
- A plugin that does not answer a ping for 2.5 s is stopped. Three crashes in
  ten minutes disable it until the player re-enables it.

## Hub

The Hub shell in `apps/game` owns every interaction rule once: keyboard
ownership while open, selection by id, the Escape ladder, double-click guards,
key isolation from the game, and session-bound async results. Plugins provide
items, views and actions; they never implement keys or focus.

## Testing

| Layer | Proves | Runs in |
| --- | --- | --- |
| Domain | ranking, codecs, calculators, migrations, manifest and chunk logic | Vitest (Node) |
| gwkit | decoder, matcher, patcher, readers | Vitest on synthetic modules; corpus lane over cached ArenaNet builds when `MOXI_CORPUS` is set |
| Plugins | behavior through `@moxi/sdk/testing` | Vitest (Node) |
| Hub shell | interaction rules once for all features | Vitest browser mode |
| End to end | ~10 journeys against the fake game client | Playwright Electron |

Mock only ArenaNet, the clock and external HTTP. No test reads source text.
One regression test per bug fix.

## Toolchain

pnpm workspace, Vite+ (`vp`: Vite, Vitest, Oxlint, Oxfmt, tsdown, tsgo), Vue
3, TypeScript strict, ArkType at process and file boundaries, Electron with
electron-builder and electron-updater. `pnpm check` is the pull-request gate.
