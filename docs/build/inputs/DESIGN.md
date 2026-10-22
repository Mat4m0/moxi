# moxi v2 architecture: the recommended design

Date: 2026-10-14. Author: lead architect (Opus 5.5). Base: moxi `main` at 848fb6e.
Inputs: designs D1 to D4 (`designs/`), research R1 to R8 (`research/`), two judge reviews.
No repository file was changed. No Electron window was started.

This file is the design of record. It replaces D1 to D4. It uses D1 (author-first) as the
specification for the SDK, the UI model, the plugin page and the proof discipline. It
replaces D1's runtime and authority core with D4's, and it adds the best parts of D2 and D3.
Where I found something better than all four, I say so.

- Proofs: `PROOFS.md` (P1 to P79). Probes: `PROBES.md` (PB1 to PB18).
- Evidence tags: **[R1 5.2]** = research note and section; **[D4 3.6]** = design and section;
  **[code]** = read in moxi source; **[est]** = estimate that a probe settles.
- Every decision has a one-line reason and the rejected alternative, inline and in the
  decision log (section 19).

## Amendments by the owner (Opus, 2026-10-14). They override the text below.

1. **Cut for 1.0: package images.** No `asset:` images, no PNG decoder or encoder, no image
   budgets. Plugin icon = host glyph or game art from `Gw.dat`, plus `accent`. Comes back only
   with a real plugin that needs it.
2. **Cut: the Main plugin data worker and `plugin-data.sqlite`.** Documents stay in Main's
   SQLite (`storage/documents.ts`) with the per-install budgets and membrane coalescing. P77's
   flood Measure decides; move to a worker thread only if it fails. Reading `Gw.dat` off the main
   thread belongs to the TX1 slice.
3. **Deferred until community or GitHub plugins open:** the CPU burner search (3.5), registry CI
   (11.6), theme packages (5.4), reproducible packages (PB16). Their text stays as the plan.
4. **Cut: the login-words build check** (4.3). The "Sent to <host>" chip is the control.
5. **Electron probes run in CI only.** No Electron process on Matthias's Mac, hidden or not.

### Probe outcomes (2026-10-15). They override the text below. Evidence: `probes/<id>.md`, reviews in `probes/VERIFY.md`.

6. **PB2, one worker's V8 out-of-memory kills its whole plugin host** (6/6, Linux and Windows), and on
   Windows a 15 GiB ArrayBuffer bomb paged the machine and stalled the game up to 29 s. Changes:
   Main samples each plugin host's private memory every 500 ms and kills and restarts a host
   above **768 MiB** (restart p50 about 200 ms); official plugins get their **own host**, so a
   community plugin cannot take official HUDs down; crash counts are per host and per install.
7. **PB3:** worker egress is 0 bytes under CSP on Linux and Windows. Required: drop
   `'wasm-unsafe-eval'` (WASM compiles today); the runtime prelude deletes `globalThis.Worker`
   (a nested `data:` worker runs runtime-built code); add `setDevicePermissionHandler(() => false)`.
   WebTransport joins WebRTC as the accepted post-exploit residual (webRequest sees neither).
8. **PB10, Linux:** the `.deb` with its AppArmor profile is the package; every renderer has
   seccomp and its own namespaces. Sandbox detection rule: `/proc/<pid>/status` has `Seccomp: 2`
   **and** `NSpid` has more than one level, and argv has no `--no-sandbox`. `hasSwitch` is useless
   (`enableSandbox()` removes it). AppImage runs without the namespace sandbox on Ubuntu 23.10+.
9. **PB7:** `backgroundThrottling: false` on every plugin-host `webContents` is mandatory (without
   it a hidden host stalls 15 s or more after about 5 minutes); the watchdog stays in the host
   page; batching uses microtask + `setTimeout(0)`, never rAF. macOS not measured.
10. **PB9:** chord and shortcuts in Main hold on Linux and Windows. Implementation rules: a matched
    chord never leaves a "held" entry (Chromium withholds the key up after `preventDefault`, so a
    held set breaks the second press); clear the page's stuck Control with a synthetic Control
    repeat + key up; track `AltGraph` on X11; `Menu.setApplicationMenu(null)` on Windows and Linux;
    e2e presses keys with `sendInputEvent` (CDP keys bypass `before-input-event`).
11. **PB11:** HTTPS = `node:https.request` with a pinned lookup and a fresh `Agent` per call
    (never global `fetch` or the default agent). **WSS = `ws` 8.22.0 with the same lookup** (pure
    JavaScript; the hand-written reader had an empty-fragment memory bomb). Trailing-dot hosts are
    refused, not normalized.
12. **PB14:** per-account partitions with their own `moxi` handler work. Hidden game windows run at
    about 1 fps, so game windows stay shown. About 40 MiB PSS per extra fixture window.
13. **PB1:** per extra session 0.85–0.94 MiB (gate 1), 10 plugins × 4 accounts 85–96 MiB (gate
    102): pass. Per worker 5.95–6.77 MiB (gate 6): borderline; no leak after forced GC. Keep the
    design; a slim HUD runtime only if real plugins push it up. **PB4:** a `data:` worker URL is
    capped at 2,097,152 characters, so the runtime loads from `moxi://app/plugin-host/code/<sha>.js`
    (scheme registered with `corsEnabled`) and only plugin code uses `data:`; `index.js` ≤ 1 MiB.
14. **PB6:** factory per session holds. Each session's facts arrive in their own message, or the
    runtime flushes per session (a light session waited 41.6 ms behind a heavy one in one flush).
    Each factory runs in a per-session `effectScope`; a view whose render throws keeps its last
    good tree (stock Vue blanks it).
15. **PB5:** plugins compiled with Vue 3.4.38 to 3.5.44 run on the host runtime unchanged; P19
    stays a gate on every Vue bump.
16. **PB13:** the vocabulary fits every v1 screen; no iframe tier. Build only what the step 7
    plugins need; the review lists the additions (fill-search action, SkillBar slot moves, cell
    drag payload, wiki links for reads plugins).
17. **PB15:** 0 API calls per update check; at most one check per repo per day plus "Check now";
    host allowlist `github.com`, `release-assets.githubusercontent.com`, `api.github.com`, index host.

---

## 0. The design on one page

### 0.1 What stays (proven, or confirmed by all four designs and by R6)

1. Main is the only process with Node, disk, sockets and secrets.
2. The official client runs alone in its game renderer with gwkit. No plugin code runs there.
3. Plugin code runs in opaque-origin `data:` module Workers in a hidden, sandboxed renderer.
   The isolation e2e passes today [R1 4.1, `e2e/plugin-isolation.e2e.ts:14-103`].
4. The host renders a closed UI vocabulary. Plugins never touch DOM, CSS, keys or focus.
5. The host reads `plugin.json` without running plugin code.
6. `Observed<T>` and `ActionResult` stay the result types [code `packages/sdk/src/game.ts`].
7. The Hub shell owns every interaction rule once (keys, Escape ladder, selection by id,
   session guards) [R3 2.2].

### 0.2 What changes (ten moves)

1. **Authors write Vue.** SFCs with `<script setup>`, composables and typed host components.
   A host-supplied Vue `runtime-core` custom renderer in the worker sends flat op batches.
   Collections (lists, grids, tables, Hub items) are data props, not child components.
2. **One worker per install for the whole app.** The runtime evaluates the plugin module once
   per plugin session (one character visit in one game window), so module scope is session
   scope. Memory scales with plugins, not with plugins times accounts.
3. **Requested is not granted.** One capability catalog drives manifest checks, types, page
   text, enforcement and the test kit. Main owns the grant store.
4. **Read or internet, never both, and never in one process.** A plugin that reads anything
   personal cannot hold a `net:` or `link:` host. AGENTS rule 3 becomes a check at build,
   install and registry time. Installs that can send run in their own plugin host, which
   receives nothing derived from the game.
5. **Game actions are host-rendered descriptors.** Only a trusted press on that control runs
   one action. The host writes the label. Main authorizes every action, for players and agents.
6. **Main owns every data source:** network proxy and shared feeds, documents, reference data
   from `Gw.dat`, package images, the activity log, the compatibility feed.
7. **Distribution like Obsidian, with pins.** One signed index for official and community
   plugins (every version pinned by SHA-256), player-added GitHub repos (trust on first use),
   and dev folders. One package format: a single JSON file.
8. **Plugin hosts by trust tier and class.** Tier: `reviewed` (official, community) or
   `unverified` (GitHub repos, dev folders). Class: `local` (may receive facts) or `internet`
   (holds `net:` or `link:`; receives no facts, no `hub.search` text, no action outcomes). A
   host exists only while one of its installs is on. An exploit or out-of-memory in unverified
   code never reaches reviewed plugins, and no process holds both personal facts and a way out.
9. **Budgets truncate or wait, never crash on size.** One op batch in flight per root, enforced
   by the membrane; byte rates and retained size per install; Main watches CPU per host,
   restarts a dead plugin host and has a safe mode.
10. **The Hub stays in the game renderer** as `packages/hub` behind a `HubPort`. The Hub chord
    and plugin shortcuts move to Main (physical key code); plugin chords need Cmd or Ctrl and
    work only while the character is in the world. A move of the Hub into a panel view stays
    an option that a probe gates (PB17).

### 0.3 Picture

```text
Main (Node, apps/desktop) — the only authority
  windows · SQLite · credentials · game files · game TCP/DNS · per-account partitions
  plugin registry · package store · grant store · action authority · activity log
  net proxy + shared feeds · CPU watch per plugin host
  plugin data worker (worker_threads): documents · reference data (Gw.dat) · package images
  signed feeds (compat + kill switches, plugin index + withdrawals) · Hub chord and shortcuts
   │
   ├── Launcher renderer (apps/launcher) — clean room: no plugin code, no plugin ops
   │     accounts, Play, settings, plugin directory, plugin pages, install and consent
   │
   ├── Game renderer, one per account (apps/game, partition persist:account-<id>)
   │     official client + gwkit runtime · fact publisher · action executor (safe point)
   │     packages/hub: Hub shell, op applier, HUD layer, panels, plugin pages (manage)
   │        ▲ facts, events, queries, results       ▼ ops, items, answers, subscriptions
   │        └── one MessagePort per (game window, plugin host), brokered by Main ──┐
   │                                                                             │
   ├── Plugin host "reviewed · local" (apps/plugin-host, hidden, sandboxed, in-memory partition)
   │     membrane: spawn, ping, budgets, routing, fan-out by grant — no authority
   │     one module Worker per install (official, community) without net: or link:
   │        host runtime (Vue runtime-core + SDK) once per worker
   │        one plugin module instance + one Vue app per plugin session
   │
   ├── Plugin host "reviewed · internet" (same code; installs with net: or link:;
   │     gets no facts, no hub.search text, no action outcomes)
   │
   └── Plugin hosts "unverified · local" and "unverified · internet" (same code; only while a
         GitHub or dev install of that class is on)
```

Every host exists only while a game window exists and one of its installs is on. A typical
player with official plugins runs one or two.

### 0.4 Numbers this design must hit (fixed now, before measuring)

R5 found that v2 moved its memory gate from 100 to 300 MiB to pass it. These gates do not move.

| Measure | Gate | Settled by |
| --- | --- | --- |
| Worker with host runtime and a 200-row view (w, above an empty host) | ≤ 6 MiB | PB1, P11 |
| Extra plugin session of one plugin (s) | ≤ 1 MiB | PB1, P11 |
| One plugin host, 10 plugins, 4 game windows, above the same host with 0 plugins | ≤ 102 MiB (= 120 MiB on macOS with probe 02's 18 MiB base) | PB1, P11 |
| Plugin work on the game main thread, Hub closed, 10 HUD widgets at 10 Hz | p99 ≤ 0.5 ms per frame (Measure, per-frame timing) | PB8, P29 |
| Main event-loop delay while chaos plugins flood documents, reference queries and the network | p99 ≤ 10 ms (Measure) | P77 |
| One-row change in a 1,000-row list | 1 `ITEMS` patch with 1 upsert | P12 |
| Theme switch | 0 messages to workers | P23 |
| Builds a library can hold before anything breaks | ≥ 10,000 (today 181) | P14 |
| Production files touched to add one game fact | ≤ 3 | P78 |
| Plugin platform core, non-test lines | ≤ 4,500 (plus ≤ 2,500 for host element components) | P79 |

Memory has one metric per OS: macOS `footprint <pid>`, Linux `Private_Clean + Private_Dirty`
from `/proc/<pid>/smaps_rollup`, Windows `privateBytes` (`app.getAppMetrics()` reports it on
Windows only). Only deltas on the same OS are compared with a gate, because the metrics differ.

Timing numbers are **Measures**: non-gating jobs, median of 5 runs, each with a decision rule.
Only deterministic checks are **Gates**: they pass 20 runs in a row, also with all CPU cores
busy (AGENTS no-flaky rule).

---

## 1. Processes

### 1.1 Jobs per process

| Process | Owns | Never has |
| --- | --- | --- |
| Main (`apps/desktop`) | lifecycle, windows, SQLite, credentials (`safeStorage`), game files, game sockets and DNS, plugin registry, package store, grants, action authority, net proxy and feeds, CPU watch, signed feeds, activity log, Hub chord | plugin code |
| Main plugin data worker (`worker_threads`) | plugin documents (own SQLite file), reference data from `Gw.dat`, package image decode and re-encode | plugin code; anything on Main's UI thread |
| Launcher renderer | accounts, Play, settings, plugin directory, plugin pages, install, consent, sources | plugin code, plugin ops, untrusted image bytes |
| Game renderer (one per account) | official client, gwkit runtime, fact publisher, action executor, Hub, HUD, panels, plugin pages for installed plugins | plugin code, untrusted image bytes |
| Plugin host, class `local` (one per tier) | workers of installs without `net:` or `link:`, membrane | Node, network, storage, grant power |
| Plugin host, class `internet` (one per tier) | workers of installs with `net:` or `link:`, membrane | the same, and any game fact, `hub.search` text or action outcome |

Every renderer runs with `sandbox: true`, `contextIsolation: true`, no Node, and one preload
that exposes only the channels of its kind (as today, `packages/contracts/src/windows.ts`).

### 1.2 Lifecycle

| Event | Effect |
| --- | --- |
| App start | Main, launcher. No plugin host (today it starts at once and costs 18 MiB [R1 7.2]). |
| First game window | Main creates each plugin host (tier × class) that has an enabled install, at most four. Main brokers one port per (game window, host). No plugin session opens yet. |
| Character enters the world (gwkit reports a loaded map after character select) | Main opens a **plugin session** (new `sid`) for that window in every host. Plugin views, panels, HUD widgets, Hub items, Hub answers and plugin shortcuts start. |
| Login screen, character select, or game state unknown | No plugin session: no plugin surface, no plugin text route, no plugin shortcut. gwkit cannot tell yet = closed (rule 4). |
| Character leaves to character select or login, or the game window closes | That plugin session ends in every worker that had it. Map loads inside a session keep it open (facts say `loading`). |
| Last game window closes | Main destroys the plugin hosts. |
| Plugin host dies (`render-process-gone`) | Main recreates it within 2 s and re-brokers every live session port. Workers that were running start again; their state comes back from documents. |
| 3 crashes of one host in 10 min | That host is **paused** for this app run. The Hub shows "Plugins paused" with "Start plugins". The plain game is not touched. |
| `--no-plugins` or the launcher switch "Start without plugins" | No plugin host is created. |

Decision: the plugin host exists only while a game window exists, because no plugin runs
without a game in 1.0. Rejected: start at app launch (today), which costs 18 MiB with no use.

Decision: a plugin session is a character session. Reason: the official login screen (and the
planned login fill, PLAN Q1) lives in the game renderer; no plugin surface, text route or
shortcut may exist next to it, so a plugin can neither draw a fake login panel nor learn
keystroke timing there. Module scope then belongs to one character visit, which is also the
natural unit for per-character state. Rejected: sessions per game window from the first frame
(the earlier text), which put live plugins on the login screen.

Decision: no plugin code and no plugin ops in the launcher in 1.0. The launcher takes
credentials and consent, so it stays a clean room. Rejected: a launcher plugin session
[D1 1.2, D4 1.3], which puts plugin-driven DOM next to the account form. It can be added later
as an additive session kind if Matthias wants plugin commands in the launcher palette (question 5).

### 1.3 Trust boundaries

There are three boundaries. The design states which one each check protects.

| Boundary | Attacker | What holds |
| --- | --- | --- |
| **Worker boundary** (JavaScript level) | Hostile plugin code in its own worker | Opaque origin, CSP, no DOM, no storage. The membrane routes facts by grant, stamps the install on every request, enforces budgets. A worker cannot reach another worker's objects. |
| **Process boundary** (Spectre-class reads, no exploit needed) | Plugin code that reads memory of its own renderer through side channels | Chromium treats every byte in a renderer as readable by any script in it; Site Isolation works only between processes. So the game renderer sends a `local` host only the facts that its installs may read, and an `internet` host no facts, no `hub.search` text and no action outcomes. No process holds both personal facts and a way out. |
| **Renderer boundary** (V8 or Blink exploit inside a plugin host) | Code execution in the plugin-host renderer | The renderer sandbox. The game renderer and Main accept an install key only from the host that owns it (6.6, I7). Main checks every network, document and grant request. Game actions start only from a trusted press in the game renderer and pass Main. A host never holds credentials, disk or sockets. |

Residuals, stated plainly:
- After a renderer exploit, the attacker can use the grants of every install in that host: in
  a `local` host their facts and documents, in an `internet` host their net hosts and
  documents. The tier split limits this to one tier; the class split keeps facts and net hosts
  in different processes.
- After a renderer exploit, WebRTC transports are a way out that no browser-side control in
  Electron limits: CSP is enforced in the renderer, `webRequest` does not see WebRTC, and the
  IP-handling policy only forces TCP. So an exploit in a `local` host can send that host's facts
  off the machine. PB3 records what the host page's own context can reach (20, question 11).

### 1.4 Plugin hosts by trust tier and class

Decision: a plugin host per (tier, class). Tier is `reviewed` or `unverified`; class is
`internet` when the manifest requests or offers a `net:` or `link:` host, else `local`. Each
host exists only while one of its installs is on, so most players run one or two.

Reasons: an exploit or a renderer-wide out-of-memory in a player-added GitHub plugin can never
touch official or community plugins; and read-or-internet holds per process, not only per
install, because workers in one renderer can read each other's bytes through Spectre-class
side channels [R7 7]. Without the class split, a `net:` plugin next to a reads plugin could
read that plugin's facts and send them with its own grant, with no exploit and no escalation.
Cost: about 18 MiB [P02] per extra host, paid only while an install of that kind is on.

Rejected: one host for all (an exploit gets the union of all grants); tier split only (the
earlier text: a reviewed `net:` plugin shares a process with reviewed facts); one renderer per
unverified install [D2 1.1] (about +20 MiB each plus a supervisor; it costs most for the
Obsidian-style use Matthias wants).

All hosts run the same code. Main keys ports, grants and crash counts by host key
`<tier>.<class>`. PB2 decides one more split: if one worker's out-of-memory kills its whole
renderer, official plugins move into their own hosts as well, because players depend on their
HUD readouts most.

---

## 2. Packages

### 2.1 Package map

```text
apps/desktop          Main. src/shell/ = the only Electron code. src/plugins/ = plugin services (plain Node)
apps/launcher         launcher renderer (Vue): + Plugins section (directory, page, sources, updates, developer)
apps/game             game renderer: client host, gwkit runtime, fact publisher, action executor; mounts packages/hub
apps/plugin-host      hidden renderer: membrane only (about 350 lines)
packages/contracts    IPC channels and ArkType schemas (Main <-> renderers)
packages/gwkit        WASM parse, match, locate, patch, runtime, game readers. No Electron, no Vue
packages/sdk          @moxi/sdk: author API, catalog, element registry, runtime, test kit, sim, Vite plugin, CLI
packages/hub          NEW: Hub shell, op applier (retained trees), HUD layer, panels, ranking, plugin page view
packages/ui           tokens and Vue host components, one per element (src/elements/*.vue), PluginPage.vue
packages/create-moxi-plugin  NEW: template + about 150 lines
plugins/*             official plugins as Vue SFC plugins, built and packed like community plugins
compat/               role specs (source) and signed locator + capability files (generated)
tools/fixture-client  fixture client; + fixture-world (generated memory + locator) and fixture-actions
```

Decision: a new `packages/hub` package. Reason: the Hub shell and applier have two real uses,
the game window and the author harness `moxi dev` (AGENTS: no layer without a second use).
Rejected: Hub code inside `apps/game` plus a separate dev harness with a third palette (today,
`apps/game/src/hub/dev/App.vue`, 521 lines [R3 1.1]).

### 2.2 `@moxi/sdk` entries

| Entry | Content | Used by |
| --- | --- | --- |
| `@moxi/sdk` | `definePlugin`, composables, `act`, `field`, element components, types | plugin authors |
| `@moxi/sdk/testing` | `mountPlugin`, `sim` (scripted game), two sessions by default | plugin tests |
| `@moxi/sdk/host` | catalog, element registry, budgets, op decoder, page model, manifest and package parser | membrane, `packages/hub`, Main, test kit |
| `@moxi/sdk/vite` | Vite plugin: compile gate, capability check, generated types, factory output, pack | template, `plugins/*` |
| `@moxi/sdk/runtime` | built to `runtime-api1.js` (Vue runtime-core subset + SDK runtime + renderer) | plugin host |
| bin `moxi` | `dev`, `check`, `build`, `pack` | authors |

### 2.3 Import rules (lint, not tests)

| Package | May import |
| --- | --- |
| `packages/sdk` | `@vue/runtime-core` (replaces `@vue/reactivity`); `arktype` in `./host` only; `vite`, `@vitejs/plugin-vue`, `@vue/compiler-sfc` in `./vite` only |
| `packages/hub` | `vue`, `packages/ui`, `@moxi/sdk/host`. **Never** `packages/gwkit`, never `electron` |
| `packages/ui` | `vue`, `@moxi/sdk/host` (types) |
| `apps/game` | `packages/gwkit`, `packages/hub`, `packages/contracts` |
| `apps/plugin-host` | `@moxi/sdk/host`, `packages/contracts` |
| `plugins/*` | `@moxi/sdk`, `vue` (rewritten to the host runtime at build) |

The rule "`packages/hub` never imports gwkit" means the applier has no code path to game
memory. It reaches the game only through a `GameBridge` with two methods (facts out, action
requests in). This is cheap and keeps an applier bug from becoming a memory bug in code.

---

## 3. Plugin runtime

### 3.1 Where each part runs

| Part | Process and thread | Why there |
| --- | --- | --- |
| Plugin code (modules, components, handlers) | one module Worker per install in the plugin host of its tier and class | opaque `data:` origin, `connect-src 'none'`, no DOM, terminable on hang [R1 4.1] |
| Membrane (spawn, ping, budgets, routing, fan-out) | plugin-host main thread | absorbs floods before they reach a game renderer; holds no authority |
| Rendering of plugin UI | game renderer (`packages/hub` with `packages/ui` elements) | host components own theme, keys, focus and accessibility |
| Fact reading and filtering | game renderer, at the gwkit safe point | it owns the facts; an ungranted fact never leaves it |
| Game action execution | game renderer, at the safe point, after Main authorizes | it sees the trusted press and owns gwkit |
| Grants, documents, network, images, packages | Main | single owner of disk, sockets and policy |

Rejected places for plugin code [R7 4, 7, 8; D4 1.2]: sandboxed iframes (focus and keys split
per frame, an accessibility tree per frame, theme injection per frame, and no control over
WebRTC in a document; their memory cost is unmeasured: Chromium groups same-origin sandboxed
iframes into one process, and R7 4.2 has no per-iframe figure); `utilityProcess` (unsandboxed
Node); workers in the game renderer (same process as game memory and the typed password);
ShadowRealm or SES (no CPU or memory limit, `while (true)` cannot be stopped); QuickJS in WASM
(it has interrupt and memory limits, but it is an interpreter about ten times slower than V8,
Vue would run inside it, and it adds a second JavaScript engine to maintain).

### 3.2 One worker per install, one module instance per session

Today one `PluginHost` and one worker per plugin exist per game window
(`apps/plugin-host/src/index.ts:35-69`), because `ctx.game` means "my session" [R1 7.1].

The new runtime keeps that meaning without a worker per window [D4 1.3]:

```ts
// What the plugin host links into one data: URL per install. Authors never see this.
// <runtime-api1.js: Vue runtime-core subset + SDK runtime + renderer, about 70 KiB min>
__moxiBoot(function plugin(__moxi) {
  // the author's bundle, built as a function body; `vue` and `@moxi/sdk` read from __moxi
  return definition; // the value of definePlugin(...)
});
// The runtime calls plugin(__moxi) once per plugin session: a fresh module scope per session.
```

- **Module scope = session scope.** A module-level `const target = useFact("game.target")`
  belongs to one plugin session (one character visit in one game window). Module-level state
  is per session, so a value kept there for account A is not visible in account B's window.
  This removes D1's risk K4 (shared module scope across accounts), which no test could prove.
- **Globals are shared.** All sessions of an install share one worker realm: `globalThis`,
  built-in prototypes and global side effects of bundled libraries. A plugin that writes there
  in session A changes session B. Both sessions belong to the same player, so this is a
  correctness bug of that plugin, not a leak to anyone else. The SDK README says so, and the
  test kit's two default sessions make it visible (PB6, P10). Rejected: freezing intrinsics in
  the prelude (it breaks libraries that polyfill and protects only the same player's data).
- The runtime (Vue, reactivity, SDK) is evaluated once per worker and shared by all sessions.
- Each session gets its own Vue apps and its own `app.config.errorHandler`. A render error in
  one window never touches another.
- **Shared state lives in Main, its one owner.** Documents are shared by all windows through
  Main. `useFetch` and `useFeed` are subscriptions that Main serves once per (install, URL),
  so four windows cause one request or one socket (section 10).
- Facts, events and ops carry `sid`, the plugin session id that Main issues when the character
  enters the world (1.2). Main maps each `sid` to its game window's `webContents`.

Decision: factory per session. Reason: it keeps today's simple author model and costs a
module instance (0.5 to 1 MiB [est]) per extra window instead of a whole worker. PB6 checks the
semantics in Node first; P10 proves them in the app.
Rejected: one shared module scope for all sessions [D1 1.2, D3 1.2], because per-account state
in module scope would leak between game windows; and a worker per (install, window) (today),
because memory and state grow with accounts.

### 3.3 Host-supplied runtime

- `moxi build` bundles the plugin with `vue` and `@moxi/sdk` as externals that read from
  `__moxi`, and emits a function body (no `import` or `export` statements).
- The plugin host builds one text `runtime + "\n" + __moxiBoot(function plugin(__moxi) {…})`
  and starts `new Worker("data:text/javascript;base64,…", { type: "module", name: installKey })`.
  Base64 grows the text by 1.33 times, not 1.45 times as `encodeURIComponent` does today [R1 3.1].
- Packages shrink from 17 to 20 KiB (runtime inside) to the author's code (0.5 to 30 KiB).
- The wire protocol becomes **private**. The public contract is: the manifest schema, the
  TypeScript exports of `@moxi/sdk`, the element registry and the catalog ids. All are additive
  within `api: 1` (AGENTS "Players depend on this").
- Vue skew policy: the host pins one Vue 3.x minor per app release. Plugins compiled with an
  older 3.x compiler must give the same op stream on the host runtime (P19, PB5). Vue 4 or a
  breaking helper change needs `api: 2`.

Decision: the host supplies the runtime. Reason: runtime fixes reach every plugin and the wire
can change without `api: 2`. Rejected: the runtime inside each bundle (today,
`scripts/build-plugins.ts:24`), which freezes the wire as public API [R1 5.5].

### 3.4 Activation (derived, no `activation` field)

| Manifest declares | The worker starts when | Then mounts |
| --- | --- | --- |
| `hud` widgets that the player turned on | a plugin session opens | one HUD app per widget per session |
| `hub` (items, scopes, numbers) | the Hub first opens in a plugin session | no app; items and answers are data |
| `commands` | the command runs (only inside a plugin session) | one app per opened view or panel |

- Idle stop: a worker with no session that uses it stops after 5 minutes. Its state comes back
  from documents.
- `ready` deadline 5 s (today none [R1 5.14]). Ping every 1 s; stop after 2.5 s without pong.
- The watchdog skips a verdict when its own ping went out late (a stalled host thread), so a
  garbage-collection pause cannot kill healthy workers [D3 1.5].
- Batching uses a microtask plus `setTimeout(0)`, never `requestAnimationFrame`, because frame
  timing in a hidden window differs per OS [D4 1.5]. PB7 measures it.

Decision: derive activation from what the manifest contributes. Reason: one fact, one owner.
Rejected: a separate `activation` field (today), which can disagree with the contributions.

### 3.5 Crash containment

| Failure | Detected by | Player sees | Recovery |
| --- | --- | --- | --- |
| Throw in render or handler | runtime `errorHandler` | last good tree stays; a small error mark on that view | next reactive change re-renders; 20 errors per minute count as one crash |
| Throw or hang in module evaluation | `ready` deadline 5 s | "Quick Travel could not start" in its views | crash policy |
| Infinite loop | membrane ping, 2.5 s | "Quick Travel stopped responding" | worker terminated; restarts on next use |
| Message flood (more than 1,000 per second for 3 s) | membrane | same | worker terminated |
| A second op batch on a root before the ack (plugin code calls `postMessage` itself) | membrane | same | worker terminated, counts as a crash |
| CPU burner that still answers pings | Main samples each plugin host's CPU (`app.getAppMetrics()`, every 2 s); above 50 % of one core for 10 s, the membrane stops that host's workers one at a time, most busy first by the runtime's busy-time reports (a hint only), until the host's CPU drops | "Quick Travel used too much CPU and was stopped" | the worker whose stop dropped the CPU gets a crash with reason `cpu`; the others restart at once; Activity shows the event |
| One view over a size budget | membrane and applier | that view shows "This view is too large to show" | plugin keeps running |
| Malformed op batch | decoder (membrane or applier) | same as crash | worker terminated |
| Worker out of memory | PB2 | worker only: crash policy. Renderer-wide: "Plugins are restarting" | Main restarts the host |
| Plugin host gone | Main `render-process-gone` (no handler today [R1 3.8]) | plugin HUD hidden, Hub rows show "restarting" | recreate within 2 s, re-broker, restart running installs |
| 3 host crashes in 10 min | Main | "Plugins paused" | that tier off for this run; player can start it again |
| Bad package or manifest | Main registry, per install | that row: "Can't load: <reason>" | others unaffected (today one bad manifest stops all [R1 5.6]) |

Crash policy per install: 3 crashes in 10 minutes disables it. Main persists this (today it is
in memory per window [R1 5.10]). The plugin page shows "Turned off after 3 crashes" and
"Turn on again".

### 3.6 Budgets: truncate, never crash on size

One file, `@moxi/sdk/host/budgets.ts`, used by the membrane, the applier and the test kit.

| Budget | Value | On breach |
| --- | --- | --- |
| Nodes per mounted root (a collection counts as 1) | 2,000 | root shows the host panel "This view is too large to show"; plugin runs on |
| Rows per collection (`List`, `Grid`, `Table`) | 10,000 | host shows the first 10,000 and a row "N more not shown" |
| Hub items per install and session | 2,000 | ranked over the first 2,000; dev warning |
| Query answers | 50 per query, deadline 150 ms | extra rows dropped; late answers ignored |
| Op batch (wire size) | 256 KiB of objects and strings, plus 4 MiB of typed arrays | batch refused; 3 refusals in 10 s = crash |
| In flight | 1 batch per root until the applier acks; **enforced by the membrane** | the runtime merges later ops (backpressure); a second unacked batch from the worker = crash |
| Bytes toward one game renderer | per install: 1 MiB/s averaged over 5 s (burst 4 MiB); HUD roots within it 256 KiB/s | the membrane holds the batch until the rate allows (waiting, not a crash) |
| Retained in the game renderer | per install and plugin session: 8 MiB wire size in total, 8 KiB per row | rows beyond it are not kept; the host shows "N more not shown" |
| Messages per worker | 1,000 per second for 3 s | crash |
| CPU per plugin host | 50 % of one core for 10 s | the busiest worker is found and stopped (3.5) |
| Strings | titles 200 characters, text 4,000 | truncated with "…" |
| Draw scene (`Canvas`, `Chart`, map layer) | 20,000 shapes, 4 MiB typed data | scene replaced by a placeholder |
| HUD widgets per install | 8; `"default": true` only for official installs | the rest stay off; the page says why |
| Documents | 1 MiB each, 256 per install, 5 MiB per install; writes ≤ 10 per second and ≤ 1 MiB/s per install, coalesced by the membrane (the last write per document every 250 ms wins) | `set()` returns `{ ok: false, reason: "quota" }` or `"rate"` |
| Reference queries | 20 per second per install | typed refusal `rate` |
| Network | 60 requests per minute (burst 10), 2 in flight, 4 MiB and 10 s per response; 2 feeds, 64 KiB per message, 50 messages per second | typed refusal |
| Toasts | 1 per 2 s per install, 3 visible | coalesced |
| Shortcut commands per install | 4 | the rest stay unbound; the player can bind them |
| Code | `index.js` ≤ 1 MiB (PB4 may lower it); package ≤ 8 MiB | build error; install refused |

Large first loads stream: the runtime sends a big first `ITEMS` upsert in chunks of at most
256 KiB, one per ack [D1 1.7]. Why 256 KiB: a message is deserialized on the game main thread
when it arrives, before the 1 ms apply budget can act, and R1 measured 1.2 ms per 289 KiB of
objects [R1 3.3]. Typed arrays clone in microseconds, so they have their own larger cap.

Decision: budgets are shared constants that truncate or wait. Reason: the Builds plugin dies
today at 181 builds, and the test kit does not see it [R1 5.4]. Every budget is enforced by a
process the plugin cannot write to (membrane, applier, Main), never by the runtime alone,
because plugin code shares the runtime's realm. Rejected: limits that crash the plugin on size;
limits that only the runtime enforces.

### 3.7 Memory model

`M(hosts) = H × b + P × w + S × P × s` with H live plugin hosts (1 to 4), b ≈ 18 MiB per host
[P02, macOS], P running plugins, S plugin sessions, w ≈ 5 MiB per worker with the runtime
[est: 2.5 MiB base P02 + 2 to 3 MiB Vue and tree R7 3.3], s ≈ 0.5 MiB per session instance
[est; D1 measured 296 KiB per 200-row session app in Node]. The table assumes one host.

| Plugins P | Accounts S | Today (per window, reactivity only) | Per window with Vue | This design |
| --- | --- | --- | --- | --- |
| 10 | 1 | 43 MiB | 68 MiB | 73 MiB |
| 10 | 4 | 118 MiB | 218 MiB | 88 MiB |
| 20 | 8 | 418 MiB | 818 MiB | 198 MiB |

Gates are in 0.4. If PB1 shows a worker above 6 MiB, HUD-only plugins get a slim runtime
(reactivity plus HUD ops, no `runtime-core`) and the rest stays.

---

## 4. Authoring model: Vue

### 4.1 What an author learns once

1. **Screens and structure are components** from `@moxi/sdk`: `<List>`, `<Form>`, `<Stack>`,
   `<Hud>`. Templates compile at build time. Lowercase HTML tags, `<style>`, `class`, `style`,
   `v-html`, `v-show`, event modifiers, `<Teleport>` and `<Transition>` are build errors with
   a suggestion (section 4.3).
2. **Collections are data.** `List`, `Grid`, `Table`, `Chart` and Hub items take arrays
   (`ItemData`, `CellData`, `RowData`, series). One row type, `ItemData`, serves Hub results,
   list rows, pins and previews.
3. **Facts are `Readonly<Ref<Observed<T>>>`.** Render something for every reason.
4. **Game actions are values.** `act("game.travel", { mapId })` describes an action. Put it in a
   row's actions or in a `<GameAction>`. The host shows the label, runs it on a press and gives
   you the result. No API runs an action from code.
5. **Module scope is your character session.** State you keep at module level belongs to one
   character visit in one game window. `globalThis` is shared by all your sessions; do not keep
   state there. Shared data lives in documents.

### 4.2 The SDK surface (complete for api 1)

```ts
// @moxi/sdk
export function definePlugin(def: {
  commands?: Partial<Record<CommandId, Component>>;   // views and panels for manifest commands
  hud?: Partial<Record<HudId, Component>>;            // manifest HUD widgets
  hub?: {
    items?: () => ItemData[];                          // reactive; the host ranks them
    answer?: (text: string) => ItemData[] | Promise<ItemData[]>; // text after a scope word, or digit-led text
  };
}): PluginDefinition;

// Composables. Call them in module scope or in a component's setup (this session).
export function useFact<F extends GrantedFact>(id: F): Readonly<Ref<Observed<FactValue<F>>>>;
export function useDoc<T>(name: string, opts: { initial: () => T; scope?: "global" | "account" }):
  { readonly value: T; readonly pending: boolean; set(next: T): Promise<WriteResult> };
export function useSettings(): Readonly<Ref<Settings>>;           // typed from plugin.json
export function useReference<K extends RefTable>(table: K): RefData<K>; // skills, maps, items, professions, heroes
export function useFetch<T>(url: GrantedUrl, opts?: { every?: number; parse?: (u: unknown) => T }):
  { readonly data?: T; readonly error?: NetError; readonly pending: boolean; refresh(): void };
export function useFeed(url: GrantedWss): { readonly messages: readonly string[]; readonly status: FeedStatus };
export function useNavigation(): { push(view: Component, props?: object): void; pop(): void };
export function useToast(): (text: string, tone?: "neutral" | "good" | "bad") => void;

// Values
export function act<Op extends GrantedAction>(op: Op, args: ActionArgs<Op>): GameIntent<Op>;
export function field(key: string): FieldRef; // inside args: the host substitutes a host input's value at press time

// Types
export type ItemData = {
  id: string;                 // stable: selection, pins and actions follow ids
  title: string;
  subtitle?: string;
  icon?: IconRef;             // { glyph } | { skill } | { item } | { profession } | { map } | { asset }
  keywords?: string[];
  accessories?: { text?: string; icon?: IconRef; tone?: Tone }[];
  preview?: Block[];          // data blocks: text | keyvalue | skillbar | image | progress
  unavailable?: string;       // the host shows the reason and disables game actions
  scope?: string;             // Hub items only: one of this plugin's scope words
  actions?: ItemAction[];     // the first one runs on Enter
};
export type ItemAction =
  | { game: GameIntent; onResult?: (r: ActionResult) => void; shortcut?: string } // label written by the host
  | { title: string; run: () => void | Promise<void>; shortcut?: string; tone?: "danger"; confirm?: string }
  | { title?: string; copy: string; shortcut?: string }                           // host copies on the press
  | { title: string; push: Component; props?: object }
  | { link: string }                                                              // https on a granted link: host; host shows the address
  | { wiki: { skill: number } | { map: number } | { item: number } | { profession: number } } // host builds the official wiki URL; no permission
  | { open: { plugin: string; item: string } };                                   // go to another plugin's Hub item (no data, no call)
```

- `useFact` and `act` are typed from the catalog through the generated `Register` (4.4), so
  one function serves every fact and every action. Adding a fact never adds an SDK function.
  Rejected: one named composable per fact (`useTarget()`, `useMap()` [D1]), because the SDK
  would grow with every feature (v2's "capability in five places" [R5 3.2]).
- `useFetch` is a subscription. Main polls the URL once per (install, URL) at
  `max(every, 60 s)` and caches it. Plugin code never runs timers for the network.
- A plugin never sees the account name. `scope: "account"` documents are resolved by the host
  from the session.
- `{ wiki }` is the reference link for plugins that read (Elite skills, boss pages [R4 D10.5]).
  The plugin picks a reference id; Main builds the URL from the reference name for a host on a
  moxi-maintained list (the official wiki). The plugin never chooses the URL, so no data of its
  choosing reaches a server it controls.
- In an `internet`-class install, `onResult` never runs: game outcomes are personal (6.3).
  The generated types make `onResult` `never` for such manifests.

### 4.3 Build: the Vite plugin

`@moxi/sdk/vite` is one Vite plugin. The template and the repo's `plugins/*` use it.

| Step | What it does | Error example |
| --- | --- | --- |
| SFC compile | `@vitejs/plugin-vue`, `bindingMetadata` in `compilerOptions` [R7 3.4 #3] | – |
| Compile gate | a node transform errors on any lowercase tag, `v-html`, `v-show`, event modifiers, `<style>`, `class`, `style`, `<Teleport>`, `<Transition>`, template refs on host elements, unknown components, with a suggestion. Reason: `@vitejs/plugin-vue` compiles these into imports of runtime-dom helpers (`vShow`, `withModifiers`, `withKeys`, `vModelText`), which the host's `runtime-core` subset does not export, so they would fail as undefined helpers at mount, not at build | `Prices.vue:12 <div> is not available in plugins. Use <Stack>.` |
| Externals rewrite | `vue` imports are rewritten to `__moxi`; the build fails on any imported name the host runtime does not export (for example `vShow`, `withModifiers`, `withKeys`, `vModel*`, `Transition`, `TransitionGroup`) | `Prices.vue imports withModifiers from "vue", which plugins cannot use` |
| Capability check | literal ids in `useFact`, `act`, `useFetch`, `useFeed`, `useReference` are compared with `plugin.json`; a non-literal id is an error | `uses useFact("game.target") but plugin.json does not request "game.target"` |
| Read-or-internet | a manifest with a personal read and a `net:` or `link:` host fails (section 6.3) | `reads from the game (game.map) and connects to the internet (net:kamadan.gwtoolbox.com). A plugin can do one or the other.` |
| Inputs in internet plugins | in an `internet`-class plugin, a literal `label` or `placeholder` of an input that matches login words (password, email, account, login, 2FA, authenticator, security code) fails; registry CI runs the same check. It catches lazy phishing only; the "Sent to" chip (5.3) is the real control | `Login.vue:8 an internet plugin cannot ask for a password` |
| Derived manifest fields | `minHost` = highest `since` of every element, prop, composable and catalog id used; `references` = tables used by `useReference` | written into the packaged `plugin.json` |
| Types | generates `moxi-env.d.ts` (gitignored) from `plugin.json` on every change | – |
| Output | function-body bundle, `index.js` | size budget |
| Pack (`moxi pack`) | `dist/plugin.moxi` (one JSON file) and `dist/moxi-release.json` | package budget |

`moxi check` runs `vue-tsc --noEmit`, the manifest check, the capability check, the budgets and
the compile gate. (moxi's own `.vue` files are not type-checked today [R3 3.2]; fix that too.)

### 4.4 Generated types

```ts
// moxi-env.d.ts — generated, gitignored
declare module "@moxi/sdk" {
  interface Register {
    commands: "favourites";
    hud: "last-trip";
    permissions: "game.progress" | "game.travel";
    optional: never;
    settings: { showRegion: boolean };
  }
}
// In @moxi/sdk: useFact<F extends Register["permissions"] & FactId>(id: F) ...
// definePlugin({ commands: { favourit: X } }) is a type error: unknown command id.
```

This is product level, not a probe: if the conditional types give confusing editor errors in
P22, keep the build-time capability check and drop the conditional types (D1 PR-8 rule).

### 4.5 Full example: Quick Travel (community plugin, reads and acts)

Repository layout from `pnpm create moxi-plugin quick-travel`:

```text
plugin.json   src/plugin.ts   src/places.ts   src/Favourites.vue   src/LastTrip.vue
src/plugin.test.ts   assets/icon.png   vite.config.ts   .github/workflows/{ci,release}.yml
```

`plugin.json` (the author writes it; `moxi build` adds `minHost` and `references`):

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/gwasm-dev/moxi/main/packages/sdk/plugin.schema.json",
  "id": "mokai.quick-travel",            // first segment = GitHub owner login; "moxi." is reserved
  "name": "Quick Travel",
  "version": "1.0.0",
  "api": 1,
  "description": "Travel to your favourite outposts from the Hub and see where you went last.",
  "author": "Mo Kai",
  "repository": "https://github.com/mokai/moxi-quick-travel",
  "license": "MIT",
  "icon": "assets/icon.png",
  "accent": "#4f8fd8",                   // the host corrects contrast for the current theme
  "permissions": {
    "game.progress": "Offers only outposts you have unlocked",
    "game.travel": "Travels when you press Enter on a destination"
  },
  "commands": [
    { "id": "favourites", "title": "Travel Favourites", "keywords": ["travel", "outpost"], "shortcut": "mod+shift+t" },
    { "id": "guild-hall", "title": "Travel to Guild Hall", "game": { "op": "game.travel", "args": { "guildHall": true } } }
  ],
  "hub": { "items": true, "scopes": ["tp"] },
  "hud": [{ "id": "last-trip", "title": "Last destination", "anchor": "screen:top-right", "default": false }],
  "settings": [{ "key": "showRegion", "label": "Show the region under each outpost", "type": "toggle", "default": true }]
}
```

`src/places.ts`:

```ts
// Module scope runs once per plugin session (one character visit in one game window).
import { act, useDoc, useFact, useReference, useSettings, type ItemData } from "@moxi/sdk";

const progress = useFact("game.progress");   // Observed<Progress> for this game window only
const maps = useReference("maps");            // names and regions from the player's own Gw.dat
const settings = useSettings();
export const favourites = useDoc<number[]>("favourites", { scope: "account", initial: () => [] });
export const lastTrip = useDoc<number | null>("last-trip", { scope: "account", initial: () => null });

export const placeName = (mapId: number) => maps.get(mapId)?.name ?? `Map ${mapId}`;

const toggleFavourite = (mapId: number) =>
  favourites.set(
    favourites.value.includes(mapId) ? favourites.value.filter((id) => id !== mapId) : [...favourites.value, mapId],
  );

export function moveFavourite(from: number, to: number) {
  const next = [...favourites.value];
  next.splice(to, 0, ...next.splice(from, 1));
  return favourites.set(next);
}

export function placeRow(mapId: number): ItemData {
  // Unknown progress (loading, unsupported) leaves the decision to the host.
  const locked = progress.value.ok && !progress.value.value.unlockedMaps.has(mapId);
  return {
    id: String(mapId),
    title: placeName(mapId),
    subtitle: settings.value.showRegion ? maps.get(mapId)?.region : undefined,
    icon: { map: mapId },
    unavailable: locked ? "Not unlocked on this character" : undefined,
    actions: [
      // Enter. The host writes "Travel to Kamadan, Jewel of Istan" and shows "You are here" itself.
      { game: act("game.travel", { mapId }), onResult: (r) => r.status === "done" && void lastTrip.set(mapId) },
      {
        title: favourites.value.includes(mapId) ? "Remove from favourites" : "Add to favourites",
        shortcut: "mod+f",
        run: () => toggleFavourite(mapId),
      },
    ],
  };
}

export const searchOutposts = (text: string) =>
  maps.search(text, { kind: "outpost", limit: 8 }).map((place) => placeRow(place.id));
```

`src/plugin.ts`:

```ts
import { definePlugin } from "@moxi/sdk";
import Favourites from "./Favourites.vue";
import LastTrip from "./LastTrip.vue";
import { favourites, placeRow, searchOutposts } from "./places";

export default definePlugin({
  commands: { favourites: Favourites },          // "guild-hall" runs from plugin.json, no plugin code
  hud: { "last-trip": LastTrip },
  hub: {
    items: () => favourites.value.map(placeRow), // the host ranks these; no plugin code per keystroke
    answer: searchOutposts,                       // only the text after "tp "
  },
});
```

`src/Favourites.vue`:

```vue
<script setup lang="ts">
import { List } from "@moxi/sdk";
import { computed } from "vue";
import { favourites, moveFavourite, placeRow } from "./places";

const items = computed(() => favourites.value.map(placeRow));
</script>

<template>
  <List
    title="Travel Favourites"
    :items="items"
    reorderable
    placeholder="Filter favourites…"
    :empty="{ title: 'No favourites yet', description: 'Search with tp and a place name, then choose Add to favourites.' }"
    @reorder="({ from, to }) => moveFavourite(from, to)"
  />
</template>
```

`src/LastTrip.vue` (HUD; the player places it, the plugin never sees pixels):

```vue
<script setup lang="ts">
import { Hud, HudIcon, HudText } from "@moxi/sdk";
import { lastTrip, placeName } from "./places";
</script>

<template>
  <Hud v-if="lastTrip.value !== null">
    <HudIcon :icon="{ glyph: 'map' }" />
    <HudText :text="`Last: ${placeName(lastTrip.value)}`" tone="muted" size="s" />
  </Hud>
</template>
```

`src/plugin.test.ts` (the test kit runs the real runtime, decoder and budgets in Node):

```ts
import { mountPlugin, sim } from "@moxi/sdk/testing";
import { expect, test } from "vitest";
import manifest from "../plugin.json";
import plugin from "./plugin";

test("Enter on a favourite travels there and remembers the trip", async () => {
  const p = await mountPlugin(manifest, plugin, {
    game: sim.outpost({ mapId: 55, unlocked: [55, 449] }), // in Lion's Arch
    docs: { favourites: [449] },
  });
  const view = await p.openCommand("favourites");
  expect(view.row("449")).toMatchObject({ title: "Kamadan, Jewel of Istan", enter: "Travel to Kamadan, Jewel of Istan" });
  await view.press("449"); // a trusted Enter in the test host
  expect(p.gameActions).toEqual([{ sid: 1, op: "game.travel", args: { mapId: 449 } }]);
  expect(p.doc("last-trip")).toBe(449);
});

test("search text reaches the plugin only after its scope word", async () => {
  const p = await mountPlugin(manifest, plugin, { game: sim.outpost({ mapId: 55 }) });
  await p.hub.type("kama");
  await p.hub.type("tp kama");
  expect(p.answerCalls).toEqual(["kama"]);
});

test("a switched-off travel permission refuses in host words", async () => {
  const p = await mountPlugin(manifest, plugin, { game: sim.outpost({ mapId: 55 }), docs: { favourites: [449] }, deny: ["game.travel"] });
  const view = await p.openCommand("favourites");
  expect(view.row("449").enter).toBe("Turned off in plugin settings");
  expect(p.session(2).roots).toEqual([]); // nothing leaked into the second game window
});
```

### 4.6 Second example: Trade Prices (internet, no reads)

```jsonc
{
  "id": "mokai.trade-prices",
  "name": "Trade Prices",
  "version": "1.2.0",
  "api": 1,
  "permissions": {
    "net:kamadan.gwtoolbox.com": "Loads current trader prices every few minutes",
    "link:wiki.guildwars.com": "Opens the wiki page of a material when you choose it"
  },
  "commands": [{ "id": "prices", "title": "Trader Prices", "keywords": ["ecto", "trader", "price"] }],
  "hub": { "scopes": ["price"], "numbers": true }   // "price ecto" and "10 ecto in plat"
}
```

```ts
// src/quotes.ts
const quotes = useFetch<Quote[]>("https://kamadan.gwtoolbox.com/trader_quotes", { every: 5 * 60_000 });
// Main polls once for every game window and caches the answer; a sixth window costs no request.
```

Adding `"game.map"` to this manifest fails `moxi build`, install and registry CI with the
read-or-internet message (4.3). The player picks Kamadan or Ascalon in a setting instead.
Trade Prices holds `net:` and `link:`, so it runs in the `internet` host of its tier (1.4).

---

## 5. UI model

### 5.1 One element registry

`packages/sdk/src/host/elements.ts` defines every element once:
`{ tag, index, props: { [name]: { type, since } }, events: { [name]: payloadSchema },
children, surfaces: ("view" | "panel" | "hud")[], since }`.
It generates the author component and its Volar types, the decoder tables, the test-kit
serializer, the docs table, and the type `Record<ElementTag, Component>` that `packages/ui`
must satisfy (a missing host component is a type error).

Decision: one registry generates five artefacts. Reason: today the wire shape exists twice (TS
types and a 170-line ArkType copy) and the test kit cannot use the app's copy [R1 3.9].
Rejected: hand-written parallel definitions.

### 5.2 Data for collections, components for structure

| Concern | Child components (`<ListItem v-for>`) [D4] | Data props (`:items`) [D1] |
| --- | --- | --- |
| Nodes for 1,000 rows | about 10,000 shadow nodes, 15,000 op numbers at mount [D1 M] | 1 node, 1 prop |
| One row changes | patch of that row's nodes | runtime keyed diff by `id`: `ITEMS(root, node, upsert[], remove[], order?)` |
| Host virtualization | needs a window protocol back to the worker | trivial: the host has all rows |
| Hub ranking and pins | host must walk a tree | rows already are the Hub item shape |

Decision: data props for collections. Rejected: child components per row, which cost ten times
the nodes and need a protocol for virtualization.

### 5.3 The vocabulary (api 1, about 45 elements)

| Group | Elements | Serves (R4) |
| --- | --- | --- |
| Layout | `Stack`, `Columns`, `Section`, `Divider`, `Tabs`, `Tab` | U1 |
| Views | `List`, `Grid`, `Table` (collections, data), `Detail`, `Form`, `Empty` | U1, H1 |
| Content | `Text`, `Heading`, `Badge`, `Image`, `Icon`, `SkillBar`, `KeyValue`, `Progress`, `Countdown` | U1, C7, D13 |
| Inputs | `TextField`, `TextArea`, `NumberField`, `Select`, `Toggle`, `Slider`, `ColorField`, `KeyField`, `TagField` | U2 |
| Actions | `Button`, `GameAction`, `RequestAccess`, `Link` | H1 |
| Drag and drop | `reorderable` on `List`/`Grid`, `drag` data on cells, `DropZone` | U3 |
| Drawing | `Chart` (line, bar, area; data table for screen readers), `Canvas` (screen-space draw list), `MapView` (host-drawn map with plugin layers) | U6, D3.7 |
| HUD | `Hud` (anchor), `HudText`, `HudIcon`, `HudBar`, `HudCountdown` | U5 |

Command presentation is a manifest field: `"view"` (in the Hub stack, default) or `"panel"`
(floating, movable, size and place kept by the host, joins the Escape ladder; for example a
Whispers window).

- Prop values only. Never functions, HTML, CSS strings, class names or style objects. URLs only
  as `asset:` paths from the package or `https` links on a granted `link:` host.
- There is no masked (password) input. Every input element of an `internet`-class install
  carries a host chip "Sent to <host>" (one chip naming its first `net:` host and "+N"), like
  the Hub scope chip, because what the player types there can leave the machine.
- Element, prop and event names cross the wire as **indices** into the registry. A plugin
  cannot name what the host does not have [D2 1.3, D3 2.2].
- New elements ship with host releases. They are additive; the build sets `minHost`.
- The launch set is only what the bundled plugins and the Build Library acceptance test need.
  The rest lands with the parity plugin that needs it. PB13 maps real v1 and v2 screens onto this
  table before any element is built.

Decision: about 45 elements that grow by real need. Reason: enough for parity [R4 5], small
enough for one maintainer to theme, fuzz and keep accessible. Rejected: about 70 elements with
an SVG family, Markdown and raster images [D4 2.4]; today's 7 node types.

### 5.4 Theme: follows by default, not locked in

What follows the theme with zero plugin code: every host element uses the `--ui-*` tokens
(`packages/ui/src/tokens.css`) and the Classic skin. A theme switch re-skins every plugin and
sends no message to any worker (P23).

Matthias asked for plugin UI that follows the theme but is not locked in. Plugin CSS is the
obvious answer and the wrong one: it breaks Classic, contrast, density and the HUD, and it is
how v2 and Logseq ended up with "theme by convention" [R5 4.1, R6 2.5]. The better answer gives
each kind of freedom its own safe channel:

| Freedom a plugin wants | Channel | Why it beats plugin CSS |
| --- | --- | --- |
| A recognizable identity | manifest `accent` colour; the host derives tints and corrects contrast against the current theme (`packages/ui/src/color.ts`); used for the icon tile, selection and `tone="accent"` | always readable, works in Classic |
| Meaning and emphasis | `tone` (neutral, accent, good, warning, danger, muted), `size`, `weight`, `emphasis` | consistent across all looks |
| Custom layout | `Stack`, `Columns`, `Tabs`, `Section` with token gaps and paddings | real layout freedom, no CSS |
| Pictures | package images (`assets/*.png`, at most 512×512, no WebP, no SVG) through `<Image src="asset:…">`; Main's data worker decodes them and re-encodes a canonical PNG (section 10), so no renderer ever decodes plugin-supplied image bytes | no network, no tracking pixels, no decoder attack on the processes with secrets |
| Game art | `<Icon :icon="{ skill }">`, `{ item }`, `{ profession }`, `{ map }`, resolved by the host from the player's own `Gw.dat` (TX1) | no ArenaNet assets in packages |
| Custom visuals | `Canvas`, `Chart` and `MapView` draw lists with token paints (`"accent"`, `"danger"`, `"profession:monk"`) and explicit `rgba(…)` inside the drawing | data viz without DOM access; the frame around it stays host chrome |
| A different look for everything | **theme packages**: `kind: "theme"`, data-only token sets (colours, lengths from a fixed scale, bundled font ids; at most 64 tokens; no `url()`, no selectors, no code, no permission page) | the player chooses the look once, for the app and all plugins |
| Density | the host picks compact (game) or comfortable (pages) per surface | plugins never handle it |

Rejected: plugin CSS or class names; iframe panels with injected tokens (VS Code's toolkit is
deprecated; focus and accessibility split per frame [R6 3.4, R7 4.4]); OffscreenCanvas (5.5).

### 5.5 Drawing: draw lists, not pixels

```ts
type Paint = Tone | `profession:${Profession}` | `rgba(${number}, ${number}, ${number}, ${number})`;
type Shape =
  | { t: "rect"; x: number; y: number; w: number; h: number; fill?: Paint; stroke?: Paint; id?: string }
  | { t: "circle"; x: number; y: number; r: number; fill?: Paint; stroke?: Paint; id?: string }
  | { t: "path"; points: Float32Array; closed?: boolean; stroke: Paint; width?: number; id?: string }
  | { t: "text"; x: number; y: number; text: string; size?: "s" | "m" | "l"; paint?: Paint }
  | { t: "icon"; x: number; y: number; size: number; icon: IconRef; id?: string }
  | { t: "raster"; x: number; y: number; w: number; h: number; cols: number; rows: number; cells: Uint8Array; palette: Paint[] };
// <Canvas :width="320" :height="180" :scene="shapes" @press="(shapeId) => …" />
// <MapView :map="mapId" :layers="[{ id: 'explored', z: 1, scene, minZoom: 0.5 }]" @press="…" />
```

- Typed arrays clone in microseconds (1,000 points as one buffer: 2.4 µs [R2 7]).
- The host redraws a scene only when it, the theme or the pixel ratio changes. Hit tests
  return the plugin's own shape ids only. Plugins never get pointer coordinates over the game.
- `MapView` is a host-drawn map from `Gw.dat` in a view or panel. Layers in world coordinates.
  Drawing on the game's own world or mission map waits for gwkit map anchors (later, native).

Decision: declarative draw lists. Reason: they cross processes as data, so workers stay in the
plugin host, and the host can later draw natively inside the game frame without plugin changes
(v1 drew cooldowns and maps natively because DOM overlays float over game panels [R4 7.1]).
Rejected: OffscreenCanvas, because the pixels would be the plugin's, not the host's (no theme,
no hit-test ownership, no accessibility), it closes the path to native drawing later, and its
GPU time cannot be bounded. Whether a canvas transferred across a Main-brokered port works in
Chromium is unverified [R7 5 "?, likely"]; the rejection does not rest on it. WebGL: GPU time
cannot be bounded.

### 5.6 HUD and panels

```vue
<Hud><HudCountdown :until="slot.readyAt" format="cooldown" /></Hud>
```

- The manifest declares each widget with a title and a default anchor. The plugin page lists
  them. Widgets are off until the player turns them on, unless `"default": true` on an official
  install (other sources cannot turn a widget on by themselves).
- Anchors are names: `screen:{top,bottom}-{left,right}`, `screen:top`, `screen:bottom`,
  `screen:center`; later `skill:1..8`, `effect:<skillId>`, `compass`, `target` when gwkit has
  the geometry. The player moves, locks and resets widgets in "Arrange HUD"; offsets are stored
  per account in Main. Plugins never see positions [R4 7.8].
- The HUD layer sits in the game renderer at `pointer-events: none`, `contain: strict`. HUD
  elements have **no events** in 1.0. Interaction goes through the Hub or a panel.
- `Countdown` and `HudCountdown` tick in the host from absolute game-clock deadlines, so facts
  at 1 to 10 Hz give smooth text: one decimal under 3 s, minutes at 99 s and above, warning tone
  under 5 s, danger under 2 s [R4 7.2].
- Panels take pointer input only inside their box. While a panel's input has focus, the Hub
  key fence applies, so typing never reaches the game.
- Known limit: a DOM HUD floats above game panels and tooltips [R4 7.1]. The declarative shape
  keeps a native renderer possible later. Checking how often it covers game UI needs a live
  session (after review).

### 5.7 Drag and drop

- The host runs the whole gesture: pointer capture, drag image, auto-scroll, highlight, and a
  keyboard alternative ("Move to…" picker). Only the final `reorder` or `drop` event with plugin
  ids crosses to the worker.
- Drags stay inside one plugin's surfaces. No drag into the game canvas.
- **A drop never starts a game action.** Moving real items is a host action on a `GameAction`
  that shows its effect text first. Rejected: an `ItemGrid` with a `drop-op` [D4 2.7], which runs
  a game action with no host-written text before the drop.

---

## 6. Capabilities, consent and grants

### 6.1 One catalog drives everything

`packages/sdk/src/host/catalog.ts` is the only place a capability exists. It generates manifest
validation, `moxi-env.d.ts` constraints, composable and `act` types, the page wording, the
enforcement tables in the game renderer and Main, the test-kit fakes, the denial-test table and
the docs table. Adding a fact is one catalog entry plus its gwkit reader plus its simulator
(three production files, P78).

```ts
type Group = "reads" | "acts" | "shows" | "internet" | "hub";
type FactEntry = {
  kind: "fact"; id: `game.${string}`; group: "reads";
  label: string;                // host wording: "Your current target"
  detail: string;               // "Name, kind and position of what you target"
  schema: Type;                 // ArkType; validates sim, test kit and gwkit reader output (P52)
  rateHz: 1 | 10 | 20;
  personal: true;               // every game fact counts for read-or-internet
  since: string;
};
type ActionEntry = {
  kind: "action"; id: `game.${string}`; group: "acts";
  label: string;                                     // "Travel to an outpost, town or your Guild Hall"
  args: Type;                                        // ArkType, checked in Main and in the executor
  describe(args: never, ref: RefData): string;       // "Travel to Kamadan, Jewel of Istan"
  available?(args: never, facts: HostFacts): true | string; // host-only: "You are here"
  confirm?(args: never, facts: HostFacts): string | null;   // "Leave this explorable area?"
  flow: "single" | "host-flow";                      // host-flow = multi-step with progress "5/16"
  regions: "any" | "non-pvp" | "outpost-only";
  minIntervalMs: number;
  since: string;
};
type OtherEntry = {
  kind: "note" | "search" | "net" | "link"; id: string; group: Group;
  label: (arg?: string) => string; personal: boolean; since: string;
};
// Exhaustive by type: Record<CapabilityId, DenialProbe> (e2e table), Record<ActionId, Executor>
// (game renderer), Record<FactId, Reader> (gwkit), Record<CapabilityId, SimFake> (test kit).
```

### 6.2 Launch catalog (api 1)

| Id | Group | Host wording on the page | Enforced by | R4 |
| --- | --- | --- | --- | --- |
| `game.player` | reads | Your character: name, professions, level, campaign and position | game renderer fact filter | F1 |
| `game.map` | reads | Where you are: map, district, and outpost, explorable or PvP | same | F1 |
| `game.target` | reads | Your current target: name, kind and position | same | F1b |
| `game.party` | reads | Your party: heroes, henchmen and their builds | same | F3 |
| `game.skills` | reads | Your skill bar, recharge times and effects on you | same | F4 |
| `game.progress` | reads | Unlocked outposts, missions, titles and skills | same | F2 |
| `game.social` | reads | Your friends, who is online and where, and whispers you receive | same | F5 |
| `game.inventory` | reads | Your bags, storage and gold (pending decision, question 7) | same | G4 |
| `game.builds.load` | acts | Load a build on you or a hero | Main authority + executor | A1 |
| `game.team.apply` | acts | Set up your party: add heroes and load their builds | same (host flow) | A2 |
| `game.travel` | acts | Travel to an outpost, town or your Guild Hall | same (host flow) | A3 |
| `game.storage.open` | acts | Open your Xunlai storage | same | A4 |
| `game.whisper` | acts | Send a whisper you type yourself, to a name you type or to a friend or whisper partner | same; body and target rules in 6.3 | A5 |
| `game.party.invite` | acts | Invite a player you name, or a friend or whisper partner, to your party | same; target rule in 6.3 | A5 |
| `game.resign` | acts | Resign from the mission (asks first) | same | A6 |
| `game.target.call` | acts | Call your target to your party | same | A7 |
| `game.note` | shows | Print notes in your chat that only you see, with an optional chime (at most 1 per second) | Main, rate-limited, no press needed | A8 |
| `hub.search` | hub | Everything you type in the Hub search | game renderer text router | [R1 5.3] |
| `net:<host>` | internet | Connects to `<host>`. It can send what you type into it and learns your IP address and when you play | Main proxy | N1, N2 |
| `link:<host>` | internet | Opens pages on `<host>` in your browser, after you see the address | Main (`shell.openExternal`) | N3 |

Shown on the page without a permission: Hub commands, scope words, HUD widgets, panels, copy on
your press, wiki pages opened on your press, toasts, storage quota, reference data from your
game files ("Uses").

Not plugin capabilities (host tweaks and host settings, never plugin code [R4 6.4]): chat
filters, quick item move, double-click repair, 4 GB mode, native cursor, templates on disk.

### 6.3 Read or internet, never both

Rule (manifest parse, used by `moxi build`, install and registry CI):

```text
personal(permissions ∪ optional) ∩ outbound(permissions ∪ optional) = ∅  →  else ManifestError("read-and-internet")
personal  = every game.* fact, hub.search
outbound  = every net:<host>, every link:<host>
class     = outbound(permissions ∪ optional) ≠ ∅ ? "internet" : "local"   (decides the plugin host, 1.4)
```

`link:` counts as outbound: a plugin that reads can encode facts into a URL path
(`/wiki/Kamadan_<base64 of name and friends>`), and one Enter on an innocent row sends it with
the player's IP address and cookies. Showing the address is not "seeing what it contains" when
the data is encoded.

Not personal, so allowed in an `internet`-class install:
- Hub text after the plugin's own scope word. The player addresses the plugin on purpose, and
  the Hub shows a chip "sends to kamadan.gwtoolbox.com" next to the scope while typing [D2 3.1].
- Hub text that starts with a digit (`"numbers": true`, for `10 ecto in plat`).
- What the player types into the plugin's own inputs. Each input carries the chip "Sent to
  <host>" (5.3), and the page says so (6.5).
- The plugin's own documents, settings and reference data from `Gw.dat`.
- Game actions, but **no outcome**: `done`, `refused` and their reasons are game state (after
  `done` on `game.travel` the plugin knows where you are; `restricted-area` tells the map kind).
  The host shows its receipt to the player; the internet host receives nothing (P7).

Allowed for plugins that read, because they cannot carry plugin-chosen data to a
plugin-chosen place:
- Wiki links built by the host (`{ wiki: { skill } }`, 4.2): the plugin picks a reference id,
  Main builds the URL for a moxi-maintained reference host. Elite's wiki buttons need only this
  [R4 D10.5].
- `game.whisper` and `game.party.invite`, with two host rules that apply to every install: the
  whisper body is always a host input that the player types and the plugin cannot pre-fill
  (`field()` of an input whose `value` the host ignores from the plugin); the target is a host
  input the player types, or a name the host delivered to this session in a `game.social` fact
  (a friend or a whisper partner). Otherwise a plugin could pre-fill encoded facts and whisper
  them to its author's character through ArenaNet's servers.

Why: AGENTS rule 3 says nothing about the player leaves the machine except what the player
sends on purpose after seeing what it contains. A plugin with game reads and an outbound host
can send facts silently, and no allowlist can read intent [R6 3.1]. A disclosure line [D1 3.8,
D4 3.5] informs but does not enforce. R4 shows that parity needs no plugin with both: Trade and
the calculators use the internet without facts; Travel, Builds, Timers and Maps read without
the internet; Elite needs only wiki links [R4 3, 6.2].

The rule holds per process too: an `internet`-class install runs in an `internet` host that
receives no facts, no `hub.search` text and no action outcomes (1.4). Without that, a `net:`
install could read another install's facts through Spectre-class side channels in the shared
renderer and send them with its own grant.

A useful side effect: the registry can auto-ingest same-permission updates (11.6). A hijacked
author account cannot turn a read plugin into an exfiltration plugin without adding a `net:` or
`link:` host, which is an escalation that a human reviews; and a hijacked `net:` plugin lives in
a process with nothing personal to read.

Residuals, stated: two installs from different authors can collude through a timing channel
between processes (low bandwidth, documented); a `net:` server learns the player's IP address
and when the player plays (the page says so); after a renderer exploit in a `local` host, its
facts can leave through WebRTC (1.3).

Future exception path, not in 1.0: a host-rendered `<Send>` control that shows the exact payload
and destination, sends it through Main on a trusted press, and logs it. That meets rule 3
literally. Any exception is Matthias's call (question 1).

Rejected: a disclosure line only (does not meet rule 3); no network in 1.0 (blocks Trade and
live calculator rates); D2's same-owner collusion check (a second account bypasses it and it
blocks legitimate pairs); jittering the first poll after a session starts (plugins run only
during play, so any request reveals play time; the page states it instead).

### 6.4 Manifest schema (api 1)

```ts
type Manifest = {
  id: PluginId;            // ^[a-z0-9][a-z0-9-]{0,38}\.[a-z0-9][a-z0-9-]{1,48}$; prefix = GitHub owner login; "moxi." official only
  name: string;            // 1..40, Basic Latin and Latin-1; not "Moxi", not a host section name
  version: SemVer;
  api: 1;
  minHost?: SemVer;        // written by moxi build
  references?: RefTable[]; // written by moxi build
  description: string;     // 1..200
  author: string;          // 1..60
  repository?: HttpsUrl;
  license?: string;        // SPDX id
  icon?: AssetPath | { glyph: Glyph };
  accent?: HexColor;
  platforms?: ("macos" | "windows" | "linux")[]; // filters the directory only; default all
  stage?: "experimental";  // honoured for official installs only; Dev and Beta show it (AGENTS)
  kind?: "plugin" | "theme";
  permissions?: Record<CapabilityId, Reason>; // Reason: plain text, 1..120 characters
  optional?: Record<CapabilityId, Reason>;
  commands?: { id: string; title: string; subtitle?: string; keywords?: string[]; icon?: IconRef;
               shortcut?: string;                    // a suggestion; assigned only if free and valid (Cmd or Ctrl, 12.3), at most 4
               presentation?: "view" | "panel";
               game?: { op: ActionId; args: Json } }[]; // static host action: no plugin code runs
  hub?: { items?: boolean; scopes?: string[]; numbers?: boolean }; // scopes: ^[a-z]{2,12}$, at most 4
  hud?: { id: string; title: string; anchor: Anchor; default?: boolean }[]; // default honoured for official installs only
  settings?: Setting[];    // toggle | number | select | slider | text | color | key
  tokens?: Record<TokenName, string>; // kind "theme" only
};
```

Parse rules:
- Unknown **top-level** fields: ignored with a warning (an older host meets a newer manifest
  through `minHost`, not by failing; today any unknown key rejects the manifest [R1 5.6]).
- Unknown **capability id**: the plugin is not installable: "Needs a newer Moxi". A host never
  grants what it does not know.
- The `plugin.json` **inside the package** is the only authority. Index entries derive from it.

### 6.5 The plugin page: exact content

Main builds one page model with a pure function, `pluginPage(manifest, catalog, grants,
source, compat) → PageModel` (`apps/desktop/src/plugins/page.ts`). The launcher directory and the
in-game Hub ("Plugins", and ⌘I on any plugin row) render it with one component,
`packages/ui/src/PluginPage.vue`. No plugin code runs while the page is open (P33). Host wording
comes first; the author's reason follows, attributed. Groups have a fixed order.

Before install, for the example plugin:

```text
[icon on #4f8fd8 tile]  Quick Travel                                         [ Install and allow ]
by Mo Kai · Community · reviewed 2 Nov 2026 · version 1.0.0 · MIT · 18 KB
Travel to your favourite outposts from the Hub and see where you went last.

READS FROM THE GAME
  Unlocked outposts, missions, titles and skills
    Plugin says: "Offers only outposts you have unlocked"

ACTS FOR YOU · only when you press its button or key
  Travel to an outpost, town or your Guild Hall
    Plugin says: "Travels when you press Enter on a destination"
    You see the place before it runs, for example "Travel to Kamadan, Jewel of Istan".

INTERNET
  None. This plugin cannot connect to the internet. What it reads stays on this computer.

ADDS
  Hub: Travel Favourites (⇧⌘T) · Travel to Guild Hall · search word "tp"
  Over the game: Last destination · off until you turn it on

STORES
  Its own data on this computer, up to 5 MB

USES
  Place names and icons from your game files

NO PLUGIN CAN
  Read game memory or network traffic · Press keys or click for you · Act without your press ·
  See your password or account · Read other plugins' data · Run code it downloads

SOURCE
  github.com/mokai/moxi-quick-travel · tag v1.0.0 · commit 3f2a9c1 · SHA-256 9b1e…41c0
  Checked by the Moxi plugin list. A matching hash proves delivery, not safety.
  Works with this game build: 2 of 2 features
```

For an internet plugin (Trade Prices), the first and third groups read:

```text
READS FROM THE GAME
  Nothing. This plugin cannot read anything from your game.

INTERNET
  kamadan.gwtoolbox.com
    Plugin says: "Loads current trader prices every few minutes"
  Opens wiki.guildwars.com pages in your browser, after you see the address
    Plugin says: "Opens the wiki page of a material when you choose it"
  It sees only what you type after "price", searches that start with a number, and what you
  type into its own fields (marked "Sent to kamadan.gwtoolbox.com"). It can send those.
  kamadan.gwtoolbox.com also learns your IP address and when you play.
  It cannot read your game. Never type a password or account details into a plugin.
```

Plugin icons on this page and everywhere else are PNGs that Main re-encoded (section 10); the
launcher never decodes bytes from a package.

Source block for a player-added GitHub repo (above the button):

```text
NOT REVIEWED BY MOXI
  It comes from github.com/someone/gw-maps (owner someone, id 1234567).
  Moxi still enforces everything on this page. It runs apart from reviewed plugins.
  Updates wait for you.
  [ ] Trust plugins from someone            (asked once per owner)
```

Optional permissions (in a group "ASKS LATER") show as unchecked lines; they are granted only in
context (6.7). After install, every line in READS, ACTS, INTERNET and ASKS LATER has a switch.
A switched-off fact reads `{ ok: false, reason: "not-permitted" }`. A switched-off action shows
its control disabled with "Turned off in plugin settings", and a press is refused. The installed
page also has: generated settings, shortcuts, **Activity** (local only: actions run with
results, requests per host per day, links opened), versions with "Use previous version", and
"Uninstall" ("Keep its data?").

An update that needs consent:

```text
Quick Travel 1.1.0 needs your OK. Version 1.0.0 keeps running until you decide.
  + Reads: Your party: heroes, henchmen and their builds
      Plugin says: "Suggests outposts where your heroes can join"
  [ Allow and update ]   [ Not now ]
```

### 6.6 Grants

```sql
-- Main SQLite; expand-only migrations from 1.0
CREATE TABLE plugin_sources (
  source_key TEXT PRIMARY KEY,         -- 'official' | 'community' | 'gh:<ownerId>' | 'dev:<pathHash>'
  kind TEXT NOT NULL, owner_login TEXT, owner_id INTEGER, trusted_at INTEGER
) STRICT;
CREATE TABLE plugin_installs (
  install_key TEXT PRIMARY KEY,        -- '<source_key>/<plugin_id>'; also the documents key
  source_key TEXT NOT NULL REFERENCES plugin_sources,
  plugin_id TEXT NOT NULL UNIQUE,      -- one install per id per player
  tier TEXT NOT NULL CHECK (tier IN ('reviewed', 'unverified')),
  version TEXT NOT NULL, sha256 TEXT NOT NULL,
  previous_sha256 TEXT, held_sha256 TEXT, repo_id INTEGER,
  enabled INTEGER NOT NULL, auto_update INTEGER NOT NULL,
  disabled_reason TEXT CHECK (disabled_reason IN ('player','crashed','withdrawn','incompatible','sandbox')),
  error TEXT, installed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE plugin_grants (
  install_key TEXT NOT NULL REFERENCES plugin_installs ON DELETE CASCADE,
  capability TEXT NOT NULL,            -- catalog id, 'net:<host>' or 'link:<host>'
  state TEXT NOT NULL CHECK (state IN ('granted', 'denied')),
  decided_at INTEGER NOT NULL, decided_for_version TEXT NOT NULL,
  PRIMARY KEY (install_key, capability)
) STRICT;
CREATE TABLE plugin_crashes (install_key TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL) STRICT;
CREATE TABLE plugin_activity (install_key TEXT, day TEXT, kind TEXT, target TEXT, count INTEGER,
  PRIMARY KEY (install_key, day, kind, target)) STRICT;
-- documents: key column becomes install_key (direct cutover before 1.0)
```

- `effective(install) = requested(manifest) ∩ granted − killed(compat feed, game build) −
  (withdrawn ? everything : ∅)`. One function in Main.
- Main pushes effective grants as copies: the per-install map to each plugin host (fan-out) and
  to each game renderer (UI state and text routing), and to each game renderer the union per
  `local` plugin host (the source filter; an `internet` host's union is always empty). A revoke
  takes effect on the next publish tick.
- **Host binding (I7).** Main assigns each install to exactly one host, `<tier>.<class>`, and
  pushes that map with the grants. The game renderer accepts ops, items, answers,
  subscriptions, `RequestAccess` and `GameAction` roots on a (window, host) port only for
  install keys of that host. Main accepts every `plugin.*` request from a plugin-host
  `webContents` (`plugin.code`, `plugin.doc.*`, `plugin.net.*`, `plugin.feed.*`,
  `plugin.ref.query`, `plugin.crashed`) only for install keys of that host. Anything else is
  dropped and counted as a fault of that host. So an exploited unverified host cannot act,
  read data or file crash reports as an official install.
- **Where approvals happen:** Main accepts install, grant and update-consent calls only from
  the launcher's or a game window's `webContents` (host code only, no plugin code). The
  plugin-host preloads have no such channel. Rejected: approvals anywhere [D1], and D3's
  launcher-only rule, which forces a player in the game back to the launcher for an optional
  permission.
- Official bundled plugins: pre-granted on first run, the page still shows everything, every
  switch works (question 3).

### 6.7 Optional permissions in context

A plugin places `<RequestAccess permission="hub.search" />`. The host renders "Allow: Sees
everything you type in the Hub search" with the author's reason. A trusted press opens a host
sheet; "Allow" makes the game renderer call Main. Denied twice: the element shows "Change this
in the plugin page" and asks no more [R6 2.11]. No API asks from code, so a timer cannot.
Rejected: `requestPermission()` with one-use gesture ids [D1 3.7], which is more API for the
same effect.

### 6.8 Hub text routing

| Text class | Who receives it | Personal |
| --- | --- | --- |
| After a plugin's own scope word (`tp kama`) | that plugin only | no |
| Starts with a digit, for plugins with `"numbers": true` | those plugins | no |
| Anything else | plugins granted `hub.search` (optional) | yes |
| Hub items (`hub.items`) | nobody: the host ranks them; no plugin code runs per keystroke | – |

The game renderer routes text and addresses each query to one install. Today every Hub plugin
receives every keystroke [R1 5.3].

### 6.9 Updates that add permissions

`decideUpdate(installed, candidate, sourceTier, autoUpdate) → Decision` is one pure function in
`apps/desktop/src/plugins/updates.ts`, tested over all combinations with literal expectations (P39).

| Situation | Official, community | GitHub repo | Dev folder |
| --- | --- | --- | --- |
| Same or fewer permissions, same owner and repo ids, `api` and `minHost` fine | apply when idle; notice in the list | ask (default) or auto if the player turned it on | reload at once |
| Permission removed | apply; its grant rows deleted | same with notice | same |
| New optional permission | apply; new ids start `denied` | same | same |
| New required permission, or a new `net:` or `link:` host | **hold**: the old version keeps running; badge "Needs your OK" with the diff | same | apply with consent sheet |
| New permission that the player denied before | apply; it stays denied; the diff says "still off" | same | same |
| `api` unsupported or `minHost` newer | not offered; "Needs Moxi 1.3" | same | error row |
| Owner id or repo id changed (index entry; for GitHub repos, the id check on every real update, 11.5) | hold as a new source | refuse; "This repository now belongs to someone else" | – |
| Same version, different bytes | refuse and log | refuse, warn: "the publisher changed 1.2.0 after you installed it" | – |
| Withdrawn | turn off with the reason; data kept | same if listed | – |
| Manifest becomes read-and-internet | refuse | refuse | error row |

An update that changes the class (a new `net:` or `link:` host, or the last one removed) moves
the install to the other host of its tier when it applies.

Rejected: v2's "every update disables until reviewed" (too much friction [R6 3.3]).

---

## 7. Game actions: host-held activation

### 7.1 Flow

```text
Player presses Enter on a row, clicks a GameAction, or presses its shortcut   (game renderer)
 1 Hub: event.isTrusted, not consumed, on a host-rendered GameAction of install X in root R
 2 Hub: intent {sid, installKey: X, root R, op, args}; resolve {field} refs from host inputs
 3 Hub: if the descriptor of that control changed in the last 500 ms → host confirm sheet, stop
 4 Hub: local fast checks on its copies: grant, catalog available(), confirm() → sheet if needed
 5 Main  plugin.action.authorize(intent, origin: "player" | "agent")
          install enabled · grant 'granted' · args match catalog schema · no kill switch for op
          on this game build · QA allowlist when origin is agent (moxi-dev MCP) · minIntervalMs
          · append to plugin_activity  →  { ok } | { refused, reason }
 6 Executor at the next gwkit safe point: region, loading, busy(op, sid); single op or host flow
          with progress ("5/16"); observe the effect in facts → done | refused | failed
 7 Hub: host receipt "Travelling to Kamadan…" → "Arrived" or "Not sent: you are in PvP"
 8 Worker (local class only): onResult / @result with the ActionResult; internet class: nothing
```

- One trusted event starts at most one action; the Hub marks it consumed.
- The label is the host's: `describe(args)`. `GameAction` has no title prop, and a game action in
  `ItemData.actions` has no `title`. A "Copy" label can never run travel.
- No plugin API starts an action. Timers, `onResult` chains, network callbacks and module code
  have no call for it. Freshness is structural, not a 3 s token.
- Multi-step flows (`game.team.apply`, travel with "Leave this area?") are host flows by
  construction. A plugin never sequences game actions (AGENTS rule 2).
- `{ field: "body" }` in args (whisper text) takes the value of the host input at press time,
  so a fast Enter never sends stale text [D4 3.6]. For `game.whisper` the body must be a
  `field()`, and the host never takes an initial `value` for that input from the plugin; the
  target must be a `field()` or a name from this session's `game.social` fact (6.3). The same
  target rule holds for `game.party.invite`. The Hub checks both when it builds the intent
  (step 2), because it owns the inputs and the facts; Main refuses a whisper intent whose body
  is not marked as host input.

### 7.2 Manifest commands with a game op

`commands[].game = { op, args }` is static. The command runs on the Hub row or on its shortcut
with no plugin code. Main sees the bound shortcut itself in `before-input-event` (section 12.3),
so the press is witnessed where it matters most: while the game has focus. Plugin chords need
Cmd or Ctrl and work only inside a plugin session, so typing in chat or on the login screen
never fires one (12.3).
Rejected: a command callback that returns any op and args after the press [D3 3.8] (a confused
deputy), and plugin-supplied args within 500 ms [D1 3.9].

### 7.3 Self-only notes

`game.note` prints a line in the chat log that only the player sees, with an optional chime.
It needs no press (reminders and timers fire on their own), and Main rate-limits it (1 per
second, 8 queued). It is not a game action: it changes nothing in the world [R4 7.7].

### 7.4 Decisions

Decision: Main authorizes every game action from every origin. Reason: one choke point for the
grant store, kill switches, the agent QA allowlist, rate limits and the activity log [R1 5.2,
9.2]. Rejected: the executor deciding alone from pushed grant copies [D1 3.5] (the QA allowlist
has no hook); Main tickets plus a Main input witness [D4 3.6], which enforce the same property
three to four times — the ticket stops no threat because the executor and the Hub share the
trusted game renderer, and on the game window movement keys keep a witness true almost always.

Decision: delete plugin-held activation tokens and the imperative `await game.travel()`.
Reason: a token proves "the player clicked something in this plugin", not "the player agreed
to this action" [R1 5.1]. Rejected: binding tokens to nodes.

---

## 8. Facts

### 8.1 Path

```text
gwkit readers at the safe point (game renderer)
  read only slices that are (granted to some install of local host H) ∩ (subscribed by a session of H)
  diff against the last value, ignoring `at`; lists as typed arrays; timers as game-clock deadlines;
  map-load generation number so stale agent ids drop [R2 5.3]
  → per (session, local plugin host) port: facts {tick, slices}      at most 20 Hz per slice
  (internet hosts: never a facts message)
membrane (local plugin host H)
  → each worker gets only slices its install is granted; others get not-permitted
worker runtime
  → shallowRef per slice; effects re-run; ops out
```

- No subscriber, no read. The game renderer reads nothing when no plugin subscribed [R2 6].
- Gating by game state (`loading`, `restricted-area`) is the producer's job, from catalog
  `regions` and the map fact.
- Fact cost targets (Measure, P29): read and publish p99 ≤ 0.25 ms per tick at 1,000 agents.
  Node lower bounds: read 6.6 µs, typed-array clone 2.4 to 4.9 µs [R2 7].

### 8.2 One schema per fact

The catalog's ArkType schema for a fact validates three producers: the simulator (`@moxi/sdk/sim`),
the test kit fakes and the gwkit reader output (on fixture-world and on the corpus lane). They
cannot drift (P52).

---

## 9. Transport

### 9.1 Links

| Link | Carrier | Messages |
| --- | --- | --- |
| Main ↔ plugin host | IPC from `packages/contracts`, ArkType in Main | `plugin.code(installKey)`, `plugin.doc.read/write/list`, `plugin.net.fetch`, `plugin.net.subscribe/unsubscribe`, `plugin.feed.open/close`, `plugin.ref.query`, `plugin.crashed`; events `plugin.installs`, `plugin.grants`, `plugin.doc.changed`, `plugin.net.data`, `plugin.feed.message` |
| Main ↔ game renderer | IPC | `plugin.action.authorize`, `plugin.page`, `plugin.grant` (approvals), `hub.toggle` and `hub.command` events, `plugin.grants` and `plugin.installs` events, `compat.status` |
| Main ↔ launcher | IPC | `plugins.directory`, `plugins.page`, `plugins.install`, `plugins.update`, `plugins.uninstall`, `plugins.grant`, `plugins.enable`, `plugins.sources.add/remove`, `plugins.dev.add` |
| Game renderer ↔ plugin host | one `MessageChannelMain` port per (game window, host), brokered by Main (as today, `apps/desktop/src/shell/main.ts:141-156`) | to host: `mount`, `unmount`, `event`, `query`, `facts`, `result`, `ack`; to game: `ops`, `items`, `answers`, `subscribe`, `rootGone`, `toast`, `status` |
| Membrane ↔ worker | `postMessage` in one process (private) | to worker: `init`, `session.open/close`, `mount`, `unmount`, `facts`, `event`, `query`, `result`, `doc`, `net`, `settings`, `grants`, `ping`; from worker: `ready`, `ops`, `items`, `answers`, `subscribe`, `request`, `error`, `pong` |

- The membrane stamps the install on every request by the worker it came from. Messages from a
  worker carry no identity. The receivers accept a stamp only for installs of that host (host
  binding, 6.6), so an exploited host cannot stamp another host's install.
- Every Main channel that a plugin host can call has a per-install budget (3.6). Document,
  reference and image work runs in Main's plugin data worker, never on Main's UI thread, which
  dispatches input to every window and runs `before-input-event` for each key (P77).
- Decision: keep the membrane between workers and the game renderer. Reason: it checks sizes,
  budgets and rates before anything reaches the WASM frame thread. Rejected: direct ports from
  workers into the game renderer [D2 1.2], which move structured-clone deserialization of
  unvalidated, possibly huge messages onto the game's main thread.
- Rejected: per-install Main ports for identity [D2 1.2]. Inside one renderer they do not reduce
  what an exploit can do, and the membrane already stamps identity against JavaScript attackers.

### 9.2 Ops (private wire)

```ts
type Op =
  | [1 /* CREATE */, id: number, element: number]                 // registry index
  | [2 /* TEXT */, id: number, text: string]
  | [3 /* INSERT */, parent: number, id: number, before: number]   // 0 = append
  | [4 /* REMOVE */, id: number]                                   // frees every sign in the subtree
  | [5 /* PROP */, id: number, prop: number, value: PropValue]
  | [6 /* EVENT */, id: number, event: number, sign: number]       // 0 = removed
  | [7 /* ITEMS */, id: number, upsert: Row[], remove: string[], order?: string[]]
  | [8 /* SCENE */, id: number, scene: Shape[]];
type Batch = { t: "ops"; sid: number; root: RootId; seq: number; ops: Op[] }; // flattened on the wire
type RootId = `${"view" | "panel" | "hud"}:${number}`;
```

- One batch per Vue scheduler flush per root (`queuePostFlushCb`), in the vue-lynx pattern [R7 3.2].
- Handler identity is de-duplicated: an inline `@select="pick(i.id)"` in a loop sends 0 ops on
  re-render (807 numbers before, 7 after [R7 3.4 #6]). `REMOVE` frees signs; R7's renderer leaked
  1,000 handlers after 5 unmounts [D1 M].
- Backpressure: one batch in flight per root until the applier sends `ack`; the runtime merges
  later ops [D3 2.2]. A flood becomes waiting, not a crash. The membrane enforces it, because
  plugin code shares the runtime's realm and can call `postMessage` itself: a second unacked
  batch on a root is a crash. The membrane also holds batches to the byte rate per install
  (3.6), and the applier drops retained data beyond the retained-size budget.
- Validation: one hand-written decoder driven by the registry tables, in `@moxi/sdk/host`. The
  membrane runs it (fast failure and attribution); the game applier runs it again before apply
  (the valuable process does not trust the plugin host); the test kit runs it (parity). ArkType
  stays at IPC, file and network edges. Rejected: per-message ArkType in the plugin host (today,
  `apps/plugin-host/src/worker-messages.ts`, 170 lines).
- Applier frame budget: at most 1 ms of op application per frame on the game thread; the rest
  waits for the next frame.

### 9.3 Events back

`{ t: "event", sid, root, sign, payload }` with a payload schema per element event (form values,
`{ from, to }`, `{ source, slot }`, shape id). Unknown signs are dropped; stale signs after a
re-render cannot run a different handler.

---

## 10. Data sources in Main

| Source | Owner file (`apps/desktop/src/…`) | Plugin access | Notes |
| --- | --- | --- | --- |
| Registry: sources, installs, grants, crashes, held updates | `plugins/registry.ts`, `plugins/grants.ts` | none (pushed copies) | one row per install |
| Package store | `plugins/package.ts` | `plugin.code` | `<data>/plugins/<sha256>.moxi`, content-addressed, immutable, hash checked on every load |
| Documents | `plugins/documents.ts` (from `storage/documents.ts`), in the plugin data worker with its own SQLite file `plugin-data.sqlite` | `useDoc` | key `(install_key, scope, account, name)`; revision-checked; `set` returns `ok`, `conflict` (with the stored value), `quota` or `rate`; no echo of own writes; list and delete for uninstall |
| Net proxy and feeds | `plugins/net.ts` | `useFetch`, `useFeed` | rules below |
| Reference data | `plugins/reference.ts` on the TX1 `Gw.dat` reader, in the plugin data worker | `useReference` | paged queries, 20 per second per install; icons as tokens the host resolves through `moxi://app/ref/…`; never bytes in plugins [R4 7.6] |
| Package images | `plugins/assets.ts`, in the plugin data worker | `asset:` props | PNG only. Before inflating, the `IHDR` must say at most 512×512 and 8 bits per channel, not interlaced, and the package total must stay under 4 megapixels; the worker inflates with `node:zlib` (`maxOutputLength` from `IHDR`), unfilters in plain JavaScript (about 150 lines), and writes a canonical RGBA PNG with its own encoder. Launcher and game renderers only ever get these PNGs, served with `nosniff` |
| Activity log | `plugins/activity.ts` | none | counts per install, host and day; last 100 actions with results; no URL contents |
| Signed feeds | `feeds.ts`: `fetchSigned(url, keyIds) → bytes \| lastGood` | none | one verifier for the compat feed and the plugin index; two keys |

Network rules (`plugins/net.ts`, plain Node, Vitest):

1. `https:` and `wss:` only, port 443. WHATWG `URL`; no userinfo, no IP literals; lowercase,
   trailing dot removed, IDNA to ASCII; exact match with a granted `net:` host.
2. DNS resolved in Main; loopback, private, link-local, CGNAT, multicast, IPv6 ULA and
   v4-mapped addresses refused; the connection uses the vetted address with SNI = host (no
   rebinding window). PB11 picks the stack without a new dependency.
3. GET only in api 1. Request header `accept` only; no cookies, no `if-none-match`, no
   `authorization`, no `referer`; `User-Agent: Moxi/<version>`.
4. Redirects to the same host only, at most 3. 10 s timeout. 4 MiB response. Text and JSON only.
5. Rate and cache per (install, URL): 60 per minute, burst 10; `max-age` honoured from an
   in-memory cache. ETags are never sent back, and nothing about plugin HTTP survives an app
   run, so a server cannot plant a cookie-like identifier. `useFetch` with `every` is one Main
   poller per (install, URL).
6. Feeds: one socket per (install, URL) for the whole app, ping and reconnect with backoff 1 to
   60 s in Main; messages ≤ 64 KiB, ≤ 50 per second forwarded.
7. Every request counts in the activity log.

Decision: the network goes through a Main proxy with exact hosts. Rejected: holes in the worker
CSP (a `data:` worker inherits the page's policy, so it cannot be per plugin [R1 6.4]); sockets
per game window (four accounts would mean four Trade sockets [R4 7.5]).

Decision: one plugin data worker (`worker_threads`) in Main owns plugin documents, reference
data and image decoding. Reason: Main's JavaScript runs on Electron's browser UI thread, which
dispatches input to every window, runs `before-input-event` for every key and carries game TCP
through IPC; synchronous SQLite writes (`node:sqlite` `DatabaseSync`) and `Gw.dat` decoding must
not run there. It is the same pattern as `locate()` (14). Rejected: rate limits alone on Main's
thread (many installs together still stall input).

Decision: Main's data worker decodes package images, PNG only, in memory-safe JavaScript plus
`node:zlib`, and re-encodes them. Reason: an image decoder bug (libwebp CVE-2023-4863 was
exploited in the wild) must never run in the launcher (credentials) or the game renderer
(typed password, game memory), and a 512 KiB file can declare a 1 GiB image. It works before
install, when no plugin host exists. Rejected: decoding in the plugin host and sending RGBA to
Main (no plugin host exists while the launcher shows a page, and it adds a raw-pixel channel
from an untrusted process); WebP (no small memory-safe decoder; authors export PNG).

---

## 11. Distribution and integrity

### 11.1 Sources and tiers

| Source | Where the code lives | Who vouches | Integrity | Updates | Badge | Plugin host |
| --- | --- | --- | --- | --- | --- | --- |
| Official | `plugins/*` in the moxi repo until the SDK is published; then `gwasm-dev/moxi-plugins` | moxi CI and review | SHA-256 + commit in the signed index; bundled snapshot in the app | automatic unless escalating | "By Moxi" | reviewed |
| Community | the author's GitHub repo, listed in `gwasm-dev/moxi-registry` | registry CI on every version; a human on escalation, new owner or failed check | SHA-256 + commit in the signed index | automatic unless escalating | "Reviewed" | reviewed |
| GitHub repo | any `owner/repo` the player adds | nobody | trust on first use: owner id, repo id, tag, SHA-256 | ask by default | "Not reviewed" | unverified |
| Dev folder | a local folder (developer mode) | the player | SHA-256 per load | on file change | "Development" | unverified |

This is "Obsidian, with pins": a list in a git repo plus code in the author's repo [R6 2.1], but
every installed byte is pinned to a reviewed or first-seen hash.

Player-added GitHub repos sit behind one switch, "Allow plugins from GitHub repositories", off by
default; turning it on shows one explanation (question 2). The first install from a new owner
asks "Trust plugins from <owner>?" once per owner id [R6 2.4].

Decision: official plugins stay in the moxi repo until the SDK is published. Reason: one pull
request changes the SDK and its plugins together. Rejected: a separate repo now (two pull
requests per SDK change; v2's example repo went stale in two days [R5 4.3]).

### 11.2 Package `.moxi`: one JSON file

```ts
type MoxiPackage = {
  format: 1;
  manifest: Manifest;                                  // the only authority
  code: string;                                        // function-body bundle; ≤ 1 MiB
  assets?: Record<AssetName, { type: "image/png"; base64: string }>;
  // AssetName ^assets/[a-z0-9][a-z0-9._/-]{0,120}\.png$ without ".."; ≤ 512 KiB and ≤ 512×512 each, ≤ 64 assets
};
// file ≤ 8 MiB, checked before JSON.parse; JSON depth ≤ 32; identity = SHA-256 of the file bytes
```

- Never extracted to disk, so path traversal, symlinks, archive bombs, case folding and Windows
  reserved names cannot happen. No unzip dependency.
- Deterministic `moxi pack` (sorted keys, fixed whitespace, no timestamps), so registry CI can
  rebuild and compare (PB16).
- Each release has two assets: `plugin.moxi` and `moxi-release.json`
  (`{ id, version, sha256, size, manifest }`, derived; checked equal to the inner manifest).

Decision: a single JSON file. Rejected: a zip [D1 4.2, R6-5], which brings the archive attack
class back and needs an unzip dependency.

### 11.3 Signed index

Published by `gwasm-dev/moxi-registry` to static hosting as `index.json` and `index.json.sig`
(ed25519 over the exact bytes). Two public keys ship in the app (current and next). The signing
key sits in a GitHub environment that needs Matthias's approval for every publish. Publishes are
batched once a week; a withdrawal publishes at once. The approval page shows a generated plain
diff against the last signed index: new versions, permission changes, tier or owner changes,
withdrawals. So each approval is a short, readable list, not a nightly habit.

```jsonc
{
  "format": 1,
  "seq": 418,                                  // strictly increasing; a lower seq is ignored (rollback)
  "keyId": "plugins-2026",
  "issued": "2026-11-02T10:00:00Z",
  "expires": "2026-12-02T10:00:00Z",           // expired: no new installs; installed plugins keep running
  "plugins": [{
    "id": "mokai.quick-travel", "tier": "community", "name": "Quick Travel", "description": "…",
    "repo": { "owner": "mokai", "name": "moxi-quick-travel", "ownerId": 4815162, "repoId": 342342 },
    "versions": [{
      "version": "1.0.0", "api": 1, "minHost": "1.0.0", "tag": "v1.0.0", "commit": "3f2a9c1e…",
      "url": "https://github.com/mokai/moxi-quick-travel/releases/download/v1.0.0/plugin.moxi",
      "sha256": "9b1e…41c0", "size": 18432,
      "permissions": ["game.progress", "game.travel"],   // derived by CI; install refuses on mismatch
      "reviewed": "2026-11-02", "scorecard": "scorecards/mokai.quick-travel/1.0.0.json"
    }]
  }],
  "withdrawn": [
    { "match": { "id": "evil.thing" }, "versions": "*", "reason": "Sent your character name to a server" },
    { "match": { "sha256": "77aa…" }, "reason": "Malicious build of a GitHub plugin" },
    { "match": { "ownerId": 7654321 }, "reason": "Account taken over; all its plugins stopped" }
  ]
}
```

Main fetches it at start and every 6 hours when automatic checks are on (a static file the app
downloads; AGENTS rule 3). Offline, bad signature, unknown key, lower `seq` or parse error: the
last good copy stays. `withdrawn` matches id, SHA-256 or owner id, so it reaches every source,
also GitHub repos and dev folders.

### 11.4 Install, update, uninstall

| Step | What Main does |
| --- | --- |
| Install | download (≤ 8 MiB, 30 s) → SHA-256 equals the index pin or the TOFU record → parse with limits → read-or-internet → id rules → for indexed sources, index permissions equal the package manifest → page → player accepts → write `<data>/plugins/<sha256>.moxi` (temp, fsync, rename) → one transaction: install row, grant rows, publisher row → enable |
| Load | read the file; SHA-256 equals the row (disk tamper turns the install off: "Files changed on disk"); send the code to the install's plugin host (tier and class) |
| Update | the table in 6.9; keep exactly one previous package for "Use previous version" |
| Disable | worker stopped in all sessions; grants kept |
| Uninstall | stop; delete install and grant rows; ask "Keep its data?" (default keep); unreferenced packages deleted at next start |
| Collision | a second install with the same id from another source is refused: "Uninstall Quick Travel first" |
| GitHub to community | if the index lists the same owner id, repo id and hash, the page offers "Switch to the reviewed source" and moves the data key |

### 11.5 GitHub repos without the API rate limit

- Add: one call `GET api.github.com/repos/{owner}/{repo}` for `owner.id` and `id` (stored;
  repo-jacking defense [R6 3.2]). GitHub only at first (stable numeric ids).
- Check: `https://github.com/{owner}/{repo}/releases/latest/download/moxi-release.json`; the
  redirect gives the tag. 0 API calls per check. No system `git` (not on stock Windows
  [R8 3.14]).
- Real update (the SHA-256 changed): one call `GET api.github.com/repositories/{repoId}` by
  the stored numeric id. Refuse if it is gone or its `owner.id` differs from the stored one;
  else download `plugin.moxi` from that repo's current `full_name`. Reason: the check path uses
  names only, so if an author renames or deletes the account or repo, a stranger can register
  the old names and serve releases there; the manifest prefix check would pass too, because
  the stranger now owns that login. One API call per real update stays far below the
  unauthenticated limit.
- `plugin.json` is read **from inside the package**, never from the repo HEAD.
- Main downloads only from hosts that PB15 records (today `github.com`, which redirects release
  assets to `release-assets.githubusercontent.com`), `api.github.com` and the index host. If
  GitHub moves assets to a new host, downloads fail closed with "GitHub changed its download
  address; update Moxi" until an app release adds it.

### 11.6 Registry CI

`gwasm-dev/moxi-registry`: `plugins/<id>.json` (tier, repo, owner id, repo id, pinned versions),
`withdrawn.json`, and three workflows:

| Workflow | Does |
| --- | --- |
| `verify.yml` (every pull request) | download the asset, SHA-256, `parseManifest` (the app's code), read-or-internet, id prefix = owner login, owner and repo ids by API, permission diff vs the last pinned version (escalation labels the PR), size limits, reproducible rebuild from `commit` (if PB16 passes), the login-words input check, banned patterns (`eval`, `Function(`, non-literal `import(`, `WebAssembly`, obfuscation markers); writes a public scorecard |
| `ingest.yml` (nightly and on dispatch) | for every listed repo, read the latest release; checks pass and nothing escalates → commit the pinned version; escalation, failed check or new owner → open a PR for a human [D4 4.2] |
| `publish.yml` (weekly on `main`, and at once for withdrawals) | build `index.json` and the approval diff, sign in the protected environment, publish |

Untrusted code never runs next to a credential. `pnpm install` and `vite build` of an author
repo run the author's scripts and `vite.config.ts`, so every rebuild and every step that touches
author code runs in a separate job with `permissions: {}`, no secrets, no cache writes and
`--ignore-scripts` where possible. That job outputs only hashes and the parsed manifest as an
artifact. The job that commits reads that artifact as untrusted data (ArkType), never runs
plugin code, and may write only the version fields of `plugins/<id>.json`; `main` is protected.

Authors only tag releases. Humans review behaviour on escalation, not hashes.

### 11.7 Author toolchain and developer mode

```text
pnpm create moxi-plugin quick-travel   # asks: name, GitHub owner, surfaces (command, hud, hub)
pnpm dev          # moxi dev: browser harness = the real packages/hub + @moxi/sdk/sim + inspector
pnpm test         # vitest + @moxi/sdk/testing in Node, two sessions by default
pnpm check        # vue-tsc, manifest, capability check, read-or-internet, budgets, compile gate
pnpm build        # dist/plugin.moxi + dist/moxi-release.json
git tag v1.0.0 && git push --tags   # release.yml attaches both assets (optional GitHub attestation)
# then one line in gwasm-dev/moxi-registry, or tell players "Add from GitHub: mokai/moxi-quick-travel"
```

- Template: `plugin.json`, `src/plugin.ts`, `src/Hello.vue`, `src/plugin.test.ts`,
  `assets/icon.png`, `vite.config.ts`, `.gitattributes` (`* text=auto eol=lf`),
  `.github/workflows/{ci,release}.yml`, `README.md`, `LICENSE`.
- moxi CI creates, tests, builds, packs and loads the template into the fixture app on every SDK
  change (P68), because v2's example repo rotted within two days [R5 4.3].
- The harness (`moxi dev`) replaces the repo-only `pnpm hub` harness and its third palette. The
  inspector shows the host tree, the op log, facts, documents, budgets and grant switches (to
  test `not-permitted`). Vue HMR in a module worker is unproven; the fallback is fast reload
  with the view stack restored (product level, not a probe).
- In the app: Settings → Developer mode → "Load plugin folder…" (Main opens the dialog; no
  renderer-chosen path). Main watches `dist/plugin.moxi` and restarts that worker within 1 s.
  Dev installs run in the unverified host, show "Development", and see the consent page on first
  load and on every permission change. The app never relaxes its CSP.
- The CLI uses `process.execPath`, never `spawn("pnpm")` (fails on Windows [R8 2]).

---

## 12. Hub and HUD placement

### 12.1 Hub in the game renderer, behind a port

The Hub stays in the game renderer as `packages/hub`, mounted by `apps/game`. It talks to the
game only through `GameBridge` and to plugin hosts only through `HubPort`. A move is a mount
change.

| Criterion | In the game renderer (chosen) | Panel-sized `WebContentsView` | Full-window overlay view |
| --- | --- | --- | --- |
| Clicks reach the game around the Hub | yes | yes, hidden when closed | **no**: no view click-through in Electron 44 [R7 6.2] |
| Keys never reach the game | capture fence in one document, tested [R3 2.2] | focus handoff; pointer lock and held keys unknown | same |
| Hub responsive while the game thread stalls | no | yes | yes |
| Provable now without a live session | yes | partly (fixture only) | – |
| Memory | 0 extra | +1 renderer (18 MiB bare [P02]; 40 to 80 MiB with Vue is an unmeasured estimate [R7 6.3 "?"]) | same |
| Applier bug impact | inside the process with game memory | outside it | outside it |

Mitigations for the in-game Hub: two decoder passes, a fixed prop-to-attribute table, a lint ban
on `v-html` and `innerHTML` in `packages/hub` and `packages/ui`, no gwkit import in
`packages/hub`, fuzzing (P6), and Trusted Types on the game page if PB12 passes.

Move criterion: run PB17 when PB8 shows a frame or input problem, or before 2.0. Move only if
there is no pointer-lock loss and no stuck key on all three OSes and Hub key-to-paint p95 under
load improves by at least 30 %. Rejected for 1.0: D3's shared Hub view that also hosts all
workers (its central claim depends on a probe that cannot be proven without a live session, and
it allows one floating panel for all accounts).

### 12.2 What plugins add to the Hub

- Commands: views and panels, and static game ops from the manifest.
- Hub items: data, ranked by the host; no plugin code per keystroke.
- Answers: for text after a scope word, digit-led text, or with `hub.search`.
- HUD toggles: "Show Last destination".
- Plugin page from any plugin row (⌘I), with switches and Activity.
- Pins and aliases: host-owned, keyed by `(install_key, item id)`.
- `open` actions: go to another plugin's item by id (no data, no call; R4 H5).
- Attribution: every plugin row, toast, panel and HUD widget carries a host chip with the
  plugin's icon and name, so a plugin cannot pose as a host row [D2 2.2]. Inputs of an
  `internet` plugin also carry "Sent to <host>" (5.3).
- All of this exists only inside a plugin session (1.2). On the login screen and in character
  select the Hub shows host rows only.

### 12.3 The Hub chord and plugin shortcuts move to Main

Main handles `before-input-event` on every game window's `webContents`. It matches stored
bindings `{ code, ctrl, alt, shift, meta }` by physical `event.code`, swallows the key down and
its key up, and sends `hub.toggle` or `hub.command(installKey, commandId)`. AltGr (Ctrl+Alt)
never matches a Ctrl binding. The default Electron menu is removed on Windows and Linux (its
Ctrl+R Reload would reload the game) and reduced to Quit and Edit on macOS [R8 3.6].

- One `KeyBinding` type in `packages/contracts`; one label function in `packages/ui`; one
  `platform` value from the preload. The three `navigator.platform` sniffs go [R8 2].
- Main matches and swallows a key before the game sees it, so a plugin chord must never be
  something the player types. An assignable plugin chord includes Cmd (macOS) or Ctrl
  (Windows, Linux), is not Ctrl+Alt (AltGr), and is not a reserved chord (Hub chord, Alt+F4,
  Ctrl or Cmd + W, Q, A, C, V, X, Z, Y, R). Shift-only and Alt- or Option-only chords are never
  assignable: Option+letter types characters on macOS, and Shift+letter is a capital in chat
  or in the password field. Suggestions are assigned only if free and valid, at most 4 per
  install (3.6). The player can rebind within the same rules.
- Plugin chords are live only inside a plugin session (1.2): never on the login screen or in
  character select, so a plugin can neither eat password characters nor learn their timing.
  The Hub chord itself is host code and works everywhere.
- The chord per OS is Matthias's pick (D8, question 4).

Decision: chord and shortcuts in Main. Reason: it works while the game has focus or a busy
thread, avoids the menu clash and layout-dependent `event.key`. Rejected: the renderer chord
(today, `apps/game/src/hub/App.vue:4-17`).

---

## 13. Compatibility feed

Signed data per game build, fetched by Main at start and every 30 minutes (plan slice K1):

```jsonc
{ "format": 1, "build": "266b5a8aa88f…", "locator": { … },
  "capabilities": { "game.travel": { "state": "off", "reason": "Travel misbehaves after the 2026-11-04 update" } } }
```

- A killed capability turns its facts `unsupported` and its actions `refused` everywhere, with
  no app release (AGENTS "When something breaks").
- The plugin page shows "Works with this game build: 2 of 3 features", computed from locator
  support and kill switches.
- Plugin withdrawals live in the plugin index, not here: two owners, two cadences, two keys,
  one verifier (`feeds.ts`).

---

## 14. Game host contract (what plugins stand on)

These items come from R2. They are not plugin code, but every fact and action depends on them.

| Item | Decision | Proof |
| --- | --- | --- |
| Per-account partitions | each game window gets `persist:account-<id>` with its own `moxi` protocol handler closed over its own client routes; IDBFS per partition. Removes the global `client` and the single `game` variable. Fixes generation mixing [R2 8.3] | P75, PB14 |
| `locate()` | runs in a Main `worker_threads` worker once per client generation and is cached next to it. Never on a renderer main thread (2 to 4 s of CPU [R2 2.2]) | P77 |
| Safe point | gwkit tracks every function that passes through the `WebAssembly.promising` seam; the main loop is identified by its export name. Deletes the duplicated five-name list [R2 5.1] | P47 |
| Witness rule | role specs get `reads`; a `gwkit-cli` helper prints instruction index and operand kind; corpus tests assert R2's literal values on 7 builds | P50 |
| Patch scope | export-only injection (append exports, no body edits), each injected export behind a tracked promising wrapper; validated with `WebAssembly.validate`; 4 GB mode stays a separate optional patch [R2 12.5] | G8, live |
| Facts publisher | subscribed slices only, diffed, typed arrays, deadlines, map-load generation | P49 |
| CI stand-ins | `fixture-world` (generated memory structs plus a matching generated locator) and `fixture-actions` (exports that record calls with `inFlight`) | P49 to P51 |
| Live gates | the first live session (after review, with Matthias) is a read-only spike, then a one-action spike (PB18) | P48, P53 |

---

## 15. Cross-platform (Windows x64 and Linux x64 prepared, not released)

| Topic | Consequence | Design response |
| --- | --- | --- |
| Worker isolation | same Chromium on all three; CSP and opaque origins are platform-neutral | the egress matrix (P1) runs on all three OSes |
| Linux sandbox | Ubuntu 23.10+ restricts unprivileged user namespaces through AppArmor. electron-builder 26.15.3's `AppRun` script (legacy and static runtime alike) appends `--no-sandbox` whenever `unshare -Ur true` fails, which it does there; `executableArgs` only changes the `.desktop` Exec line [code `app-builder-lib/out/targets/appimage/{AppImageTarget,appImageUtil}.js`]. The `.deb` post-install sets `chrome-sandbox` to 0755 when root can `unshare --user` and installs an AppArmor profile that grants `userns` to `/opt/<product>/<executable>` [code `templates/linux/after-install.tpl`, `apparmor-profile.tpl`] | `.deb` is the sandboxed Linux candidate; its sandbox depends on that AppArmor profile being loaded for that exact path. A directly launched AppImage on Ubuntu 23.10+ runs with `--no-sandbox` unless the user installs a profile, whatever `executableArgs` says. Main refuses non-official plugins when `app.commandLine.hasSwitch("no-sandbox")`, or on Linux when `/proc/<pid>/status` of a plugin host lacks `Seccomp: 2`, or on macOS and Windows when `ProcessMetric.sandboxed` is false (that field is darwin and win32 only, `electron.d.ts:11487-11491`); the page says why (P5, P73, PB10) |
| Browser-side network enforcement | CSP runs inside the renderer and does not survive a renderer exploit; Electron also disables the network-service sandbox on Windows, which confines that process's OS access but does not decide which URLs a renderer may load [R7 9.4] | on all three OSes: CSP + in-memory partition + `webRequest` cancel of every non-host URL (browser process) + permission handlers that deny all (P1, P2) |
| WebRTC | not governed by `connect-src`; `webRequest` does not see WebRTC transports; `setWebRTCIPHandlingPolicy("disable_non_proxied_udp")` only forces TCP, so TURN over TCP still reaches any host | no WebRTC control is claimed. PB3 checks whether `RTCPeerConnection` exists in workers (it was Window-only in 2023); if it does, the runtime prelude deletes it before plugin code runs, and P1 tries TURN over TCP. The post-exploit residual is listed (1.3) |
| Hidden windows | frame and timer behaviour of a hidden renderer differs per OS | no rAF batching; PB7 on all three OSes |
| Keys | `mod` = Cmd on macOS, Ctrl elsewhere; Ctrl+R clashes with the default menu; AltGr = Ctrl+Alt | section 12.3 |
| Paths | case-sensitive Linux; Windows reserved names, `\`, long paths | packages are content-addressed hex names; no extraction; dev folders keyed by a hash of the normalized path |
| Git | no system `git` on Windows or in AppImage | HTTPS downloads of release assets only |
| Data roots | 4 GB cache in Roaming on Windows today [R8 3.2] | `%LOCALAPPDATA%\Moxi` and XDG data and cache (R8 D-2); plugin packages under the data root |
| Fractional scaling | canvas blur risk at 125 and 150 % | the host scales draw lists by `devicePixelRatio`; plugins use CSS pixels |
| Template on Windows | CRLF, `pnpm` spawning | template `.gitattributes`; CLI uses `process.execPath` |
| Credentials | sync `safeStorage` API is removed in Electron 46 [R7 9.1] | make the credential interface async now; Linux `basic_text` hides "Remember login" |
| GPU-less CI | the client needs WebGL; Chromium needs an explicit SwiftShader opt-in | CI-only switch, never in product paths; host drawings need no WebGL |
| CI cost (private Free plan) | Windows 2×, macOS 10× minutes | PR: Linux only. Nightly and tags: Windows and macOS. Real-client boot: nightly, non-gating |
| Linux e2e sandbox | Playwright adds `--no-sandbox` on Linux unless `chromiumSandbox: true` [R8 3.10] | e2e sets `chromiumSandbox: true` and the runner runs `sysctl kernel.apparmor_restrict_unprivileged_userns=0`, so CI tests the real sandbox |

Nothing in the plugin API names an OS. `platforms` in a manifest only filters the directory.

---

## 16. Security model summary

| Threat | Controls | Residual |
| --- | --- | --- |
| Hostile plugin author (code in a worker) | worker isolation; read-or-internet per install and per process (class split); host-rendered actions with host text; whisper body and target from the player; per-install data keys; attribution chips; budgets; no eval or WASM | covert timing channel between colluding installs of different authors |
| Phishing inside a plugin (fake login form in an `internet` plugin) | no plugin session before the character is in the world; no masked input; "Sent to <host>" chip on every input of an internet plugin; page text; login-words check at build and registry; attribution chips | a convincing form with unusual words, inside the game, still possible; the chip and page warn |
| Hijacked author account ships an update | escalation hold (new `net:` or `link:` host); read-or-internet; class split (a `net:` plugin has no facts in its process); withdrawal by id, hash or owner; GitHub repos ask before updating | a same-permission update can misbehave inside its own grants until withdrawn |
| Distribution tampering (asset swap, tag move, repo transfer or re-registration, rollback, freeze) | SHA-256 pins; signed index with `seq` and `expires`; numeric owner and repo ids, checked by id on every real update; package manifest is the authority; registry CI builds author code without credentials | a compromised signing key until rotation (two keys, Matthias-gated environment) |
| Renderer exploit in a plugin host | renderer sandbox required; tier and class split; host binding of install keys (I7); Main checks every request; actions need trusted presses in the game renderer; no disk, sockets or credentials in the host | grants of the installs in that one host; in a `local` host, its facts can leave through WebRTC (1.3) |
| Malicious image in a package | Main's data worker decodes PNG only, with size caps before inflate, in JavaScript, and re-encodes; no renderer decodes plugin bytes | a bug in `node:zlib` inflate (hardened, bounded output) |
| Bug in the op applier (game renderer) | registry indices, fixed prop table, two decoder passes, fuzzing, lint bans, no gwkit import in `packages/hub`, Trusted Types if PB12 passes | logic bugs and label spoofing inside the Hub (attribution chips reduce it) |
| Buggy or greedy plugin (loops, floods, huge UI, out of memory, CPU burn, Main floods) | watchdog, membrane-enforced backpressure, byte rates, retained-size budget, budgets that truncate, CPU watch, Main channel budgets and the data worker, crash policy, host restart, safe mode, `--no-plugins` | one host's plugins restart together after a renderer-wide out-of-memory; a burner costs up to 10 s of CPU before it is found |

Invariants (each has proofs):
- **I1** Plugin code runs only in sandboxed plugin hosts (P5).
- **I2** No game action without a trusted press on a host-rendered control that shows host text (P40, P41).
- **I3** No install holds a personal read and an outbound host (`net:` or `link:`), and no
  `internet` host receives a game fact, `hub.search` text or an action outcome (P34, P7).
- **I4** Executed code = hashed bytes: no remote code, `eval`, `new Function`, `import()` of built strings, WebAssembly (P3).
- **I5** Every capability fails closed on its own; the plain game always stays playable (P16, P17, P36).
- **I6** Plugin data never lives in browser storage and is keyed by install (P4, P58, P62).
- **I7** The game renderer and Main accept an install key only from the plugin host that owns it (P7).
- **I8** No plugin surface, text route or shortcut exists outside a plugin session (character in the world) (P74).
- **I9** No launcher or game renderer decodes image bytes from a package (P59).

---

## 17. What changes in the current code

### 17.1 Keep

| Item | Where | Reason |
| --- | --- | --- |
| Opaque `data:` module workers, own partition, permission denial | `apps/plugin-host/src/index.ts:44-55`, `apps/desktop/src/shell/main.ts:277-303` | proven [R1 4.1] |
| Isolation e2e | `e2e/plugin-isolation.e2e.ts` | extend it to the full matrix (P1) |
| Manifest-first parsing | `packages/sdk/src/manifest.ts` | rewrite on the catalog, keep the idea |
| `Observed<T>`, `ActionResult`, reasons | `packages/sdk/src/game.ts:7-56` | honest and additive |
| Revisioned documents in SQLite | `apps/desktop/src/storage/documents.ts` | add install key, write result, quota, list and delete |
| Hub key model and its tests | `apps/game/src/hub/Hub.vue`, `hub.contract.test.ts` | move to `packages/hub`; rerun over real worker output (P25) |
| Watchdog values, crash policy numbers | `apps/plugin-host/src/plugin-host.ts:149-163, 297-302` | move into the membrane; persist crashes in Main |
| Main-brokered port per game window | `apps/desktop/src/shell/main.ts:141-156` | now per (game window, plugin host) |
| Tokens, appearance, contrast helpers | `packages/ui/src/{tokens.css,appearance.ts,color.ts}` | the theme base |
| gwkit parse, match, locate, runtime | `packages/gwkit/src/*` | proven on 7 builds [R2 1] |

### 17.2 Change

| Item | Where | Change |
| --- | --- | --- |
| Plugin CSP | `apps/desktop/src/plugin-isolation.ts:1-2` | drop `'wasm-unsafe-eval'`; keep `connect-src 'none'`, `worker-src data:` |
| Plugin session | `apps/desktop/src/shell/main.ts:130, 277-303` | in-memory partition per host (today `persist:plugins`); `webRequest` cancels every URL except `moxi://app/plugin-host/*` |
| Plugin-host window | `apps/desktop/src/shell/main.ts:122-140, 429` | created with the first game window; one per (tier, class) with an enabled install; `render-process-gone` restart; sandbox refusal; CPU watch |
| Plugin sessions | `apps/plugin-host/src/index.ts`, `apps/game` | open when gwkit reports the character in the world, close at character select, logout or window close; until gwkit can tell, no plugin session (fixture-world provides it in CI) |
| Game windows | `apps/desktop/src/shell/main.ts:69, 91, 121, 237` | per-account partition and protocol handler; no global `client`, no single `game` variable |
| Hub chord | `apps/game/src/hub/App.vue:4-17` | Main `before-input-event` (new `apps/desktop/src/shell/input.ts`); default menu removed on Windows and Linux |
| Facts | `apps/game/src/hub/main.ts:31-35` (one-shot `unsupported`) | `apps/game/src/facts.ts` publisher |
| Game actions | `apps/game/src/hub/client.ts:27-36` | `apps/game/src/actions.ts` executor after Main authorize |
| Manifest | `packages/sdk/src/manifest.ts:82-210` | `permissions` and `optional` as `{ id: reason }`; tolerant top level; `hub`, `hud`, `commands[].game`, `accent`; no `activation` |
| Documents channel | `apps/desktop/src/plugin-documents.ts`, `packages/contracts/src/documents.ts` | key = install key; write result; quota and rate; list and delete; moved into the Main plugin data worker with its own `plugin-data.sqlite` (today `DatabaseSync` on Main's thread, `storage/database.ts:3`, `shell/main.ts:314-315`) |
| Contracts | `packages/contracts/src/{index.ts,windows.ts}` | channels of 9.1; the plugin-host kind has no grant or install channel |
| Packaging | `electron-builder.config.ts:66-72` | Linux `deb` + AppImage (no `executableArgs` override: it changes only the desktop entry, and `AppRun` adds `--no-sandbox` on its own); delete dead `allowElevation`; one owner for `appId` |
| CI | `.github/workflows/ci.yml`, `build.yml` | Playwright Chromium in `check`; xvfb `1920x1080x24`; `chromiumSandbox: true` + sysctl; no background mode on Linux; `build.yml` with a Linux PR trigger and fuse read-back; new `nightly.yml` (Windows and macOS e2e, real-client boot) and `probes.yml` |
| Credentials interface | `apps/desktop/src/storage/credentials.ts:14-16` | async now (Electron 46) |
| Safe point | `packages/gwkit/src/runtime/index.ts:1-7` | track every promising export |
| Docs | `docs/ARCHITECTURE.md`, `packages/sdk/README.md` | updated in the same changes (AGENTS) |

### 17.3 Delete

| Item | Where | Replaced by |
| --- | --- | --- |
| Per-window `PluginHost` and its state | `apps/plugin-host/src/index.ts:5-82`, `plugin-host.ts` (629 lines) | `apps/plugin-host/src/membrane.ts` (about 350 lines) with sessions |
| Permission and token checks in the plugin host | `plugin-host.ts:333-395, 344, 368` | Main authority and receivers |
| Plugin-held activation tokens, imperative actions | `packages/sdk/src/runtime.ts:33-39, 161-164`, `game.ts` `loadBuild`/`travel`, `protocol.ts:65-95` | `act()` descriptors and `GameAction` |
| Node factories and whole-tree serialization | `packages/sdk/src/{nodes.ts,surfaces.ts}` | Vue renderer ops |
| Whole-state snapshots | `plugin-host.ts:166-181`, `apps/game/src/hub/client.ts:22` | per-root ops |
| ArkType copy of worker messages | `apps/plugin-host/src/worker-messages.ts` (170 lines) | registry-driven decoder in `@moxi/sdk/host` |
| `plugin.bundles` channel | `apps/desktop/src/plugin-bundles.ts` | registry + `plugin.code(installKey)` |
| Runtime inside each bundle | `scripts/build-plugins.ts:21-25` | host runtime + `@moxi/sdk/vite` |
| `__moxiPluginSetup`, `bytes`, `activation` | `packages/sdk/src/index.ts:5-7, 51-54` | – |
| Dev harness and its third palette | `apps/game/src/hub/dev/*`, `apps/plugin-host/src/dev/main.ts`, `pnpm hub` | `moxi dev` on `packages/hub` + `@moxi/sdk/sim` |
| `Blocks.vue`, `Icon.vue` | `apps/game/src/hub/` | `packages/ui` elements |
| rAF batching in a hidden window | `plugin-host.ts:54-56` | microtask batching |
| Hub key fences duplicated for the chord | `apps/game/src/hub/App.vue` | Main input (the in-Hub fence stays) |

### 17.4 Rewrite

`plugins/builds`, `plugins/calculator`, `plugins/target-distance` as Vue SFC plugins built by
`@moxi/sdk/vite` and installed as official packages. Builds becomes the Build Library acceptance
test (P26).

Size estimate [est]: about 7,300 lines added (host element components about 2,500, Main plugin
services about 1,800 with the data worker and the PNG decoder and encoder, SDK runtime, host,
Vite plugin, test kit and sim about 2,000, membrane 350, launcher pages 700) and about 2,500
deleted. The platform-core budget (0.4) holds it.

---

## 18. Migration order

Each step ends with its proofs green and reviewed by Opus. Gates pass 20 runs, also under CPU
load. Step 12 runs in parallel from step 2. No live game session before step 11 ends.

| Step | Content | Proofs (PROOFS.md) |
| --- | --- | --- |
| 0 | CI green on Linux: Playwright Chromium in `check`, xvfb screen, no background mode on Linux, `chromiumSandbox: true` + sysctl, artifacts on failure | existing suites 20×; Linux part of P72 |
| 1 | Probes PB1 to PB7 and PB9 to PB15 (CI or hidden local windows); PB8 with a probe-local applier; PB16 after step 3. Record numbers in the plan file; change budgets only where a decision rule says so | P11 (from PB1); PROBES.md |
| 2 | `@moxi/sdk/host`: catalog, element registry, budgets, op decoder, manifest v1, package format, page model, `decideUpdate` (Node only) | P32, P33 (model), P34, P39 (table), P61 (parse), P62 |
| 3 | SDK runtime: Vue renderer with signs, factory sessions, `ITEMS` patches, backpressure, test kit, sim, Vite plugin (gate, capability check, types, pack) | P9 (Node half), P10 (Node), P12, P13, P14 (kit), P15, P19, P21, P22, P69 |
| 4 | `packages/hub` + `packages/ui` elements: Hub shell moved, applier, HUD layer, toasts, panels, attribution, `RequestAccess`, `GameAction` UI | P6, P23, P24, P25, P27, P28, P31, P38, P41, P42, P45 |
| 5 | Main plugin services I: registry, package store, plugin data worker with documents by install key, grants and effective grants, plugin hosts per (tier, class) with host binding, restart, CPU watch and safe mode, Main channel budgets, partition hardening, sandbox refusal, authority, activity | P2, P5, P7, P8, P16, P17, P18, P35, P36, P43, P58, P77 (flood half) |
| 6 | Game side on the fixture: game state from fixture-world and plugin sessions, fact publisher (fixture-world), executor (fixture-actions), full action path with the whisper rules, Main chord and shortcuts, menu | P1, P3, P4, P37, P40, P44, P45, P46, P47, P49, P51, P52, P74 |
| 7 | Rebuild Builds (Build Library acceptance), Calculator, Target Distance as SFC plugins; delete the old SDK | P26, P14 (e2e), P29 and P30 (Measures), P78 and P79 (review) |
| 8 | Launcher Plugins section and distribution: fixture registry over loopback, signed index, GitHub TOFU with the id check per real update, updates, withdrawal, dev folder; registry workflows with the untrusted build job split off | P60, P61, P63, P64, P65, P66, P67, P70 |
| 9 | Net proxy and feeds; package images (PNG decode and re-encode in the data worker) and `Gw.dat` icons; Trade Prices skeleton | P54, P55, P56, P57, P59 |
| 10 | Author toolchain: `create-moxi-plugin`, `moxi` CLI, template CI, harness | P68, P79 (review) |
| 11 | Three-OS CI: build matrix (NSIS, deb + AppImage, dmg), Windows and macOS nightly fixture e2e, packaged Linux sandbox, real-client boot nightly | P71, P72, P73, P76, P20 |
| 12 | Game host (parallel): per-account partitions, `locate()` off-thread, safe point over all promising exports, `reads` corpus tests | P47, P50, P75, P77 |
| then | Review. Then the live session with Matthias: PB18 (reads, one action), HUD z-order check, Hub feel | P48, P53 |

---

## 19. Decision log

| # | Decision | Reason (one line) | Rejected alternative |
| --- | --- | --- | --- |
| 1 | Plugin code in `data:` module Workers in hidden sandboxed renderers | proven isolation at 2.5 MiB per worker | iframes (focus, keys and accessibility per frame, theme injection, no WebRTC control; memory unmeasured), `utilityProcess` (no sandbox), workers in the game renderer, ShadowRealm/SES (no CPU limit), QuickJS (about 10× slower, a second engine) |
| 2 | One worker per install, module factory per session | memory scales with plugins; module-level state is per session (globals stay shared and documented) | worker per (plugin, window) (today); one shared module scope [D1, D3]; frozen intrinsics |
| 3 | Shared state lives in Main | one owner per fact | module-level sharing in the worker |
| 4 | Plugin hosts by trust tier and class (`local`, `internet`) | an exploit or out-of-memory in unverified code never reaches reviewed plugins; no process holds both personal facts and a way out (Spectre-class reads) | one host for all; tier split only; a renderer per unverified install [D2] |
| 5 | Plugin hosts exist only while a game window exists | no plugin runs without a game in 1.0 | start at app launch (today) |
| 6 | No plugin code or ops in the launcher in 1.0 | the launcher takes credentials and consent | launcher plugin session [D1, D4] |
| 7 | Vue SFCs over a host-supplied `runtime-core` custom renderer | real Vue for authors; host keeps theme, keys and accessibility | node factories; Remote DOM with stock Vue (+13.5 KiB gz polyfill per worker); iframe tier |
| 8 | Host supplies the runtime | private wire; fixes reach every plugin | runtime inside each bundle (frozen wire) |
| 9 | Collections are data props with keyed patches | 1 node per list; trivial virtualization; Hub ranks rows | child components per row [D4] |
| 10 | One element registry generates components, types, decoder, kit, docs | one owner per element | parallel hand-written definitions (today) |
| 11 | One registry-driven decoder in membrane, applier and kit | the valuable process does not trust the plugin host | per-message ArkType (today); validation in the plugin host only |
| 12 | Names travel as registry indices | a plugin cannot name what the host lacks | names on the wire |
| 13 | One batch in flight per root, enforced by the membrane; byte rate per install toward a game renderer; 256 KiB batches | a flood waits instead of crashing; a message never costs the game frame more than about 1 ms to deserialize | a rate cap that crashes (today); enforcement by the runtime alone (plugin code shares its realm) |
| 14 | Budgets are shared constants that truncate | Builds dies at 181 today; the kit must see the same limits | crashing limits |
| 15 | Microtask batching in hidden hosts | hidden-window frame timing differs per OS | rAF batching (today) |
| 16 | Theme by tokens, accent, images, Gw.dat icons, draw lists, theme packages | freedom without breaking looks, contrast or the HUD | plugin CSS; iframe panels with injected tokens |
| 17 | Declarative draw lists (`Canvas`, `Chart`, `MapView`) | data crosses processes; host-owned pixels; native drawing stays possible | OffscreenCanvas (plugin-owned pixels, GPU time unbounded; cross-process transfer unverified); WebGL |
| 18 | About 45 elements, grown by real need | enough for parity; one maintainer can keep it accessible | about 70 elements [D4]; 7 node types (today) |
| 19 | HUD anchored by name, placed by the player, no HUD events | plugins never see pixels or the camera | pixel positions; HUD click handlers |
| 20 | One capability catalog | adding a fact touches 3 files, not 6–10 | capability code in five places (v2) |
| 21 | Requested is not granted; Main grant store | consent must be real and revocable | manifest = grant (today) |
| 22 | Read or internet, never both; `link:` counts as internet; internet installs get no action outcomes; whisper body and target from the player | rule 3 in code; parity needs no exception (Elite uses host-built wiki links) | disclosure line only [D1, D4]; no network in 1.0; `link:` exempt with reads (the earlier text) |
| 23 | No same-owner collusion check | a second account bypasses it; it blocks legitimate pairs | D2's check |
| 24 | Optional permissions through a host `RequestAccess` element | no API can ask from code | `requestPermission()` with gesture ids [D1] |
| 25 | Approvals only from launcher or game `webContents` | no process that runs plugin code can grant | approvals anywhere [D1]; launcher only [D3] |
| 26 | Host-rendered `GameAction`, trusted press, host label, 500 ms guard | closes the confused deputy | plugin-held 3 s tokens (today) |
| 27 | Main authorizes every action | one choke point for grants, kill switches, QA allowlist, rate, log | executor decides alone [D1]; tickets + input witness [D4] |
| 28 | Static `game` op and args in manifest commands | no plugin code runs on a shortcut action | callback returning op and args [D3]; args within 500 ms [D1] |
| 29 | Drops never start game actions | the host must show the effect first | `ItemGrid` `drop-op` [D4] |
| 30 | `game.note` without a press, rate-limited | reminders need it; it changes nothing in the world | treat it as a game action (kills reminders) |
| 31 | Network through a Main proxy; `useFetch` polled by Main | exact hosts, pinned DNS, one request for all windows | CSP holes per worker; sockets per window |
| 32 | `link:<host>` separate from `net:`, but outbound for read-or-internet; host-built `{ wiki }` links for reads plugins | a link is not network access for the plugin, but a plugin-built URL can carry encoded facts | links on `net:` grants [D3]; links exempt with reads |
| 33 | Documents keyed by install key (source/id) | a GitHub plugin can never read official data | keyed by bare plugin id (today) |
| 34 | Four sources: official, community, GitHub repo, dev folder | Obsidian's model with pins | Obsidian list without pins; v2's empty pinned catalog |
| 35 | One signed index with `seq`, `expires`, withdrawals; Matthias-gated key; weekly batched publish with a generated diff, withdrawals at once | tamper, rollback and freeze defense; approvals stay readable | author-held keys; an unsigned list; a nightly approval habit |
| 36 | Package = one JSON file, content-addressed, never extracted | no archive attack class, no unzip dependency | zip [D1, R6] |
| 37 | Registry auto-ingests non-escalating versions; author code builds in a job with no token | read-or-internet plus the class split make a hijacked same-permission update unable to exfiltrate; a build cannot rewrite the registry | human review of every version [D2]; first-version-only review; building in the committing job |
| 38 | GitHub checks through `moxi-release.json`; one id check by API per real update | 0 API calls per check, no system git; a re-registered name cannot take over an install | API polling; system git; name-only checks (repo-jacking) |
| 39 | Bundled official plugins install through the same path | one code path for every plugin | special bundled path (today) |
| 40 | Hub in the game renderer, `packages/hub` behind `HubPort` | provable now; a move stays a mount change | panel view now [D3]; full-window overlay view |
| 41 | Hub chord and plugin shortcuts in Main by physical key; plugin chords need Cmd or Ctrl, at most 4 per install, only inside a plugin session | works while the game has focus; no Ctrl+R reload; typing never fires a plugin | renderer chord with platform sniffing (today); Shift-only and Alt-only plugin chords |
| 42 | Kill switches in the compat feed; withdrawals in the plugin index | two owners, two cadences | one feed for both |
| 43 | Linux: sandbox required for non-official plugins; `.deb` (AppArmor `userns` profile) is the sandboxed candidate; AppImage on Ubuntu 23.10+ runs unsandboxed and refuses non-official plugins | isolation is void without the sandbox; `AppRun` adds `--no-sandbox` whatever `executableArgs` says | `executableArgs: []` as a security measure (it only changes the desktop entry) |
| 44 | No `'wasm-unsafe-eval'`, no eval, no WASM in plugins | executed code = hashed bytes; no parity need | allowing WASM |
| 45 | Membrane between workers and the game renderer | sizes and rates are checked before the WASM thread deserializes | direct worker-to-game ports [D2] |
| 46 | Gates are deterministic; timing is a Measure | no flaky tests | timing thresholds as required e2e gates [D2, D3, D4] |
| 47 | Per-account partitions with own protocol handler | fixes generation mixing; separate IDBFS | shared default session and global routes (today) |
| 48 | `locate()` in a Main worker thread, cached per generation | no 2–4 s freeze | renderer main thread |
| 49 | Official plugins stay in the moxi repo until SDK publication | one pull request per SDK change | separate repo now |
| 50 | Test kit runs the real runtime, decoder and budgets, two sessions by default | a green kit means a working plugin | a kit with its own logic (today) |
| 51 | A plugin session is a character session | no plugin surface, text route or shortcut next to the official login screen | sessions per game window from the first frame |
| 52 | Host binding: an install key is accepted only from its own host | the tier and class splits mean nothing if a host can stamp another host's install | per-install ports [D2] (no gain inside one renderer) |
| 53 | Main samples CPU per plugin host and finds the burner by stopping workers one at a time | a worker that yields still burns cores; per-worker CPU cannot be read | no CPU budget (the earlier text); a renderer per plugin [D2] |
| 54 | Plugin documents, reference data and image decoding in one Main data worker | Main's UI thread dispatches every key and carries game traffic | rate limits alone on Main's thread |
| 55 | Package images: PNG only, decoded and re-encoded by Main in JavaScript; no renderer decodes plugin bytes | decoder bugs and decompression bombs stay out of the processes with secrets | decode in the plugin host and send RGBA; WebP |
| 56 | No ETags, no persisted HTTP state for plugins | a server cannot plant a cookie-like id | ETag revalidation across runs |
| 57 | No masked input; "Sent to <host>" chip on inputs of internet plugins; login-words check at build and registry | phishing is the main real harm for GW1 accounts | plugin inputs without attribution |
| 58 | Memory gates as deltas on one OS with one metric per OS | `privateBytes` exists on Windows only; metrics differ per OS | absolute gates from mixed metrics |
| 59 | Per-frame host cost measured with `performance.now()` around applier work, the rAF histogram and `contentTracing` | Long Animation Frames only report frames over 50 ms | LoAF attribution for sub-millisecond work |

---

## 20. Decisions for Matthias

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | Read or internet as a rule for every tier, and any exception | yes, no exceptions in 1.0; a future host `<Send>` control that shows the payload is the exception path |
| 2 | Player-added GitHub repos | behind one switch, off by default, "Not reviewed" badge, updates ask |
| 3 | Official bundled plugins pre-granted on first run | yes; the page shows everything and every switch works |
| 4 | Hub chord on Windows and Linux (D8) | your pick; not Ctrl+R; matched by physical key in Main |
| 5 | Plugin commands in the launcher palette | not in 1.0; add later as an additive session kind if wanted |
| 6 | Linux package | build `.deb` and AppImage in CI; `.deb` is the sandboxed candidate on Ubuntu 24.04 (AppArmor profile); AppImage there runs unsandboxed with plugins from other sources off; decide the released one after PB10 |
| 7 | `game.inventory` (bags, storage, gold) in api 1 | yes if live calculators and Xunlai Storage are parity |
| 8 | Registry auto-ingests same-permission community versions | yes, now that `net:` plugins run in a host without facts; signed index published weekly with a generated diff, withdrawals at once |
| 9 | Public `gwasm-dev/moxi-registry`, signing key behind your approval, `@moxi/sdk` on npm | when P68 and P69 pass; each publication needs your OK |
| 10 | Nightly real-client boot from GitHub runners (downloads from ArenaNet, no login, no ArenaNet files in GitHub caches) | yes, non-gating |
| 11 | Accept the residual: a renderer exploit in a `local` plugin host can send that host's facts out through WebRTC (no browser-side control in Electron) | yes for 1.0: it needs a V8 or Blink exploit, the host holds only the facts its installs were granted, and the tier split keeps unverified code apart; revisit if Electron gains a session-level WebRTC switch |
| 12 | Whisper and invite rules: body always typed by you; target typed by you or a friend or whisper partner | yes; a plugin cannot pre-fill a whisper |

---

## Review outcome

Date: 2026-10-14. 26 review issues against DESIGN, PROOFS and PROBES. I checked each against
its evidence: the installed electron-builder 26.15.3 templates, Electron 44.5.1 typings,
`@vue/compiler-sfc` 3.5.43 output (`v-show` and `.stop` compile to `vShow` and `withModifiers`
imports from "vue"; neither exists in `runtime-core`), moxi source at 848fb6e, R7 lines, and a
live `curl -sI` of a GitHub release asset (302 to `release-assets.githubusercontent.com`).
All 26 hold in substance. Where I applied a different fix, or left out part of a fix, the row
says why.

| # | Issue | Outcome | What changed, or why not |
| --- | --- | --- | --- |
| 1 | AppImage `executableArgs: []` does not avoid `--no-sandbox` (major) | accepted | `AppRun` adds `--no-sandbox` when `unshare -Ur` fails, legacy and static runtime alike; `executableArgs` only edits the desktop entry. D 15, 17.2, decisions 43 and 20.6 restated; `executableArgs` dropped. P73 passes for the AppImage when the refusal row works; PB10 outcomes rewritten; `.deb` is the sandboxed candidate |
| 2 | `.deb` sandbox mechanism is not setuid (minor) | accepted | D 15 states the AppArmor `userns` profile for `/opt/<product>/<executable>`; PB10 records `aa-status` and runs with the profile removed; P73 covers that case |
| 3 | `disable_non_proxied_udp` is not a WebRTC block (major) | accepted | The IP-handling policy is no longer presented as a control (D 15, PB3 config C). P1 and PB3 add TURN over TCP with data-carrying credentials and count TCP bytes; if `RTCPeerConnection` exists in workers, the prelude deletes it and any hit blocks. I found no browser-side way to disable WebRTC for one partition in Electron, so D 1.3 and 16 list the post-exploit residual, PB3 records page-context attempts, and question 11 asks Matthias to accept it |
| 4 | Long Animation Frames cannot measure sub-millisecond host time (major) | accepted | PB8 and P29 measure per-frame host time with `performance.now()` around receipt, applier and HUD apply, the rAF histogram and `contentTracing`; LoAF only counts frames over 50 ms. Decision 59 |
| 5 | `privateBytes` is Windows-only; gates mix metrics (major) | accepted | One metric per OS (macOS `footprint`, Linux `Private_Clean + Private_Dirty`, Windows `privateBytes`); gates are same-OS deltas: w ≤ 6, s ≤ 1, host ≤ 102 MiB above an empty host (the old 120 MiB on macOS). D 0.4, PROBES common rules, PB1, P11, decision 58 |
| 6 | QuickJS has CPU and memory limits (minor) | accepted | D 3.1 and decision 1 reject QuickJS for speed and a second engine; only ShadowRealm and SES lack a CPU limit |
| 7 | iframe "7–34×" and the 40–80 MiB view figure are not measurements (minor) | accepted | Ratio dropped; the iframe rejection rests on focus, keys, accessibility, theme injection and WebRTC; D 12.1 labels 40–80 MiB as an unmeasured estimate |
| 8 | OffscreenCanvas same-renderer constraint is unverified (minor) | accepted | D 5.5 and decision 17 mark it unverified and rest the rejection on host-owned pixels, native drawing later and unbounded GPU time |
| 9 | The compile gate's stated reason is wrong (minor) | accepted | D 4.3 states the real failure (runtime-dom helper imports, undefined at mount); a new externals-rewrite row fails the build on names the host runtime lacks; P21 uses compiler-sfc output and adds that case |
| 10 | Windows network-sandbox reason is wrong (minor) | accepted | D 15 and P2 now say "browser-side enforcement that survives a renderer exploit"; P2 runs on all three OSes |
| 11 | GitHub assets now redirect to `release-assets.githubusercontent.com` (minor) | accepted | D 11.5 names it, builds the allowlist only from PB15 results and fails closed with a clear error on a new host; PB15 records it |
| 12 | PB4 bootstrap fails on CORS before size (minor) | accepted | PB4 runs the bootstrap with and without `corsEnabled` plus `Access-Control-Allow-Origin` from the plugin partition's handler only, and records CORS and size refusals apart |
| 13 | Per-partition handlers for `moxi` are already proven (minor) | accepted | PB14 and P75 narrowed to two simultaneous game partitions, JSPI, IDBFS and memory; P75 is now product-level and "partly"; the URL-token fallback is a last resort; PROOFS summary recounted (21 AD, 0/16/63) |
| 14 | "Cannot leak" is too strong in one realm (minor) | accepted, in part | D 3.2 and 4.1 say module-level state is per session and globals are shared; PB6 and P10 add `globalThis` and prototype cases. Not done: freezing intrinsics. It breaks polyfilling libraries and protects only the same player's data across that player's own windows |
| 15 | No per-process `--disable-renderer-backgrounding` (minor) | accepted | PB7 relies on per-`webContents` `setBackgroundThrottling(false)` and Main-driven pings; the switch is described as app-wide, with its effect on launcher and game windows |
| 16 | Spectre-class reads inside the shared plugin host defeat read-or-internet (major) | accepted | Hosts are now per (tier, class). `internet` = the manifest has a `net:` or `link:` host; that host gets no facts, no `hub.search` text and no action outcomes. D 0.2, 0.3, 1.1, 1.3, 1.4, 6.3, 6.6, 8.1, I3, decision 4; P7 taps the internet host's port for 0 fact bytes. Auto-ingest (decision 37) now rests on this split. Cost: about 18 MiB per extra host, only while such an install is on |
| 17 | Side doors: `link:` with reads, pre-filled whispers, action status to `net:` plugins (major) | accepted, one part stronger | `link:` counts as outbound; reads plugins get host-built `{ wiki }` links (Elite parity). Whisper body is always player-typed in a host input the plugin cannot pre-fill; whisper and invite targets are player-typed or a friend or whisper partner from this session's `game.social` (keeps a Whispers window possible); this applies to every install. Internet-class installs get **no** action outcome at all, not a generic "not sent": `done` alone already reveals where a travel went. D 4.2, 6.2, 6.3, 7.1; P34, P45 |
| 18 | Phishing forms, ETag tracking, passive data (major) | accepted, in part | "Sent to <host>" chip on every input of an internet plugin; no masked input; page says "can send what you type, your IP address and when you play"; literal login words refused at build and registry (install sees only compiled code, so not there); ETags never sent and no plugin HTTP state survives a run (simpler than not persisting them); no plugin surface before the character is in the world. Rejected: separating poll timing from session start. Plugins run only during play, so any request reveals play time; a few seconds of jitter hides nothing, so the page states it instead |
| 19 | Plugin shortcuts eat typed characters and leak keystroke timing (major) | accepted, in part | Plugin chords need Cmd or Ctrl, never Ctrl+Alt, Shift-only or Alt/Option-only; common editing chords reserved; at most 4 per install; plugin sessions start only when the character is in the world (D 1.2, 12.3, I8); P74 and PB9 rows added. Not done: suspending chords while the game's chat input has focus. gwkit has no such reader, the modifier rule already keeps typed text from matching, and a bound Cmd or Ctrl chord pressed while chatting is the player's own command |
| 20 | Backpressure only in the runtime; deserialization cost; no retained budget (major) | accepted, plus one change | The membrane enforces 1 unacked batch per root (a second is a crash); byte rate per install toward a game renderer (1 MiB/s, HUD 256 KiB/s) that delays instead of crashing; retained budget 8 MiB per install and session, 8 KiB per row; `default: true` HUD only for official installs. Also: batches and first-load chunks drop from 2 MiB to 256 KiB of objects (typed arrays keep 4 MiB), so one message costs the game thread about 1 ms. P14, P15, P16 |
| 21 | Plugin requests run synchronous SQLite on Main's UI thread (major) | accepted | Per-install budgets on every Main channel (documents ≤ 10 writes/s and 1 MiB/s, coalesced by the membrane; reference ≤ 20/s); documents, reference data and images move to one Main plugin data worker with its own `plugin-data.sqlite`. P77 adds a flood Measure (p99 ≤ 10 ms). Decision 54 |
| 22 | No CPU budget (major) | accepted | Main samples each host's CPU every 2 s; above 50 % of one core for 10 s the membrane stops workers one at a time, busiest first by untrusted busy-time hints, until CPU drops; reason `cpu`; Activity shows it. P16 `yielding-burner`, PB2 variant C. Decision 53 |
| 23 | Untrusted image bytes decoded in the launcher and the game renderer (major) | accepted, different mechanism | Main's data worker decodes PNG only (IHDR caps before inflate, `node:zlib` with bounded output, unfilter in JavaScript) and writes a canonical PNG; launcher and game render only those; WebP dropped; 512×512 per image, 4 megapixels per package. Not taken: decoding in the plugin host, because no plugin host exists while the launcher shows a page before install, and it adds a raw-pixel channel from an untrusted process; hiding icons of untrusted owners, because no renderer decodes plugin bytes any more. P59, P61, I9, decision 55 |
| 24 | Repo-jacking check cannot fire on name-only checks (major) | accepted | On every real update, `GET api.github.com/repositories/{repoId}`; refuse if gone or `owner.id` differs; download from the current `full_name`. D 6.9, 11.5, decision 38; P63 adds re-registered login and recreated repo |
| 25 | Registry CI runs author code next to a write token; nightly approvals (major) | accepted | Untrusted builds run in a job with `permissions: {}`, no secrets, no cache writes, `--ignore-scripts`; the committing job reads only the artifact and writes only version fields; `main` protected; weekly signed publish with a generated diff, withdrawals at once. D 11.3, 11.6, decisions 35, 37; P66 |
| 26 | Receivers do not bind install keys to their host (major; issue text truncated) | accepted | Invariant I7: the game renderer accepts a message on a (window, host) port, and Main accepts every `plugin.*` request including `plugin.crashed`, only for install keys of that host; anything else is dropped as a host fault. D 1.3, 6.6, 9.1; P7 forges ops, a `GameAction` root, a document read and three crash reports from the unverified host |

Net effect on the design: the shape stays (Main authority, workers in hidden sandboxed hosts,
Vue over a host runtime, host-rendered UI, Main-owned data), with five structural additions:
hosts per (tier, class), plugin sessions = character sessions, host binding of install keys,
a Main plugin data worker, and membrane-enforced byte, retained and CPU budgets.
