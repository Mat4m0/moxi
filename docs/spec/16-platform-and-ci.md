# 16 Platform and CI

## Purpose

How moxi runs on macOS, Windows and Linux: OS rules, data roots, credential storage, CI lanes, and
the order in which milestones replace today's code. Main and the renderers behave the same on
every OS; this file names where the OS still matters. Terms: [01](01-foundations.md). Budgets:
[05](05-budgets.md). Sandbox rule, plugin partition, CSP: [03](03-plugin-hosts-and-lifecycle.md)
§1.10, §1.11. Proof criteria: `docs/build/proofs.md`.

## 1. Rules in force

### 1.1 Operating systems

Targets: macOS arm64, Windows x64, Linux x64, on Electron 44.5.1. Nothing in the plugin API names
an OS; the manifest field `platforms` only filters the directory ([04](04-catalog-and-manifest.md)).

| Topic | Rule | Owner |
| --- | --- | --- |
| Linux sandbox | Ubuntu 23.10+ restricts unprivileged user namespaces through AppArmor. The `.deb` installs a profile granting `userns` to `/opt/Moxi/moxi`; then every renderer has `Seccomp: 2` and its own PID namespace. An AppImage's `AppRun` adds `--no-sandbox` when `unshare -Ur` fails, so on stock Ubuntu it runs without the namespace sandbox. Main detects both | 03 §1.11; 1.4 |
| WebRTC, WebTransport | `RTCPeerConnection` is undefined in workers; `webRequest` sees neither transport. A compromised host page could use them: accepted residual | 01 Q11 |
| Hidden windows | Plugin hosts are hidden with `backgroundThrottling: false`; batching never uses `requestAnimationFrame`; game windows always stay shown (hidden, about 1 fps). Measured on Linux and Windows; macOS unmeasured | 03 §1.7, 06 |
| Git | No system `git` on Windows or in an AppImage. GitHub plugins download release assets over HTTPS only | 15 |
| Child processes | Scripts, CLI and tests start Node as `process.execPath` plus a script path, never `pnpm`, `npx` or a `.cmd` by name. Cross-platform tests read process trees through Electron (`app.getAppMetrics()` from Main), never `ps` | 08 (CLI); here |
| Line endings | Root `.gitattributes` holds `* text=auto eol=lf`; the plugin template carries the same line | here; 08 |
| Tests per OS | A test that cannot run on one OS uses `test.skip(<os condition>, "<reason>")`; the reason names the OS limit. No silent skip | AGENTS |

Isolation (CSP, partition, handlers; P1 and P3 run on every OS with a lane) is 03 §1.10; keys
(`mod`, physical codes, AltGr, no application menu on Windows and Linux) are 11; paths (case,
reserved names, content-addressed packages, hashed dev folders) are 15; fractional scaling is 09.
Data roots: 1.5.

### 1.2 Where checks run

1. No check and no worker starts Electron on Matthias's Mac: no e2e, packaged app or probe, hidden
   or not. The only Electron runs there are his own `pnpm dev` and live sessions with him (L).
   Electron checks run in GitHub Actions only. `playwright.config.ts` throws
   `Electron e2e runs in CI only (docs/spec/16).` when `process.env.CI !== "true"`.
2. Local checks: `pnpm check` (format, lint, types, Vitest in Node, the Hub suite in Vitest
   browser mode on headless Chromium) and `pnpm gate <files>` (`docs/build/README.md`).
3. Workers never wait on CI. Opus pushes the slice branch, opens a draft pull request, sets the
   labels below and reads the result.

| Kind (`docs/build/proofs.md`) | When | Workflow / job | Runner |
| --- | --- | --- | --- |
| N, B | every PR, local | `ci.yml` / `check` | ubuntu-24.04 |
| E (fixture e2e) | every PR | `ci.yml` / `e2e` | ubuntu-24.04 |
| E, new or changed file: 20 runs + 5 loaded | PR label `gate` | `ci.yml` / `e2e-gate` | ubuntu-24.04 |
| E `@long` (over 2 min, e.g. P20) | PR label `long`; nightly | `ci.yml` / `e2e-long`; `nightly.yml` / `e2e-linux-long` | ubuntu-24.04 |
| E3 Windows leg; N and B on Windows | nightly | `nightly.yml` / `e2e-windows`, `check-windows` | windows-2025 |
| E3 macOS leg | nightly, only while repo variable `MOXI_MACOS_LANE` is `on` | `nightly.yml` / `e2e-macos` | macos-15 |
| Pk | packaging PRs, nightly (Linux); dispatch and `v*` tags (all OSes) | `build.yml` / `package`, `deb-sandbox` | per OS |
| Measure | PR label `measure`; dispatch | `measures.yml` / `measure` | ubuntu-24.04 (dispatch may pick windows-2025) |
| Real client (canary) | nightly | `nightly.yml` / `real-client` | ubuntu-24.04, windows-2025 |

C (corpus) runs on Matthias's Mac in Node only (`MOXI_CORPUS`); L (live) runs after review gate R1,
with Matthias (`moxi-dev` MCP).

Stability: a new or changed `e2e/*.e2e.ts` file passes `e2e-gate` before merge (AGENTS 20-run
rule). A `@long` test and every Windows or macOS job count as a gate after 5 green runs in a row;
then a red run blocks merges until fixed or the test is deleted with a reason. Real-client runs and
Measures never block a merge; Opus applies the Measure's decision rule.

### 1.3 CI lanes

Every workflow: `permissions: { contents: read }`; `actions/checkout@v4`, `pnpm/action-setup@v4`
(version from `packageManager`), `actions/setup-node@v4` with `node-version-file: .node-version`
and `cache: pnpm`; `pnpm install --frozen-lockfile`;
`concurrency: { group: "${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}", cancel-in-progress: ${{ github.event_name == 'pull_request' }} }`.
Runner labels are pinned (section 3). No workflow on `main` has `paths-ignore`. ArenaNet files
never enter `actions/cache` or an artifact. "Linux setup" for Electron jobs:
`pnpm exec playwright install-deps chromium`, then
`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, then the command under
`xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24"`.

**`ci.yml`**: on `pull_request` (types `opened`, `synchronize`, `reopened`, `labeled`) and `push`
to `main`. `check` and `e2e` skip `labeled` events. Required checks on `main`: `check`, `e2e`.

| Job | Runs when | Steps after install | Timeout (min) |
| --- | --- | --- | --- |
| `check` | not a `labeled` event | `pnpm exec playwright install --with-deps chromium`; `pnpm check` | 10 |
| `e2e` | not a `labeled` event | Linux setup; `pnpm e2e --grep-invert @long`; on failure upload `.evidence/` as `e2e-evidence` | 20 |
| `e2e-long` | PR has label `long` | Linux setup; `pnpm e2e --grep @long` | 30 |
| `e2e-gate` | PR has label `gate` | checkout `fetch-depth: 0`; Linux setup; `pnpm gate` on `git diff --name-only --diff-filter=AM origin/main...HEAD -- 'e2e/*.e2e.ts'` (CI mode: 20 runs, then 5 with all cores busy; `@long` excluded) | 60 |

Every e2e launch passes `chromiumSandbox: true` (else Playwright adds `--no-sandbox` on Linux),
listens on port 0, and keeps `MOXI_BACKGROUND` off on Linux (Electron applies opacity there, which
throttles a transparent window to about 1 fps).

**`build.yml`**: on `workflow_dispatch`, `push` of tags `v*`, `schedule` (section 3), and
`pull_request` with `paths: [electron-builder.config.ts, build/**, apps/desktop/**, package.json,
pnpm-lock.yaml, scripts/check-fuses.ts, e2e/packaged/**, .github/workflows/build.yml]`. Nothing in
it publishes (`publish: null`).

| Job | Matrix / needs | Steps after install | Timeout |
| --- | --- | --- | --- |
| `package` | PR and schedule: `[ubuntu-24.04]`; dispatch and tags: `[macos-15, windows-2025, ubuntu-24.04]` | cache Electron and electron-builder downloads; `pnpm package`; `node scripts/check-fuses.ts`; `ls -l out` (bash); fail if an expected artifact of that OS is missing (macOS `*.dmg`, `*.zip`; Windows `*.exe`; Linux `*.deb`, `*.AppImage`); upload `moxi-<os>` | 30 |
| `deb-sandbox` | needs `package`; ubuntu-24.04; runs whenever the Linux leg ran | download `moxi-ubuntu-24.04` into `out/`; append `127.0.0.1 patching.1.arenanetworks.com` and `::1 patching.1.arenanetworks.com` to `/etc/hosts`; `sudo apt-get install -y fuse3 ./out/moxi_*.deb`; `pnpm exec playwright install-deps chromium`; `xvfb-run … pnpm e2e:packaged`. **No sysctl change**: this lane tests the stock Ubuntu path | 30 |

**`nightly.yml`**: on `schedule` (section 3) and `workflow_dispatch`.

| Job | Runner | Steps after install | Timeout |
| --- | --- | --- | --- |
| `e2e-windows` | windows-2025 | `pnpm e2e` (every fixture e2e, `@long` included; no xvfb) | 40 |
| `check-windows` | windows-2025 | `pnpm exec playwright install chromium`; `pnpm check` | 20 |
| `e2e-linux-long` | ubuntu-24.04 | Linux setup; `pnpm e2e --grep @long` | 30 |
| `e2e-macos` | macos-15, `if: vars.MOXI_MACOS_LANE == 'on'` | `pnpm e2e` | 40 |
| `real-client` | matrix ubuntu-24.04, windows-2025 | Linux setup on Linux; `pnpm e2e:real` with `MOXI_GAME_CACHE` under `${{ runner.temp }}`; upload `.evidence/e2e/real/` always | 30 |

If background mode stalls the Windows e2e, `MOXI_BACKGROUND` gets the Linux rule on Windows too.

**`measures.yml`**: on `pull_request` (types `labeled`, `synchronize`) when the PR has label
`measure`, and on `workflow_dispatch` with input `os` (`ubuntu-24.04` default, or `windows-2025`).
One job `measure`: Linux setup (on Linux); `pnpm e2e:measure`; upload `.evidence/measures/` as
`measures`; print one line per result. Timeout 60. Each Measure runs its scenario 5 times in a row
in the same job, with a fresh app start per run. There is no `probes.yml`: the open probe work
(PB8) is a Measure.

**Playwright**: one `playwright.config.ts` with projects; `workers: 1`, `retries: 0`,
`outputDir: ".evidence/e2e/<project>/"`.

| Project | `testMatch` | Script in `package.json` |
| --- | --- | --- |
| `fixture` | `e2e/*.e2e.ts` | `e2e`: today's build steps, then `playwright test --project fixture` |
| `packaged` | `e2e/packaged/*.pk.ts` | `e2e:packaged`: `playwright test --project packaged` (tests the installed app; no build) |
| `real` | `e2e/real/*.real.ts` | `e2e:real`: `pnpm build && playwright test --project real` |
| `measure` | `e2e/measures/*.measure.ts` | `e2e:measure`: `pnpm build && playwright test --project measure` |

### 1.4 Packaging

electron-builder 26.15.3 with `electron-builder.config.ts`. `pnpm package` builds and packages;
it publishes nothing until M9-10.

| OS | Targets | Signing | Install |
| --- | --- | --- | --- |
| macOS | `dmg` and `zip`, arm64 | ad hoc (`identity: "-"`) until M15-01 | – |
| Windows | NSIS x64, `oneClick`, per user | none until M15-02 | electron-builder's per-user default folder |
| Linux | `.deb` x64 = **the package**; AppImage x64 = built in CI, **not released** | – | `/opt/Moxi/moxi`, link `/usr/bin/moxi`, profile `/etc/apparmor.d/moxi` |

1. **One owner for identity.** `apps/desktop/src/identity.ts` holds `appId` and `productName`.
   `apps/desktop/package.json` exports `"./identity": "./src/identity.ts"`; the config takes both
   from `resolveIdentity(true)`. No other file holds the literals.
2. **Fuses.** The config exports `fuses` (today's nine values, unchanged); `afterPack` flips
   exactly that object; `scripts/check-fuses.ts` reads every unpacked app and fails on any
   difference (2.3, P71).
3. **Windows.** `nsis: { oneClick: true, perMachine: false }`; `allowElevation` is deleted (dead
   with a per-user one-click installer).
4. **Linux.** `linux.target`: `deb` and `AppImage`, both x64. `linux.artifactName:
   "moxi_${version}_${arch}.${ext}"` (the default name derives from `@moxi/desktop` and breaks
   fpm). `linux.maintainer`, `linux.synopsis`, `linux.description` are set (fpm needs them;
   values in section 3). `toolsets: { appimage: "1.0.3" }`: the static runtime's desktop entry has
   no hard-coded `--no-sandbox`. No `executableArgs`: it only changes the desktop entry, and
   `AppRun` adds `--no-sandbox` on its own.
5. **`.deb` post-install check (BD11).** `deb.afterInstall: "build/linux/after-install.tpl"`:
   electron-builder 26.15.3's stock `templates/linux/after-install.tpl`, unchanged, plus one last
   line:

   ```bash
   bash '/opt/${sanitizedProductName}/resources/linux-sandbox-check.sh' || true
   ```

   electron-builder expands every `${letters}` in this template as a macro and throws on an
   unknown name, so the template uses only `${executable}` and `${sanitizedProductName}`.
   `linux.extraResources` copies `build/linux/linux-sandbox-check.sh` (2.4, verbatim, no macros)
   to `resources/linux-sandbox-check.sh`. The check never fails the install: a `.deb` whose
   profile did not load cannot start (Chromium aborts before Main runs), so the install prints the
   fix instead. It is a shipped script that postinst calls, so CI and players run the same check.

### 1.5 Data roots

Two roots: `data` (Electron `userData`: SQLite, Chromium state, package store) and `gameCache`
(client generations and chunks, up to about 4 GB). Main calls `app.setPath("userData", data)`
before `ready`, as today.

Packaged: macOS `~/Library/Application Support/Moxi` (cache in `game` below it); Windows
`%LOCALAPPDATA%\Moxi` (cache `...\Moxi\game`); Linux `$XDG_DATA_HOME/moxi` and
`$XDG_CACHE_HOME/moxi/game`. Dev: `data` = `<repo>/.data`; cache = `~/Library/Caches/moxi-dev/game`,
`%LOCALAPPDATA%\moxi-dev\game` or `$XDG_CACHE_HOME/moxi-dev/game`. Every combination is a
literal row in 2.1.

- `%LOCALAPPDATA%` unset: `<home>\AppData\Local`. `XDG_DATA_HOME` or `XDG_CACHE_HOME` unset, empty
  or not absolute: `<home>/.local/share` or `<home>/.cache`.
- `MOXI_DATA_DIR` and `MOXI_GAME_CACHE` override the roots verbatim in every build (tests and the
  packaged lane use them).
- No move: nothing was released, so no player data exists at the old packaged roots (Windows
  Roaming, Linux `~/.config/Moxi`). Dev data does not move.
- One function computes the roots for Main and for `scripts/fetch-client.ts`; it has no Electron
  import and uses `path.win32` for Windows and `path.posix` otherwise, so its test is one literal
  table on every OS.

### 1.6 Credentials

- Credentials exist only in Main (AGENTS rule 5): never in logs, renderers, plugins, diagnostics
  or test output.
- The store uses Electron's async API (`isAsyncEncryptionAvailable`, `encryptStringAsync`,
  `decryptStringAsync`); Electron 46 removes the sync one. Main builds it after `app.whenReady()`,
  because the Linux backend reads `unknown` before `ready`.
- Fail closed: backend `basic_text` or `unknown`, or encryption unavailable, means `canRemember()`
  is false and `save` refuses; the launcher hides "Remember login" (M9-04). If `decryptStringAsync`
  answers `shouldReEncrypt: true`, the store encrypts again and replaces the row before it returns.
- The table stays `credentials(account TEXT PRIMARY KEY, ciphertext BLOB NOT NULL)`, created by
  the credentials slice's own migration (M9-02; migrations are numbered per slice in merge order,
  [12](12-consent-grants-and-updates.md)).

### 1.7 Main switches for Dev and CI

| Variable | Read when | Effect |
| --- | --- | --- |
| `MOXI_DATA_DIR`, `MOXI_GAME_CACHE` | every build | override the roots (1.5) |
| `MOXI_CDP_PORT` | `!app.isPackaged` | CDP on 127.0.0.1, port 4620–4629 (`pnpm drive`) |
| `MOXI_BACKGROUND=1` | `!app.isPackaged`, never on Linux | no Dock icon, invisible windows, no focus |
| `MOXI_PATCH_ROOT` | `!app.isPackaged` | every ArenaNet patch URL goes to this loopback root |
| `MOXI_LAUNCHER_URL`, `MOXI_GAME_URL` | `!app.isPackaged` | Vite dev servers (`MOXI_PLUGINHOST_URL` is removed, 03 §1.10) |
| `MOXI_SOFTWARE_GL=1` | `!app.isPackaged` | `app.commandLine.appendSwitch("enable-unsafe-swiftshader")` before `ready` (new); the official client needs WebGL on GPU-less runners, host drawings need none; product paths never add it |
| fixture registry and GitHub base URLs; non-official install injection | `!app.isPackaged` | 15 (BD21, BD22) |

Every new Dev or CI switch follows `MOXI_PATCH_ROOT`: read only when `!app.isPackaged`; a packaged
build ignores it.

### 1.8 Release lanes (later milestones)

Only these points are decided; each slice brief adds the rest with Matthias.

- **App updates** (M9-10): `electron-updater`; channels Dev, Beta, Stable; never a downgrade. Update
  URLs need Matthias.
- **Dev** (M9-10, M15-03): merging to `main` publishes Dev. **Beta, Stable** (M15-03): shipped only
  by Matthias, Beta one click, Stable one approval; versions computed from pull-request titles
  (git-cliff); `docs/RELEASING.md`.
- **Signing** (M15-01, M15-02): macOS Developer ID team 9NN976MFZ4 with notarization; Windows with
  the Lupinum organization certificate.

## 2. Types and shapes

### 2.1 Data roots

```ts
// apps/desktop/src/folders.ts (M8-04). Exported as "@moxi/desktop/folders".
export type Folders = { readonly data: string; readonly gameCache: string };

export function resolveFolders(input: {
  packaged: boolean;
  platform: "darwin" | "win32" | "linux"; // Node's process.platform; Main throws "Unsupported platform." for others
  home: string; // os.homedir()
  repoRoot: string;
  env: {
    MOXI_DATA_DIR?: string;
    MOXI_GAME_CACHE?: string;
    LOCALAPPDATA?: string;
    XDG_DATA_HOME?: string;
    XDG_CACHE_HOME?: string;
  };
}): Folders;
```

Test rows (literal, every OS): home `/h` or `C:\Users\p`, repo `/repo` or `C:\repo`:

| platform, build, env | `data` | `gameCache` |
| --- | --- | --- |
| darwin, packaged | `/h/Library/Application Support/Moxi` | `/h/Library/Application Support/Moxi/game` |
| win32, packaged, `LOCALAPPDATA=D:\Local` | `D:\Local\Moxi` | `D:\Local\Moxi\game` |
| win32, packaged, no `LOCALAPPDATA` | `C:\Users\p\AppData\Local\Moxi` | `C:\Users\p\AppData\Local\Moxi\game` |
| linux, packaged, no XDG | `/h/.local/share/moxi` | `/h/.cache/moxi/game` |
| linux, packaged, `XDG_DATA_HOME=/x/d`, `XDG_CACHE_HOME=/x/c` | `/x/d/moxi` | `/x/c/moxi/game` |
| linux, packaged, `XDG_CACHE_HOME=rel` | `/h/.local/share/moxi` | `/h/.cache/moxi/game` |
| darwin, Dev | `/repo/.data` | `/h/Library/Caches/moxi-dev/game` |
| win32, Dev, no `LOCALAPPDATA` | `C:\repo\.data` | `C:\Users\p\AppData\Local\moxi-dev\game` |
| linux, Dev | `/repo/.data` | `/h/.cache/moxi-dev/game` |
| any, packaged, `MOXI_DATA_DIR=/d`, `MOXI_GAME_CACHE=/g` | `/d` | `/g` |

### 2.2 Credential store

```ts
// apps/desktop/src/storage/credentials.ts (M9-02). Plain module; shell/ wires safeStorage.
import type { Database } from "./database";

export type CredentialSaveResult =
  | { ok: true }
  | { ok: false; reason: "encryption-unavailable" | "basic-text" };

/** Main passes safeStorage; tests pass a fake. */
export type CredentialCipher = {
  /** Linux: safeStorage.getSelectedStorageBackend(); macOS and Windows: "os". */
  readonly backend:
    | "os" | "basic_text" | "gnome_libsecret" | "kwallet" | "kwallet5" | "kwallet6" | "unknown";
  available(): Promise<boolean>; // isAsyncEncryptionAvailable()
  encrypt(secret: string): Promise<Uint8Array>; // encryptStringAsync()
  decrypt(ciphertext: Uint8Array): Promise<{ secret: string; reEncrypt: boolean }>; // decryptStringAsync()
};

export type CredentialStore = {
  /** False for "basic_text", "unknown" or no encryption. The launcher hides "Remember login". */
  canRemember(): Promise<boolean>;
  save(account: string, secret: string): Promise<CredentialSaveResult>;
  load(account: string): Promise<string | null>;
  clear(account: string): Promise<void>;
};

export function createCredentialStore(deps: {
  cipher: CredentialCipher;
  db: Database;
}): CredentialStore;
```

`account` is the account id of the accounts store (M9-01, format in 03 §1.12). `save` returns
`basic-text` for that backend and `encryption-unavailable` for `unknown` or when `available()` is
false.

### 2.3 Fuse read-back

```ts
// electron-builder.config.ts: the object afterPack flips. Its keys, values and comments are
// today's inline object (electron-builder.config.ts:33-54), moved, not changed.
export const fuses = {
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  // … the nine FuseV1Options entries of today
} satisfies FuseConfig;

// scripts/check-fuses.ts (M8-01): node scripts/check-fuses.ts [unpacked app]
// Default path by OS: out/mac-arm64/Moxi.app, out/win-unpacked/Moxi.exe, out/linux-unpacked/moxi.
// For every FuseV1Options key: expected = fuses[key] ? FuseState.ENABLE : FuseState.DISABLE;
// actual = (await getCurrentFuseWire(path))[key]. Prints "<name> ok|expected X, found Y";
// exit 1 on any difference or a missing key.
```

### 2.4 Linux sandbox check (`build/linux/linux-sandbox-check.sh`, verbatim)

```bash
#!/bin/bash
# Moxi needs Chromium's sandbox. On Ubuntu 23.10 and later it starts only while the AppArmor
# profile /etc/apparmor.d/moxi is loaded, or when chrome-sandbox is setuid root. Run as root.
app_dir="$(cd "$(dirname "$0")/.." && pwd)"
profile=/etc/apparmor.d/moxi
restrict=/proc/sys/kernel/apparmor_restrict_unprivileged_userns

if [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; then exit 0; fi
if [ ! -d /sys/kernel/security/apparmor ]; then exit 0; fi
if [ -u "$app_dir/chrome-sandbox" ]; then exit 0; fi
if [ ! -r "$restrict" ] || [ "$(cat "$restrict")" != "1" ]; then exit 0; fi
if grep -qs '^moxi ' /sys/kernel/security/apparmor/profiles; then exit 0; fi

echo "Moxi cannot start: its AppArmor profile is not loaded." >&2
if [ -f "$profile" ]; then
  echo "Fix: sudo apparmor_parser --replace $profile" >&2
else
  echo "Fix: sudo cp $app_dir/resources/apparmor-profile $profile && sudo apparmor_parser --replace $profile" >&2
fi
exit 1
```

### 2.5 Measure results

```ts
// e2e/measures/record.ts (M2-07). One JSON file per result: .evidence/measures/<proof>-<name>.json
export type MeasureResult = {
  readonly proof: string; // "P11", "PB8", "P29", …
  readonly name: string; // "worker-w", "hub-scroll-p99", …
  readonly unit: "MiB" | "ms" | "count" | "percent";
  readonly runs: readonly number[]; // 5 values, in run order
  readonly median: number;
  readonly threshold: number; // an upper bound from 01 §1.6 or 05 §4.4
  readonly withinThreshold: boolean; // median <= threshold; informs Opus, never gates
  readonly os: "linux" | "windows" | "macos";
  readonly commit: string; // GITHUB_SHA
};

export function recordMeasure(
  input: Pick<MeasureResult, "proof" | "name" | "unit" | "runs" | "threshold">,
): Promise<MeasureResult>; // throws unless runs.length === 5
```

### 2.6 Egress and code-generation rows (P1, P3)

```ts
// e2e/plugin-egress.e2e.ts (M5-10). Chaos plugins `egress` and `codegen` report one row per attempt.
type Outcome = "threw" | "undefined" | "noEffect" | "posted" | "succeeded";
type AttemptRow = readonly [attempt: string, outcome: Outcome];
type ListenerCount = { readonly hits: number; readonly bytes: number };
// Listeners on 127.0.0.1, port 0: http, https (self-signed), ws, turnTcp, stunUdp, quic (WebTransport).
```

The literal lists are in section 8.

## 3. Constants

CI and packaging values only (plugin budgets: 05). Runner labels `ubuntu-24.04`, `windows-2025`,
`macos-15` are pinned because `-latest` moves. Node comes from `.node-version` (24.18.0 today).
`nightly.yml` runs at `cron: "17 2 * * *"` and `build.yml` at `cron: "47 2 * * *"` (UTC). Artifact
retention is 7 days. Linux package metadata: `maintainer: "Moxi <noreply@example.invalid>"` until
Matthias sets the real one; `synopsis: "Guild Wars launcher with a Hub and plugins"`;
`description: "Moxi runs ArenaNet's official Guild Wars client with a launcher, a Hub and plugins."`
The xvfb screen, sysctl, PR labels (`gate`, `long`, `measure`), `MOXI_MACOS_LANE`, the `@long`
threshold (a test over 2 minutes), the `.deb` artifact name and the AppImage toolset are in 1.2 to 1.4.

## 4. Decisions

| Decision | Reason | Rejected |
| --- | --- | --- |
| Electron checks run in CI only; `playwright.config.ts` refuses outside CI | no window may open on Matthias's Mac; a guard beats an unenforced rule | hidden local windows |
| PRs: Linux only. Windows nightly. macOS behind a repo variable | private-plan minutes cost 2× on Windows and 10× on macOS | three OSes on every PR |
| e2e runs with the Chromium sandbox on (`chromiumSandbox: true` and the sysctl); the packaged lane keeps stock AppArmor | else Playwright adds `--no-sandbox` and CI never tests the real sandbox; the packaged lane must test what a player's Ubuntu does | unsandboxed e2e; the sysctl in the packaged lane |
| `.deb` is the Linux package; the AppImage is built, not released | the AppImage runs without the namespace sandbox on Ubuntu 23.10+ | the AppImage as the package; `executableArgs: []` (changes only the desktop entry) |
| `.deb` post-install prints the fix; never fails the install | the app aborts before Main code runs, so no app text can explain it; a failed postinst leaves a half-configured package | a start wrapper; failing the install |
| Fuse read-back after every package; `identity.ts` owns `appId` and `productName` | `afterPack` can silently not run; the Windows AUMID must match the installer's shortcut | trusting the build log; two literals |
| Two data roots; Windows Local, Linux XDG; macOS unchanged | the 4 GB game cache must not roam | Roaming app data; v1's six roots |
| Data roots without Electron, path flavour by platform | one function for Main and scripts; literal tests on every OS | `app.getPath()` plus test literals that change with the host OS |
| Async credential store now; `basic_text` means no "Remember login" | Electron 46 removes the sync API; a plain-text secret on disk is not a credential store | change at the Electron 46 upgrade; warn and store |
| Real-client boot: nightly, non-gating, never cached | patch-server outages would flake PRs; ArenaNet files stay out of GitHub storage | a PR gate; caching the chunk store |
| SwiftShader only through a Dev-only switch | the player's security posture never changes for CI | the switch in product code |
| One Playwright config with projects; labels select long, gate and Measure runs | one runner, one report format; minutes only when Opus asks | one config per lane; Measures on every PR |
| Packaged lane reads the app through a Chromium CDP port (`--remote-debugging-port=0`) and `/proc` | the inspect fuse is off in packaged builds and the product gets no test switch | a test-only product flag; outside reads only (they cannot see the page reason) |
| Long and non-Linux checks become gates after 5 green runs in a row | 20 runs of a 5-minute test or a nightly job are not practical | 20 runs everywhere; never gating |

## 5. Today in code (main 848fb6e) and what changes

| Item | Today | Change | Slice |
| --- | --- | --- | --- |
| `.github/workflows/ci.yml` | `ubuntu-latest`, 10 min each; no Playwright Chromium for the Hub suite; `xvfb-run --auto-servernum pnpm e2e`, no sandbox; red on `main` since 2026-10-04 | Chromium install, sysctl, xvfb screen, evidence upload, no `MOXI_BACKGROUND` on Linux (`apps/desktop/src/shell/main.ts:57` applies it today) (branch `ci-green-clean`); then `permissions`, `concurrency`, pinned labels, label jobs (1.3) | M0-01, M0-04 |
| e2e launches | no `chromiumSandbox` (`e2e/shell.e2e.ts:83`, `:259`, `:299`; `e2e/plugin-isolation.e2e.ts:40`); fixed port `MOXI_PATCH_ROOT = "http://127.0.0.1:4699"` (`e2e/shell.e2e.ts:49`); `ps -axo` (`:29`); `execFile("pnpm", …)` (`:98`) | sandbox on; port 0; Electron process list and `process.execPath` | M0-01, M0-04, M8-02 |
| `playwright.config.ts` | one config, `outputDir: ".evidence/c2/playwright"`, timeout 300 s | projects, CI guard, `.evidence/e2e/<project>/` | M0-04 |
| `build.yml`, `electron-builder.config.ts` | `build.yml`: dispatch and tags; `*-latest` runners; uploads zip, dmg, exe, AppImage; never ran. Config: `appId` literal (`:6`), also in `apps/desktop/src/identity.ts:7-8`; `allowElevation` (`:67`); Linux AppImage only (`:68-72`); no maintainer or `artifactName`; fuses flipped (`:33`), never read back | 1.3, 1.4 | M0-06 (identity), M8-01, M8-03 |
| `apps/desktop/src/folders.ts` | packaged roots under `app.getPath("appData")` (Windows Roaming, Linux `~/.config`); test literals depend on the host OS (`folders.test.ts:7-17`); cache root computed twice (`shell/main.ts:25-30`, `scripts/fetch-client.ts:5-9`; Windows fallbacks differ) | 1.5, 2.1: one function | M8-04 |
| `apps/desktop/src/storage/credentials.ts` | sync interface, injected crypto; tested; never constructed; no `safeStorage` anywhere | 2.2, wired in Main | M9-02 |
| `apps/desktop/src/identity.ts` | packaged builds always `Moxi` / `stable`; `beta` never produced | channels per build (open question) | M9-10 |
| `.gitattributes`, `nightly.yml`, `measures.yml`, `scripts/check-fuses.ts`, `build/linux/*`; seven `probe/*` branches with `paths-ignore` | none; never merged | 1.1, 1.3, 1.4; probes archived | M8-02, M2-07, M8-01, M0-07 |

## 6. Migration order

`docs/build/milestones.md` owns the slices and gates. This table maps milestones to the design's
migration steps and shows where action chains (OD2) and `game.vitals` (OD3) land.

Goals and gates are in `milestones.md`. Design steps: M0 0; M1 2 (M1-00 moves the old SDK to
`packages/sdk/src/legacy`); M2 3; M3 4; M4 5 (M4-09 membrane); M5 6 and 12 (the game window
switches to `@moxi/hub` in M5-06); M6 7; M7 8 (part), 9, 10; M8 11; M11 12 (live); M14 8 (rest).

- **Chains (OD2):** `chainable` (M1-01), step cap (M1-02), `commands[].game.steps` (M1-03), page
  lines (M1-07); progress "2/4" and cancel (M3-07); whole-chain authorization (M4-07); chain
  executor and P81 fixture half (M5-08); team apply by chain or host flow (M6-01); page lists the
  steps (M7-04); chains live (M11-10); a new op in a chain is an escalation (M14-03).
- **`game.vitals` (OD3):** entry, schema, `rateHz` (M1-01); READS line (M1-07); simulator fake
  (M2-05); fixture structs (M5-01), publisher, P82 (M5-07); live (M11-05).
- **After M8:** R1 (Opus platform review, then live session 1 with Matthias). M14 runs alongside
  M13 and is required for 1.0 Stable. M15 (Public Beta) needs M13, not M14.

Order rules:

1. A slice starts when its dependencies are merged (README "Pick"), at most three at once. Slices
   that depend only on M0 (for example M5-01, M5-02, M5-04, M5-05, M5-11, M8-01, M8-04) may run
   beside M1 to M4; design step 12 runs in parallel from step 2.
2. No live game session before review gate R1.
3. The old SDK (`packages/sdk/src/legacy`, from M1-00) keeps working until M6-03 deletes it, with
   the dev harness, `scripts/build-plugins.ts`, `Blocks.vue` and `Icon.vue`. The old Hub runs on
   it until M5-06.
4. Code the design deletes goes in the slice that builds its replacement. Each spec's "Today in
   code" table names that slice (for example the per-window `PluginHost` in M4-05, 03 and 02;
   `plugin.bundles` in M4-02, 07; the renderer chord in M5-09, 11).

## 7. Built by

| Slice | Builds from this file |
| --- | --- |
| M0-01 | `ci.yml` from `ci-green-clean`; `chromiumSandbox: true` in every launch; no background mode on Linux |
| M0-02, M0-03 | the OS-skip rule for the Windows case of `e2e/startup.e2e.ts`; CI mode of `pnpm gate` for e2e files |
| M0-04 | port 0; Playwright projects (`fixture` first), CI guard, `outputDir`; `@long`; `permissions`, `concurrency`, pinned labels and the `e2e-long` and `e2e-gate` jobs in `ci.yml` (budget ≤ 300 lines) |
| M0-06, M0-07 | `"./identity"` export, config reads `appId` and `productName` from it; archive the probe branches with their `paths-ignore` |
| M2-07 | `measures.yml`, project `measure`, `e2e/measures/record.ts` (2.5) |
| M4-05, M5-10 | P20 journey tagged `@long`; `e2e/plugin-egress.e2e.ts` with the P1 and P3 lists (section 8) |
| M8-01 | `build.yml` (1.3 `package`), the Linux block, NSIS cleanup, `fuses` export, `scripts/check-fuses.ts`, `build/linux/after-install.tpl`, `build/linux/linux-sandbox-check.sh` |
| M8-02 | `nightly.yml`, `.gitattributes`, `MOXI_SOFTWARE_GL`, `e2e/real/boot.real.ts`, Windows fixes in e2e helpers (`process.execPath`, Electron process list) |
| M8-03, M8-04 | `deb-sandbox` job and `e2e/packaged/linux-sandbox.pk.ts`; `resolveFolders` (2.1) with its table test, `"./folders"` export, `scripts/fetch-client.ts` uses it |
| M9-02; M9-10, M15-01 to M15-03 | `createCredentialStore` (2.2) and its `safeStorage` wiring in `shell/`; release lanes (1.8) |

## 8. Checked by

| Proof | What it checks here | Where | Owner |
| --- | --- | --- | --- |
| P1 | egress list 8.1: rows equal, 0 hits and 0 bytes at all six listeners | E3 | M5-10 |
| P3 | code-generation list 8.2: rows equal | E3 | M5-10 |
| P5 (packaged half) | the `.deb` and AppImage cases of 8.3 | Pk | M8-03 |
| P20 | hidden hosts keep their timers (criteria: 03 §7) as a `@long` journey | E3 nightly | M4-05 (Linux), M8-02 (Windows) |
| P71 | every expected artifact on its OS; `check-fuses` prints only `ok` lines | Pk | M8-01 |
| P72 | every fixture e2e with the sandbox on: Linux 20 of 20 in `e2e-gate` before merge; Windows (and macOS while its lane is on) 5 nightly runs in a row before the job counts | E3 | M0-01 (Linux), M8-02 |
| P73 | cases of 8.3 against 03 §7 | Pk | M8-03 |
| P76 | 8.4 | nightly canary | M8-02 |

Node tests here, each with its bug: `folders.test.ts` (the Windows game cache lands in Roaming; a
Dev build writes into release data; a relative `XDG_CACHE_HOME` is used); `credentials.test.ts`
(a `basic_text` backend stores a secret; a `reEncrypt` answer is ignored; a secret appears in
captured stdout or stderr of the test run).

### 8.1 P1 egress list (worker of the chaos plugin `egress`, in an `unverified.local` host)

| Outcome | Attempts |
| --- | --- |
| threw | `fetch` http, https (loopback), with `keepalive`, and `fetch("moxi://app/game/index.html")`; `XMLHttpRequest`, `WebSocket`, `WebSocketStream`, `EventSource`, `WebTransport`; `importScripts` (http); `import()` of http, https, `data:`, `blob:` URLs and of `moxi://app/game/index.html`, `moxi://app/client/Gw.snapshot`, `moxi://app/plugin-host/index.html` |
| undefined | `navigator.sendBeacon`, `fetchLater`, `RTCPeerConnection` (STUN and TURN rows); `new Worker(data:)` that fetches; `SharedWorker`; `navigator.serviceWorker` |
| succeeded | `import()` of the runtime URL `moxi://app/plugin-host/code/<sha>.js` (the only `moxi` import that may succeed) |
| posted | `BroadcastChannel` to a sibling install's worker; the sibling receives 0 messages |

### 8.2 P3 code-generation list (worker of the chaos plugin `codegen`)

| Outcome | Attempts |
| --- | --- |
| threw | `eval`, `new Function`; session `setTimeout("…")` (the wrapper of 06 §7.3); `import()` of `data:` and `blob:` modules; `WebAssembly.compile`, `instantiate`, `new WebAssembly.Module`, `compileStreaming` on an 8-byte module |
| noEffect | `globalThis.setTimeout("…")` |
| succeeded | `WebAssembly.validate` on the same module (returns `true`; creates no code) |
| undefined | `new Worker(data:)`, `new Worker(blob:)` (`"Worker" in globalThis` is false) |

### 8.3 Packaged Linux cases (`e2e/packaged/linux-sandbox.pk.ts`)

Each started case uses a fresh `MOXI_DATA_DIR`, a `MOXI_GAME_CACHE` seeded with the fixture client
(`seedFixtureClient`), the ArenaNet patch host blocked (the fixture cache is the only game), and
one dev-folder install of a fixture plugin seeded through Main's registry module (15) before
start. The test spawns the binary with `--remote-debugging-port=0`, takes the port from the stderr
line `DevTools listening on ws://127.0.0.1:<port>/…`, and connects with
`chromium.connectOverCDP`. It reads Main's `/proc/<pid>/cmdline` and, for every renderer,
`/proc/<pid>/status` (`Seccomp:`, `NSpid:`); it runs the product's `sandboxState` (03 §2) on these
reads and expects the same verdict the app shows on its plugin page. Cases run in this order:

| Case | Start | Expected |
| --- | --- | --- |
| `deb-default` | `/opt/Moxi/moxi` | every renderer `Seccomp: 2` and `NSpid` deeper than Main's; no `--no-sandbox`; official and dev plugins run |
| `deb-usr-bin` | `/usr/bin/moxi` | same |
| `deb-no-sandbox-flag` | `/opt/Moxi/moxi --no-sandbox` (negative control) | non-official refused, official running, the sandbox reason on the page |
| `appimage-default` | the AppImage | same as the negative control |
| `deb-no-profile` | `sudo apparmor_parser -R /etc/apparmor.d/moxi`, then `/opt/Moxi/moxi` | `sudo /opt/Moxi/resources/linux-sandbox-check.sh` exits 1 and prints `Fix: sudo apparmor_parser --replace /etc/apparmor.d/moxi`; the app exits by itself within 10 s and opens no window |

### 8.4 P76 real-client boot (`e2e/real/boot.real.ts`)

Unpacked app, `chromiumSandbox: true`, `MOXI_SOFTWARE_GL=1`, no `MOXI_PATCH_ROOT`, a fresh game
cache. Each step is a `test.step`, so the first failing step names the cause:

1. On the launcher page, call `download.pause` first (the minimum playable set still downloads;
   the background fill does not).
2. `download`: Play becomes available (step limit 15 min).
3. `boot`: press Play; the game window opens.
4. `gpu`: write `app.getGPUFeatureStatus()` to the evidence.
5. `frames`: count `requestAnimationFrame` callbacks in the game page for 5 s; every 1-s bucket is
   above 0.
6. `screen`: a screenshot of the game page has at least 1 % of pixels with a channel above 16.
7. `promoted`: `<gameCache>/generations.json` has a non-null `active` within 60 s.

From M10-02, the job also runs `pnpm compat:check` on the downloaded generation (the P50 canary).

## 9. Deferred

- **macOS CI lane** and **AppImage release**: off until the repo is public or Matthias approves the
  minutes (then `MOXI_MACOS_LANE=on`); the AppImage is built, not released (BD11).
- **Windows rename retry in the chunk store**: only if the Windows nightly shows `EPERM` or
  `EBUSY` from antivirus scans of fresh chunk files.
