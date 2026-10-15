# 01 Foundations

## Purpose

The ground every other spec stands on: the rules that always hold, the line on automation, the
names and identifiers, the invariants and their proofs, the design targets, the 1.0 scope and
the decision log. Other specs own the details; this file says what must never break. Specs name
other work by slice ID (`M<milestone>-<nn>`, `docs/build/milestones.md`); older plan names (Q1,
TX1, K1, G8 and similar) appear only in "Old ID" columns of the build plan.

## 1. Rules in force

### 1.1 What stays

1. Main (`apps/desktop`) is the only process with Node, disk, sockets and secrets.
2. The official client runs alone in its game renderer with gwkit. No plugin code runs there.
3. Plugin code runs in opaque-origin `data:` module Workers in hidden plugin hosts (renderers with
   `sandbox: true`); a non-official install also needs the sandbox test to pass (I1, spec 03).
4. The host renders a closed UI vocabulary and reads `plugin.json` without running plugin code.
   Plugins never touch DOM, CSS, keys or focus.
5. `Observed<T>` and `ActionResult` stay the result types (spec 04).
6. The Hub shell owns every interaction rule once: keys, Escape ladder, selection by id, session
   guards (spec 10).

### 1.2 The ten moves

Each move is a decision in section 6: (1) authors write Vue SFCs (`<script setup>`, composables,
typed host components) on a host `runtime-core` custom renderer that sends flat op batches;
collections are data props (37, 40); (2) one worker per install for the whole app (29); (3)
requested is not granted: one capability catalog drives manifest checks, types, page text,
enforcement and the test kit, and Main owns the grant store (20, 49); (4) read or internet, never
both, never in one process (22, 8); (5) host-rendered game actions: only a trusted press runs one
action or one chain (53 to 55); (6) Main owns every data source: net proxy and feeds, documents,
`Gw.dat` reference data, the activity log, the compat feed (59 to 65); (7) distribution like
Obsidian, with pins; one package = one JSON file (66 to 70); (8) plugin hosts by group and class
(8, 9); (9) budgets truncate or wait, and "Start without plugins" gives the plain game (27, 28,
12); (10) the Hub stays in the game renderer behind `HubPort`, `GameBridge` and `HubMain`; its
chord and the plugin shortcuts live in Main (5, 44, 46, 48).

### 1.3 The line: quality of life, never automation

**No combat automation and no economy automation. Quality of life is welcome.** In code:

| Rule | Enforced by | Proof |
| --- | --- | --- |
| Every catalog action is quality of life. No op that attacks, uses a skill, moves the character, targets for combat, picks up, trades, uses a merchant, buys, sells, crafts, salvages, drops or gives items or gold can exist | `ActionEntry.automation` has the single value `"quality-of-life"`, plus a denylist test table (spec 04) | P83 |
| No action starts from code: timers, fact changes, network replies, `onResult` handlers and module code have no call that runs one | no SDK function runs an action; `act()` only returns data (specs 08, 13) | P40, P44 |
| Facts are display only; no code path leads from a fact to an action (`game.vitals` included) | executor reachable only from a press handler (spec 13); lint rule (spec 02) | P82 |
| `game.note` (self-only chat line) needs no press, because it changes nothing in the world | Main rate limit (spec 13) | P84 |
| Signed compat data changes locators and kill switches only; it never adds a capability, fact or action | feed parser (spec 15) | P80 |

AGENTS rule 2 states the same line for contributors. Agents in live sessions follow the stricter
AGENTS "Live game sessions" list, enforced by Main's QA allowlist (spec 13).

### 1.4 Invariants

| Id | Invariant | Proofs |
| --- | --- | --- |
| I1 | Plugin code runs only in plugin hosts (hidden renderers, `sandbox: true`). A non-official install never runs in a host that fails the sandbox test (spec 03) | P5, P73 |
| I2 | No game action starts without a trusted press, except an `origin: "agent"` request in a Dev QA run that passes Main's QA allowlist. One press starts at most one action or one chain | P40, P41, P44, P46 |
| I3 | No install holds a personal read and an outbound host, and no `internet` host receives a game fact, `hub.search` text or an action outcome | P34, P7 |
| I4 | Executed plugin code = hashed bytes: no remote code, `eval`, `new Function`, `import()` of built strings, WebAssembly or nested `data:` workers | P3, P1 |
| I5 | Every capability fails closed on its own; the plain game always stays playable | P16, P17, P36 |
| I6 | Plugin data never lives in browser storage and is keyed by install key | P4, P58, P62 |
| I7 | The game renderer and Main accept an install key only from the plugin host that owns it | P7 |
| I8 | No plugin surface, text route or shortcut exists outside a plugin session | P74 |
| I9 | Plugins never hold image bytes. A package is `{ format, manifest, code }`; game art reaches host components only, through `moxi://app/ref/…` URLs that a plugin partition cannot load | P59, P61 |
| I10 | A chain holds only chainable catalog actions (manifest parse, Main authorization and executor, specs 04, 13) and runs only from one trusted press, each step only in an outpost, town or Guild Hall; it stops at the first `refused` or `failed` step or at player input (game input or Escape) | P81 |
| I11 | Only app code defines capabilities. Every action entry is quality of life, and the compat feed can change locators and kill switches only | P80, P83 |

### 1.5 Threats and residuals

| Threat | Controls | Residual |
| --- | --- | --- |
| Hostile plugin author (code in a worker) | worker isolation; read-or-internet per install and per process; host-rendered actions with host text; whisper body and target from the player; per-install data keys; attribution chips; budgets; no `eval`, WASM or nested workers | covert timing channel between colluding installs of different authors |
| Bot plugin (combat or economy automation) | quality-of-life-only catalog (1.3); no API starts an action; one trusted press per action or chain; facts never drive actions; compat feed cannot add capabilities | a player can press often; Main's per-op `minIntervalMs` bounds it |
| Phishing in a plugin (fake login form in an `internet` plugin) | no plugin session before the character is in the world; no masked input; `Sent to <host>` chip on every input of an `internet` plugin; page text; attribution chips | a convincing form inside the game is still possible; the chip and page warn |
| Hijacked author account ships an update; distribution tampering (asset swap, tag move, repo transfer or re-registration, rollback, freeze) | escalation hold (new `net:` or `link:` host, new op in a chain); read-or-internet; class split; withdrawal by id, hash or owner; GitHub repos ask before updating; SHA-256 pins; signed index with `seq` and `expires`; numeric owner and repo ids checked on every real update; the manifest inside the package is the authority | a same-permission update can misbehave inside its own grants until withdrawn; a compromised signing key until rotation (two keys, Matthias-gated) |
| Renderer exploit in a plugin host; bug in the op applier (game renderer) | renderer sandbox required; hosts split by group and class; host binding (I7); Main checks every request; actions need trusted presses in the game renderer; no disk, sockets or credentials in a host; registry indices; fixed prop table; two decoder passes; fuzzing; lint ban on `v-html` and `innerHTML`; no gwkit import in `packages/hub` | the grants of the installs in that one host; from a `local` host its facts can leave through WebRTC or WebTransport (accepted for 1.0, Q11); logic bugs and label spoofing inside the Hub (attribution chips reduce it) |
| Buggy or greedy plugin (loops, floods, huge UI, out of memory, CPU, Main floods) | watchdog; membrane-enforced backpressure; byte rates; retained-size budget; truncating budgets; host memory cap; per-install budgets on Main channels; crash policy; host restart; "Start without plugins" | one host's plugins restart together after an out-of-memory or a cap kill; a CPU burner that answers pings keeps running until the player turns it off (Activity shows it) |

### 1.6 Design targets

Fixed before measuring; they do not move to make a check pass. Runtime budgets and limits are in
spec 05. Proof details and pass criteria are in `docs/build/proofs.md`.

| Target | Value | Kind | Proof |
| --- | --- | --- | --- |
| Memory deltas: w = worker with the host runtime and a 200-row view, above an empty host; s = extra plugin session of one plugin; h = one host with 10 plugins and 4 game windows, above the same host with 0 plugins | w ≤ 6 MiB; s ≤ 1 MiB; h ≤ 102 MiB | Measure. Rule: w above 6 MiB on the pruned runtime → slim HUD runtime | P11 |
| Plugin work on the game main thread, Hub closed, 10 HUD widgets at 10 Hz | p99 ≤ 0.5 ms per frame | Measure | P29 |
| Main event-loop delay while chaos plugins flood documents, reference queries and the network | p99 ≤ 10 ms | Measure. Rule: above it → documents move to a worker thread | P77 |
| One-row change in a 1,000-row list; theme switch; builds a library holds before anything breaks | 1 `ITEMS` patch with 1 upsert; 0 messages to workers; ≥ 10,000 | Gate | P12, P23, P14 |
| Production files touched to add one fact / one action / one element; counted lines of platform core / host element components | ≤ 3 / ≤ 3 / ≤ 2; ≤ 5,000 / ≤ 2,500 | Review (section 4) | P78, P79 |

Memory Measures compare deltas on one OS only, with one metric per OS: Linux
`Private_Clean + Private_Dirty` from `/proc/<pid>/smaps_rollup`; Windows `privateBytes` from
`app.getAppMetrics()`; macOS `footprint <pid>` once a macOS CI lane exists. The host memory cap
uses its own sampler (spec 03). Gate, Measure, Review (Opus's check in the pull request) and
Live (a check with Matthias in the game) are defined in `docs/build/README.md` ("Checks").

## 2. Glossary

| Term | Meaning | Detail |
| --- | --- | --- |
| Plugin id, class, source, install | Plugin id: manifest `id`, `<owner>.<name>` in lowercase; the prefix `moxi.` belongs to official plugins. Class: `internet` when the manifest requests or offers a `net:` or `link:` host, else `local`. Source: official (bundled with the app), community (signed index), GitHub repo or dev folder. Install: one plugin id installed from one source; at most one install exists per plugin id | 04, 12, 15 |
| Source key, install key, host group, host key | Forms, patterns and issuers: section 3. Install key `<source key>/<plugin id>` keys grants, documents, settings, marks, HUD and panel placement, crash counts, activity and host binding; the membrane stamps it on every worker request. Host group (`official`, `reviewed`, `unverified`) comes from the source; host key `<host group>.<class>` names the plugin host that runs an install; at most six exist | 3, 03 |
| Plugin host, membrane, worker, applier | Plugin host: hidden renderer (`apps/plugin-host`, `sandbox: true`) with the membrane and one module Worker per install of its host key. Membrane: its main-thread code (spawn, ping, budgets, routing, fan-out by grant); it holds no authority. Worker: at most one module Worker per install at a time, shared by every game window; the host runtime is evaluated once in it; it stops when unused. Applier: code in `packages/hub` that applies op batches to host element trees | 03, 06, 07, 10 |
| Plugin session, sid | One character visit in one game window. `GameState` (`login`, `character-select`, `loading`, `in-world`, `unknown`) drives it: `in-world` opens it; `login`, `character-select`, `unknown`, a game page reload, the game renderer's death and window close close it; `loading` changes nothing, and gwkit reports `loading` during a map load, never `unknown`. Every plugin surface, text route and shortcut exists only inside one. sid: its id; `game.state` answers `{ sid: number \| null }` (new on entering `in-world`, the same while there, `null` otherwise) | 03 §1.5, 07, 13 |
| Module instance, root, RootId | Module instance: the plugin module evaluated once per (install, plugin session); module scope is session scope, `globalThis` is shared by all sessions of one install; a worker session opens at session open for an install with a granted `game.note`, otherwise on its first mount, hub, query or event. Root: one mounted plugin component tree (view, panel or HUD widget) of one (sid, install key); op batches address roots. RootId: `view:<n>`, `panel:<n>` or `hud:<n>` | 06, 07, 3 |
| View, panel, HUD widget | View: a command screen on the Hub's view stack. Panel: a command screen floating inside the game window, movable, part of the Escape ladder; never an OS window. HUD widget: a manifest `hud` entry shown at a named anchor while it is on (player choice, or the manifest default for official installs, spec 12); it takes no input | 10 |
| Fact, personal, outbound, catalog | Fact: a copied, read-only game value (catalog group `reads`); display only. Personal: a capability whose data is about the player: every `game.*` fact and `hub.search`. Outbound: `net:<host>` and `link:<host>`. Catalog: `packages/sdk/src/host/catalog.ts`, the only place a capability exists | 04, 13 |
| Game intent, game action, host flow, chain | Game intent: the value `act(op, args)` returns: data only; the host writes its label. Game action: one catalog action (group `acts`), run by the executor at a gwkit safe point after Main authorized it. Host flow: a game action with several game steps that the host runs and shows with progress ("5/16"), such as team apply. Chain: a manifest command whose `game` holds `steps` of chainable catalog actions with static args; one trusted press runs them in order as one host flow (rules: I10; step limit: spec 05) | 04, 08, 13 |
| Safe point, executor, fact publisher | Safe point: the point in the client's main loop where gwkit may read memory and call exports. Executor: game-renderer code that runs authorized actions at the safe point and observes their effect in facts. Fact publisher: game-renderer code that reads subscribed facts at the safe point and sends them to `local` hosts | 13 |
| Effective grants, kill switch, game build, client generation | Effective grants: requested ∩ granted − killed − withdrawn, per (install, game build). Kill switch: a compat-feed entry that turns one capability off for one game build. Game build: one ArenaNet client build; locators, kill switches and effective grants are per game build. Client generation: one downloaded, verified copy of a game build in the cache (`apps/desktop/src/game-files/generations.ts`) | 12, 15 |
| Start without plugins, plugins paused | Start without plugins: the launcher switch and the `--no-plugins` command-line switch; Main creates no plugin host for this app run. Specs and UI never say "safe mode". Plugins paused: a host that crashed too often stays off for this app run until the player presses "Start plugins" (counts in spec 05) | 03 |

**Trusted press.** One player input that may start one game action or one chain. It is one of:

1. A `click`, or an Enter or Space `keydown` with `event.repeat === false` and not composing, that
   is `isTrusted` and not yet consumed, in the game renderer, on a host control that carries an
   intent: a `GameAction`; the selected row of the Hub or of a focused panel (a game `ItemAction`
   or a manifest command with a static `game`); the confirm-sheet button; or Enter in a
   single-line input of a `Form` whose first `GameAction` it presses (spec 09). A click the
   browser synthesizes from a held key counts once per physical key down. A control whose
   descriptor changed within the descriptor guard (spec 05) opens the host confirm sheet
   instead; the sheet's own confirm press is the trusted press.
2. A bound manifest-command shortcut that Main matched in `before-input-event` with
   `input.isAutoRepeat === false` while a plugin session is open in that game window (spec 11).

Row-action shortcuts never run game actions; the `game` `ItemAction` has no `shortcut`. The Hub
marks a press consumed when it builds an intent from it.

**Agents.** `pnpm dev --qa` sets `MOXI_QA=1` (honoured only unpackaged; packaged builds refuse
it) and writes `qa: true` into `cdp.json`. CDP input is trusted in the page, so the page cannot
tell an agent from the player: in such a run Main treats **every** `plugin.action.authorize` as
`origin: "agent"`, and the QA allowlist applies to every press (spec 13).

## 3. Identifiers

One file defines every identifier: `packages/sdk/src/host/ids.ts`, exported by `@moxi/sdk/host`.
Main, `packages/contracts`, the membrane and `packages/hub` import it; the worker runtime imports
its types only (`import type`), so ArkType never enters the runtime bundle. Nobody re-declares
these types; wire encodings are in spec 07. `@moxi/sdk/host` holds every plugin-protocol shape
(ids, catalog, manifest, wire ops, port and worker protocols, `Platform`, `KeyChord`, `KeyCode`,
action types); `packages/contracts` holds IPC channels and Main → renderer events and imports
them (specs 02, 07).

```ts
// packages/sdk/src/host/ids.ts
import { type } from "arktype";

export type SourceKey = "official" | "community" | `gh:${string}` | `dev:${string}`;
export type InstallKey = `${SourceKey}/${string}`; // "<source key>/<plugin id>"
export type HostGroup = "official" | "reviewed" | "unverified";
export type PluginClass = "local" | "internet"; // derived from the manifest (spec 04)
export type HostKey = `${HostGroup}.${PluginClass}`;
export type Sid = number; // positive integer, issued by Main
export type RootKind = "view" | "panel" | "hud";
export type RootId = `${RootKind}:${number}`;

const SOURCE = "official|community|gh:[1-9][0-9]{0,14}|dev:[0-9a-f]{16}";
const PLUGIN = "[a-z0-9][a-z0-9-]{0,38}\\.[a-z0-9][a-z0-9-]{1,48}";
export const PLUGIN_ID = new RegExp(`^${PLUGIN}$`); // the only source; the manifest (spec 04) imports it
export const SOURCE_KEY = new RegExp(`^(?:${SOURCE})$`);
export const INSTALL_KEY = new RegExp(`^(?:${SOURCE})/${PLUGIN}$`);
export const ROOT_ID = /^(?:view|panel|hud):[1-9][0-9]{0,14}$/;

const matching = <T extends string>(re: RegExp, what: string) =>
  type("string").narrow((s, ctx): s is T => re.test(s) || ctx.mustBe(what));
export const sourceKey = matching<SourceKey>(SOURCE_KEY, "a source key");
export const installKey = matching<InstallKey>(INSTALL_KEY, "an install key");
export const rootId = matching<RootId>(ROOT_ID, "a root id");
export const hostKey = type(
  "'official.local' | 'official.internet' | 'reviewed.local' | 'reviewed.internet' | 'unverified.local' | 'unverified.internet'",
);
export const sid = type("number.integer > 0");

// official → official, community → reviewed, gh: and dev: → unverified
export declare function hostGroupOf(source: SourceKey): HostGroup;
export declare function hostKeyOf(source: SourceKey, cls: PluginClass): HostKey; // `${group}.${cls}`
export declare function installKeyOf(source: SourceKey, pluginId: string): InstallKey;
```

| Id (issue rules) | Issued by | Rule |
| --- | --- | --- |
| `gh:<ownerId>` | Main, at the first install from that GitHub owner | `ownerId` = the owner's numeric GitHub id in decimal (at most 15 digits), never the login |
| `dev:<pathHash>` | Main, when the player adds a dev folder | first 16 lowercase hex characters of SHA-256 over the UTF-8 bytes of `fs.realpathSync.native(folder)`, with `\` replaced by `/` |
| Install key, host key | Main, at install with `installKeyOf`; the host key also at every update that changes the class, with `hostKeyOf(source, class)` | the install key is the primary key of the install row and never changes for that install: an update keeps it, and installing the same plugin id from another source (only after the first install is removed) gives a new key with its own data. Main pushes the install → host key map with the grants (host binding, spec 07) |
| sid | Main, when it opens a plugin session | one counter per app run, starting at 1, +1 per session. Never reused in the run, never stored. Main maps each sid to its game window and account. A host restart keeps the sid |
| RootId | the Hub in the game renderer, when it mounts a root | one counter per game page load, starting at 1, +1 per mounted root (command view, pushed view, panel, HUD widget per session); at most 15 digits; a remount takes a new id. Unique within one window: workers, the membrane and the applier key roots by (sid, RootId). A reload closes the session first (spec 03), so an old root never meets a new one. The Hub drops messages for a root id it did not mount |

## 4. Counting rules (P78, P79)

**Counted line**: a non-blank line in a git-tracked `.ts` or `.vue` file, excluding `legacy/`,
`*.test.ts`, files under `test/`, `test-fixtures/` or `fixtures/`, and committed generated files
(first line `// generated by <script>; do not edit`, which covers generated tables). `pnpm lines`
(`scripts/line-count.ts`, built in M1-00) prints every group; only the first two have caps.

| Group | Paths | Cap |
| --- | --- | --- |
| Platform core (product code that runs) | `packages/sdk/src/{host,runtime}/**`, `packages/sdk/src/index.ts`, `apps/plugin-host/src/**`, `apps/desktop/src/plugins/**`, `apps/launcher/src/plugins/**` | 5,000 |
| Host element components | `packages/ui/src/elements/**` | 2,500 |
| Reported only | `packages/sdk/src/{testing,vite}/**`, `packages/cli/**`, `packages/hub/src/**`, `apps/game/src/**`, `packages/gwkit/src/game/**`, `packages/contracts/src/**` | – |

Slice budgets are ceilings: brief writers make the core slices of M1, M2, M4 and M7 sum to
≤ 5,000 and say so in `docs/build/milestones.md`.

**Production file** (P78): a `.ts` or `.vue` file outside tests, fixtures, generated output,
`tools/` and `compat/`. A new fact touches the catalog, the gwkit reader and the simulator fake;
a new action touches at most 4 files: the catalog entry, the executor row, the gwkit call and one test file; a new element, the element
registry and its host component. The role spec in `compat/roles/` and the fixture-world generator
in `tools/fixture-client` are required too; the pull request lists them, but they do not count.

## 5. 1.0 scope

| Area | In 1.0 |
| --- | --- |
| Platforms | macOS (signed, notarized `dmg`), Windows (signed NSIS), Linux (`.deb` with its AppArmor profile). AppImage is built in CI, not released |
| Plugin sources | until M14: official (bundled with the app, updated with app releases) and dev folders. From M14 (required for 1.0 Stable; Public Beta, M15, needs M13 only): signed community index; GitHub repos behind one switch, off by default; official plugins update through the index |
| Plugin API | `api: 1`. Facts `game.player`, `game.map`, `game.target`, `game.party`, `game.skills`, `game.progress`, `game.social`, `game.vitals`. Actions `game.builds.load`, `game.team.apply`, `game.travel`, `game.storage.open`, `game.whisper`, `game.party.invite`, `game.resign`, `game.target.call`. Also `game.note`, `hub.search`, `net:<host>`, `link:<host>` (spec 04) |
| UI | the element set the bundled plugins and the Build Library need (spec 09); Hub, HUD, panels inside the game window (spec 10) |
| Bundled plugins | Builds, Travel (with Progress), Trade (with Calculators), People (Whispers and invite), Timers (cooldowns, key labels, effect timers, Reminders), Quick actions (Xunlai, Call Target, Resign), Target Distance, Elite skills |
| Host tweaks (no plugin code) | chat filters, double-click repair, native cursor, 4 GB mode, render scale, template-save repair, texture packs, character switch, controller, Steam sign-in |
| Parity baseline | v1 Beta v2026.10.0-beta.1 plus Progress and Reminders; one row per v1 feature in `docs/build/parity.md` |

Not in 1.0: plugin code, ops or commands in the launcher; `game.inventory` (until Matthias says
yes, Q7); a pressable HUD; whisper drafts; an action button on toasts; a host `<Send>` control; a
"skill used" event fact; maps (compass ranges, exploration grid); Quick Item Move; the alcohol
timer; Trusted Types on the game page (PB12); the Hub as a panel view (PB17); any plugin UI in
its own OS window; a combined travel-and-invite flow (two presses instead).

## 6. Decision log

Each row: the decision, its reason, the rejected alternative, and the spec that holds the detail.
A row with several numbers holds one decision per number, marked (a), (b), (c) in every cell.

| # | Decision | Reason | Rejected | Spec |
| --- | --- | --- | --- | --- |
| 1 | No combat and no economy automation; quality of life is welcome | moxi must never become a bot platform, and players want convenience | a catalog that admits any op the game supports; review as the only control | 01 |
| 2, 3 | (a) Gates are deterministic; timing and memory are Measures (median of 5, with a decision rule). (b) Memory is compared only as same-OS deltas, one metric per OS | (a) no flaky tests. (b) the metrics differ per OS (`privateBytes` exists on Windows only) | (a) timing thresholds as gating e2e checks. (b) absolute gates from mixed metrics | 01 |
| 4 | Electron checks (e2e, packaged, probes) run in CI only | no window may open on Matthias's Mac | hidden local windows | 16 |
| 5 | New `packages/hub` behind `HubPort`, `GameBridge` and `HubMain`; it never imports gwkit | two real uses (game window, `moxi dev`); an applier bug has no code path to game memory | Hub code in `apps/game` plus a separate dev harness | 02 |
| 6 | Official plugins stay in the moxi repo until the SDK is published | one pull request per SDK change | a separate repo now | 02 |
| 7 | Plugin code in opaque-origin `data:` module Workers in hidden, sandboxed renderers | one opaque-origin worker per install costs about 6 MiB with the host runtime and has no DOM, storage or network | iframes (focus, keys, accessibility and theme per frame; no WebRTC control); `utilityProcess` (no sandbox); workers in the game renderer; ShadowRealm or SES (no CPU limit); QuickJS (about 10× slower, a second engine) | 03 |
| 8, 9 | (a) Plugin hosts per host key (group × class), at most six. (b) Hosts exist only while a game window exists and one of their installs is on | (a) an exploit or out-of-memory in community or unverified code never reaches official plugins; no process holds personal facts and a way out. (b) no plugin runs without a game in 1.0 | (a) one host for all; a split by trust only; one renderer per unverified install. (b) a host from app start (about 18 MiB with no use) | 03 |
| 10, 11 | (a) No plugin code or ops in the launcher in 1.0. (b) A plugin session is a character session | (a) the launcher takes credentials and consent. (b) no plugin surface, text route or shortcut next to the official login screen | (a) a launcher plugin session. (b) sessions per game window from the first frame | 03 |
| 12, 13 | (a) Main caps each host's private memory and restarts the host above the cap; a cap kill charges the host, never an install. (b) High CPU: Main logs it and shows it in Activity; no kill | (a) one worker's V8 out-of-memory takes its whole host down, and Main cannot tell which install caused it. (b) a reliable burner search needs a re-design before untrusted sources open | (a) no cap (one plugin can page the whole machine and stall the game); charging a guessed install. (b) restarting the whole host on high CPU (takes healthy HUDs down) | 03 |
| 14, 15 | (a) Non-official plugins need the sandbox. Linux: `Seccomp: 2`, host `NSpid` deeper than Main's, no `--no-sandbox` in argv. macOS and Windows: `ProcessMetric.sandboxed`. (b) Plugin CSP without `'wasm-unsafe-eval'`; the runtime prelude deletes `globalThis.Worker`; device permissions denied; in-memory partition with `webRequest` cancel | (a) isolation is void without the sandbox; `hasSwitch("no-sandbox")` is blind after `app.enableSandbox()`. (b) executed code = hashed bytes; a nested `data:` worker runs built code under any CSP | (a) `hasSwitch`; trusting the package type. (b) WASM in plugins | 03 |
| 16, 17 | (a) `backgroundThrottling: false` on every plugin-host `webContents`. (b) Accept the post-exploit residual: WebRTC and WebTransport from a compromised plugin host | (a) a throttled hidden host stalls for 15 s or more. (b) it needs a V8 or Blink exploit, the host holds only its installs' grants, and Electron has no control for it | (a) app-wide switches. (b) no network for plugins at all | 03 |
| 18, 19 | (a) Per-account game partitions `persist:account-<id>` with their own `moxi` handler; game windows stay shown. (b) Game data in the default session is reset at the move to per-account partitions | (a) no client-generation mixing; a hidden game window runs at about 1 fps. (b) data may change before 1.0, and the client downloads again | (a) the shared default session and global routes. (b) migrating IDBFS and localStorage | 03 |
| 20, 21 | (a) One capability catalog. (b) Every action entry is `automation: "quality-of-life"`; a combat and economy denylist is checked by type and test | (a) adding a fact touches 3 files, not 6 to 10. (b) the line holds by construction, not by review | (a) capability code in five places. (b) an open catalog with review only | 04 |
| 22, 23 | (a) Read or internet, never both; `link:` counts as outbound; `internet` installs get no action outcome; whisper body and target come from the player. (b) No same-owner collusion check | (a) AGENTS rule 3 in code; parity needs no exception. (b) a second account bypasses it, and it blocks legitimate pairs | (a) a disclosure line only; no network in 1.0; `link:` exempt with reads. (b) an owner-based check | 04 |
| 24, 25 | (a) Static `game` op or chain in manifest commands. (b) `link:<host>` is its own capability but outbound; reads plugins get host-built `{ wiki }` links | (a) no plugin code runs on a shortcut action. (b) a plugin-built URL can carry encoded facts | (a) a callback that returns op and args; plugin args within a time window. (b) links on `net:` grants; links exempt with reads | 04 |
| 26 | `game.vitals`: health, energy, death, morale and the skill being cast, for you and your heroes; display only; withheld in PvP battle maps and while loading | quality-of-life readouts with no path to actions | henchmen and other players in api 1; a "skill used" event fact now | 04 |
| 27, 28 | (a) Budgets are shared constants that truncate or wait. (b) One batch in flight per root, enforced by the membrane; a byte rate per install toward a game renderer; small batches | (a) a plugin must not die on size, and the kit must see the same limits. (b) a flood waits instead of crashing; one message costs the game frame about 1 ms at most | (a) limits that crash the plugin on size. (b) a rate cap that crashes; enforcement by the runtime alone | 05 |
| 29, 30 | (a) One worker per install, module factory per plugin session. (b) The host supplies the runtime from `moxi://app/plugin-host/code/<sha>.js`; only plugin code uses `data:` | (a) memory grows with plugins; module-level state is per session. (b) a private wire; runtime fixes reach every plugin; `data:` URLs have a size cap | (a) a worker per (plugin, window); one shared module scope; frozen intrinsics. (b) the runtime inside each bundle | 06 |
| 31 | Per-session flush, `effectScope` and timers; a view whose render throws keeps its last good tree | one session never waits on or breaks another | one flush for all sessions; stock Vue (blanks the view) | 06 |
| 32 | The worker sends at the end of each Vue flush (post-flush microtask) per (session, root) and on ack; the membrane forwards by microtask with a `setTimeout(0)` fallback | hidden-window frame timing differs per OS | `requestAnimationFrame` batching | 06 |
| 33 | Activation derived from what the manifest contributes | one fact, one owner | an `activation` field | 06 |
| 34, 35, 36 | (a) A membrane between workers and the game renderer. (b) One registry-driven decoder in membrane, applier and kit; names travel as registry indices. (c) Host binding: an install key is accepted only from its own host | (a) sizes and rates are checked before the WASM thread deserializes. (b) the valuable process does not trust the plugin host; a plugin cannot name what the host lacks. (c) host splits mean nothing if a host can stamp another host's install | (a) direct worker-to-game ports. (b) per-message ArkType; names on the wire. (c) per-install ports | 07 |
| 37, 38 | (a) Vue SFCs over a host-supplied `runtime-core` custom renderer. (b) The test kit runs the real runtime, decoder and budgets, with two sessions by default | (a) real Vue for authors; the host keeps theme, keys and accessibility. (b) a green kit means a working plugin | (a) node factories; Remote DOM with stock Vue; an iframe tier. (b) a kit with its own logic | 08 |
| 39 | One element registry generates components, types, decoder tables, kit and docs | one owner per element | parallel hand-written definitions | 09 |
| 40, 41 | (a) Collections are data props with keyed patches. (b) Elements grow by real need: the set the bundled plugins and the Build Library need | (a) one node per list; easy virtualization; the Hub ranks rows. (b) one maintainer can keep it accessible | (a) child components per row. (b) about 70 elements up front | 09 |
| 42, 43 | (a) Theme by tokens, `accent`, `Gw.dat` icons and draw lists; plugin icons are host glyphs or game art. (b) Declarative draw lists (`Canvas`, `Chart`, `MapView`) | (a) freedom without breaking looks, contrast or the HUD; no image decoder. (b) data crosses processes; host-owned pixels | (a) plugin CSS; iframe panels with injected tokens; plugin-supplied pictures. (b) OffscreenCanvas (plugin-owned pixels, unbounded GPU time); WebGL | 09 |
| 44 | The Hub stays in the game renderer | provable now; a move stays a mount change | a panel view now; a full-window overlay view | 10 |
| 45, 46 | (a) HUD anchored by name, placed by the player, no HUD events; no pressable HUD in 1.0. (b) Plugin panels stay inside the game window | (a) plugins never see pixels or the camera. (b) one surface the player already manages | (a) pixel positions; HUD click handlers. (b) a host "Pop out" into an OS window | 10 |
| 47 | Per-frame host cost measured with `performance.now()` around applier work, the rAF histogram and `contentTracing` | Long Animation Frames report only frames over 50 ms | LoAF attribution | 10 |
| 48 | Hub chord and plugin shortcuts in Main by physical key; plugin chords need Cmd or Ctrl, are capped per install, and work only in a plugin session | works while the game has focus; no menu reload; typing never fires a plugin | a renderer chord with platform sniffing; Shift-only and Alt-only plugin chords | 11 |
| 49, 50 | (a) Requested is not granted; Main owns the grant store. (b) Optional permissions only through the host `RequestAccess` element | (a) consent must be real and revocable. (b) no API can ask from code | (a) manifest = grant. (b) `requestPermission()` with gesture ids | 12 |
| 51 | Approvals only from the launcher's or a game window's `webContents` | no process that runs plugin code can grant | approvals anywhere; launcher only | 12 |
| 52 | Official bundled plugins are pre-granted their required permissions on first run | the page shows everything and every switch works | asking on first run | 12 |
| 53, 54 | (a) Host-rendered `GameAction`, trusted press, host label, descriptor guard. (b) Main authorizes every action, for players and agents | (a) closes the confused deputy. (b) one choke point for grants, kill switches, QA allowlist, rate and log | (a) plugin-held activation tokens. (b) the executor deciding alone; tickets plus an input witness | 13 |
| 55 | Chains: one press runs a short manifest-declared list of chainable actions as a host flow, only in outposts, towns and Guild Halls, stopping at the first failure | multi-step quality of life with one consent per run | plugin-sequenced actions (plugin code decides when the next one runs) | 13 |
| 56, 57 | (a) Drops never start game actions. (b) `game.note` needs no press, is rate-limited and may follow any fact | (a) the host must show the effect first. (b) reminders need it; it changes nothing in the world | (a) a drop that runs an op. (b) treating it as a game action (kills reminders) | 13 |
| 58 | `locate()` in a Main worker thread, cached per client generation | no 2 to 4 s freeze | the renderer main thread | 13 |
| 59 | Shared state lives in Main | one owner per fact | module-level sharing in the worker | 14 |
| 60, 61 | (a) Network only through a Main proxy with exact hosts; Main polls `useFetch`. (b) HTTPS with `node:https.request`, a pinned lookup and a fresh `Agent` per call; WSS with `ws` 8.22.0 | (a) pinned DNS; one request for all windows. (b) no state shared between calls; no hand-written frame parser | (a) CSP holes per worker; sockets per window. (b) global `fetch`; a hand-written WSS frame parser | 14 |
| 62, 63 | (a) Bundled Mozilla TLS roots only. (b) No ETags and no persisted HTTP state for plugins | (a) the same trust on every OS. (b) a server cannot plant an identifier | (a) bundled plus system roots. (b) ETag revalidation across runs | 14 |
| 64, 65 | (a) Documents keyed by install key in Main's SQLite, budgeted per install; they move to a worker thread only if P77 fails. (b) Reference data and game art come from the player's `Gw.dat` through Main; plugins get ids and names, never bytes | (a) no plugin reads another source's data; the least code. (b) no image bytes or tracking in plugins | (a) keying by bare plugin id. (b) plugin-supplied pictures | 14 |
| 66 | Sources: official (bundled), community index, GitHub repo, dev folder | Obsidian's model, with pins | a plugin list without pins | 15 |
| 67, 68 | (a) One signed index with `seq`, `expires` and withdrawals; a Matthias-gated key; withdrawals at once. (b) A package is one JSON file, content-addressed, never extracted | (a) tamper, rollback and freeze defense. (b) no archive attack class, no unzip dependency | (a) author-held keys; an unsigned list. (b) zip | 15 |
| 69, 70 | (a) GitHub checks through `moxi-release.json`; one id check per real update; at most one check per repo per day plus "Check now". (b) Bundled official plugins install through the same path as every plugin | (a) 0 API calls per check; repo-jacking defense; API rate limits. (b) one code path | (a) API polling; system git; name-only checks. (b) a special bundled path | 15 |
| 71, 72 | (a) Kill switches in the compat feed; withdrawals in the plugin index. (b) The compat feed changes locators and kill switches only | (a) two owners, two cadences. (b) signed data must never widen what plugins can do | (a) one feed for both. (b) capabilities delivered by the feed | 15 |
| 73 | Until M14, official plugins update with app releases | no signed index exists before M14 | publishing an index early | 15 |
| 74, 75 | (a) Linux ships as `.deb` with its AppArmor profile; AppImage is built but not released. (b) Data roots: `%LOCALAPPDATA%\Moxi` on Windows, XDG data and cache on Linux | (a) the AppImage runs without the sandbox on Ubuntu 23.10+. (b) the game cache must not roam | (a) the AppImage as the package. (b) Roaming app data | 16 |
| 76 | No masked input; a `Sent to <host>` chip on every input of an `internet` install | phishing is the main real harm for GW1 accounts | plugin inputs without attribution | 09 |

## 7. Owner decisions

Open items are also collected in `docs/build/milestones.md`; no spec settles them.

| # | Question | Answer in force |
| --- | --- | --- |
| Q1 | Read or internet for every source; exceptions | Yes, no exception in 1.0. A host `<Send>` control that shows the payload is the only future path; Matthias decides it |
| Q2, Q8 | Player-added GitHub repos; registry auto-ingest of same-permission versions | From M14: GitHub repos behind one switch, off by default, "Not reviewed" badge, updates ask; auto-ingest with registry CI (section 11) |
| Q3, Q5 | Official plugins pre-granted on first run; plugin commands in the launcher palette | Yes, their required permissions only (decision 52); not in 1.0 |
| Q4 | Hub chord on Windows and Linux | **Open.** In force: Ctrl+R with `Menu.setApplicationMenu(null)`; Cmd+R on macOS (spec 11) |
| Q6 | Linux package | `.deb`. AppImage release: **open** |
| Q7 | `game.inventory` in api 1 | **Open.** Not in api 1 at launch; slice M11-13 waits for a yes |
| Q9 | Public registry repo, signing key, `@moxi/sdk` on npm | **Open.** Each publication needs Matthias |
| Q10, Q11 | Nightly real-client boot in CI; WebRTC and WebTransport post-exploit residual | Yes, non-gating; accepted for 1.0 |
| Q12 | Whisper and invite rules | Yes: the body is always typed by the player; the target is typed, or a friend or whisper partner from `game.social` |
| OD1 to OD4 | The line; action chains; `game.vitals`; plugin panels | Yes: no combat and no economy automation, quality of life welcome (1.3); chains (decision 55); `game.vitals` (decision 26); panels inside the game window only (decision 46) |
| – | Public or private repo (Actions minutes, macOS lane) | **Open.** The macOS CI lane runs only when the repo is public or minutes are approved |
| – | v1 features to drop; merging pull requests; app icons | **Open.** Proposal in `docs/build/parity.md`; Matthias merges, or gives a standing approval; Matthias picks icons (M12-09) |

## 8. Today in code (main 848fb6e) and what changes

| Concept | Today | Changes to | Slice |
| --- | --- | --- | --- |
| Install identity | Plugin id only, pattern `^[a-z0-9]+(\.[a-z0-9-]+)+$` (`packages/sdk/src/manifest.ts:102`). Documents keyed `(plugin, scope, account, name)` (`apps/desktop/src/storage/documents.ts:15`) | source key and install key (section 3); documents by install key (spec 14) | M1-01, M4-02, M4-03 |
| Hosts | One plugin host for all plugins, created at app start (`apps/desktop/src/shell/main.ts:429`); one `PluginHost` with its workers per game window (`apps/plugin-host/src/index.ts`) | hosts per host key, created with the first game window; one worker per install, run by the membrane | M4-05, M4-09, M2-02 |
| Sessions, roots | The game window's `webContents.id` travels with the port (`main.ts:150`); plugins with `activation: "game"` start on the login screen (`manifest.ts:127-133`). The Hub mints `view:<pluginId>:<uuid>` (`apps/game/src/hub/client.ts:75`); no panels; HUD only in the dev harness | `sid` per character session, issued by Main; `RootId` from one counter per game page load | M5-06, M3-01, M3-02 |
| Presses, chains | 3 s single-use activation tokens minted and checked in the plugin host (`apps/plugin-host/src/plugin-host.ts:333-395`); imperative `loadBuild` and `travel` (`packages/sdk/src/game.ts:48-54`); no chains | trusted press and Main authorization; tokens and imperative calls deleted; manifest chains, chain executor, progress UI | M3-07, M4-07, M5-08, M1-03 |
| Result types | `Observed<T>` and `ActionResult` (`packages/sdk/src/game.ts`) | kept; `Unavailable` and `Refusal` change (spec 04) | M1-01 |
| I1, I3, I4 | Plugins run in a hidden sandboxed host; `e2e/plugin-isolation.e2e.ts` covers part of it. `net:<host>` is accepted next to game reads (`manifest.ts:112-126`); no network exists. Plugin CSP has `'wasm-unsafe-eval'` (`apps/desktop/src/plugin-isolation.ts:2`) | full egress matrix (P1); sandbox refusal (P5); read-or-internet at parse and class split; CSP without it, the prelude deletes `globalThis.Worker` | M5-10, M4-06, M1-03, M4-05, M2-01 |
| I7, I8 | No host binding; plugin rows appear in the Hub before the character is in the world | install → host key map, enforced in the game renderer, Main and the membrane; plugin surfaces only inside a plugin session | M4-05, M4-01, M4-09, M5-06 |
| P78, P79 | About 2,000 counted lines (`packages/sdk/src` 1,038; `apps/plugin-host/src` 940); a new fact touches 6 to 10 files | caps in section 4; a new fact touches ≤ 3 files | M6-04 |

## 9. Built by

| What | Slices |
| --- | --- |
| Old SDK moved to `packages/sdk/src/legacy` (entries `./legacy`, `./legacy/host`, `./legacy/testing`; lint rows allow them until M6-03); `pnpm lines` | M1-00 |
| `packages/sdk/src/host/ids.ts` (section 3); catalog admission (`automation`, denylist) | M1-01 |
| Install key, source keys, host keys in Main; the membrane (one worker per install, sessions, host binding of messages) | M4-02, M4-05, M4-09 |
| sid and plugin sessions; RootId assignment | M5-06; M3-01, M3-02 (runtime side M2-01) |
| Trusted press; chains | M3-07, M5-08, M5-09; M1-03, M4-07, M11-10 |
| Compat feed limited to locators and kill switches | M9-11 |
| P78/P79 review; P11 Measure job | M6-03, M6-04, M7-06; M2-07 |

## 10. Checked by

The proofs named in 1.4 check the invariants; each has one owning slice in `docs/build/proofs.md`.

| Proof | What it checks here | Kind | Owner |
| --- | --- | --- | --- |
| P11 | w, s and host memory targets (1.6) | Measure | M2-07 |
| P40, P84 | executor calls = trusted presses, or chain steps of one press; `game.note` rate limit: `note.perSecond`, `note.queued` waiting, overflow refused `rate` (spec 05) | Gate | M5-08 |
| P78, P79 | files per fact, action and element; counted lines of platform core and element components (section 4) | Review | M6-04 (P79 also M6-03, M7-06) |
| P80, P83 | the compat feed cannot add a capability, fact or action; every action entry is quality of life and denylisted op names cannot be added | Gate (N) | M9-11 (P80), M1-01 (P83) |
| P81 | chains: one press, chainable steps in order, stop at the first failure, refused outside outposts, player input cancels, no step without the press, page lists steps | Gate (N, E) | M1-03 (parse), M5-08 (fixture), M11-10 (live) |
| P82 | `game.vitals` schema, withheld in PvP battle maps and loading, keyed by map-load generation; display only | Gate (N, E) | M1-01, M5-07, M11-05 |

## 11. Deferred

Until community or GitHub sources open (slice M14-04, before 1.0 Stable; none exists before M14):

- CPU burner search: Main finds and stops the busy worker in a host that still answers pings, by
  halving instead of one worker at a time; the stopped worker gets a `cpu` crash (a new
  `CrashKind`, spec 07). Until then decision 13 holds.
- Registry CI in `gwasm-dev/moxi-registry`: untrusted author builds in a job with no token and no
  secrets, auto-ingest of same-permission versions (Q8), weekly signed publish with a generated
  diff, withdrawals at once.
- Theme packages: manifest `kind` and `tokens` fields. Until then a manifest has neither, and an
  unknown top-level field is ignored with a warning (spec 04).
- Reproducible packages: registry CI rebuilds a package and compares bytes. `moxi pack` output is
  deterministic from the start (spec 15).
