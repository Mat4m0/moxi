# 03 Plugin hosts and lifecycle

This spec says which processes exist, when plugin hosts and plugin sessions start and stop, how
Main hardens and supervises each host, and what players see when a host fails. Main decides all
of this; plugin code never decides when it runs. Terms are in [01](01-foundations.md), message
shapes in [07](07-wire-and-ipc.md), every number in [05](05-budgets.md).

## 1. Rules in force

### 1.1 Processes

| Process | Owns | Never has |
| --- | --- | --- |
| Main (`apps/desktop`) | app lifecycle, windows, SQLite (documents too, on Main's thread, [14](14-main-data-and-network.md)), credentials, game files, game sockets and DNS, plugin registry, package store, grants, action authority, net proxy and feeds, signed feeds, activity log, Hub chord and plugin shortcuts, the **host supervisor** (1.7) | plugin code |
| Main `worker_threads` worker | `locate()`, once per client generation ([13](13-game-actions-chains-facts.md)) | plugin code, IPC |
| Launcher renderer (default session) | accounts, Play, settings, plugin directory and pages, install, consent, sources | plugin code, plugin ops |
| Game renderer, one per account (`persist:account-<id>`) | official client, gwkit, fact publisher, action executor, Hub, HUD, panels, plugin pages | plugin code |
| Plugin host, one per `HostKey` (hidden, in-memory partition `plugins-<HostKey>`) | the module workers of the installs bound to it; the membrane | Node, network, disk, browser storage, grant power. An `.internet` host also never gets a game fact, `hub.search` text or an action outcome |

Every renderer has `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` and
`webSecurity: true`, and one preload with only the channels of its window kind
(`packages/contracts/src/windows.ts`). Navigation is prevented, `window.open` is denied, and Main
calls `app.enableSandbox()` before any window exists. All plugin hosts use the window kind
`pluginHost`; Main keeps each host's `HostKey` by `webContents.id`.

### 1.2 Trust boundaries

| Boundary | Attacker | What holds |
| --- | --- | --- |
| Worker (JavaScript level) | hostile plugin code in its own worker | opaque `data:` origin; CSP (1.10); no DOM, no storage; the prelude deletes `Worker` ([06](06-worker-runtime.md)); the membrane routes facts by grant, stamps the install on every request and enforces budgets |
| Process (Spectre-class reads, no exploit) | plugin code that reads the memory of its own renderer | a `local` host receives only facts that its installs may read; an `internet` host receives none (I3, 13). No process holds personal facts and a way out |
| Renderer (V8 or Blink exploit in a host) | code execution in a plugin-host renderer | the OS sandbox (1.11); host binding of install keys (I7, enforced per 07); Main checks every request; game actions start only from a trusted press in the game renderer; a host has no disk, sockets or credentials |

Residual (01 §1.5): after a renderer exploit the attacker holds the grants of every install in
that one host, so the group split limits the harm to one group. From a `local` host those facts
can leave through page-context WebRTC or WebTransport (PB3), which CSP and `webRequest` miss.

### 1.3 Hosts: group, class, binding

- `HostKey` is `"<group>.<class>"` (01 §3): the group is `hostGroupOf(source_key)`, the class is
  `classOf(manifest)` ([04](04-catalog-and-manifest.md) §8.6, rule in 04 §7), `internet` when
  `permissions` or `optional` hold any `net:` or `link:` id, granted or not. SQL stores neither.
- At most `host.max` hosts (3 groups × 2 classes); a typical player runs 1 or 2.
- Main binds every enabled install to exactly one host and pushes the binding with the grants
  (07, 12); when an update changes the class and the player grants it (12), Main moves the install.

### 1.4 Lifecycle

| Event | Main does |
| --- | --- |
| App start | Creates no plugin host. Reads `--no-plugins` (1.13). |
| A game window opens, or any input of `wantedHosts` changes (installs on or off or removed, pause, plugins off, sandbox refusal, last game window closed) | Reconciles: creates every wanted host that does not exist; destroys every existing host that is not wanted. Hosts never keep the app running. |
| A host window is created | Status `starting`. On `did-finish-load`: sandbox check (1.11), then pushes installs and grants (07), then status `running`, then brokers ports (1.6). |
| The character enters the world; or leaves it (character select, login, state unknown), the game page reloads, the game window closes or its renderer dies | Opens, or closes, a plugin session (1.5). Map loads inside the world keep it open. |
| A host renderer is gone (`render-process-gone` with any reason, `did-fail-load` of its main frame, or a memory-cap kill) | Gone path (1.7). |

`wantedHosts`: no game window, or plugins off for this run → no host; otherwise the hosts of all
enabled installs, minus paused hosts, minus non-official hosts when the run is `sandboxRefused`.

### 1.5 Plugin sessions

A plugin session is one character visit in one game window. Without a session, a game window has
no plugin surface, no plugin text route, no plugin shortcut and no worker message (I8).

1. The game renderer invokes `game.state { state }` when gwkit's `GameState` changes (values:
   [13](13-game-actions-chains-facts.md) §3.1). Main runs `sessionStep(open, state)` (section 2):
   `in-world` opens a session when none is open; `login`, `character-select` and `unknown` close
   the open one; `loading` changes nothing (gwkit reports `loading` during a map load, never
   `unknown`). Main answers `{ sid: number | null }`: a new `sid` on entering `in-world` (issued
   per 01 §3, kept on the game window's record, 1.12), the same `sid` while there, else `null`.
2. The game renderer announces `{ t: "session", sid, open: true }` on each host port before any
   other message for that `sid`, and to a port that arrives later (a new or restarted host) first
   (07 §5). Then it mounts the HUD widgets that are on. A worker's session opens at once for an
   install with a granted `game.note`, otherwise on its first mount, hub, query or event (06).
3. Close: on `null`, Main clears the `sid` from the record; the game renderer announces
   `open: false` on each port and unmounts every root of that `sid`; each host ends the session
   in every worker (06) and drops later port messages for it. A game page reload, the death of the
   game renderer and a window close also close it: Main clears the `sid` (before a reload, first)
   and sends every host the portless `{ window }` message (1.6), because the renderer cannot
   announce. From then on Main refuses host requests that carry that `sid` (07).

Until gwkit's game-state reader works for the game build (13), no session opens and the plain game
runs (AGENTS rule 4). In CI, fixture-world provides every state.

### 1.6 Ports

- One `MessageChannelMain` port per (game window, host), brokered by Main when the host is
  `running` and the game page has fired `did-finish-load`, and again after every game page load
  and every host start or restart. A new port for the same pair replaces the old one at both
  ends. Its messages carry `sid`; handshake and payloads: 07 §5.
- `moxi-hub-port` without a port means "drop that port": Main sends `{ window }` to every host
  when a game window closes, its renderer dies or its page reloads, and `{ host }` to every game
  renderer when a host is destroyed or starts to restart.

### 1.7 Host supervisor

**Sampler.** One timer in Main runs while at least one host exists, at the host sample interval
(05 §3.5). A tick that finds the previous tick still running is skipped. Each tick:

1. Calls `app.getAppMetrics()` once; the sampler is the only caller in Main, others read its last
   sample. A tick is this call plus, on Linux, one async file read per host; no process spawn.
2. Reads private memory per host by its pid (`webContents.getOSProcessId()`): Linux
   `Private_Clean + Private_Dirty` from `/proc/<pid>/smaps_rollup`; Windows
   `memory.privateBytes`; macOS `memory.workingSetSize`. Electron reports KB. If `smaps_rollup`
   cannot be read, Main uses `workingSetSize` and logs it once.
3. A host above `host.memoryCapBytes` gets `webContents.forcefullyCrashRenderer()`, reason
   `memory`. The gone path follows.
4. CPU: `cpu.percentCPUUsage` per host. When every sample in `host.cpuWindowMs` is above
   `host.cpuShareOfCore`, Main reports one `host-cpu-high` event to the activity log (14) per
   episode, which ends at the first sample below. In 1.0 Main never stops a worker or host for CPU.

**Gone path.**

1. Main ignores the event when it comes from an older window of that host (generation counter).
2. Main adds the time to that host's crash history (memory, this run). At `crash.limit` crashes
   within `crash.windowMs`: status `paused`, no new window, activity event `host-paused`.
3. Otherwise: status `restarting`; portless `moxi-hub-port { host }` to every game renderer; Main
   releases that host's net and feed subscriptions (14); `destroy()` on the dead window; a new
   window for the same `HostKey` and partition; then the normal start (1.4). Target: the host
   restart target (05 §4.4), measured by P17.
4. A host crash or a cap kill charges the host only, never an install: Main cannot tell which
   worker caused it. Activity event `host-crashed` or `host-memory`.

`plugins.run { run: true }` ("Start plugins") on a paused host clears that host's crash history and reconciles.

**Timers in hidden hosts.** The worker watchdog runs in the host page (06), so every host has
`backgroundThrottling: false`, because a throttled hidden host loses its timers after about 5
minutes (PB7). Game windows always stay shown, because a hidden game window runs at about 1 fps
(PB14); Main never calls `hide()` on one.

### 1.8 Crash containment

`CrashKind` is the one list of crash kinds (type in `host/port.ts`, [07](07-wire-and-ipc.md);
stored in `plugin_crashes.kind`, 12). The last column gives each kind's meaning. This spec has no
player wording: every text a player sees for these failures is in [10](10-hub-hud-panels.md) §1.14.

| Failure | Detected by | Player sees | Recovery and charge |
| --- | --- | --- | --- |
| Throw in render or handler | runtime error handler (06) | the "Render threw" state (10 §1.14): the last good tree stays | the next change re-renders; `worker.errorsPerMinute` such errors in a minute count as one crash, `errors` |
| Throw in module evaluation (`error` with `module: true`, 07), or no `ready` before `worker.readyMs` | runtime (06 §7.1), ready deadline (06) | the "Worker stopped" state (10 §1.14) in its views | `start`; after a module throw the worker keeps serving its other sessions |
| Infinite loop | membrane ping (`worker.pingMs`, `worker.pongMs`; 06) | same | worker terminated, starts again on next use; `hang` |
| Message flood (`wire.messagesPerSecond`) | membrane (05) | same | worker terminated; `flood` |
| Second unacked batch on a root, malformed batch, repeated oversize batches (05) | membrane decoder (07) | same | worker terminated; `batch` |
| The worker's own `error` event | membrane (06) | same | worker terminated; `worker` |
| One view over a size budget | membrane or applier (05) | the "Too large" state (10 §1.14) | plugin runs on; no crash; repeated refused batches are a `batch` crash (07 §6.4) |
| Host renderer gone, including V8-heap out-of-memory in one worker (kills the whole host, PB2) and `ArrayBuffer` growth above the cap (sampler) | `render-process-gone`, sampler | 1.9 | gone path (cap kill for the sampler); host charge |
| Host crash limit reached | Main | the "Host paused" state (10 §1.14) | host paused for this run |
| CPU burner that answers pings | sampler | an Activity line | none in 1.0 (section 8) |
| Bad package or manifest | registry ([15](15-distribution-and-compat.md)) | that row: "Can't load: <reason>" | other installs unaffected |

Install crash policy: the membrane reports `plugin.crashed { installKey, kind, detail }` (07). Main
adds a `plugin_crashes` row (12). At `crash.limit` rows within `crash.windowMs`, Main turns the
install off with `disabled_reason = 'crashed'` and pushes the new install list. The plugin page
shows the reason and "Turn on again" (12), which deletes that install's rows.

### 1.9 Plugin surfaces while a host is not running

| Host status | HUD widgets | Views and panels | Hub rows of its installs | Its plugin shortcuts (Main) |
| --- | --- | --- | --- | --- |
| `starting`, `restarting` | hidden | stay on screen in the "Starting" or "Host restarting" state (10 §1.14); input off (a `starting` host has none yet) | shown in that state (10 §1.14); a press does nothing | swallowed and ignored |
| `running` again | mounted again (new `RootId`) if still on | a view or panel opened from a manifest command mounts again with the same command; views that plugin code pushed on top close, so the stack falls back to its command view; local state is lost, documents stay | normal | normal |
| `paused` | hidden | closed; the Hub shows the "Host paused" notice (10 §1.3, §1.14), one per paused host | hidden | not bound |
| `refused` | hidden | closed | hidden; the plugin page says why (12) | not bound |

A game action that Main already authorized finishes in the game renderer; its result is not
delivered to the dead plugin instance. Wording and visual design of these states: [10](10-hub-hud-panels.md) §1.14.

### 1.10 Plugin partitions

- Partition `plugins-<HostKey>`, for example `plugins-official.local`, has no `persist:` prefix:
  it lives in memory and writes nothing to disk. There is one per host.
- Main hardens each partition once per app run, before its first host window:

  ```ts
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !isPluginHostRequest(details.url) }),
  );
  ses.protocol.handle("moxi", servePluginHostFile);
  ```

- `servePluginHostFile` answers GET only. It serves files under the plugin-host renderer root
  (with the runtime file `code/<sha>.js`, 06) for `moxi://app/plugin-host/*` through
  `resolveRendererPath`, and 404 for everything else. Every response, 404s too, carries `pluginCsp`.
- `isPluginHostRequest` (section 2) lets through only `moxi://app/plugin-host/*`. `webRequest`
  never sees `data:`, `blob:` or WebTransport, so it backs up CSP and never replaces it.
- The CSP literal (`pluginCsp` in `apps/desktop/src/plugin-isolation.ts`):

  ```text
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src data:; connect-src 'none'
  ```

  The `data:` worker inherits it; `script-src 'self'` lets it import the runtime file. No
  `'wasm-unsafe-eval'`: with it, plugins can compile WebAssembly (PB3). `worker-src data:` allows
  the plugin's own worker; the prelude deletes `Worker`. The `moxi` scheme has `corsEnabled: true`
  (06).
- Plugin hosts load only `moxi://app/plugin-host/`, in Dev too: `MOXI_PLUGINHOST_URL` and the
  plugin-host Vite dev server (port 4613) are removed, and `scripts/dev.ts` runs
  `vp build --watch` for `apps/plugin-host` and restarts Electron when its `dist` changes.

### 1.11 Sandbox rule

- Main checks every plugin host when it starts (1.4), not once per run, with `sandboxState`
  (section 2). On Linux, "more `NSpid` levels than Main's own" also holds when Main itself runs in
  a container. On macOS and Windows a missing metrics entry or field counts as not sandboxed.
- Main never uses `app.commandLine.hasSwitch("no-sandbox")` (false after `app.enableSandbox()`).
- A failed check sets `sandboxRefused` for this app run, in Main's memory only. Nothing is stored:
  `disabled_reason` has only `player` and `crashed` (12). Non-official hosts are then not wanted,
  so reconcile destroys any that run, and Main reports `refused` for every non-official `HostKey`
  with enabled installs. Official hosts run. The plugin page and the Hub show the reason (12).
- A Linux `.deb` whose AppArmor profile did not load cannot start: Chromium aborts before Main
  code runs, so no app text can explain it. The `.deb` post-install check prints the fix
  ([16](16-platform-and-ci.md), BD11).

### 1.12 Game window partitions

| Session | Used by | Its `moxi` handler serves | Permissions |
| --- | --- | --- | --- |
| default | launcher | `/launcher/*` only | deny all |
| `persist:account-<accountId>` | the game window of that account | `/game/*` (plus the Dev proxy to `MOXI_GAME_URL`, as today) and `/client/*` through that window's routes | `pointerLock` and `fullscreen` only (`main.ts:225-236`) |
| `plugins-<HostKey>` | one plugin host | `/plugin-host/*` only | deny all, devices too |

- At most one game window per account. Main registers each account partition's handler once; it
  serves the routes of that account's current window (`createClientRoutes`, pinned to one client
  generation) and gives 404 when no window exists. IDBFS lives in the partition.
- No global `client` and no single `game` variable: Main keeps one record per game window
  `{ accountId, routes, sid? }`, keyed by `webContents.id`, the one owner of `sid → window,
  account`. `accountId` comes from the accounts store (M9-01): stable, never reused,
  `[a-z0-9-]{1,40}` (`default` until M9-01).
- Game data in the default session (IDBFS, localStorage) is neither migrated nor deleted. The new
  partition starts empty and the client downloads again (BD9).

### 1.13 Plugins off for a run

- Main's run flag `pluginsOff` is true at start when `process.argv` (not `app.commandLine`)
  includes `--no-plugins`. "Start without plugins" in the launcher sets it; "Start plugins" clears
  it. It is not stored. A second app start with the switch is ignored (single-instance lock).
- While `pluginsOff` is true, no host exists. Sessions still open and close, so plugins start
  mid-session when the flag clears. "Safe mode" means exactly this flag and appears nowhere else.

## 2. Types and functions

All of these are plain Node modules without Electron imports, unit-tested in Node. The Electron
wiring lives in `apps/desktop/src/shell/plugin-hosts.ts` (host windows, partitions, sampler,
ports) and in `main.ts` (game partitions).

```ts
// apps/desktop/src/plugins/hosts.ts
import type { HostKey, InstallKey } from "@moxi/sdk/host"; // 01 §3, with `hostGroupOf`, `hostKeyOf`

/** Pushed in `plugin.state.hosts` (07 §4); a host that does not exist is missing there unless paused/refused. */
export type HostStatus = "starting" | "running" | "restarting" | "paused" | "refused";

export const pluginPartition = (host: HostKey) => `plugins-${host}` as const;

export type HostInputs = {
  gameWindows: number; pluginsOff: boolean; sandboxRefused: boolean;
  paused: ReadonlySet<HostKey>;
  enabled: readonly { installKey: InstallKey; host: HostKey }[];
};
export function wantedHosts(input: HostInputs): Set<HostKey>;

/** True when `times` holds `limit.count` or more entries newer than `now - limit.windowMs`. */
export function crashLimitReached(
  times: readonly number[],
  now: number,
  limit: { count: number; windowMs: number },
): boolean;

/** Host events for the activity log (14), shown on every bound install's page. Install crashes
 *  are `CrashKind` (07, `host/port.ts`), not host events. */
export type HostEventKind =
  "host-crashed" | "host-memory" | "host-cpu-high" | "host-paused" | "sandbox-refused";

/** The window options of every plugin host; a test asserts each flag. */
export function hostWindowOptions(host: HostKey, preload: string): {
  show: false;
  webPreferences: {
    partition: ReturnType<typeof pluginPartition>;
    preload: string;
    sandbox: true; contextIsolation: true; nodeIntegration: false; webSecurity: true;
    backgroundThrottling: false; // mandatory (PB7)
  };
};

// apps/desktop/src/plugins/partition.ts
/** True only when the URL parses, the scheme is `moxi:`, the host is `app`, there is no user
 *  info, and the normalized path starts with `/plugin-host/`. */
export function isPluginHostRequest(url: string): boolean;

// apps/desktop/src/plugins/sandbox.ts
export type SandboxInput =
  | { os: "linux"; argv: readonly string[]; hostStatus: string | undefined; mainStatus: string }
  | { os: "darwin" | "win32"; sandboxed: boolean | undefined };
export type SandboxState =
  | { sandboxed: true }
  | {
      sandboxed: false;
      reason: "no-sandbox-switch" | "no-seccomp" | "no-pid-namespace" | "not-sandboxed" | "unknown";
    };
/** Linux, first match wins: argv has `--no-sandbox` (or `--no-sandbox=…`) → no-sandbox-switch;
 *  host status unreadable → unknown; `Seccomp` field is not "2" → no-seccomp; host NSpid levels
 *  ≤ Main's → no-pid-namespace; else sandboxed. NSpid levels = numbers on the `NSpid:` line
 *  (missing line = 0). macOS and Windows: true → sandboxed; false → not-sandboxed;
 *  undefined → unknown. */
export function sandboxState(input: SandboxInput): SandboxState;

// apps/desktop/src/plugins/host-metrics.ts
/** (Private_Clean + Private_Dirty) kB × 1024; undefined when either line is missing. */
export function smapsPrivateBytes(rollup: string): number | undefined;
export function hostPrivateBytes(
  os: "linux" | "darwin" | "win32",
  memory: { workingSetSize: number; privateBytes?: number }, // Electron MemoryInfo, KB
  rollup: string | undefined,
): number;
export type CpuEpisode = { aboveSince: number | undefined; reported: boolean };
/** Reports once when every sample for the CPU window stayed above the threshold (05). */
export function cpuStep(
  episode: CpuEpisode,
  percent: number,
  now: number,
): { episode: CpuEpisode; report: boolean };

// apps/desktop/src/plugins/sessions.ts
import type { GameState } from "@moxi/sdk/host"; // game-protocol type; values: 13; contracts re-exports it (07)
export type SessionStep = "open" | "close" | "none";
export function sessionStep(open: boolean, state: GameState): SessionStep;
```

Messages this file relies on (names and shapes: 07, which owns them; `game.state`, port `session`: 1.5; `moxi-hub-port`: 1.6):

| Message | From → to | Carries | When |
| --- | --- | --- | --- |
| `plugin.state` (event) | Main → game renderers, launcher | `GamePluginState`; this file owns its `hosts: { host: HostKey; state: HostStatus }[]`, `pluginsOff` and `sandboxRefused` | every change |
| `plugins.run` (invoke) | launcher or game renderer → Main | `{ run: true }` ("Start plugins"): clear `pluginsOff` and unpause every paused host (clearing their crash history) | player press |
| `plugins.run` (invoke) | launcher → Main | `{ run: false }` ("Start without plugins"): set `pluginsOff` | player press |

## 3. Constants

All values are in [05](05-budgets.md) (`host.*`, `crash.*`, `worker.*`, `wire.*`) and read by Main
from its budgets module; the keys used here are named in 1.3, 1.7 and 1.8.

## 4. Decisions

| Decision | Reason | Rejected |
| --- | --- | --- |
| Hosts exist only while a game window exists and one of their installs is on | no plugin runs without a game in 1.0; a host costs about 18 MiB | start at app launch |
| A plugin session is one character visit; no plugin code or plugin ops in the launcher | login screen and character select stay plugin-free: no fake login panel, no keystroke timing; the launcher takes credentials and consent | a session per game window from the first frame; a launcher plugin session |
| One host per `HostKey` (group × class); official plugins form their own group; pause counts per host; the group derives from `source_key`, with no `tier` column (BD6) | an exploit or out-of-memory stays inside one group, read-or-internet holds per process; one worker's V8 out-of-memory kills its whole host (PB2) and players rely on official HUDs; a crashing community host must not stop official HUDs; one owner per fact | one host for all; tier split only; one renderer per unverified install (about +20 MiB each); official and community together in `reviewed`; pause per tier; a stored tier or a third CHECK value |
| In-memory partition per host; CSP without `'wasm-unsafe-eval'`, plus a `webRequest` filter and deny-all permission and device handlers; hosts load from `moxi://` in Dev too | no plugin bytes on disk, two hosts never share a renderer process; CSP stopped all worker egress and code generation (PB3), and the filter survives a renderer exploit for the URLs it sees; one security path, no Dev exception | `persist:plugins`; one partition for all hosts; CSP alone; the filter alone (it misses WebTransport, `data:`, `blob:`); a Dev server URL let through the filter |
| Main kills a host above one memory cap, the same on all OSes; macOS memory = `workingSetSize`; high CPU is reported, never stopped, in 1.0 (BD7) | an `ArrayBuffer` bomb paged Windows and froze the game for up to 29 s; hosts passed 1 GiB within 0.5 to 1.6 s (PB2); no extra process per tick; macOS is unmeasured; a one-by-one CPU search stops healthy workers when the busy hint lies (PB2) | rely on the worker's `RangeError`; `footprint <pid>` on every tick (a process spawn); stop or restart the host on high CPU |
| A host crash or cap kill charges the host only; restart = destroy the dead window and create a new one | Main cannot tell which worker caused it; fresh process and state, the path PB2 measured | charge every install of the host; guess from busy hints; `webContents.reload()` on the dead contents |
| Linux sandbox = `Seccomp: 2` and deeper `NSpid` and no `--no-sandbox`; macOS and Windows = `ProcessMetric.sandboxed`; unsandboxed runs keep official plugins | the only rule right in every PB10 case; official code ships with the app | `hasSwitch` (false after `enableSandbox()`); Seccomp alone; refuse all plugins |
| Main issues the `sid` in the `game.state` answer; the game renderer announces open and close on the port | port order puts `session` before every mount; the portless `{ window }` message ends sessions when the game renderer is gone | Main → host session events (no order with port messages) |
| Per-account game partitions, each with its own `moxi` handler | each window serves its own client generation and storage (PB14) | the default session with a global `client` (generations mix) |
| Watchdog in the host page; `backgroundThrottling: false` on every host | 0 timer gaps on Linux and Windows with the flag (PB7) | Main-driven pings by default (kept as the fallback, section 8) |

## 5. Today in code (main 848fb6e) and what changes

| Item | Today | Change | Slice |
| --- | --- | --- | --- |
| Hosts, window options, crash policy, metrics | one hidden `pluginHost` window at app ready (`apps/desktop/src/shell/main.ts:429-432`), unguarded `let pluginHost` (`:70`, `:145-153`); `createWindow` (`:122-140`) with `backgroundThrottling: kind === "launcher"` (`:137`); no host `render-process-gone` handler (the game window has one, `:181`); no `app.getAppMetrics()`; no `--no-plugins`; crash policy in memory per game window (`apps/plugin-host/src/plugin-host.ts:277-304`) | host registry per `HostKey` in `shell/plugin-hosts.ts` driven by `wantedHosts`; `hostWindowOptions`; gone path, pause, restart; sampler; `pluginsOff` (launcher switch: M7-04); `plugin.crashed` to Main, `plugin_crashes` rows | M4-05 (Main), M4-09 (membrane) |
| Ports | one per game window (`main.ts:141-156`); the game `webContents` id is the only session id; portless message = drop (`:151-154`); receivers `apps/plugin-host/src/index.ts:21-71`, `apps/game/src/hub/main.ts:19-48` (one port only) | one port per (window, host), re-brokered on page loads and host starts; the game side keeps one port per host | M4-05 |
| Sessions | none; one `PluginHost` per game window from the first page load (`apps/plugin-host/src/index.ts:36-69`), so plugins run on the login screen | character sessions with `sid` | M5-06 |
| Partitions, CSP, sandbox, Dev URL, scheme | `persist:plugins` (`main.ts:130`, `:277`); deny-all permission handlers (`:278-281`); `moxi` handler for `/plugin-host/` only with `pluginCsp` (`:282-303`); `apps/desktop/src/plugin-isolation.ts:1-2` has `'wasm-unsafe-eval'`, asserted in `e2e/plugin-isolation.e2e.ts:102` (partition name `:81`, `:88`), imported by `apps/plugin-host/vite.config.ts`; `app.enableSandbox()` (`main.ts:41`), no check; `MOXI_${kind}_URL` (`:193-195`), `MOXI_PLUGINHOST_URL` and port 4613 in `scripts/dev.ts:116`, `:148`; `registerSchemesAsPrivileged` without `corsEnabled` (`main.ts:42-47`) | `plugins-<HostKey>`, in memory; device handler and `webRequest` filter once per host partition; the CSP literal of 1.10, with the e2e in the same pull request; `sandboxState` and refusal; Dev URL removed; `corsEnabled: true` | M4-06; M2-07 (`corsEnabled`) |
| Game partitions | default session; global `client` (`main.ts:91`, reassigned `:121`); single `game` (`:69`, `:423`); one default handler serves launcher, game, plugin-host and client routes (`:237-276`); game permissions on the default session (`:225-236`) | per-account partitions and handlers; default session serves `/launcher/*` only | M5-03 |

## 6. Built by

| Slice | Builds from this file |
| --- | --- |
| M2-07 | `corsEnabled` on the `moxi` scheme; `code/<sha>.js` served from the plugin-host root |
| M4-01 | the message shapes listed in section 2 (07) |
| M4-02 | the Dev-only injection of non-official installs that P5 and P7 need (BD22, 15) |
| M4-05 | host registry, `wantedHosts`, `hostWindowOptions`, ports per (window, host), sampler, gone path, pause, install crash policy (Main side), `pluginsOff` from `--no-plugins` |
| M4-06 | partitions, handlers, CSP literal, `isPluginHostRequest`, `sandboxState` and refusal, removal of the Dev host URL |
| M4-08 | chaos e2e for P7, P16, P17 |
| M4-09 | the membrane side of 1.8: detection of each `CrashKind`, `plugin.crashed` reports, session handling per worker (06, 07) |
| M3-06 | HUD and panel states of 1.9, fed by `plugin.state` from the simulator |
| M5-03 | per-account partitions, no global `client` or `game`, launcher-only default session |
| M5-06 | `game.state`, `sessionStep`, `sid`, session open and close |
| M7-04 | "Start without plugins", host and sandbox reasons on the plugin page |
| M8-01 | `.deb` post-install AppArmor check (16) |
| M8-02 | P20 on the Windows nightly lane |
| M8-03 | P73 and the packaged half of P5 |

## 7. Checked by

| Proof | What it checks here | Where | Owner |
| --- | --- | --- | --- |
| P2 | N `apps/desktop/src/plugins/partition.test.ts`: true for `moxi://app/plugin-host/` and `moxi://app/plugin-host/code/<sha>.js`; false for `moxi://app/game/`, `moxi://app/client/Gw.snapshot`, `moxi://app/launcher/`, `moxi://other/plugin-host/`, `moxi://app/plugin-host/../game/`, `http://127.0.0.1:1/`, `https://example.com/`, `ws://127.0.0.1:1/`, `file:///etc/passwd`, `not a url`. E3: Main calls `session.fromPartition("plugins-official.local").fetch("http://127.0.0.1:<port>")`; the listener gets 0 hits | N, E3 | M4-06 |
| P5 | N `sandbox.test.ts`, one row per PB10 case: Linux `[]`, `Seccomp: 2`, host NSpid `1234 7 1`, Main `4321` → sandboxed; argv `--no-sandbox` → no-sandbox-switch; NSpid `1234` → no-pid-namespace; `Seccomp: 0` → no-seccomp; unreadable → unknown; Main NSpid `4321 9`, host `1234 7` → no-pid-namespace; host `1234 7`, Main `4321` → sandboxed (SUID helper); macOS `true` → sandboxed; Windows `false` → not-sandboxed; macOS `undefined` → unknown. E3: a sandboxed run (CI `chromiumSandbox: true` and the AppArmor sysctl) has every host sandboxed; a second run with `--no-sandbox` has 0 non-official workers, official plugins running, the page reason shown | N, E3, Pk | M4-06 (N, Linux E), M8-03 (Pk) |
| P7 | official reads plugin, official `net:` plugin, one GitHub and one dev install (BD22): `official.local` 1 worker, `official.internet` 1, `unverified.local` 2, no `reviewed.*` host; port and forgery checks as in 07 | E | M4-05, M4-08 |
| P16 | worker-level chaos rows as in 1.8; `oom` runs in a non-official host next to an official HUD: that host restarts and the official HUD counter keeps rising; N with a fake clock: the install crash limit turns the install off and "Turn on again" works; the `yielding-burner` row is deferred | E3, N | M4-08 |
| P17 | `forcefullyCrashRenderer()` once, then up to the host crash limit: 1 restart per crash, HUD back, the "Host paused" state (10 §1.14) after the limit, Play still works, the game frame counter keeps rising. Measure: restart time against the restart target (05 §4.4) | E3 | M4-05, M4-08 |
| P20 | hidden hosts keep their timers while game windows are minimized or covered: 0 false watchdog stops. If an OS fails: Main-driven pings (section 8) | E3 nightly | M4-05 (Linux), M8-02 |
| P73 | `.deb` with its profile: every renderer has `Seccomp: 2`, an `NSpid` deeper than Main's, and Main's argv has no `--no-sandbox`; the same `.deb` started with `--no-sandbox` (negative control): non-official refused, official running, page reason; `.deb` without its profile: does not start, and the post-install output names the fix; AppImage on default Ubuntu: non-official refused | Pk | M8-03 |
| P75 | N: routes for two windows with a candidate staged between them; E: two fixture windows in two account partitions with different generations, separate IDBFS, each handler serves only its routes, JSPI in both | N, E | M5-03 |
| P10 (E half, owner 06) | character select ends 1 session; closing a window ends 1 session | E | M5-06 |
| P1, P3 (owner 16) | run against the CSP literal of 1.10 | E3 | M5-10 |

N tests in this area, each with its bug: `hosts.test.ts` (`wantedHosts` keeps a non-official host
in a refused run; `hostWindowOptions` loses `backgroundThrottling: false`; a crash outside the
window still counts); `sessions.test.ts` (a map load closes the session; `in-world` twice opens
two sessions); `host-metrics.test.ts` (KB read as bytes; one CPU spike reported as an episode).

## 8. Deferred

- **CPU burner search** (find and stop the busiest worker, by halving): M14-04, before community
  or GitHub sources open (BD5).
- **Main-driven watchdog pings**: only if P20 shows false stops on an OS; macOS is unmeasured.
- **macOS memory metric**: replace `workingSetSize` once a macOS Measure exists.
- **AppImage release**: built in CI, not released; Matthias decides (BD11).
- **Launcher plugin session**: not in 1.0; it can come later as an additional session kind.
