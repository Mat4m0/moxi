# Build book plan (2026-10-15): input for milestones.md, proofs.md and the slice briefs

This file is the single source for the build-book writers. Where it disagrees with
DESIGN.md or older plans, THIS FILE WINS; where it disagrees with `docs/spec/`, the spec wins. Writers never invent a decision that
this file or DESIGN makes; where neither decides, they write the smallest correct choice,
mark it `[decided by writer]` and list it in their return value so Opus can confirm it.

Paths (relative to the repo root):
- Design of record: `docs/spec/` (written from `docs/build/inputs/DESIGN.md`, which it supersedes)
- Proofs P1-P79: `docs/build/inputs/PROOFS.md`; P80-P84 in section 6 below
- Resolutions R1-R30 and N1-N23 from the spec review are already applied to `docs/spec/`
- v1 reference (read only): `../gwonmac` (`Mat4m0/gwonmac`)

## 1. Target layout in the repo

```text
AGENTS.md                      rules (edited by Opus only)
docs/ARCHITECTURE.md           short v2 overview (≤ 250 lines): processes, packages, trust, data flow; links to specs
docs/spec/NN-<topic>.md        the design of record, split by topic, amendments merged, gaps closed (16 files, list in 4)
docs/build/README.md           how a slice runs: roles, worktrees, checks, evidence, review, merge, stop rules (Opus writes)
docs/build/milestones.md       ordered milestones: goal, slices table, gate (exact checks), exit review, needs-Matthias
docs/build/proofs.md           proof catalog P1..P8x, each owned by exactly one slice (or split halves, each owned)
docs/build/parity.md           parity ledger: one row per v1 feature: keep/drop/merge/defer, home, journey, line budget
docs/build/slices/<ID>.md      one brief per slice (ID scheme in 3)
```

No status in the repository (AGENTS rule): no "status" column anywhere in docs/. Status lives
outside git (the lead's own notes, issues and pull requests).

## 2. Decisions Opus made for the book (BD = book decision). Writers apply them.

Owner (Matthias) decisions, 2026-10-15:
- OD1 The line: **no combat automation and no economy automation; quality of life is welcome.** The catalog holds no combat or economy actions. No action ever starts from code: timers, fact changes, network replies, module code. Only a trusted press.
- OD2 **Action chains**: one trusted press runs a manifest-declared list of chainable catalog actions as a host flow.
- OD3 **`game.vitals`** read fact: health %, energy, dead flag, morale, skill being cast; player and heroes; display only.
- OD4 **Panels stay inside the game window.** No plugin UI in its own OS window. ("Pop out" withdrawn.)
- Builders are mostly Sonnet/Haiku workers supervised by Opus. Briefs for all milestones. Outdated docs replaced or archived.

Book decisions (resolve open questions from the maps):
- BD1 Chains: declared only in manifest `commands[].game = { steps: [{ op, args }] }` (static args, no `field()`), runnable from the Hub row and its shortcut. ≤ 8 steps. Chainable ops: `game.travel`, `game.builds.load`, `game.team.apply`, `game.storage.open`. Not chainable: `game.whisper`, `game.party.invite` (need player-typed body/target), `game.resign`, `game.target.call`. Main authorizes the whole chain before step 1 (every op granted, not killed, args valid) and checks `minIntervalMs` per step. The executor runs steps in order at safe points; the Hub shows all steps and progress "2/4"; the chain stops at the first `refused`/`failed`; before each step the host re-checks "in an outpost/town/Guild Hall" (`game.map.area === "outpost"`, PvP outposts included); any player game input or Escape cancels the rest. The plugin page lists each chain's steps. An update that adds a new op to a chain is a permission escalation; changed order or args of already-granted ops is not. Chains count within the 4 shortcuts per install.
- BD2 `game.vitals`: per agent (player + heroes; no henchmen, no other players in api 1), keyed by agent id with the map-load generation; fields: `healthPct` (0..1), `energy` and `energyMax` (null when the game does not expose it for that agent), `dead` (boolean), `moralePct` (-60..+10), `casting` (`{ skillId, since }` or null). `rateHz` 10. Withheld (`restricted-area`) in PvP maps and while loading. Display only (structural: no code path from facts to actions). A "skill used" event fact (for instant skills) is NOT in api 1; note it as a later candidate. `game.note` may be driven by any fact (self-only).
- BD3 Compat feed may only change locators and kill switches; it can never add a capability, fact or action. A proof (new) enforces it.
- BD4 Catalog admission: every `ActionEntry` carries `automation: "quality-of-life"`; there is no other value. A review rule + a test list forbid combat/economy ops (attack, skill use, move, target-for-combat, pick up, trade, merchant, buy/sell, craft, salvage, drop/give items or gold).
- BD5 1.0 plugin sources: **official (bundled with the app) and dev folder** at Beta. GitHub repos (behind a switch, off by default) and community index come in M14, before 1.0 Stable. Official plugins update with app releases until M14 (no signed index before M14). Amendment 3 deferrals (CPU burner search, registry CI, theme packages, PB16) land in M14.
- BD6 Plugin host groups: `official`, `reviewed` (community), `unverified` (GitHub, dev) × class `local`/`internet` → `HostKey = "<group>.<class>"`, at most 6 hosts, each only while one of its installs is on and a game window exists. SQL: keep `tier` out; derive group from `source_key`.
- BD7 High CPU in 1.0 (burner search deferred): Main logs it and shows it in Activity; no kill. Memory cap: 768 MiB on all OSes; Linux `smaps_rollup` Private_Clean+Private_Dirty, Windows `privateBytes`, macOS `app.getAppMetrics()` `workingSetSize` until a macOS Measure exists. A cap kill charges the host only.
- BD8 P11 memory numbers become **Measures** (median of 5, decision rule: if w > 6 MiB on the pruned runtime → slim HUD runtime). Gates stay deterministic only.
- BD9 Default-session IDBFS/localStorage data is reset when games move to `persist:account-<id>` (pre-1.0; the client re-downloads). Said in the PR.
- BD10 TLS: bundled Mozilla roots only in 1.0.
- BD11 Linux: `.deb` with AppArmor profile is the package; postinst checks the profile and prints the fix. AppImage is built in CI but not released (Matthias decides later).
- BD12 Hub chord on Windows/Linux: one constant, default Ctrl+R (today's), with `Menu.setApplicationMenu(null)`; Matthias may change it (open decision D8). macOS Cmd+R.
- BD13 No pressable HUD in 1.0 (decision 19 stays). No whisper drafts in 1.0. Toast has no action button in 1.0.
- BD14 Reference data (skills, maps, items, professions, heroes with English names) is its own slice (M11-01); before it, the sim and test kit carry fixture reference tables. Build skill icons come from the Gw.dat reader (M12-01); until then a host glyph.
- BD15 `game.inventory` is NOT in api 1 launch (v1 never read it; parity needs none). Slice M11-13 exists but is gated on Matthias (open decision Q7).
- BD16 IDs: new slice IDs `M<milestone>-<nn>` (e.g. `M2-04`). Old IDs (S2, T1, X5, Q1, A1, G3, TX1, R1-05 …) appear only in an "Old ID" column for traceability.
- BD17 Every Electron check (e2e, packaged, probes) runs in CI only (Linux on every PR; Windows nightly; macOS lane only when the repo is public or minutes are approved). Workers never start Electron locally. Local checks: Node Vitest, Vitest browser (headless Chromium), lint, types.
- BD18 Gate runner `pnpm gate <test files…>` (M0-03): 20 runs in a row, then 5 runs with all CPU cores busy; exit non-zero on the first failure. Every changed test file passes it before review.
- BD19 Every IPC channel and Main→renderer event gets a typed shape in `packages/contracts` (M4-01); the plugin port and worker protocol live in `@moxi/sdk/host` (`host/wire.ts`, `host/port.ts`). Until then, new code adds no raw string events.
- BD20 Documents: a new migration (one migration per slice, numbered in merge order) rebuilds `documents` keyed by `(install_key, scope, account, name)`; dev DBs migrate, no edit of migration 1.
- BD21 Dev-only base URLs (fixture registry, fixture GitHub) follow the `MOXI_PATCH_ROOT` pattern (refused in packaged builds), never `MOXI_DATA_DIR`.
- BD22 Test-only install injection for non-official installs before M7/M14: a Dev-build-only Main switch (refused when packaged), so P5/P7/P73 run in M4.
- BD23 P1 allows exactly one `moxi` import: `moxi://app/plugin-host/code/<sha>.js`; every other `moxi` path is 404 for plugins. P3: `WebAssembly.validate` "returns but creates no code"; add the nested `new Worker(data:)` row.
- BD24 `slice/t1-e2e` is archived, not merged; its useful ideas are re-done in M0-04/M0-05. `ci-green-clean` lands first, then X5.
- BD25 Parity baseline = v1 Beta v2026.10.0-beta.1 plus Progress and Reminders from local HEAD (both merged into Travel/Timers, Progress deferred). Drops (D12 proposal, awaiting Matthias): diagnostics overlay, input trace, PlayStation prompt atlas, profession trace, other traces, visual problem report, Templates pane UI, Core/Tools modes, walkable terrain, cartography evidence export. Maps (grid, compass ranges) deferred after Beta. Quick Item Move deferred (host tweak).
- BD26 Merged plugin set for parity: Builds, Travel (+Progress), Trade (+Calculators), People (Whispers + invite), Timers (cooldowns, key labels, effect timers, Reminders; alcohol deferred), Quick actions (Xunlai, Call Target, Resign), Target Distance, Elite skills. Host tweaks: chat filters, double-click repair, native cursor, 4 GB mode, render scale, template-save repair, texture packs, character switch, controller, Steam sign-in.
- BD27 "Travel and invite" is two presses in 1.0: a travel row, then an invite row for the same friend. No combined flow, no new catalog id (parity difference).
- BD28 Merging: AGENTS says merging PRs needs Matthias. The book's process: Opus reviews, CI green, then asks Matthias (or uses a standing approval if he gives one; open decision).
- BD29 Local parallelism: at most 3 workers building at once (machine load); waits capped at 4 min; CI waits happen in Opus's main loop, never in a worker.
- BD30 Line budgets: platform core ≤ 5,000 non-test lines + ≤ 2,500 element components (P79; counted paths in spec 01 §4: sdk host+runtime+index, plugin-host, desktop/plugins, launcher/plugins); the core slices of M1, M2, M4 and M7 sum to ≤ 5,000; each slice brief states its own budget; > 120 % needs Opus design review before merge. Test lines ≤ product lines per slice. Resolutions R1-R30 are applied to `docs/spec/`.

## 3. Slice brief template (every file in docs/build/slices/)

```markdown
# <ID> <Title>

| Milestone | Model | Depends on | Specs | Proofs | Budget | Old ID |
| --- | --- | --- | --- | --- | --- | --- |
| M2 | Sonnet | M1-01, M1-05 | spec/06 §3, spec/08 §2 | P12, P15 (N half) | ≤ 450 lines (+ ≤ 400 test) | – |

## Outcome
2-4 sentences: what works afterwards, for players or for the next slice. Outcomes, not mechanisms.

## Read first
Exact spec sections and code files (path:line) the worker must read. Nothing else.

## Preflight (stop and report if any line fails)
Commands with expected results that confirm the brief's assumptions still hold on the base
commit (files exist, exports have these names, earlier slices merged, a test count).

## Scope
- Create: paths. Change: paths (with the symbols). Do not touch: paths.

## Build
Numbered steps. Interfaces as TypeScript (exact names and types). Constants with values.
Where the spec already defines a type, reference it instead of copying it.

## Tests (each names the bug it catches)
| Test file | Case | Bug it catches | Kind (N/B/E-CI) |

## Done when (exact commands; all must pass)
1. `pnpm check`
2. `pnpm gate <changed test files>`
3. Slice-specific commands with expected output (literal values).
4. CI-only checks (E): which job must be green on the draft PR (Opus pushes).

## Evidence
`.evidence/<ID>/evidence.md`: each command, exit code, output tail; numbers for Measures.

## Stop and ask Opus
Slice-specific triggers + the standard list (README).

## Out of scope
What a worker might be tempted to do but must not.
```

Haiku-model slices must be fully mechanical: every file, name and value given. Sonnet slices may
leave local design inside the spec to the worker. Opus slices are taste/UI/security-final work.

## 4. Spec files (docs/spec/)

Done: the 16 specs exist in `docs/spec/`.

## 5. Milestones and slices

Model: H = Haiku, S = Sonnet, O = Opus. Deps are within the book. Proof ids from PROOFS.md
(halves N/B/E). Budget = non-test lines (rough; brief writers refine).

### M0 Clean base (Opus-led; mostly ops)
Goal: main is green in CI, the open P1 review findings are fixed, the gate runner exists, the book is the plan.
| ID | Title | Model | Deps | Scope | Proofs/findings | Budget |
| M0-01 | Land the CI fix | O | – | push `ci-green-clean` (Matthias OK), PR #1 ready, merge; CI green on main | P72 (Linux part) | 0 |
| M0-02 | Merge startup robustness | S | M0-01 | rebase `slice/x5-robustness`, Windows handling of the chmod e2e (stated skip or injection), stop the tick after `app.exit(1)`; CI green; merge | R2-01, R2-02, R1-10, R1-12, R1-13 | ≤ 60 |
| M0-03 | Gate runner | S | – | `scripts/gate.ts` + `pnpm gate <files>`: 20 runs then 5 with all cores busy (node worker_threads burners), Vitest Node and browser configs, CI mode for e2e files, clear report | BD18 | ≤ 180 |
| M0-04 | E2E hygiene | S | M0-01 | no fixed ports/TOCTOU (port 0), unique evidence paths, bounded `application.close()`, drive.ts timeouts; Playwright projects (fixture, packaged, real, measure), the CI-only guard, label jobs (spec 16); archive `slice/t1-e2e` ideas | R3-04, R3-08 | ≤ 300 |
| M0-05 | Missing regression tests | S | M0-01, M0-03 | R3-01 child-frame IPC refusal (E, CI), protocol in-root dot-segment case, R3-03 chunk-store crash-mid-write + two stores, R3-06 coverage config for unimported files, R3-05 runtime test with a real tiny WASM | R3-01, R3-03, R3-05, R3-06 | ≤ 250 test |
| M0-06 | Repo hygiene | H | – | delete `apps/desktop/src/index.ts` (dead), drop unused `@moxi/gwkit` dep of desktop, one owner for `appId`, ignore `test-results/`, banner on `packages/sdk/README.md` ("replaced in M2; see docs/spec/08") | – | ≤ 30 |
| M0-07 | Archive old work | O | M0-01 | close probe PRs #2–#7, tag+delete probe branches, archive `slice/t1-e2e`, move old `.handoff` plans to `.handoff/archive/` (Matthias OK for remote parts) | – | 0 |
Gate: CI `check` + `e2e` green on main 3 runs in a row; `pnpm gate` works on one Node and one browser file; no open P1 finding.

### M1 Plugin contracts in Node (`@moxi/sdk/host`) [DESIGN step 2]
Goal: one catalog, manifest, element registry, codec, package format and page model, all pure TypeScript with tables of tests.
| M1-00 | Move the old SDK aside | H | M0 | move today's SDK to `packages/sdk/src/legacy` (entries `./legacy`, `./legacy/host`, `./legacy/testing`; ~30 import sites; lint rows until M6-03); add `pnpm lines` (`scripts/line-count.ts`, counted paths per spec 01 §4) | P79 (tool) | ≤ 120 |
| M1-01 | Capability catalog | S | M1-00 | facts (player, map, target, party, skills, progress, social, vitals; inventory entry gated BD15), actions (8 + `automation` + `chainable`), note, hub.search, net:, link:; ArkType schemas; describe/available/confirm/regions/minIntervalMs; `Unavailable`/`Refusal` unions; generated `Register` | P32, P52 (schema half) | ≤ 600 |
| M1-02 | Budgets module | H | M1-01 | `budgets.ts` constants from spec/05 incl. chain limits, one export | P14/P15 (constants) | ≤ 120 |
| M1-03 | Manifest v1 (P81 parse half) | S | M1-01 | schema + validation: commands (+ static game op or chain steps), hud, settings types, shortcuts grammar, permissions/optional, compiler floor, unknown fields ignored with warning; read-or-internet rule at parse | P34 (Node), P36 (table) | ≤ 400 |
| M1-04 | Element registry | S | M1-01 | registry for the step-7 element set (spec/09): props, events, since; generates TS types, decoder tables and docs table | P23 (model) | ≤ 500 |
| M1-05 | Op batch codec | S | M1-04, M1-02 | ops with registry indices, sign encoding for functions/intents/field refs, `PropValue`/`Row`, decoder used by membrane/applier/kit; shared batch corpus | P69 (N), P8 (decoder) | ≤ 450 |
| M1-06 | Package format | S | M1-03 | `.moxi` single JSON `{format, manifest, code}`, sha256 content address, caps, parse corpus | P61 (parse) | ≤ 250 |
| M1-07 | Page model and update decisions | S | M1-03 | `pageModel(manifest, grants)` exact texts (spec/12 incl. chains), `decideUpdate(old, new)` | P33 (model), P39 (table), P62 | ≤ 400 |
Gate: listed proofs green; `pnpm check`; budget table.

### M2 Worker runtime and SDK [step 3]
| M2-01 | Runtime renderer | S | M1-05 | Vue runtime-core custom renderer → op batches; send at the end of each Vue flush per (session, root) and on ack; last good tree on render error; prelude deletes `globalThis.Worker` and the RTC globals | P9 (N), P13 | ≤ 500 |
| M2-02 | Plugin sessions | S | M2-01 | module factory per session, per-session effectScope and timers cleared on close, facts per session, hub.items/answer | P10 (N) | ≤ 350 |
| M2-03 | Collections and backpressure | S | M2-01 | `ITEMS` keyed patches; one unacked batch per root; byte rate | P12 (N), P15 (N) | ≤ 300 |
| M2-04 | Composables | S | M2-02, M1-01 | useFact, useDoc, useSettings, useReference (reactive cache + async search), useFetch, useFeed, useNavigation, useToast, useNote; act(), field() | P13, P22 (types) | ≤ 400 |
| M2-05 | Test kit and sim | S | M2-04 | `@moxi/sdk/testing` (mountPlugin, openCommand, press, gameActions, hub.type, session(n), sim) on the real runtime, decoder, budgets; fixture reference tables | P14 (kit), P69 (kit) | ≤ 450 |
| M2-06 | Vite plugin | S | M2-05, M1-06 | `@moxi/sdk/vite`: compile gate, externals rewrite (fail on names the runtime lacks), capability check, generated types, pack, exact compiler pin + floor | P21, P22, P19 (setup) | ≤ 350 |
| M2-07 | Runtime bundle and boot | S | M2-01 | pruned `runtime-api1.js`, served at `moxi://app/plugin-host/code/<sha>.js` (corsEnabled), boot module text, `__moxi` keys; P11 Measure job (CI) | P11 (Measure), P19 | ≤ 250 |
Gate: P9 N, P10 N, P12 N, P13, P14 kit, P15 N, P19, P21, P22, P69 N; old SDK still works (no deletion yet).

### M3 Hub, elements, HUD [step 4]
| M3-01 | packages/hub | S | M2 | move Hub shell from `apps/game/src/hub` behind `HubPort`; contract suite moves with it; row-action shortcuts Hub-local; form-focus test | P25, Hub form-focus finding | ≤ 400 moved |
| M3-02 | Applier | S | M3-01, M1-05 | ops → host element tree with registry decoder; byte/retained budgets; seeded fuzz harness; lint ban `v-html`/`innerHTML` | P6, P12 (B), P15 (B), P69 (B) | ≤ 400 |
| M3-03 | Elements A: layout, views, content | S (+O taste) | M3-02 | Stack, Columns, Section, Divider, Tabs, Tab, List, Grid, Table, Detail, Form, Empty, Text, Heading, Badge, Icon, SkillBar, KeyValue, Progress, Countdown | P23, P28 | ≤ 1,100 |
| M3-04 | Elements B: inputs and actions | S (+O taste) | M3-02 | TextField, TextArea, NumberField, Select, Toggle, Slider, ColorField, KeyField, TagField, Button, GameAction, RequestAccess, Link; `field` binding; "Sent to <host>" chip | P31, P38 (B), P45 (B) | ≤ 800 |
| M3-05 | Drawing elements | S | M3-02 | Chart, Canvas, MapView draw lists, hit tests by shape id | P28 | ≤ 500 |
| M3-06 | HUD layer and panels | S (+O) | M3-03 | HUD anchors by name, Arrange HUD, panels floating inside the game window (OD4), toasts, attribution chips | P27 (B) | ≤ 500 |
| M3-07 | Action UI | S | M3-04 | confirm sheet, 500 ms descriptor guard, receipts, chain progress "2/4" and cancel, fed by a fake executor port | P41, P42, P45 (B) | ≤ 300 |
| M3-08 | PB8 frame-cost probe | S | M3-02 | fixture-busy client (10/12 ms per frame) + per-frame host timing harness; CI Measure | PB8 → P29/P30 setup | ≤ 250 |
Gate: P6, P23, P25, P27 B, P28, P31, P38 B, P41, P42, P45 B; PB8 recorded.

### M4 Main plugin services [step 5]
| M4-01 | Typed contracts | S | M0 | every IPC channel, Main→renderer event and port message in `packages/contracts` with ArkType schemas (spec/07); replace raw strings | P8 (contracts) | ≤ 500 |
| M4-02 | Registry and package store | S | M1-06, M4-01 | install records by install key, content-addressed store, bundled official index in app resources, Dev-only injection of non-official installs (BD22) | P18, P67 (bundled) | ≤ 450 |
| M4-03 | Documents by install key | S | M4-02 | migration 2, budgets, membrane coalescing results, list/delete | P58 | ≤ 250 |
| M4-04 | Grants, settings, layout stores | S | M4-02, M1-07 | grant store, effective grants (per install × game build), deny counts, setting values, HUD layout per account, pins/aliases, key bindings, action log ring of 100 | P35 (N), P36 (N), P38 | ≤ 450 |
| M4-05 | Plugin hosts | S (+O review) | M4-02 | hosts per `HostKey` (BD6) created with the first game window, host binding I7, restart, 768 MiB cap sampler (BD7), crash counts, `--no-plugins`, backgroundThrottling false | P7, P16, P17, P20 (Linux) | ≤ 500 |
| M4-06 | Partition hardening | S | M4-05 | in-memory partition, webRequest cancel, literal CSP (no `wasm-unsafe-eval`), device permission deny, sandbox refusal rule (NSpid/Seccomp/argv; ProcessMetric.sandboxed) | P2, P5 (Linux) | ≤ 250 |
| M4-07 | Action authority and activity | S (+O review) | M4-04 | `plugin.action.authorize` for intents and chains (BD1), QA allowlist hook, minIntervalMs, kill-switch hook, activity counts + log | P43 (N) | ≤ 350 |
| M4-09 | Membrane | S (+O review) | M4-05, M2-07 | `apps/plugin-host/src/membrane.ts` replaces `plugin-host.ts`: one worker per install, sessions, boot via the runtime URL, per-worker guard (`host/worker-guard.ts`), budgets first pass, host binding of messages | P15 (E), P16 | ≤ 350 |
| M4-08 | Chaos suite | S | M4-09 | chaos plugins (throw-render, throw-module, loop, never-ready, bad-batch, oom, byte-flood, retained-growth), forged-message script, 8 fixture packages, P77 flood Measure | P16, P17, P18, P7, P77 (Measure) | ≤ 400 test |
Gate: P2, P5 (Linux), P7, P8, P16, P17, P18, P20 (Linux), P35 N, P36 N, P38, P43 N, P58; P77 Measure recorded.

### M5 Game host and game side on the fixture [steps 6 + 12]
| M5-01 | fixture-world | S | M0 | generated memory structs + matching locator in `tools/fixture-client`; read counter; states login/character-select/in-world/loading; map kinds outpost/explorable/PvP; builds A and B with shifted offsets and one broken role | P49, P51, P52 (fixtures) | ≤ 500 |
| M5-02 | fixture-actions | H | M5-01 | exports that record calls with `inFlight` | P47 (fixture) | ≤ 120 |
| M5-03 | Per-account partitions | S | M4-01 | `persist:account-<id>` with its own `moxi` handler, IDBFS per partition, remove global `client`/`game`, data reset (BD9) | P75 | ≤ 350 |
| M5-04 | locate() off-thread | S | M5-01 | Main `worker_threads` per client generation, cached | P77 (locate half) | ≤ 200 |
| M5-05 | Safe point | S | M5-02 | track every function through the `WebAssembly.promising` seam; main loop by export name | P47 | ≤ 200 |
| M5-06 | Game state and sessions | S | M5-01, M4-05 | gwkit `gameState()`; Main issues `sid` (positive int, per run); session open/close to hosts and game renderer; sessions only in world | P10 (E), P51 | ≤ 300 |
| M5-07 | Fact publisher | S | M5-06, M1-01 | subscribed slices only, diff, typed arrays, per-session messages, regions gating, ≤ 20 Hz, internet hosts get none | P35 (E), P49, P52 | ≤ 400 |
| M5-08 | Action path and executor | S (+O review) | M5-07, M4-07, M3-07 | trusted press → intent → Main authorize → executor at safe point → effect observed → receipt; whisper/invite rules; chain executor (BD1); game.note path | P40, P43 (E), P44, P45 (E), P46, P37, P81, P84 | ≤ 500 |
| M5-09 | Main chord and shortcuts | S | M4-05 | Hub chord + plugin shortcuts in Main by physical key (PB9 rules), null menu on Windows/Linux, `sendInputEvent` e2e helper, recorded layout tables | P74 | ≤ 300 |
| M5-10 | Egress and code-gen proofs | S | M5-08 | chaos plugins egress/codegen, loopback listeners (port PB3 code), storage/channel pair | P1, P3, P4 | ≤ 300 test |
| M5-11 | Witness reads | S | M5-01 | `reads` in role specs, `gwkit-cli` helper, corpus tests on 7 builds | P50 | ≤ 300 |
Gate: P1, P3, P4, P10 E, P35 E, P37, P40, P44, P45 E, P46, P47, P49, P50, P51, P52, P74, P75; P77 locate.

### M6 Bundled plugins on the new SDK [step 7]
| M6-01 | Builds plugin | S (+O taste) | M5 | Build Library acceptance: SFC plugin, 10,000 builds, team apply via chain or host flow | P26, P14 (E) | ≤ 900 |
| M6-02 | Calculator and Target Distance | S | M5 | rebuilt as SFC plugins | P9 (E) | ≤ 300 |
| M6-03 | Delete the old SDK | S | M6-01, M6-02 | delete old SDK, node types, Blocks.vue, Icon.vue, dev harness third palette, tokens; `pnpm hub` on packages/hub + sim; R3-07 duplicates gone | P79 (lines) | negative |
| M6-04 | Frame-cost Measures and line budget | S | M6-03 | P29/P30 in CI (fixture-busy), line-count script, Opus review | P29, P30, P78, P79 | ≤ 150 |
Gate: P26, P14 E, P9 E, P78, P79; P29/P30 recorded.

### M7 Network, plugin pages, author path [steps 8 part, 9, 10]
| M7-01 | Net proxy | S | M4 | `node:https.request` + pinned lookup + fresh Agent; address rules (PB11); useFetch polling in Main | P54, P56 | ≤ 400 |
| M7-02 | Feeds | S | M7-01 | `ws` 8.22.0 with the same lookup; useFeed | P55, P57 | ≤ 250 |
| M7-03 | Trade Prices skeleton | S | M7-02 | internet-class plugin; proves no facts reach it | P34 (B) | ≤ 250 |
| M7-04 | Launcher Plugins section | S (+O taste) | M4-04, M1-07 | list, plugin page with exact texts (incl. chains), toggles, settings, Activity, Start without plugins | P33 (B), P38 | ≤ 600 |
| M7-05 | Dev folder installs | S | M7-04 | unverified host, reload, page badge | P70 | ≤ 250 |
| M7-06 | Author toolchain | S | M7-05, M2-06 | `create-moxi-plugin`, `moxi` CLI dev/check/build/pack, template CI lane | P68, P79 | ≤ 500 |
Gate: P33 B, P34 B, P54, P55, P56, P57, P68, P70.

### M8 Three-OS CI and packaging [step 11]
| M8-01 | Build matrix | S | M0 | `build.yml`: dmg, NSIS, `.deb` (+ AppImage built, not shipped), fuse read-back, postinst AppArmor check (BD11), Linux PR trigger | P71, P73 (setup) | ≤ 200 yaml |
| M8-02 | Nightly lanes | S | M8-01 | `nightly.yml`: Windows fixture e2e; real-client boot (no ArenaNet files in caches); macOS lane behind a repo switch | P20, P72 (Win), P76 | ≤ 150 yaml |
| M8-03 | Packaged Linux sandbox lane | S | M8-01, M4-06, M7-04, M7-05 | ubuntu-24.04 `dpkg -i`, `aa-status`, `/proc/<pid>/status` reader | P73, P5 (packaged) | ≤ 150 |
| M8-04 | Data roots per OS | H | M0 | `%LOCALAPPDATA%\Moxi`, XDG data/cache; `folders.ts` + tests | – | ≤ 60 |
Gate: P20, P71, P72, P73, P76.
**Review gate R1** after M8: Opus full-platform review (security model, budgets, line budget, proofs table complete); then **live session 1** with Matthias: PB18 read-only spike, then one action; HUD z-order; Hub feel (P48, P53).

### M9 Walking skeleton
Goal: Matthias plays a plain session on moxi instead of v1; the Dev app updates itself.
| M9-01 | Accounts | S | M5-03 | accounts in Main (create, edit, archive, remove, shortcuts, multi-open per account window); launcher bridge drops fixture ops | R1-05 | ≤ 450 |
| M9-02 | Credentials store | S | M9-01 | `safeStorage` async, Linux `basic_text` refused, never in logs/renderers; test greps captured output | – | ≤ 200 |
| M9-03 | Login engine and Dev login | S | M9-02 | host action fills the official login screen (fixture login screen in CI), cancel on player input, one attempt per launch; `pnpm dev --login` reads `~/.config/moxi-dev/login.env` (workers never read it) | old Q1 | ≤ 350 |
| M9-04 | Saved login | S | M9-03 | store, use, forget, change; automatic return after reload | old A2 | ≤ 250 |
| M9-05 | Game window basics | S | M5-03 | render scale, reload, relog, Cmd-Q flow, Show | old W2 | ≤ 300 |
| M9-06 | Input | S | M9-05 | keyboard layouts, Command/Ctrl rules, text editing, paste cleaning (tables per layout) | old I1 | ≤ 400 |
| M9-07 | Play without waiting | S | M0 | Play available at once with an active client; update check beside it; candidate for next session | old X7 | ≤ 150 |
| M9-08 | Game socket policy | S | M0 | report what v1 allows vs what ArenaNet uses; Opus decides; implement | R1-09, old X6 | ≤ 100 |
| M9-09 | Flight recorder | S | M5 | 1 Hz metrics ring (10 min), session ndjson in Dev, nothing leaves the machine | old Q2 | ≤ 350 |
| M9-10 | App updates | S | M8-01 | electron-updater, Dev/Beta/Stable, no downgrade, Dev identity | old U2 | ≤ 300 |
| M9-11 | Compat feed | S | M5-11 | ed25519-signed locator + kill switches, pinned key, local match fallback (facts on, actions off), `compat.yml`; proof: feed cannot add a capability (BD3) | old K1, P64 | ≤ 400 |
| M9-12 | Diagnostics export | S | M9-09 | player sees the content before sending; no secrets (test) | old D3 | ≤ 250 |
Gate: fixture journeys for each; live: Matthias plays a plain session (Matthias).

### M10 Dev QA loop
| M10-01 | moxi-dev MCP | S | M9-09, M4-07 | stdio MCP over the Dev app's CDP: observe, act on app UI, host actions only via Main's QA allowlist (AGENTS live rules) | old Q3 | ≤ 500 |
| M10-02 | Patch-day watcher | S | M5-11 | `pnpm compat:check` on a new ArenaNet build: locate + report | old Q4 | ≤ 250 |
| M10-03 | QA journeys | S (+O judge) | M10-01 | named journeys write screenshots, trace, facts timeline to `.evidence/qa/<journey>/`; login-to-outpost, Hub open/search/close | old Q5 | ≤ 300 |
Gate: each journey twice in a row on a live session (Opus with Matthias's account choice).

### M11 Game layer (live)
Every fact/action slice: role specs in `compat/roles/`, readers in `packages/gwkit/src/game/` under the witness rule, fixture-world structs, corpus tests, live check via MCP compared with the game screen.
| M11-01 | Reference data | S | M5 | skills, maps, items, professions, heroes; English names for wiki; source decided in the slice (v1 data + Gw.dat) | BD14 | ≤ 400 + data |
| M11-02 | Facts: player, map, target | S | M11-01, M10-01 | incl. characterKey, Guild Hall owned/at | old G1 | ≤ 400 |
| M11-03 | Facts: party | S | M11-02 | heroes, henchmen, builds; account heroes | old G2 | ≤ 300 |
| M11-04 | Facts: skills and effects | S | M11-02 | skill bar, recharge, effects on you | old G3 | ≤ 350 |
| M11-05 | Fact: vitals | S | M11-03 | BD2 fields; GWCA leads proven in WASM | OD3 | ≤ 300 |
| M11-06 | Fact: progress | S | M11-02 | unlocked outposts, missions, titles, skills | – | ≤ 300 |
| M11-07 | Fact: social and chat | S | M11-02 | friends, online/where, whispers received, chat participants | old G5, G6 | ≤ 400 |
| M11-08 | Actions: travel, builds, team, storage | S | M11-03 | executor ops + effect predicates; live travel and build apply | old G7 | ≤ 400 |
| M11-09 | Actions: whisper, invite, resign, call target, note | S | M11-07 | rules from spec/13; resign and call target live check by Matthias | old G7 | ≤ 350 |
| M11-10 | Chains live | S | M11-08 | chain journeys live (travel → team.apply) | OD2 | ≤ 150 |
| M11-11 | HUD anchors from game geometry | S | M11-04 | skill:1..8, effect:<id>, compass, target | Timers parity | ≤ 400 |
| M11-12 | Patches and 4 GB mode | S | M5-05 | declarative export-only patches, validation; 4 GB mode | old G8 | ≤ 350 |
| M11-13 | Inventory read (gated) | S | M11-02 | only if Matthias says yes (BD15) | Q7 | ≤ 300 |
Gate: every fact read live equals the game screen; every action live once; corpus witness on 7 builds.

### M12 Launcher, looks and settings
| M12-01 | Gw.dat reader | S | M0 | Rurik archive reader + ATEX decoder in TS, off Main's thread; UI textures and game-art icons (skills, items, professions, maps) to a rebuildable cache | old TX1, P59 rest | ≤ 600 |
| M12-02 | Looks model | O | M12-01 | Modern themes, Classic packs (Original, Minimalus), Back to defaults with Undo, settings storage | old L3 | – |
| M12-03 | Launcher shell | O | M12-02, M9-01 | Home, Play, accounts, search palette, setup, Appearance (mockup `../mockups/launcher-1.0`) | old L4 | – |
| M12-04 | News and Today data | S | M0 | v1 sources first, cached and dated, stale shown | old N1 | ≤ 300 |
| M12-05 | Today and News UI | O | M12-03, M12-04 | – | old L5 | – |
| M12-06 | Hub, HUD, panels in every look | O | M12-02, M3 | – | old L7 | – |
| M12-07 | Settings, shortcuts, appearance parity | S (+O) | M12-03 | one settings catalogue, rebinding with conflicts and capture, chat aliases | A17–A19 | ≤ 500 |
| M12-08 | Visual verify port | S | M12-03 | `verify/run.mjs`, `behavior.mjs` against the app via CI | old V1 | ≤ 250 |
| M12-09 | Icons | O | Matthias pick | `.icns`, Windows/Linux icons | old ICON | – |
Gate: launcher matches the mockup verify set in CI; Classic textures read from the player's own Gw.dat.

### M13 Parity
| M13-01 | Builds live | S | M11-08 | apply, team apply, live party, Hub rows | B01 | ≤ 500 |
| M13-02 | Travel (+Progress) | S | M11-08, M11-06 | destinations (199), favourites, recents per character, Guild Hall, friends | B02, B03 | ≤ 600 |
| M13-03 | Trade (+Calculators) | S | M7-03 | live feed, search, saved offers, trader prices and history; offline calculators; optional live rates | B04, B07 | ≤ 700 |
| M13-04 | People | S | M11-09 | whispers (session-only), people list, invite; travel and invite per BD27 | B05, B06 | ≤ 500 |
| M13-05 | Timers | S | M11-11 | cooldowns, key labels, effect timers, Reminders (alcohol deferred) | B11–B15 | ≤ 600 |
| M13-06 | Quick actions | H | M11-09 | Xunlai, Call Target, Resign with manifest shortcuts | B08, B17, B18 | ≤ 150 |
| M13-07 | Target Distance live | H | M11-02 | live facts, range bands | B10 | ≤ 80 |
| M13-08 | Elite skills | S | M11-06 | planner, filters, Hunt list, 925 locations, wiki links | B23 | ≤ 500 |
| M13-09 | Character switch and chat filters | S | M11-07 | host features | A15, B16 | ≤ 400 |
| M13-10 | Texture packs, cursor, double-click, render scale | S | M11-12 | host tweaks | A09, A10, A12, A13 | ≤ 600 |
| M13-11 | Controller and Steam sign-in | S | M9-06 | gamepad; Steam | A05, A07 | ≤ 400 |
| M13-12 | Template files | S | M11-02 | template-save repair, write template to game folder | A14 | ≤ 300 |
Gate: every keep row in parity.md passes its journey (live or sim per the coverage table), or Matthias dropped it.

### M14 Plugin sources (Obsidian-like)
| M14-01 | Signed plugin index | S | M7-04 | official + community index with seq, expires, withdrawals; Matthias-gated key; official updates move to the index | P60, P64, P65, P67 | ≤ 400 |
| M14-02 | GitHub repo installs | S | M14-01 | `moxi-release.json`, TOFU, repo-id check per real update, one check per day + Check now, allowlist, typed rate-limit error | P63 | ≤ 450 |
| M14-03 | Updates and withdrawals | S | M14-02 | escalation flow (incl. chain ops), withdrawals at once | P39 (E), P62 | ≤ 300 |
| M14-04 | Registry and deferred hardening | S | M14-01 | `gwasm-dev/moxi-registry` workflows with the untrusted build job split off, CPU burner search (halving), theme packages, PB16 reproducible packs | P24, P66, P16 (burner) | ≤ 600 |
| M14-05 | Public SDK docs and template | S (+O) | M7-06 | docs site/pages, template repo | P68 | ≤ 400 docs |
Gate: P39 E, P60, P62–P67; a GitHub plugin installs, updates and is withdrawn on the fixture servers.

### M15 Public Beta (needs M13; M14 runs alongside and is required for 1.0 Stable)
| M15-01 | macOS signing and notarization | S | M8-01 | Developer ID team 9NN976MFZ4 | old R-SIGN | ≤ 100 yaml |
| M15-02 | Windows signing | S | Matthias | Lupinum organization cert | old R-SIGN | ≤ 80 |
| M15-03 | Ship pipeline | S | M9-10 | `ship.yml`: versions from PR titles (git-cliff), Beta 1 click, Stable 1 approval; `docs/RELEASING.md` | old R-SHIP, DOC1 | ≤ 200 |
| M15-04 | Import from v1 | S | M13 | builds, favourites, texture packs (macOS) | old R-IMP | ≤ 300 |
| M15-05 | v1 notice and archive | O | M15-03 | final v1 release with the notice, archive v1 (Matthias publishes) | old R-V1 | – |
Gate: signed builds on 3 systems; Beta channel live (Matthias).

### Later (after Beta, not briefed in detail; one-paragraph slices)
Maps (compass ranges first, then exploration grid), Quick Item Move, alcohol timer, `skill used` event fact, macOS CI lane if minutes allow, Trusted Types (PB12), Hub panel view (PB17).

## 6. New proofs (append after P79 in docs/build/proofs.md)
- P80 Compat feed cannot add a capability, fact or action (BD3). Gate, N. Owner M9-11.
- P81 Chains: one press runs ≤ 8 chainable steps in order; stops at first failure; refused outside outposts; player input cancels; no step runs without the press; page lists steps. Gate, N + E. Owner M5-08 (fixture), M11-10 (live).
- P82 `game.vitals`: schema, regions withheld in PvP/loading, per-agent keyed by map-load generation; display only (no code path to actions — static import check is a lint rule, not a test). Gate, N/E. Owner M1-01 (schema), M5-07 (fixture), M11-05 (live).
- P84 game.note rate: 1 per second per (install, window), 8 queued, overflow refused `rate`. Gate, N + E. Owner M5-08.
- P83 Catalog admission: every action entry has `automation: "quality-of-life"`; a denylist of combat/economy op names cannot be added (type + test table). Gate, N. Owner M1-01.
Amend P40 ("executor calls = presses") to "= presses, or chain steps of one press".
