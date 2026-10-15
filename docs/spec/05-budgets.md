# 05 Budgets

Every runtime limit on plugin code, plugin hosts and plugin traffic: its value, the process that
enforces it, and what happens on a breach. Other specs name a budget by its key
(`budgets.wire.batchBytes`), never its value. Design targets fixed before measuring (memory per
worker, P12, P23, P78, P79): [spec 01 §1.6 and §4](01-foundations.md).

## 1. Rules in force

1. One file, `packages/sdk/src/host/budgets.ts`, holds every limit in section 3 and exports
   `budgets`, re-exported by `@moxi/sdk/host` ([spec 02](02-packages-and-boundaries.md)). The
   membrane, game renderer, Main, runtime and test kit import it; no other file declares a
   section 3 value.
2. A budget truncates, holds or refuses with a typed reason; it never stops a plugin for size.
   Only protocol faults stop a worker: no `ready`, no pong, a message flood, a second unacked
   batch on a root, 3 refused batches in 10 s, a malformed batch, 20 errors in a minute (crash
   kinds: `CrashKind`, [spec 07](07-wire-and-ipc.md)).
3. The authority is a process the plugin cannot write to: the game renderer or Main. The membrane
   checks first, for fast failure and attribution; after a plugin-host exploit only the authority
   holds: the game renderer bounds a flood (one unacked batch per root, the batch caps, the
   retained cap) and Main bounds the host (memory cap in 3.5, `render-process-gone`:
   [spec 03](03-plugin-hosts-and-lifecycle.md)). The runtime may merge or pre-truncate, never as
   enforcement.
4. The test kit applies the same constants with the same outcomes (P14), through the shared
   retained tree (`host/tree.ts`, [spec 07](07-wire-and-ipc.md)).
5. Scope is per install unless a row says otherwise; "per session" = per install and plugin
   session (spec 01 §2).
6. Rates use the token bucket (2.2). Every enforcer takes its clock as a parameter (fake in tests).
7. Character counts are UTF-16 units (`string.length`). Truncation keeps the first `n - 1` units,
   never splits a surrogate pair and appends `…` (U+2026): at most `n` units. `note.chars` and `crash.detailChars` cut
   with `...` (3 ASCII dots) instead, still at most `n`.
8. Op byte budgets use wire size (2.3); documents, code and packages use UTF-8 bytes.
9. Budgets are not settings. From 1.0.0 a plugin-visible budget may rise within `api: 1`; lowering
   one can break published plugins and needs Matthias's OK (AGENTS "Players depend on this").

## 2. Types and shapes

### 2.1 `budgets.ts`

```ts
// packages/sdk/src/host/budgets.ts: one object per key prefix of section 3
const KiB = 1024;
const MiB = 1024 * KiB;
export const budgets = {
  view: { nodesPerRoot: 2_000, rowsPerCollection: 10_000 /* , …rest of 3.1 */ },
  // then wire, worker, crash, host, hub, install, facts, docs, reference, net, feed, note, code,
  // dist, compat, settings, manifest, activity
} as const;
```

Keys follow the table order of section 3, values exactly as in the Value column (`2_000`,
`256 * KiB`); a row with several keys lists the values in the same order. Suffixes: `Ms`
milliseconds, `Bytes` bytes, `Chars` UTF-16 units, `PerSecond` / `PerMinute` a rate.

### 2.2 Token bucket

```ts
// packages/sdk/src/host/bucket.ts: the one rate helper (membrane, Hub, Main); `now` in milliseconds
export function createBucket(capacity: number, perSecond: number, now: () => number): {
  take(cost?: number): boolean; // cost defaults to 1
  waitMs(cost?: number): number; // 0 when take(cost) would pass now
};
```

- The bucket starts full and refills `perSecond × elapsed seconds`, up to `capacity`. `take(cost)`
  passes when tokens ≥ `min(cost, capacity)`, then subtracts `cost`; only a cost above the capacity
  takes tokens below 0, so one oversized batch still passes after a full refill.
- "Holds" in section 3 = the caller waits `waitMs(cost)` and tries again. "Refuses" = the call
  fails at once with the stated reason.
- Example, `net` (capacity 10, 1 per second): 10 requests at t = 0 pass, the 11th is refused, one
  more passes at t = 1 s.

### 2.3 Wire size

`wireSize(value)` has one definition, in the codec ([spec 07](07-wire-and-ipc.md)); typed arrays
count by `byteLength` as typed bytes. A batch's size is the sum over its ops; a row's size is the
wire size of its `Row` plus its typed bytes.

## 3. Budgets in `budgets.ts`

"Applier (+ membrane)" = the applier is the authority and the membrane checks first.

### 3.1 Views and collections

| Key | Value | Authority | On breach |
| --- | --- | --- | --- |
| `view.nodesPerRoot` | `2_000` | applier (+ membrane) | A collection counts as 1 node. The root shows the host panel "This view is too large to show" until it is closed; the plugin keeps running |
| `view.rowsPerCollection` | `10_000` | applier | Keeps the first 10,000 rows in order; a host row "N more not shown" (N with thousands separators) |
| `view.rootsPerSession` | `32` | Hub (+ membrane) | Open views and panels per session (HUD roots count under `install.hudWidgetsOn`). A `push` beyond it is ignored with a dev warning |
| `view.titleChars`, `view.textChars` | `200`, `4_000` | applier | Truncated (rule 7). Spec 09 marks each string prop `title` or `text`; every other string uses the title cap |
| `view.sceneShapes`, `view.sceneTypedBytes` | `20_000`, `4 * MiB` | applier | The scene (`Canvas`, `Chart`, map layer) shows a placeholder |

### 3.2 Wire toward the game renderer

| Key | Value | Authority | On breach |
| --- | --- | --- | --- |
| `wire.batchBytes`, `wire.batchTypedBytes` | `256 * KiB`, `4 * MiB` | applier (+ membrane) | Batch refused (not applied); the membrane counts it |
| `wire.maxDepth` | `32` | applier (+ membrane) | Nesting depth of a wire value; the encoder ([spec 06](06-worker-runtime.md)) and the decoder (spec 07) use it. Deeper: `malformed` |
| `wire.refusedBatches`, `wire.refusedWindowMs` | `3`, `10_000` | membrane | That many refused batches within the window: crash `batch` |
| `wire.unackedPerRoot` | `1` | membrane; applier | Membrane: a second unacked batch on a root is a crash (`batch`). Applier: drops it and counts a host fault. The runtime merges later ops while it waits |
| `wire.itemsChunkBytes` | `256 * KiB` | runtime | A large first `ITEMS` upsert goes in chunks of at most this size, one per ack |
| `wire.bytesPerSecond`, `wire.burstBytes` | `1 * MiB`, `4 * MiB` | membrane | Refill and capacity of the byte bucket per install and game window. Holds (waiting, not a crash) |
| `wire.hudBytesPerSecond` | `256 * KiB` | membrane | HUD roots have their own bucket (capacity = this value) and also take from the install bucket. Holds |
| `wire.retainedBytes`, `wire.retainedRowBytes` | `8 * MiB`, `8 * KiB` | applier | Per session, all roots: rows beyond the byte cap, and any row larger than the row cap, are not kept; the host shows "N more not shown" |
| `wire.messagesPerSecond`, `wire.floodSeconds` | `1_000`, `3` | membrane | More than `messagesPerSecond` in each of `floodSeconds` consecutive whole seconds: crash `flood` |
| `wire.applyMsPerFrame` | `1` | applier | Stops applying for this frame; the rest waits for the next frame |

### 3.3 Worker lifecycle

| Key | Value | Authority | On breach |
| --- | --- | --- | --- |
| `worker.readyMs` | `5_000` | membrane | Worker terminated; its views show "<name> could not start"; crash `start` (a throw while the module loads is charged the same) |
| `worker.pingMs`, `worker.pongMs` | `1_000`, `2_500` | membrane | Ping interval; no pong for `pongMs`: worker terminated; "<name> stopped responding"; crash `hang` |
| `worker.lateTickMs` | `500` | membrane | A watchdog tick that runs this late gives no verdict (a stalled host thread, such as a garbage-collection pause) |
| `worker.idleStopMs` | `300_000` | membrane | An unused worker stops ("unused": [spec 06](06-worker-runtime.md)); its state comes back from documents |
| `worker.errorsPerMinute` | `20` | membrane | 20 render or handler errors within 60 s count as one crash (`errors`) |

### 3.4 Crash policy

| Key | Value | Authority | On breach |
| --- | --- | --- | --- |
| `crash.limit`, `crash.windowMs` | `3`, `600_000` | Main | That many crashes of one install within the window: the install is turned off, persisted; the page shows "Turned off after 3 crashes" and "Turn on again". That many crashes of one host within the window: the host is paused for this app run; the Hub shows "Plugins paused" and "Start plugins" |
| `crash.detailChars` | `200` | Main | `plugin.crashed.detail` ([spec 07](07-wire-and-ipc.md)) is cut with `...` (rule 7) |

### 3.5 Plugin hosts

| Key | Value | Authority | On breach |
| --- | --- | --- | --- |
| `host.max` | `6` | Main | One host per host key; never more by construction (spec 01 §3) |
| `host.memoryCapBytes` | `768 * MiB` | Main | Host killed and restarted; one crash charged to the host, none to an install. The Hub shows "Plugins are restarting". Metric per OS: spec 03 |
| `host.memorySampleMs`, `host.cpuSampleMs` | `500`, `2_000` | Main | Sample intervals (CPU: `app.getAppMetrics()`) |
| `host.cpuShareOfCore`, `host.cpuWindowMs` | `0.5`, `10_000` | Main | Above the share for the window (5 samples in a row): one log line and one `cpu` event in Activity for each running install of that host; no stop. The next event for that host needs a sample below the share first |

### 3.6 Hub, toasts and actions (game renderer)

| Key | Value | Authority | On breach |
| --- | --- | --- | --- |
| `hub.itemsPerSession` | `2_000` | Hub | Ranks over the first 2,000 items; dev warning |
| `hub.answersPerQuery`, `hub.queryDeadlineMs` | `50`, `150` | Hub | Extra answers are dropped; answers after the deadline are ignored |
| `hub.descriptorGuardMs` | `500` | Hub | A press on a game control whose descriptor changed within this time opens the host confirm sheet instead of running |
| `hub.confirmArmingMs` | `400` | Hub | The confirm sheet ignores presses for this time after it opens, so a held or repeated Enter cannot confirm it |
| `hub.doubleClickGuardMs` | `700` | Hub | A double-click runs a row's primary action only when the row is selected and has been visible this long ([spec 10](10-hub-hud-panels.md) H6) |
| `hub.marks`, `hub.phraseChars` | `64`, `64` | Main (`hub.marks.save`) | More marks in one save, or a longer search phrase: the save is refused (`invalid`), nothing changes ([spec 12](12-consent-grants-and-updates.md)) |
| `hub.maxOffset` | `16_384` | Main | Largest absolute value of a placement or mark coordinate or size (`x`, `y`, `dx`, `dy`, `w`, `h`): refused at the Main edge, nothing changes ([spec 10](10-hub-hud-panels.md)) |
| `hub.toastIntervalMs`, `hub.toastsVisible`, `hub.toastMs` | `2_000`, `3`, `3_800` | Hub | One toast per install per interval; a newer toast replaces the waiting one (at most one waits). Past `toastsVisible`, the oldest is removed. `toastMs` is the lifetime; toast text is cut at `view.titleChars` |

### 3.7 Install surfaces, chains and facts

| Key | Value | Authority | On breach |
| --- | --- | --- | --- |
| `install.hudWidgetsOn` | `8` | Main (`hub.hud.on`) | More stay off; the page says "At most 8 HUD widgets of one plugin can be on" |
| `install.shortcuts` | `4` | Main (binding store) | At most 4 manifest shortcut suggestions are assigned, chain commands included; the rest stay unbound (the player can bind them). Row-action shortcuts do not count ([spec 11](11-input-and-shortcuts.md)) |
| `install.chainSteps` | `8` | manifest parser | Manifest error "A chain has at most 8 steps" |
| `install.requestDenials` | `2` | Main (grant store) | After 2 denials the access sheet no longer opens; the row says "Change this in the plugin page" (P38, spec 12) |
| `facts.maxHz` | `20` | fact publisher | Never publishes a slice more often; per-fact rates in 4.1 |

### 3.8 Documents and reference data (Main)

| Key | Value | Authority | On breach |
| --- | --- | --- | --- |
| `docs.docBytes` | `1 * MiB` | Main | UTF-8 bytes of the JSON text. `DocWriteReply` ([spec 14](14-main-data-and-network.md)) `{ ok: false, reason: "quota" }` |
| `docs.count`, `docs.totalBytes` | `256`, `5 * MiB` | Main | Same, for a new document over the count, or a write that takes the install total (all scopes and accounts) over the byte cap |
| `docs.writesPerSecond`, `docs.writeBytesPerSecond` | `10`, `1 * MiB` | Main | Bucket capacities equal the values. `{ ok: false, reason: "rate" }` |
| `docs.readsPerSecond` | `20` | Main | Bucket capacity 20. Refused: `rate` |
| `docs.coalesceMs` | `250` | membrane | At most one write per document per interval leaves the host: the last one. A superseded `set()` resolves with the result of the write that was sent ([spec 07](07-wire-and-ipc.md)) |
| `docs.nameChars` | `128` | Main; runtime | `useDoc` throws a `TypeError` at the call; Main refuses the request as malformed |
| `reference.queriesPerSecond` | `20` | Main | Bucket capacity 20. Typed refusal `rate` |
| `reference.pageRows` | `50` | Main | A query returns at most 50 rows per page; `RefSearch.offset` asks for the next |
| `reference.defaultRows` | `20` | SDK (default, not a limit) | `RefSearch.limit` when the plugin gives none ([spec 08](08-sdk-and-toolchain.md)); at most `reference.pageRows` |

### 3.9 Network and feeds (Main)

Refusal names (`rate`, `too-large`, `timeout`, `redirect`) are `NetErrorKind` of
[spec 08](08-sdk-and-toolchain.md).

| Key | Value | Authority | On breach |
| --- | --- | --- | --- |
| `net.requestsPerMinute`, `net.burst` | `60`, `10` | Main | Per install: refill `requestsPerMinute / 60` per second, bucket capacity `burst`. Refused: `rate` |
| `net.inFlight` | `2` | Main | A third concurrent request: `rate` |
| `net.responseBytes` | `4 * MiB` | Main | Response aborted: `too-large` |
| `net.timeoutMs` | `10_000` | Main | One deadline for DNS, connect, redirects and body: `timeout`. Also the WSS handshake deadline, DNS included |
| `net.redirects` | `3` | Main | Same host only; more: `redirect` |
| `net.pollFloorMs` | `60_000` | Main | `useFetch(url, { every })` polls at `max(every, 60 s)`, once per (install, URL) |
| `net.cacheBytes` | `8 * MiB` | Main | In-memory `max-age` cache per install, keyed by (install, URL); the oldest entry leaves first |
| `feed.perInstall` | `2` | Main | A third feed URL: status refused (`rate`) |
| `feed.messageBytes` | `64 * KiB` | Main | `ws` `maxPayload`: the socket closes (1009) and reconnects with backoff |
| `feed.messagesPerSecond` | `50` | Main | Per install, bucket capacity 50. Extra messages dropped and counted in Activity |
| `feed.keptMessages` | `100` | runtime | `useFeed().messages` keeps the newest 100 |
| `feed.backoffMinMs`, `feed.backoffMaxMs`, `feed.backoffResetMs` | `1_000`, `60_000`, `60_000` | Main | Reconnect waits 1, 2, 4 … s up to the longest wait; a socket that stayed open for the reset time resets the backoff |
| `feed.pingMs`, `feed.pongMs` | `30_000`, `10_000` | Main | Ping interval; no pong in time: socket terminated, reconnect with backoff |
| `feed.compatBytes`, `feed.indexBytes` | `1 * MiB`, `4 * MiB` | Main | Signed feed files ([spec 15](15-distribution-and-compat.md) §6): compat feed and plugin index. Larger: the fetch fails `too-large` |
| `feed.fetchMs` | `30_000` | Main | One deadline per signed feed fetch: `timeout` |

### 3.10 Notes (Main)

| Key | Value | Authority | On breach |
| --- | --- | --- | --- |
| `note.perSecond`, `note.queued` | `1`, `8` | Main | Per install and game window (bucket capacity 1). Extra notes wait in order; a note that finds `queued` waiting is refused (`rate`) and counted in Activity (P84) |
| `note.chars` | `120` | Main | Cut with `...` (rule 7); the game's chat line holds 120 characters |

### 3.11 Code, packages, distribution and manifest

| Key | Value | Authority | On breach |
| --- | --- | --- | --- |
| `code.codeBytes`, `code.manifestBytes` | `1 * MiB`, `64 * KiB` | `moxi build`; Main | UTF-8 bytes of `index.js` (`MoxiPackage.code`) and of the serialized manifest. Build error; install refused |
| `code.packageBytes` | `2 * MiB` | `moxi pack`; Main | File bytes, checked before `JSON.parse`; a download stops at this size; the row shows "Can't load: the package is too large" |
| `code.jsonDepth` | `32` | Main | Package refused |
| `code.downloadMs` | `30_000` | Main | Install fails: "Download timed out" |
| `code.previousPackages` | `1` | Main | Exactly one previous package per install is kept for "Use previous version" |

Distribution and compat limits ([spec 15](15-distribution-and-compat.md) §10 cites each key):

| Key | Value | Authority | On breach |
| --- | --- | --- | --- |
| `dist.redirects` | `4` | Main | Redirects per distribution request (spec 15 §9.5); more: the request fails |
| `dist.sigBytes` | `1 * KiB` | Main | A `.sig` file; larger: refused |
| `dist.manifestSlackBytes` | `8 * KiB` | Main | `moxi-release.json` ≤ `code.manifestBytes` plus this; larger: refused |
| `dist.apiBodyBytes` | `256 * KiB` | Main | A GitHub API response body (deadline `code.downloadMs`); larger: refused |
| `dist.devDebounceMs` | `100` | Main | Dev folder: wait after a `plugin.moxi` change before reading it |
| `dist.indexValidityDays` | `30` | publish workflow | Plugin index `expires` = `issued` + this |
| `dist.checkHours` | `6` | Main | Plugin index fetch interval (from M14) while automatic checks are on |
| `dist.githubCheckHours` | `24` | Main | GitHub update check: at most 1 per repo per this interval (stored last-check time), plus "Check now" |
| `compat.reasonChars` | `200` | Main | `CompatFile` kill-switch `reason`, 1 to this many characters; longer: the whole file is refused |

The manifest parser enforces these `manifest.*` bounds; a breach is a manifest error, and
[spec 04](04-catalog-and-manifest.md) §8.2 and §8.5 own which field each bounds and the lower bounds.

| Kind | Keys and values |
| --- | --- |
| Text length (`Chars`) | `nameChars` `40`, `descriptionChars` `200`, `authorChars` `60`, `reasonChars` `120` (reason text of `permissions` and `optional`), `titleChars` `60` (command and HUD widget titles, setting labels), `repositoryChars` `200`, `subtitleChars` `120`, `keywordChars` `30`, `detailChars` `200`, `groupChars` `40`, `unitChars` `12`, `optionLabelChars` `60` |
| Count | `scopes` `4` (`hub.scopes` words), `permissionKeys` `32` (in `permissions` and in `optional`, each), `commands` `32`, `keywords` `8` (per command), `hudWidgets` `16`, `settings` `32`, `options` `50` (`select`, `multi`) |

Setting value bounds ([spec 04](04-catalog-and-manifest.md) §8.5 owns the fields; [spec 12](12-consent-grants-and-updates.md) §6.1 checks values):

| Key | Value | Authority | On breach |
| --- | --- | --- | --- |
| `settings.textChars` | `200` | manifest parser; Main | `text` setting `maxLength`: cap and default. Above the cap: refused at manifest parse; a stored value above it is refused |
| `settings.listItems` | `50` | manifest parser; Main | `list` setting `maxItems`: cap and default. Same outcome |
| `settings.itemChars` | `100` | manifest parser; Main | Length of one `list` item. Same outcome |

### 3.12 Activity (Main)

| Key | Value | Authority | On breach |
| --- | --- | --- | --- |
| `activity.actions` | `100` | Main | Ring of the last 100 actions with results ([spec 12](12-consent-grants-and-updates.md)) |
| `activity.days` | `30` | Main | Day counts and crash rows older than 30 days are deleted at app start |
| `activity.flushMs` | `10_000` | Main | Buffered counts are written in one transaction this often while counts wait, before a read and at quit (spec 14) |

## 4. Values kept outside `budgets.ts`

### 4.1 Per catalog id

These numbers sit in each catalog entry, so adding a fact or an action stays within 3 production
files (P78). [Spec 04](04-catalog-and-manifest.md) owns the fields;
[spec 13](13-game-actions-chains-facts.md) owns the effect predicates.

- `rateHz`: `game.player` 20, `game.map` 10, `game.target` 20, `game.party` 1, `game.skills` 10,
  `game.progress` 1, `game.social` 10, `game.vitals` 10, `game.inventory` 1 (only if Matthias
  approves it, Q7).
- `minIntervalMs` / `effectTimeoutMs`: `game.travel` 5_000 / 60_000, `game.builds.load` 1_000 /
  5_000, `game.team.apply` 5_000 / 30_000, `game.storage.open` 1_000 / 5_000, `game.whisper`
  1_000 / 5_000, `game.party.invite` 2_000 / 5_000, `game.resign` 5_000 / 5_000,
  `game.target.call` 1_000 / 5_000.
- `minIntervalMs`: Main refuses with `rate` an intent whose op the same install started in the
  same plugin session less than `minIntervalMs` ago. Steps of one chain do not count against each
  other; each step's start counts for later presses.
- `effectTimeoutMs`: from the executor call to the observed effect. No effect in time: `failed`;
  a chain stops at that step. The travel value covers the loading screen.

### 4.2 Host display thresholds

`Countdown` and `HudCountdown` ([spec 09](09-elements-and-theme.md)) tick in the host from
game-clock deadlines: one decimal below 3 s; whole minutes at 99 s and above; warning tone below
5 s; danger tone below 2 s. The constants live in the components.

### 4.3 Main schedules ([spec 15](15-distribution-and-compat.md))

| Schedule | Value |
| --- | --- |
| Compat feed fetch | at app start, then every 30 min |
| Plugin index fetch (from M14) | at app start, then every `dist.checkHours` while automatic checks are on |
| GitHub update check (from M14) | at most 1 per repo per `dist.githubCheckHours` (stored last-check time), plus "Check now" |
| GitHub API calls | 1 per add, 1 per real update, 0 per check |
| Signed GitHub download URL | used within 5 min of resolving; never cached or persisted; a retry resolves it again |
| Signed feed files | compat feed ≤ `feed.compatBytes`, plugin index ≤ `feed.indexBytes`, `feed.fetchMs` per fetch |

### 4.4 Measures

Measures run in CI only, median of 5 runs, and never block a merge; Opus applies the rule
(`docs/build/README.md`). Design targets (P11, P29 with the Hub closed, P77 floods): spec 01 §1.6.
The other thresholds:

| Measure | Threshold | Proof | If over |
| --- | --- | --- | --- |
| Added host time per frame, Hub open and scrolling 1,000 rows | p99 ≤ 4 ms | P29 | batch HUD applies into one task per frame with a 1 ms cap; still over: run PB17 |
| Game frames during the P29 runs | count within 1 % of no plugins; 0 frames over 50 ms caused by host scripts | P29 | same |
| Fact read and publish per tick at 1,000 agents | p99 ≤ 0.25 ms | P29 | Opus review |
| Hub key down to painted selection, `fixture-busy` at 12 ms per frame | p95 ≤ 50 ms | P30 | run PB17 |
| Main event-loop delay during `locate()` | p99 ≤ 20 ms | P77 | Opus review |
| Plugin host restart after a crash | ≤ 2 s | P17 | Opus review |
| Game frame rate during each chaos plugin | within 1 % of the no-plugin run | P16 | Opus review |
| Dev folder: `dist/plugin.moxi` change to restarted worker | ≤ 1 s | P70 | Opus review |

### 4.5 Code budgets

Counted lines, groups and caps (5,000 plus ≤ 2,500 for `packages/ui/src/elements`): spec 01 §4
(P79); production files per fact, action or element: spec 01 §4 (P78). `pnpm lines`
(`scripts/line-count.ts`, M1-00) prints them. Slice budgets are ceilings: the brief states its line
budget; above 120 % needs an Opus design review before merge; test lines stay at or below product
lines.

## 5. Decisions

| Decision | Reason | Rejected |
| --- | --- | --- |
| One file, one export, for every limit on plugins and hosts (manifest, package and distribution bounds included) | membrane, applier, kit and Main agree by construction | a limits table per process |
| Truncate, hold or refuse; stop a worker only on protocol faults | a large library must degrade, not die (Builds stops at 181 builds today) | stopping the plugin on size |
| The authority is the game renderer or Main; the membrane is a first pass | plugin code shares the runtime's realm; a host exploit owns the membrane | membrane or runtime alone |
| Per-catalog-id numbers live in the catalog entry | a new fact stays at 3 production files (P78) | per-id maps in `budgets.ts` |
| Token buckets; debt only for a cost above the capacity | deterministic on a fake clock; a batch bigger than the burst still moves | sliding windows (more state, edge cases) |
| Package file ≤ 2 MiB | manifest ≤ 64 KiB, code ≤ 1 MiB and JSON escaping; keeps `JSON.parse` on Main short (P77) | 8 MiB |
| Host memory cap 768 MiB on every OS, sampled every 500 ms, charged to the host | a worker's V8 out-of-memory kills its whole host; a bomb passes 1 GiB within 0.5–1.6 s; Main cannot tell which install grew | a cap on Windows only; charging a guessed install |
| High CPU in 1.0: log and Activity, no stop | stopping workers one by one fails with 3 or more healthy workers and a lying busy hint | restarting the whole host (takes healthy HUDs down) |
| A chain has at most 8 steps; its shortcut counts in the 4 | bounds what one press can do; real chains need 2 to 4 steps | no step cap; chain shortcuts outside the cap |
| Host pause counts per host | one group's crashes must not pause another group | per trust tier |
| Network rate per install; cache per (install, URL) | a per-URL rate multiplies with the number of URLs | rate per (install, URL) |

## 6. Today in code (main 848fb6e) and what changes

| Today | Where | Becomes |
| --- | --- | --- |
| `pluginLimits`: 500 items in total (catalog, query results, list views); over: crash "Published too many items" | `apps/plugin-host/src/worker-messages.ts:5-14`, `apps/plugin-host/src/plugin-host.ts:502-514` | `view.rowsPerCollection`, `hub.itemsPerSession`; truncate |
| Nodes 2,000, strings 4,000, values 16,000, depth 64 per message; over: crash "Sent an invalid or oversized message" | `worker-messages.ts:7-8,12-13,152-170,158-162` | `view.nodesPerRoot`, `view.textChars`, `view.titleChars` (host panel or truncation); `wire.batchBytes` and `wire.maxDepth` bound a batch (spec 07) |
| 500 messages in a rolling second: crash | `worker-messages.ts:9`, `plugin-host.ts:246-251` | `wire.messagesPerSecond` for `wire.floodSeconds` |
| Open views 32, HUD widgets 32: crash | `worker-messages.ts:10-11`, `plugin-host.ts:113,412,558` | `view.rootsPerSession` (push ignored); `install.hudWidgetsOn` 8 (rest stay off) |
| Watchdog: ping 1,000 ms, stop after 2,500 ms; any message counts as a pong; no late-tick skip | `plugin-host.ts:149-163` | `worker.pingMs`, `worker.pongMs`, `worker.lateTickMs` |
| 3 crashes in 600,000 ms disable a plugin, in memory per game window | `plugin-host.ts:296-303` | `crash.*`, persisted by Main per install, and per host |
| Toasts live 3,800 ms, no rate or visible cap; activation tokens expire after 3,000 ms | `plugin-host.ts:187-197,333-341,370` | `hub.toast*`; tokens deleted: freshness is structural (spec 13) |
| Manifest name 40, description 200, command title 60, setting label 60 | `packages/sdk/src/manifest.ts:103,111,139,176` | `manifest.*` (adds author, reason, scopes and the schema bounds of spec 04) |
| Documents: no size, count or rate limit | `apps/desktop/src/storage/documents.ts`, `apps/desktop/src/plugin-documents.ts` | `docs.*` in Main |
| No memory or CPU sampling of the plugin host; `render-process-gone` handled for game windows only | `apps/desktop/src/shell/main.ts:181` | `host.*`, `crash.*` (spec 03) |
| Plugin code size printed, never checked | `scripts/build-plugins.ts:43-49` | `code.*` |
| No ready deadline, idle stop, byte rate, retained cap, network, feed or note limit | – | the rows of section 3 |

`pluginLimits` and its crash paths go away when the membrane switches to `budgets`. Review checks
that no second limits table remains.

## 7. Built by

| Slice | Builds from this spec |
| --- | --- |
| M1-02 | `budgets.ts` (2.1, section 3) and `bucket.ts` (2.2), with a fake-clock table test for `createBucket` (bugs: an oversized cost never passes; refill above capacity) |
| M1-03 | `install.chainSteps`, `manifest.*`, `code.manifestBytes` at parse |
| M1-05 | `wire.batchBytes`, `wire.batchTypedBytes`, `wire.maxDepth` in the decoder (`wireSize`: spec 07) |
| M1-06, M2-06 | `code.packageBytes`, `code.codeBytes`, `code.jsonDepth` (M1-06); `code.codeBytes`, `code.packageBytes` as build errors (M2-06) |
| M2-01, M2-03 | error reports for `worker.errorsPerMinute`; `wire.unackedPerRoot`, `wire.itemsChunkBytes`, the byte buckets, `wire.messagesPerSecond`; `wire.maxDepth` in the encoder |
| M2-04, M2-05 | `feed.keptMessages`, `docs.nameChars` in the runtime; the kit applies section 3.1, 3.2 and `hub.itemsPerSession` with host outcomes |
| M3-01, M3-02, M3-05 | `hub.itemsPerSession`, `hub.answersPerQuery`, `hub.queryDeadlineMs`, `hub.doubleClickGuardMs`; applier rows of 3.1 and 3.2; scene caps |
| M3-06, M3-07 | `install.hudWidgetsOn`, `hub.toast*`; `hub.descriptorGuardMs`, `hub.confirmArmingMs` |
| M4-03, M4-04 | `docs.*`; `activity.*`; `hub.marks`, `hub.phraseChars`, `install.requestDenials` |
| M4-05, M4-07, M4-09 | `crash.*`, `host.*` (M4-05); `install.shortcuts`, `minIntervalMs` (M4-07); `worker.*` and the membrane's checks, the rows marked "+ membrane" (M4-09) |
| M5-07, M5-08 | `facts.maxHz` and `rateHz`; `effectTimeoutMs` and the chain step cap at run time |
| M7-01, M7-02, M11-01, M11-09 | `net.*`; `feed.*`; `reference.*`; `note.*` |
| M9-11, M14-01, M14-02 | schedules of 4.3; `dist.redirects`, `dist.sigBytes`, `feed.compatBytes`, `feed.fetchMs`, `compat.reasonChars` (M9-11); `dist.manifestSlackBytes`, `dist.apiBodyBytes`, `dist.indexValidityDays`, `dist.checkHours`, `dist.githubCheckHours`, `feed.indexBytes` (M14-01, M14-02) |
| M2-07, M3-08, M4-08, M6-04, M7-05 | Measure jobs: P11; PB8; P16, P17, P77; P29, P30; P70. `dist.devDebounceMs` (M7-05) |

## 8. Checked by

| Proof | What it checks here | Slice |
| --- | --- | --- |
| P14 | Kit and host give the same outcome: 10,000 builds shown (a Builds row stays under 800 wire bytes, so 10,000 fit `wire.retainedBytes`); 12,000 show "2,000 more not shown"; 2,001 nodes show the host panel; a 9,000-character title is cut at 200; a 9 KiB row is not kept; the plugin stays running | M2-05 (N), M6-01 (E) |
| P15 | At most 1 unacked batch per root at every moment; a 10,000-change flood waits and the final trees match; a raw `postMessage` bypass crashes at its second unacked batch | M2-03 (N), M3-02 (B) |
| P16 | Chaos plugins: byte flood held to `wire.bytesPerSecond`, retained growth truncated, both not stopped; disabled after the 3rd crash | M4-08 |
| P56 | Network and feed caps refuse with typed reasons; the plugin keeps running | M7-01 |
| P17 | "Plugins paused" after 3 host crashes; restart Measure | M4-05, M4-08 |
| P57 | Feed backoff 1, 2, 4 s on a fake clock | M7-02 |
| P58 | Document quota refusals | M4-03 |
| P77 | Over-budget calls get `rate`; event-loop Measures | M4-08 |
| P81 | A 9-step chain is a manifest error (parse half); 8 steps run | M1-03 (parse), M5-08, M11-10 |
| P84 | Note rate 1 per second, 8 queued, overflow refused `rate` | M5-08 |
| P11, P29, P30, P70 | Measures (4.4 and spec 01 §1.6) | M2-07, M6-04, M7-05 |

## 9. Deferred

Until community or GitHub plugins open (M14-04):

- CPU burner search: on high CPU, the membrane stops the host's workers by halves until the CPU
  drops; the stopped worker gets a crash with reason `cpu`.
- Theme packages: at most 64 tokens per theme.
