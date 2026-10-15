# 15 Distribution and compat

## Purpose

How plugin code reaches a player's machine and stays the code the player accepted: the `.moxi` package,
content-addressed store, install records, sources, updates, withdrawals, signed feeds and the compat feed with
kill switches.

## 1. Rules in force

### 1.1 Sources

| Source | Source key | Code comes from | Who vouches | Integrity | Updates | Badge | Host group | Available |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Official | `official` | bundled in the app (§4); from M14 also the signed index (§8) | moxi CI and review | SHA-256 in the bundled or signed index | with app releases; from M14 also from the index; automatic unless escalating | "By Moxi" | `official` | 1.0 Beta |
| Dev folder | `dev:<pathHash>` | `<folder>/dist/plugin.moxi` (§5) | the player | SHA-256 per load | on file change | "Development" | `unverified` | 1.0 Beta, Developer mode only |
| Community | `community` | the author's GitHub release, pinned in the signed index (§8) | registry review | SHA-256 + commit in the signed index | automatic unless escalating | "Reviewed" | `reviewed` | M14 |
| GitHub repo | `gh:<ownerId>` | any public `owner/repo` the player adds (§9) | nobody | trust on first use: owner id, repo id, SHA-256 | ask by default | "Not reviewed" | `unverified` | M14, behind a switch, off by default |

Ids, source keys (`gh:[1-9][0-9]{0,14}`), install keys (SOURCE_KEY + PLUGIN_ID) and `hostGroupOf` are defined
once in spec 01 §3 (`@moxi/sdk/host`, `ids.ts`). Official plugins stay in `plugins/*` until the SDK is published
(spec 01 decision 6).

### 1.2 Rules

1. **One install path.** Every source ends in §3.3's steps; bundled official plugins too (P67).
2. **The package manifest is the only authority.** Index entries and `moxi-release.json` are derived; Main
   refuses a package whose derived data differs.
3. **Executed code = hashed bytes.** Content-addressed store, SHA-256 checked on every load, a package never
   extracted to disk.
4. **Ids are bound to the publisher** (§3.4). One install per plugin id.
5. **Withdrawals reach every source** and apply within one index fetch, also offline from the last good copy
   (§8.3).
6. **The compat feed changes locators and kill switches only**; never a capability, fact, action, grant, region
   or rate (BD3, P80, §7.2).
7. **One verifier** (`apps/desktop/src/feeds.ts`) for both signed feeds; two owners, two cadences, two key pairs
   (§6).
8. **Fail closed, keep playing** (AGENTS rule 4): a bad package, feed or download affects only its own install
   or feed; the last good state stays.
9. **No telemetry** (AGENTS rule 3): static-file GETs and the GitHub API calls of §9; no cookies.
10. **Matthias decides** signing keys, the distribution host and every publication of compat data or the index.
    Code ships with no production key or host until he gives them (§6.1); it then fetches nothing.

## 2. Package format

### 2.1 Types (`packages/sdk/src/host/package.ts`, M1-06)

```ts
import type { JsonValue, Manifest, ManifestWarning, SemVer } from "./manifest.ts";
export type JsonObject = { readonly [k: string]: JsonValue };
export type Sha256 = string; // 64 lowercase hex
/** The file `plugin.moxi`. Exactly these three keys. */
export type MoxiPackage = { readonly format: 1; readonly manifest: JsonObject; readonly code: string };
export type ParsedPackage = {
  readonly manifest: Manifest;      // parseManifest(rawManifest).manifest
  readonly rawManifest: JsonObject; // as stored; compared with index and release data
  readonly code: string;            // function-body bundle (spec 06, spec 08)
  readonly warnings: readonly ManifestWarning[];
};
/** The release asset `moxi-release.json`, derived from the package. */
export type ReleaseFile = {
  readonly id: string; readonly version: SemVer; readonly sha256: Sha256;
  readonly size: number; readonly manifest: JsonObject;
};
export type PackageErrorCode =
  | "too-large" | "not-utf8" | "not-json" | "too-deep" | "not-a-package" | "newer-format"
  | "code-too-large" | "manifest-too-large" | "manifest" | "needs-newer-host";
export class PackageError extends Error { constructor(readonly code: PackageErrorCode, message: string); }

export function parsePackage(bytes: Uint8Array): ParsedPackage; // throws PackageError
export function packPackage(rawManifest: JsonObject, code: string): Uint8Array;
export function canonicalJson(value: JsonValue): string;
export function sha256Hex(bytes: Uint8Array): Promise<Sha256>; // crypto.subtle; Node and browser
export function releaseFileBytes(pkgBytes: Uint8Array): Promise<Uint8Array>; // canonical ReleaseFile
export function checkReleaseFile(value: unknown, pkgBytes: Uint8Array, pkg: ParsedPackage): Promise<boolean>;
```

`host/` may import only `arktype` (spec 02), so hashing uses `crypto.subtle`, not `node:crypto`.

### 2.2 `parsePackage`, in this order

| Step | Check | Error code | Host text |
| --- | --- | --- | --- |
| 1 | `bytes.byteLength ≤ budgets.code.packageBytes`, before decoding | `too-large` | the package is too large |
| 2 | UTF-8 with `TextDecoder("utf-8", { fatal: true })` | `not-utf8` | the package is damaged |
| 3 | nesting depth ≤ `budgets.code.jsonDepth`, by a scan before `JSON.parse` (count `{` and `[` outside strings; the root object is depth 1) | `too-deep` | the package is damaged |
| 4 | `JSON.parse` | `not-json` | the package is damaged |
| 5 | `format` is an integer above 1 | `newer-format` | Needs a newer Moxi |
| 6 | ArkType, `"+": "reject"`: `{ format: 1, manifest: object, code: string }`. Any other key (an `assets` key included) refuses the file | `not-a-package` | this is not a Moxi plugin package |
| 7 | UTF-8 bytes of `code` ≤ `budgets.code.codeBytes` | `code-too-large` | the plugin code is too large |
| 8 | UTF-8 bytes of `canonicalJson(manifest)` ≤ `budgets.code.manifestBytes` | `manifest-too-large` | plugin.json is too large |
| 9 | `parseManifest(manifest)` (spec 04 §8.6). `needs-newer-host` maps to that code; `malformed` and `read-and-internet` map to `manifest` | `manifest` | `plugin.json: <ManifestError message>` |
| 10 | the build-written fields `minHost` and `vueCompiler` are present (spec 04 §8.1) | `not-a-package` | this is not a Moxi plugin package |
| 11 | `checkHost(manifest)` (spec 04 §8.7) | `needs-newer-host` | Needs a newer Moxi |

### 2.3 Pack and release file

- `packPackage(m, code)` = UTF-8 of `canonicalJson({ format: 1, manifest: m, code })`, no BOM, no trailing
  newline. `moxi pack` (spec 08 §5.6) calls it, then `parsePackage` on the result.
- `canonicalJson`: keys sorted by UTF-16 code unit, no whitespace, arrays in order, strings and numbers as
  `JSON.stringify` writes them. The same `dist/` gives the same bytes on every OS.
- Package identity = `sha256Hex(fileBytes)`.
- `releaseFileBytes(pkg)` = canonical JSON of `{ id, version, sha256, size, manifest }`. `checkReleaseFile`
  passes when the value parses as `ReleaseFile` and every field equals the package (`sha256` of the bytes,
  `size` = byte length, `canonicalJson(manifest)` equal).
- A GitHub release carries both files as assets: `plugin.moxi` and `moxi-release.json`.

## 3. Store and registry (Main)

### 3.1 Files

| Path | Holds | Slice |
| --- | --- | --- |
| `apps/desktop/src/plugins/store.ts` | content-addressed store: `put`, `read`, `collect` | M4-02 |
| `apps/desktop/src/plugins/registry.ts` | install rows, install path, load, updates, uninstall, bundled reconcile, test installs | M4-02 |
| `apps/desktop/src/plugins/dev-folders.ts` | dev folder add and watch (§5) | M7-05 |
| `apps/desktop/src/feeds.ts` | signed feed verifier, fetch, cache (§6) | M9-11 |
| `apps/desktop/src/compat.ts` | compat feed per game build (§7) | M9-11 |
| `apps/desktop/src/plugins/plugin-index.ts` | signed plugin index (§8) | M14-01 |
| `apps/desktop/src/plugins/github.ts` | GitHub repo resolve, check, id check, download (§9) | M14-02 |

Data folder (the root itself: spec 16):

```text
<data>/plugins/<sha256>.moxi        immutable packages; nothing else is executed
<data>/plugins/<random>.tmp         writes in progress; deleted by collect()
<data>/feeds/compat-<build>.cache   last good compat file per game build (§6.3)
<data>/feeds/plugins-index.cache    last good plugin index (§8)
```

### 3.2 SQL

This spec owns `plugin_sources` and `plugin_installs`. Grants, settings values, HUD, panels, marks, bindings,
action log, crashes and the activity table: spec 12; documents: spec 14. One new migration in M4-02, numbered in
merge order (spec 16).

```sql
CREATE TABLE plugin_sources (
  source_key TEXT PRIMARY KEY,     -- 'official' | 'community' | 'gh:<ownerId>' | 'dev:<pathHash>'
  owner_login TEXT,                -- gh: the login at the last API answer (display, id prefix at first install)
  folder TEXT,                     -- dev: the real path the player chose
  trusted_at INTEGER               -- gh: when the player answered "Trust plugins from <owner>?"
) STRICT;
CREATE TABLE plugin_installs (
  install_key TEXT PRIMARY KEY,    -- '<source_key>/<plugin_id>' (spec 01 §3)
  source_key TEXT NOT NULL,        -- plugin_sources.source_key
  plugin_id TEXT NOT NULL UNIQUE,  -- one install per plugin id
  version TEXT NOT NULL,
  sha256 TEXT NOT NULL,            -- the package that runs
  previous_sha256 TEXT,            -- for "Use previous version"
  next_sha256 TEXT,                -- a verified update that waits
  next_wait TEXT CHECK (next_wait IN ('idle', 'consent')),
  repo_id INTEGER, repo_name TEXT, -- gh: numeric repo id and the current 'owner/repo'
  checked_at INTEGER,              -- gh: last update check, ms since epoch
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  disabled_reason TEXT CHECK (disabled_reason IN ('player', 'crashed')),
  auto_update INTEGER NOT NULL CHECK (auto_update IN (0, 1)),
  installed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  CHECK ((next_sha256 IS NULL) = (next_wait IS NULL)),
  CHECK ((enabled = 1) = (disabled_reason IS NULL))
) STRICT;
```

- **`InstallStatus`.** The stored `disabled_reason` is `player` or `crashed` only. The full type, with the
  computed `status: "on" | "off" | "withdrawn" | "incompatible" | "damaged"` and the run flags, is defined once in
  spec 12 §8 (`packages/sdk/src/host/page.ts`); this section owns the rules that compute `status`.

  `status` is `off` when `enabled = 0`; `withdrawn` (§8.3), `incompatible` and `damaged` come from the last good index
  and the package (§3.5) and win over `on`.
- No `tier`, `kind` or owner-id column: the source key holds them (BD6, spec 03 §1.3). Withdrawn, cannot load,
  needs a newer Moxi, incompatible, damaged, sandbox-refused, experimental in Stable and source switched off are
  computed each run from the last good index and the package, never stored (§3.5, §8.3).
- No `REFERENCES` or `CASCADE`: foreign keys are off in `openDatabase`. An uninstall or install-key change edits
  the keyed tables in the same transaction (§3.7, §8.5); documents survive an uninstall that keeps data.

### 3.3 Install path

| Step | Official (bundled or index) | Community (M14) | GitHub repo (M14) | Dev folder |
| --- | --- | --- | --- | --- |
| 1 Bytes | read the bundled file, or download the index `url` | download the index `url` | §9.3 | read `<folder>/dist/plugin.moxi` |
| 2 Pin | SHA-256 = bundled or index `sha256`; size = `size` | same | SHA-256 = `moxi-release.json` `sha256`, and `checkReleaseFile` | none; the hash is recorded |
| 3 Parse | `parsePackage` (§2.2) | same | same | same |
| 4 Ids | §3.4 | §3.4 | §3.4 | §3.4 |
| 5 Platform | `manifest.platforms`, when present, includes this OS (enforced at install and load, P18) | same | same | same |
| 6 Derived data | index entry equals the manifest (§8.2) | same | done in step 2 | – |
| 7 Withdrawn | no withdrawal matches (§8.3) | same | same | same |
| 8 Consent | pre-granted (required permissions only), no page (spec 12) | page, player accepts | page, player accepts | page on first load |
| 9 Store | `store.put(bytes, sha256)` | same | same | same |
| 10 Commit | one transaction: source row (insert if absent), install row, grant rows from spec 12 | same | same | same |
| 11 Run | push host state (spec 07); reconcile hosts (spec 03) | same | same | same |

- Downloads stop at `budgets.code.packageBytes` and `budgets.code.downloadMs`.
- `store.put`: write `<random>.tmp` in `<data>/plugins/`, `fsync`, rename to `<sha256>.moxi`, `fsync` the
  folder; an existing file is not rewritten.
- A refusal before step 10 changes nothing. A crash between step 9 and 10 leaves an unreferenced file that
  `collect()` deletes at the next start.
- Before M14 a candidate exists only for dev folders. From M14, Main holds one verified candidate per (source,
  plugin id) in memory until the player installs or dismisses it, so the page is built from the real package.

### 3.4 Id rules

| Source | Rule | Error text |
| --- | --- | --- |
| Official | the id starts with `moxi.` | Official plugins use ids that start with moxi. |
| Community | the id starts with the lowercased index `repo.owner` + `.` | The plugin id must start with `<owner>.` |
| GitHub repo | the id starts with the lowercased owner login (API answer at first install) + `.` | same |
| Any other than official | the id does not start with `moxi.` | Ids that start with moxi. belong to official plugins |
| Any | no install row with this `plugin_id` from another source | Uninstall `<installed name>` first |
| Update | the package id equals the install's `plugin_id` | The package is for another plugin |

The prefix is checked once, at first install; later owner renames keep the install (its key holds the owner id).
`moxi.` only for official, and official only `moxi.`.

### 3.5 Load

At app start the registry reads every install's package from the store, checks its SHA-256 against
the row, parses it (§2.2) and checks the platform; the parsed manifest stays in memory for the run.
`plugin.code` (spec 07) checks the hash again before every send. A failure means the install does
not run this run (others do) and its row says "Can't load: …":

| Failure | Row text |
| --- | --- |
| file missing, or SHA-256 differs from the row | Files changed on disk |
| a `PackageError` | its host text (§2.2) |
| wrong platform | Made for `<macOS, Windows, Linux list>` only |

A bundled or test install refused at install time has no row; Main keeps it for the run as
`RegistryProblem = { source: SourceKey; id: string | null; reason: string }`, shown as a "Can't
load" row (spec 12 `PluginRow`). One bad package never blocks another (P18).

### 3.6 Applying updates

`decideUpdate` (spec 12) decides; this section applies its outcome to the install row.

| Outcome | Row change |
| --- | --- |
| apply, apply when idle | `next_sha256` = candidate, `next_wait = 'idle'`; applied at the next idle moment |
| ask (GitHub, `auto_update = 0`), hold ("Needs your OK"), apply with consent sheet (dev) | `next_wait = 'consent'`; the old version keeps running; `plugins.update { choice: "allow" }` applies it |
| reload at once (dev) | applied now |
| refuse, not offered, error row | no row change; the reason shows on the page (spec 12) |
| hold as a new source | a separate candidate for the new source; the install is unchanged |

- **Idle** = no plugin session open in any game window (app start, or the last session closes; spec 03 §1.5): a
  running session would lose local state. Every non-held apply waits for idle.
- **Apply** (one transaction): `previous_sha256 = sha256`, `sha256 = next_sha256`, `version` from the new
  manifest, `next_* = NULL`, grant changes (spec 12), `updated_at`. Main then pushes the new `sha256` and the
  host restarts that worker (spec 07).
- A newer candidate replaces a waiting one. Same version with different bytes never applies. A check that finds
  `sha256` equal to the running or waiting package does nothing.
- `auto_update` starts at 1 for official and community installs, 0 for GitHub installs; the page switch changes
  it (spec 12). Dev installs ignore it.
- **Use previous version** (`choice: "previous"`): swap `sha256` and `previous_sha256`, set `version` from that
  package, set `auto_update = 0`. Grant rows stay; effective grants use requested ∩ granted (spec 12).

### 3.7 Turn off, uninstall, collect

- **Turn off**: `enabled = 0`, `disabled_reason = 'player'`; workers stop in every session; grants kept. "Turn
  on again" clears it and the crash rows (spec 03 §1.8).
- **Uninstall** (official installs offer only Turn off): stop; in one transaction delete the install row and
  every row keyed by its install key (spec 12 tables). "Keep its data?" (default keep) keeps or deletes that
  install key's documents (spec 14). A reinstall from the same source gets the same key and its documents back.
  Source rows stay (a trust answer is asked once per owner).
- **`collect()`**, at app start and after every commit that changes package references: delete each `*.tmp` and
  each `*.moxi` that no row names in `sha256`, `previous_sha256` or `next_sha256`
  (`budgets.code.previousPackages` = 1 holds by construction).

## 4. Official plugins bundled with the app

### 4.1 Bundled index (B-D7)

`apps/desktop/dist/plugins/bundled.json`, written by `scripts/build-plugins.ts --bundled`; inside
the signed app, so no signature:

```ts
type BundledIndex = { format: 1; plugins: { id: string; version: SemVer; sha256: Sha256; size: number }[] };
// the package file is <sha256>.moxi beside it
```

- Location: packaged `join(app.getAppPath(), "dist", "plugins")` (in the asar; `files: ["dist/**"]` ships it);
  Dev `join(repoRoot, "apps/desktop/dist/plugins")`.
- `--bundled` packs every `plugins/<name>` on the new SDK layout (`src/plugin.ts`, spec 08) with the build and
  `packPackage` of `moxi pack`, writing `<sha256>.moxi` and `bundled.json` sorted by id. Old-SDK folders keep
  today's output in `apps/plugin-host/dist/plugins/` until M6-03. A package is never written under a renderer's
  `dist/`.
- `--e2e` also packs the fixture plugins into `apps/plugin-host/test-fixtures/dist/` with `installs.json` for
  `MOXI_TEST_INSTALLS` (§4.3); fixtures are never bundled.

### 4.2 `reconcileBundled()` at app start (no network)

For each bundled entry, after `collect()`:

1. No install row with that id: install from the bundled file (§3.3, official, pre-granted).
2. An official install exists: the bundled package is an update candidate; with the index (M14) the candidate is
   the highest version among bundled and index that passes §3.3 steps 2-7. A lower version never replaces a
   higher one.
3. An install of that id from another source exists: skip; problem row "Uninstall `<name>` first".

An official install that neither `bundled.json` nor the signed index lists is uninstalled with its data kept. An
official plugin the player turned off stays off across app updates. `stage: "experimental"` (spec 04): in the
`stable` channel (`apps/desktop/src/identity.ts`) Main does not install, list or run such an official install;
Dev and Beta do; other sources ignore the field.

### 4.3 Test installs (BD22)

`MOXI_TEST_INSTALLS` = absolute path of a JSON file, read only when `!app.isPackaged` (the
`MOXI_PATCH_ROOT` pattern, `shell/main.ts:72`).

```ts
type TestInstall = {
  source: SourceKey;        // any; 'gh:<n>' gets owner_login "test", 'dev:<hash>' gets folder = dirname(file)
  file: string;             // absolute path of a .moxi
  sha256?: Sha256;          // the pin; default: the file's own hash (set a wrong one to test refusals)
  grants?: "all" | "none";  // default "all": every requested id granted, no page
};
```

After `reconcileBundled()`, Main runs each entry through §3.3 without step 8, so P5, P7, P16 and P18
run non-official installs from M4 on. Packaged lanes (P73) add a dev folder instead (§5).

## 5. Dev folders (M7-05)

- Settings → Developer mode (app setting `pluginDeveloperMode`, boolean, default `false`) → "Load plugin
  folder…". Main opens the folder dialog; no renderer-chosen path (spec 08 §6.5). Without the mode the action is
  absent and dev installs do not run. Source key `dev:<pathHash>` (spec 01 §3); the source row keeps `folder`.
- Main watches `<folder>/dist/` with `fs.watch`; a change to `plugin.moxi` waits the dev debounce (spec 05
  §4.3), reads the file, and skips it when its hash equals the running or waiting package. Else it runs §3.3 and
  `decideUpdate` with source dev (reload at once, or the consent sheet for a new permission; old grants stay
  until accepted). Target ≤ 1 s to the restarted worker (spec 05 §4.4, P70).
- A half-written or bad file shows its text on the page ("Can't load: …") and the running version stays; the
  next change retries (`moxi pack` writes by temp + rename, spec 08). Missing folder or `dist/plugin.moxi`: "No
  dist/plugin.moxi in `<folder>`. Run pnpm build there." The stored version keeps running.
- Dev installs run in the `unverified` host, keep the CSP, and see every consent rule.

## 6. Signed feeds (`apps/desktop/src/feeds.ts`)

### 6.1 Keys, host and URLs

```ts
export type FeedName = "compat" | "plugins";
export type FeedKey = { readonly id: string; readonly x: string }; // Ed25519 public key, base64url (JWK "x")

export const FEED_KEYS: Record<FeedName, readonly FeedKey[]> = {
  compat: [],  // [current, next] = ids "compat-2026", "compat-2027"; public halves from Matthias
  plugins: [], // [current, next] = ids "plugins-2026", "plugins-2027"
};
export const DEV_FEED_KEY: FeedKey; // id "dev"; accepted for both feeds only when !app.isPackaged
export const DIST_ROOT: string | null = null; // "https://<host>/<path>/"; Matthias decides the host

export function feedUrl(name: "plugins"): URL;                  // <root>plugins/v1/index.json
export function feedUrl(name: "compat", build: GameBuild): URL; // <root>compat/v1/<build>.json
// The signature is at the same URL + ".sig".
```

- Two keys per feed, current and next (B-D6). Rotation: sign with next; the next app release ships (next, a new
  next). A compromised key is dropped by an app release.
- `DIST_ROOT === null` (and no dev override): Main fetches no feed; compat runs on local matches (§7.3), plugins
  come from the bundle.
- `scripts/feed-keygen.ts` prints a new PKCS#8 private key (PEM) and its public `x`; Matthias runs it. Private
  keys live only in the protected CI environments of §7.5 and §8.4.
- `DEV_FEED_KEY`'s private half is committed at `e2e/fixtures/feed-dev-key.pem` for fixture servers; a packaged
  build never accepts it.
- Dev overrides (BD21), only when `!app.isPackaged`, each `http://127.0.0.1:<port>/`: `MOXI_DIST_ROOT` replaces
  `DIST_ROOT`; `MOXI_GITHUB_ROOT` maps `https://<host><path>` of the GitHub hosts (§9.5) to `<root><host><path>`
  (allowlist checked on the original URL). Any other value throws "Invalid development root." Override requests
  use `node:http` to `127.0.0.1` without the public-address rule (spec 14).

### 6.2 Signature file and verification

`.sig` is canonical JSON `{ "keyId": string, "sig": string }`, `sig` = base64 of the 64-byte Ed25519 signature
over the exact data bytes.

```ts
export type VerifyFailure = "bad-signature-file" | "unknown-key" | "bad-signature";
export function verifySigned(data: Uint8Array, sigFile: Uint8Array, keys: readonly FeedKey[]):
  { ok: true; keyId: string } | { ok: false; reason: VerifyFailure };
// node:crypto: createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
// verify(null, data, key, Buffer.from(sig, "base64")) === true
```

`unknown-key`: `keyId` is not in `keys`. `bad-signature-file`: not the JSON above, or `sig` is not 64 bytes. The
parsed body must carry the same `keyId` (§7.1, §8.1); else the file is refused.

### 6.3 Fetch and last good copy

```ts
export type HttpsGet = (url: URL, opts: { maxBytes: number; deadlineMs: number; headers?: Record<string, string> }) =>
  Promise<{ status: number; headers: Readonly<Record<string, string | undefined>>; body: Uint8Array }>;
// One request, no redirect following, no cookies; implemented by spec 14's HTTPS client.
export type FetchFailure = "offline" | "timeout" | "not-found" | "http" | "too-large" | "host" | VerifyFailure;
export function fetchSigned(url: URL, keys: readonly FeedKey[], maxBytes: number, get: HttpsGet):
  Promise<{ ok: true; data: Uint8Array; sigFile: Uint8Array; keyId: string } | { ok: false; reason: FetchFailure }>;
export function readCache(file: string, keys: readonly FeedKey[]): Promise<{ data: Uint8Array; keyId: string } | null>;
export function writeCache(file: string, data: Uint8Array, sigFile: Uint8Array): Promise<void>;
```

- Redirects: §9.5 rules. Sizes, deadline, redirect cap and `.sig` size: `feed.compatBytes`, `feed.indexBytes`, `feed.fetchMs`, `dist.redirects`, `dist.sigBytes` (§10). `404` → `not-found`.
- Cache file = canonical JSON `{ "data": <base64>, "sig": <the .sig object> }`, written by temp + `fsync` +
  rename. `readCache` verifies again; a failing cache is ignored and deleted ("corrupted cache", P60).
- Each feed keeps its last good parsed body in memory; a failed fetch, parse or `seq` rule leaves it in force.

## 7. Compat feed (M9-11)

### 7.1 File

```ts
// apps/desktop/src/compat.ts
import type { Locator } from "@moxi/gwkit/locate";
export type GameBuild = string; // SHA-256 (64 lowercase hex) of ArenaNet's Gw.jspi.wasm as downloaded
export type KillableId = FactId | ActionId | "game.note"; // hub.search, net:, link: are not per build

export type CompatFile = {
  format: 1;
  seq: number;              // integer ≥ 1, strictly increasing per build
  keyId: string;            // equals the .sig keyId
  issued: string;           // ISO 8601 UTC, "Z" suffix
  build: GameBuild;         // equals the build in the URL
  locator: Locator | null;  // null: kill switches only, no signed locator yet
  capabilities: Record<string, { state: "off"; reason: string }>; // kill switches; reason 1 to `compat.reasonChars` chars, host words
};
```

- `GameBuild` is the `Gw.jspi.wasm` hash from `verifyGeneration`
  (`apps/desktop/src/game-files/client.ts:133-166`), kept with each client generation (M5-04). What
  `locator.client` hashes is spec 13's.
- Fetched for every build in use (the active generation and each open game window's): at start, on the compat
  schedule (every 30 min, spec 05 §4.3), and when a new build comes into use. Caches of builds no generation uses are deleted
  at start. A `404` means no signed file yet; a cached copy stays.

### 7.2 What the feed can and cannot do (BD3, P80)

`parseCompatFile(data, keyId, build)` accepts a file only when every rule holds; else the whole file is refused
and the last good copy stays:

1. ArkType with `"+": "reject"` at the top level and in every kill entry: an unknown key anywhere (`grants`,
   `actions`, `regions`, `rateHz`, …) refuses the file.
2. `format === 1`, `build` equals the requested build, `keyId` equals the signature's, `seq` > the cached `seq`
   for that build.
3. Kill keys match `/^game\.[a-z]+(?:\.[a-z]+)*$/`; `state` is exactly `"off"`.
4. A kill key that is not a `KillableId` of this app is ignored (logged once); `hub.search`, `net:` and `link:`
   cannot be killed.
5. `locator` passes gwkit's locator schema (`loadLocator`, `packages/gwkit/src/locate/specs.ts:58`; M9-11 may
   add a value-taking `parseLocator` to `@moxi/gwkit/locate`).

`CompatState` has no field that could name a new id, grant, region, rate or reader, so the catalog (spec 04)
stays the only source of capabilities.

### 7.3 Compat state per build

```ts
export type CompatState = {
  trust: "signed" | "local" | "none";
  locator: Locator | null;                    // what game.locator returns (spec 07)
  killed: ReadonlyMap<KillableId, string>;    // id → host reason
};
export function compatState(file: CompatFile | null, local: Locator | null): CompatState;
```

| Signed file | Local match (spec 13, M5-04) | `trust` | `locator` | `killed` |
| --- | --- | --- | --- | --- |
| with a locator | any | `signed` | the file's | the file's kills |
| none, or `locator: null` | present | `local` | the local one | the file's kills, plus every `ActionId` and `game.note` with "Game actions wait for a checked update for this game version" |
| none, or `locator: null` | not yet | `none` | null | the file's kills |

- Local match = facts on, actions off; `game.note` counts as an action because it calls into the client.
  Effective grants are per (install, game build) (spec 12).
- Main answers `game.locator` (spec 07) with `{ build, locator }` from this state. This map is the kill-switch
  and local-match part of `GamePluginState.killed` for that window's build (off(build): spec 07, spec 13, which
  adds what is not located). Main refuses a killed action at `plugin.action.authorize` with `unsupported` and
  the kill reason as `message`; the game renderer publishes a killed fact as `unsupported` (spec 04 rule 7, spec
  13).
- Page line "Works with this game build: N of M features" (spec 12): M = the install's requested `game.*` facts,
  actions and `game.note`; N = those that `capabilitySupport(specs, locator)` (`@moxi/gwkit/locate`, spec 13)
  supports and that are not killed. With no game window open the page uses the active generation's build.

### 7.4 Kill switch flow

AGENTS "When something breaks": propose a kill switch → Matthias approves → publish (§7.5) → every app turns it
off within one fetch, also offline from the cache (P64). A later file without the entry turns it back on.

### 7.5 `.github/workflows/compat.yml`

| Job | Trigger | Does | Slice |
| --- | --- | --- | --- |
| `publish` | `workflow_dispatch` with `build`, `locator` (a committed file path or `none`), `kills` (JSON object) | environment `compat-publish` (Matthias approves each run); body with `seq` = last published + 1; `scripts/sign-feed.ts` signs with `MOXI_COMPAT_KEY`; uploads `compat/v1/<build>.json` and `.sig` to the distribution host; commits the signed pair to `compat/signed/` | M9-11 |
| `watch` | schedule `*/30 * * * *` and dispatch | read ArenaNet's current manifest; if no signed file exists for the build: download `Gw.jspi.wasm` (never into a cache), run `pnpm compat:check` (locate + report), open or update one issue "Game build `<first 12 hex>`: N located, M refused" with the report and the candidate locator as an artifact | M10-02 |

`compat/signed/` holds generated, signed files (AGENTS: never edit). Nothing is published without Matthias's
approval in the environment.

## 8. Signed plugin index (M14-01)

### 8.1 File

```ts
// apps/desktop/src/plugins/plugin-index.ts. Unknown keys are ignored (the index is additive).
type PluginIndex = {
  format: 1;
  seq: number;          // integer ≥ 1, strictly increasing; lower or equal: ignored (rollback)
  keyId: string;        // equals the .sig keyId
  issued: string;       // ISO 8601 UTC
  expires: string;      // after issued; expired: no installs or updates from it
  plugins: IndexPlugin[];
  withdrawn: Withdrawal[];
};
type IndexPlugin = {
  id: string;                         // spec 04 id pattern
  source: "official" | "community";
  name: string; description: string;  // spec 05 manifest.* lengths
  repo: { owner: string; name: string; ownerId: number; repoId: number };
  versions: IndexVersion[];
};
type IndexVersion = {
  version: SemVer; api: 1; minHost: SemVer; tag: string; commit: string; // 40 hex
  url: string;          // https://github.com/<owner>/<repo>/releases/download/<tag>/plugin.moxi, or under the dist root
  sha256: Sha256; size: number;       // size ≤ budgets.code.packageBytes
  permissions: string[]; optional: string[]; // sorted keys of manifest.permissions / manifest.optional
  reviewed: string;     // YYYY-MM-DD
  scorecard: string;    // path in the registry repository
};
type Withdrawal =
  | { match: { id: string }; versions?: "*" | SemVer[]; reason: string } // default "*"
  | { match: { sha256: Sha256 }; reason: string }
  | { match: { ownerId: number }; reason: string };
```

### 8.2 Rules

- Fetched at app start always (withdrawals must arrive), then on the index schedule (`dist.checkHours`, spec 05 §4.3) while the app
  setting `pluginUpdateChecks` (boolean, default `true`) is on.
- Accepted when `verifySigned` passes, the body parses, `keyId` matches and `seq` > the cached `seq`. Offline,
  bad signature, unknown key, lower `seq`, truncated file or parse error: the last good copy stays (P60). No
  cached copy and no fetch: no index (bundled only).
- **Expired** (`expires` < now): no new installs and no updates (a frozen index cannot push a version that a
  newer index withdrew); installed plugins keep running; withdrawals still apply.
- **Install or update from the index**: the highest version that passes `checkHost`, the platform and no
  withdrawal. After §3.3 steps 1-3, `id`, `version`, `api`, `minHost` equal the manifest's and
  `permissions`/`optional` equal the sorted keys of its maps; else "The package does not match the plugin list".
- `official` entries need `moxi.` ids; `community` entries need the owner prefix (§3.4). From M14 official
  updates come from the index too (§4.2 rule 2).

### 8.3 Withdrawals

`withdrawn(install)` is computed from the last good index, also an expired one, for every source:

| Match | Hits |
| --- | --- |
| `{ id }` | installs with that plugin id; `versions` limits it to those versions |
| `{ sha256 }` | installs whose running package has that hash |
| `{ ownerId }` | `gh:<ownerId>` installs, and community installs whose index entry has that `ownerId` |

A withdrawn install does not run, its effective grants are empty (spec 12), the page shows the reason, its data
stays, and no matching package can be installed or applied. A newer index without the match makes it run again.
Dev folders are included, because "load this folder" is a way to hand out code.

### 8.4 Registry repository and publish

`gwasm-dev/moxi-registry` (public: Matthias, open Q9): `plugins/<id>.json` (source, repo with owner and repo
ids, pinned versions) and `withdrawn.json`. In M14-01 versions are added by reviewed pull requests; the
automated jobs come with M14-04 (section 15).

`publish.yml`: weekly on `main` and on dispatch (at once for a withdrawal). It builds `index.json` with `seq` +
1 and `expires` = `issued` + `dist.indexValidityDays`, and a plain diff against the last signed index
(new versions, permission, source or owner changes, withdrawals) as the job summary. Environment `index-publish`
(Matthias approves each run) signs with `MOXI_INDEX_KEY` and publishes `plugins/v1/index.json` and `.sig` to the
distribution host.

### 8.5 GitHub repo to community

When the index lists an entry with the install's `ownerId`, `repoId` and a version whose `sha256` equals the
running package, the page offers "Switch to the reviewed source". On press, one transaction: insert the
`community` source row if absent; `UPDATE plugin_installs SET install_key = 'community/<id>', source_key =
'community', repo_id = NULL, repo_name = NULL, checked_at = NULL, auto_update = 1`; the same key change in every
table keyed by install key (spec 12 tables and documents, spec 14). The host binding moves from `unverified` to
`reviewed`.

## 9. GitHub repos (M14-02)

### 9.1 Switch and trust

- App setting `pluginGithubRepos` (boolean, default `false`): "Allow plugins from GitHub repositories". Off: no
  add, no checks, GitHub installs do not run (data kept). Turning it on shows once: "Plugins from GitHub
  repositories are not reviewed by anyone. Each one runs in its own sandbox, asks before it updates and uses
  only what you allow." (text for Opus's copy pass)
- The first install from an owner id asks once: "Trust plugins from `<login>`?" Yes sets
  `plugin_sources.trusted_at`.

### 9.2 Add (1 API call)

1. Input `owner/repo` or `https://github.com/owner/repo`. Owner `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`, repo
   `^[A-Za-z0-9._-]{1,100}$`, not `.` or `..`.
2. `GET https://api.github.com/repos/{owner}/{repo}` → `{ id, full_name, owner: { id, login } }` (ArkType; extra
   keys ignored). Store `repo_id = id`, `repo_name = full_name`; source key `gh:<owner.id>`, `owner_login =
   owner.login`.
3. Trust question (9.1), then the check (9.3) and download, then §3.3.

### 9.3 Check (0 API calls) and download

1. `GET https://github.com/{repo_name}/releases/latest/download/moxi-release.json`, following redirects by §9.5.
   The tag is the `<tag>` segment of the first `Location` on `github.com` that matches
   `/<o>/<r>/releases/download/<tag>/moxi-release.json` (any `<o>/<r>`). GitHub's own rename redirect (301) is
   followed; the stored name changes only after an id check.
2. Parse as `ReleaseFile`. `sha256` equal to the running or waiting package: done; set `checked_at`.
3. Else a real update: the id check (9.4). Then `GET
   https://github.com/{full_name}/releases/download/{tag}/plugin.moxi` from hop 1; the signed `release-assets`
   URL is used at once, never stored, and a retry starts again at hop 1. Then `checkReleaseFile` and §3.3.
4. At most one check per repo per the GitHub check interval (spec 05 §4.3) by `checked_at`, plus "Check now"
   (spec 05 §4.3), and only while `pluginUpdateChecks` is on.
5. `assets[].digest` is not used (one more API call; our SHA-256 against `moxi-release.json` covers transport).

### 9.4 Id check on every real update (1 API call)

`GET https://api.github.com/repositories/{repo_id}`:

| Answer | Result |
| --- | --- |
| 404 or 410 | refuse: "This repository no longer exists" |
| `owner.id` ≠ the source's owner id | refuse: "This repository now belongs to someone else" |
| `full_name` ≠ `repo_name` (compared case-insensitively) | store the new `repo_name` and `owner_login`, then repeat 9.3 once with the new name; a second difference refuses with "This repository changed while checking. Try again." |
| else | continue 9.3 step 3 |

This refuses a re-registered login or a recreated repository under the old name (repo-jacking), with or without
automatic updates (P63).

### 9.5 Requests, hosts and errors

- Every hop: `https:`, port 443, host in `github.com`, `release-assets.githubusercontent.com`, `api.github.com`,
  or the distribution host. Another host: "GitHub changed its download address; update Moxi". The list holds
  until an app release changes it (PB15 is single-vantage).
- Redirects: 301, 302, 307, 308 only, at most `dist.redirects` (§10), `Location` resolved against the current
  URL. Headers: `user-agent: Moxi/<app version>`; API calls add `accept: application/vnd.github+json` and
  `x-github-api-version: 2022-11-28`. No cookies; no `if-none-match` (a 304 still costs quota).

```ts
export type GitHubError = // host text after "//"
  | { code: "rate-limited"; retryAfterMs: number | null } // API 403/429 (retry-after, x-ratelimit-reset): GitHub is busy right now. Try again later.
  | { code: "not-found" }       // No public repository <owner>/<repo>
  | { code: "no-release" }      // This repository has no release with moxi-release.json
  | { code: "repo-gone" } | { code: "owner-changed" } | { code: "changed-while-checking" } // texts of 9.4
  | { code: "host-changed"; host: string } // GitHub changed its download address; update Moxi
  | { code: "bad-release" }     // moxi-release.json does not match plugin.moxi
  | { code: "too-large" }       // the package is too large
  | { code: "timeout" }         // Download timed out
  | { code: "offline" };        // No internet connection
```

## 10. Constants

Spec 05 owns every numeric value (`budgets.ts`); this spec names the keys and their meaning:

- `budgets.code.packageBytes`, `budgets.code.codeBytes`, `budgets.code.manifestBytes`, `budgets.code.jsonDepth`,
  `budgets.code.downloadMs`: package size, code size, manifest size, JSON depth, download deadline (§3.3, §9).
- `dist.redirects`: redirects per distribution request (§9.5). `dist.sigBytes`: size of a `.sig` file.
- `dist.manifestSlackBytes`: `moxi-release.json` may exceed `code.manifestBytes` by this much.
- `dist.apiBodyBytes`: size of a GitHub API response body (deadline `code.downloadMs`).
- `dist.devDebounceMs`: dev folder wait after a `plugin.moxi` change. `dist.indexValidityDays`: plugin index validity
  (`expires` = `issued` + this).
- `dist.checkHours`: plugin index fetch interval. `dist.githubCheckHours`: GitHub update check, at most 1 per repo per
  this interval.
- `feed.compatBytes`, `feed.indexBytes`, `feed.fetchMs`: signed feed size caps and fetch deadline (§6).
  `compat.reasonChars`: kill-switch `reason` length (§7.1). The compat fetch schedule is in spec 05 §4.3.

## 11. Decisions

Chosen, with the alternative rejected: one JSON file `{ format, manifest, code }`, canonical and never
extracted (not a zip, no assets: no archive attack class, reproducible bytes); bundled official
plugins through the normal install path from `bundled.json`, updated with app releases until M14
(BD5; no early index); install and source tables here, everything that follows from the index or the
package computed (no stored `withdrawn` or `incompatible`); every non-held update waits for idle (not
at once: a session would lose local state); withdrawals by id, hash or owner id for every source;
strict compat schema, kills only for `KillableId`, local match = facts on and actions and notes off
(BD3: a wrong locator may read wrong numbers but must never call the client); `.sig` as
`{ keyId, sig }` with two pinned keys per feed (not trying every key, not one key); GitHub 0 API
calls per check, 1 per add and per real update, no digest call (the unauthenticated limit is 60 per
hour per IP, shared behind NAT); dev and test overrides only in unpackaged builds (BD21).

## 12. Today in code (main 848fb6e)

- `scripts/build-plugins.ts:18-51` bundles the old runtime into each plugin → `host/package.ts`;
  `--bundled` writes `.moxi` and `bundled.json` (M1-06, M4-02).
- `electron-builder.config.ts:15` ships plugin code to `renderers/plugin-host` → packages ship in
  `dist/plugins/` inside the asar (M4-02).
- `apps/desktop/src/plugin-bundles.ts:16-24` (one bad file drops every plugin, P18) and
  `plugin.bundles` (`shell/main.ts:316`) → registry + store + `plugin.code` (M4-02, M4-05).
- `apps/desktop/src/storage/migrations.ts` (migration 1 only) → new migration (M4-02).
- `compat/reference/1eb07332632e.json` (unsigned, read by `packages/gwkit/src/locate/locate.test.ts`)
  and `loadLocator` (`specs.ts:58`) → `feeds.ts`, `compat.ts`, `compat/signed/`, `compat.yml`
  (M9-11, M10-02).
- `apps/desktop/src/identity.ts` (channel `dev` or `stable`) → `stage: "experimental"` hidden in
  `stable` (M4-02).
- `MOXI_PATCH_ROOT` (`shell/main.ts:72-89`) → `MOXI_DIST_ROOT`, `MOXI_GITHUB_ROOT`,
  `MOXI_TEST_INSTALLS` follow it (M4-02, M9-11, M14-02).
- No index, GitHub, dev folder or withdrawal code → §5, §8, §9 (M7-05, M14-01..03).

## 13. Built by

M1-06 §2 (parse corpus) · M2-06, M7-06 `moxi pack` on §2.3 (spec 08) · M4-02 §3 and §4 · M7-04 list
and page texts of §3.5-§3.7 · M7-05 §5 · M9-11 §6, §7.1-§7.4, `compat.yml` `publish` · M10-02
`compat.yml` `watch`, `pnpm compat:check` · M14-01 §8.1-§8.4 · M14-02 §9, §8.5 · M14-03 escalation
over §3.6 for index and GitHub sources (chain ops: spec 12; withdrawals at once) · M14-04 section 15.

## 14. Checked by

| Proof | What it checks here | Kind | Slice |
| --- | --- | --- | --- |
| P18 | bundled or test installs with corrupt JSON, wrong hash, unknown capability, read-and-internet, wrong platform show 5 rows with their texts; 3 good ones run | N + E | M4-02, M4-08 (E) |
| P39 | update outcomes applied as §3.6; a held version never runs before "Allow" | N + E | M1-07, M14-03 |
| P60 | index: bad signature, unknown key, lower `seq`, expired, truncated, offline start, corrupted cache → last good stays; expired blocks installs and updates; withdrawals still apply | N | M14-01 |
| P61 | typed refusals with database and store byte-identical: SHA-256 mismatch, same version new bytes, changed on disk, `packageBytes` + 1, depth 33, an `assets` key, index permissions ≠ manifest; crash between store and commit → collected at next start | N | M1-06, M4-02, M14-01 |
| P62 | GitHub repo offering `moxi.builds`; prefix ≠ owner; same id from another source; dev folder with an installed id → typed errors; official documents unreachable | N | M14-03 |
| P63 | GitHub-like fixture: first install, owner change, asset swapped under the same version, same-owner rename (followed), transfer (refused), 404, 50 MiB asset, re-registered login, recreated repo; 1 API call per add, 0 per check, 1 per real update | N | M14-02 |
| P64 | withdrawal by id, SHA-256 and owner id; compat kill of `game.travel` → refused `unsupported` for every plugin; offline start keeps both from the cache | N + E | M9-11, M14-01 |
| P65 | fixture registry journey: browse, page, install, use, switch off, held update, accept, previous version, uninstall keeping data, reinstall | E3 | M14-01 |
| P67 | fresh data folder, no network: bundled plugins are `official` installs through §3.3 and run | N + E | M4-02 (N), M14-01 (E) |
| P70 | dev folder reload without restart, documents kept, new permission → consent sheet, old grants until accepted, no folder action without Developer mode; Measure ≤ 1 s | E + M | M7-05 |
| P80 | compat parser table: `state: "on"`, unknown top-level or entry keys, `net:` keys, a wrong `build` or `keyId` → whole file refused; unknown `game.*` id → ignored; 1,000 seeded accepted files: `killed` ⊆ `KillableId`, catalog unchanged | N | M9-11 |

## 15. Deferred (M14-04, before 1.0 Stable)

- **Registry CI** in `gwasm-dev/moxi-registry`. `verify.yml` on every pull request: download, SHA-256, the app's
  `parsePackage`, read-or-internet, id prefix = owner login, owner and repo ids by API, permission diff against
  the last pinned version (escalation labels the pull request), size limits, banned patterns (`eval`,
  `Function(`, non-literal `import(`, `WebAssembly`, obfuscation markers); writes a public scorecard.
  `ingest.yml` nightly: for each listed repo, read the latest release; clean and not escalating → commit the
  pinned version; escalation, failed check or new owner → a pull request for a human (owner decision Q8).
  Untrusted code never runs next to a credential: each step that touches author code runs in its own job with
  `permissions: {}`, no secrets, no cache writes and `--ignore-scripts` where possible, and outputs only hashes
  and the parsed manifest; the committing job reads them as untrusted data and may write only version fields of
  `plugins/<id>.json`. Proof P66.
- **Reproducible packages** (PB16): `verify.yml` rebuilds from `commit` and compares bytes. `moxi pack` output
  is canonical from the start (§2.3).

