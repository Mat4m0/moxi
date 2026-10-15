# 12 Consent, grants and updates

## Purpose

What the player sees before a plugin runs, what they allow, and how those choices are stored and
enforced: the plugin page model and its texts, the grant rules, the update and install decisions,
and the SQL tables for grants, settings values, HUD, panels, marks, bindings, action log, crashes
and activity. Spec 15 owns `plugin_sources` and `plugin_installs`.

## 1. Rules in force

### 1.1 Grants

1. Requested is not granted: Main's grant rows decide (manifest `permissions`, `optional`, spec 04 §8), and exist only for requested ids.
2. At install, every `permissions` id becomes `granted` and every `optional` id `denied` with deny
   count 0. The press on "Install and allow" is the consent. Official plugins install on first
   run without a press (decision 52, spec 01); their `optional` ids also start `denied`.
3. After install, every line in the page groups Reads, Acts, Shows, Internet and Asks later has a
   switch. Off: the row becomes `denied`. On: the row becomes `granted`.
4. A switched-off fact reads `{ ok: false, reason: "not-permitted" }`. A switched-off action
   shows its control disabled with `REFUSAL_TEXT["not-permitted"]` (spec 04 §3: "Turned off in
   plugin settings"); a press is refused `not-permitted`.
5. A chain (spec 04 §8.4) is available only when every step op is available; it has no switch.
6. A disabled install (player, crash, withdrawal, damage) keeps its grant rows; Main sends no
   grants for it (it is in no host's install list, spec 07 §4).
7. After every grant, enable, setting or layout change, Main pushes the whole new state to every
   receiver in the same Main task (spec 07 §4); the game renderer applies it on its next publish
   tick (P35).

### 1.2 Where approvals happen

Main accepts install, grant, enable, update-consent, settings and layout calls only from the
launcher's or a game window's `webContents` (channel kinds L and G, spec 07 §3); plugin-host
preloads have no such channel (P8). In a game window only host UI calls them: the plugin page,
the `RequestAccess` sheet, Arrange HUD and the mark menus. Plugin code has no API that asks.
No renderer sends an account id; Main resolves the account from the sender window (spec 07 §3).
Scopes of every stored choice are in the table comments of section 3.

### 1.3 Optional permissions and updates

- An `optional` id is granted only through a host `RequestAccess` sheet that a trusted press
  (spec 01 §2) opens (section 5), or with its page switch. No plugin call and no timer can ask.
- An update never widens access silently: a new required permission, `net:` or `link:` host, or
  chain op waits for the player while the old version keeps running. `decideUpdate` (section 9)
  is the only place that decides. Until M14, official plugins update only with app releases: at
  app start Main runs it for each bundled official package whose hash differs (BD5).

## 2. Files

| File | Holds | Slice |
| --- | --- | --- |
| `packages/sdk/src/host/grants.ts` | section 4 types and functions | M1-07 |
| `packages/sdk/src/host/settings.ts` | `settingDefaults`, `checkSettingValue` (6.1) | M1-07 |
| `packages/sdk/src/host/page.ts` | `PageModel`, `pageModelSchema`, `pageModel`, `noticeOf`, `sentToHosts`, page texts (sections 7, 8) | M1-07 |
| `packages/sdk/src/host/updates.ts` | `admitInstall`, `decideUpdate`, `UPDATE_TEXT` (section 9) | M1-07 |
| `packages/contracts/src/plugins.ts` | `PluginRow` schema (section 8) | M4-01 |
| `apps/desktop/src/plugins/grants.ts` | grant store, `plugins.grant`, `plugins.enable` | M4-04 |
| `apps/desktop/src/plugins/choices.ts` | settings, HUD, panel, mark, binding and action log stores | M4-04 |
| `apps/desktop/src/storage/migrations.ts` | the migrations of section 3 | M4-02, M4-04, M7-05, M14-02 |
| `packages/ui/src/PluginPage.vue` | renders `PageModel` in the launcher and the Hub | M7-04 |

`pageModel` and `decideUpdate` are pure; Main calls them and never re-implements a page text or
an update rule.

## 3. SQL

Main's SQLite (`<data>/moxi.sqlite`, `node:sqlite`), all tables `STRICT`. Install keys, source
keys and account ids follow spec 01 §3 and spec 03 §1.12; no table stores a host tier or group
(Main derives it with `hostKeyOf`, spec 01 §3). Spec 15 owns `plugin_sources` and `plugin_installs`
(`disabled_reason` is `'player'` or `'crashed'`; withdrawn, incompatible, damaged, sandbox-refused
and source-switched-off are computed each run, never stored).

```sql
CREATE TABLE plugin_crashes (
  install_key TEXT NOT NULL, at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('start', 'hang', 'flood', 'batch', 'errors', 'worker')) -- CrashKind (spec 07)
) STRICT;
CREATE INDEX plugin_crashes_install ON plugin_crashes (install_key, at);
CREATE TABLE plugin_grants (     -- per install
  install_key TEXT NOT NULL, capability TEXT NOT NULL, -- CapabilityId: catalog id, 'net:<host>' or 'link:<host>'
  state TEXT NOT NULL CHECK (state IN ('granted', 'denied')),
  deny_count INTEGER NOT NULL DEFAULT 0 CHECK (deny_count >= 0),
  PRIMARY KEY (install_key, capability)
) STRICT;
CREATE TABLE plugin_settings (   -- per install, all accounts (spec 04 §8.5)
  install_key TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, -- Setting.key; JSON of a SettingValue
  PRIMARY KEY (install_key, key)
) STRICT;
CREATE TABLE plugin_hud_on (     -- HUD on/off per (install, hudId), all accounts (spec 10 §1.9)
  install_key TEXT NOT NULL, hud_id TEXT NOT NULL, -- manifest hud[].id
  PRIMARY KEY (install_key, hud_id)
) STRICT;
CREATE TABLE plugin_hud_place (  -- HudPlacement (spec 10 §2.1) per (account, install, hudId)
  account TEXT NOT NULL, install_key TEXT NOT NULL, hud_id TEXT NOT NULL,
  dx INTEGER NOT NULL, dy INTEGER NOT NULL, -- CSS px; bounds checked at the Main edge (spec 10 §2.1)
  locked INTEGER NOT NULL CHECK (locked IN (0, 1)),
  PRIMARY KEY (account, install_key, hud_id)
) STRICT;
CREATE TABLE plugin_panel_place ( -- PanelPlacement (spec 10 §2.1) per (account, install, commandId)
  account TEXT NOT NULL, install_key TEXT NOT NULL, command_id TEXT NOT NULL,
  x INTEGER NOT NULL, y INTEGER NOT NULL, w INTEGER NOT NULL, h INTEGER NOT NULL,
  PRIMARY KEY (account, install_key, command_id)
) STRICT;
CREATE TABLE hub_marks (         -- HubMark list (spec 10 §1.12) per (install, kind, id), all accounts
  position INTEGER PRIMARY KEY,  -- index in the saved list = pinned order
  install_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('item', 'command')),
  id TEXT NOT NULL,              -- Hub item id or manifest command id
  pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
  phrase TEXT,                   -- stored normalized (`norm`); NULL: none
  CHECK (pinned = 1 OR phrase IS NOT NULL),
  UNIQUE (install_key, kind, id), UNIQUE (phrase)
) STRICT;
CREATE TABLE key_bindings (      -- per app; only targets with an assigned or cleared chord
  install_key TEXT NOT NULL,     -- '' for host targets
  target TEXT NOT NULL,          -- 'hub' when install_key = ''; else a manifest command id
  chord TEXT,                    -- JSON KeyChord (spec 11); NULL: the player cleared it
  origin TEXT NOT NULL CHECK (origin IN ('suggested', 'player')),
  CHECK (origin = 'player' OR chord IS NOT NULL),
  PRIMARY KEY (install_key, target)
) STRICT;
CREATE TABLE plugin_action_log ( -- per install, ring
  id INTEGER PRIMARY KEY,        -- increasing; the ring keeps the newest per install
  install_key TEXT NOT NULL, at INTEGER NOT NULL, -- epoch ms of the authorize call
  origin TEXT NOT NULL CHECK (origin IN ('player', 'agent')),
  command TEXT,                  -- manifest command id; NULL for a GameAction or ItemAction
  steps TEXT NOT NULL            -- JSON ActionLogStep[] (6.4)
) STRICT;
CREATE INDEX plugin_action_log_install ON plugin_action_log (install_key, id);
CREATE TABLE plugin_activity (   -- day counts; kinds and targets: spec 14
  install_key TEXT NOT NULL, day TEXT NOT NULL, -- 'YYYY-MM-DD', local date
  kind TEXT NOT NULL, target TEXT NOT NULL,     -- target: host name, op id or ''
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (install_key, day, kind, target)
) STRICT;
```

Migrations (one per slice, in merge order; nobody edits a merged migration; the `documents`
rebuild of spec 14 is simply "a new migration"):

- M4-02: `plugin_installs` (spec 15), `plugin_crashes`. M4-03: the `documents` rebuild keyed by
  install key (BD20, spec 14).
- M4-04: `plugin_grants`, `plugin_settings`, `plugin_hud_on`, `plugin_hud_place`,
  `plugin_panel_place`, `hub_marks`, `key_bindings`, `plugin_action_log`, `plugin_activity`; and
  `DELETE FROM plugin_installs`.
- M7-05: `plugin_sources` with `folder` (spec 15). M14-02: `plugin_sources.owner_login`,
  `trusted_at`; the GitHub columns of `plugin_installs` (spec 15).
- M4-04's `DELETE FROM plugin_installs` clears installs that dev databases got before grants
  existed; at the next start the bundled official plugins install again with grant rows.
  Packages stay in the store.
- No `REFERENCES` or `CASCADE`: `openDatabase` leaves `PRAGMA foreign_keys` off and some rows
  must outlive their install. Uninstall deletes rows itself, in one transaction.

Row lifecycle:

| Event | Main does, in one transaction |
| --- | --- |
| Install | install row (spec 15); `initialRows` grant rows (section 4); official: `plugin_hud_on` rows for `hud` entries with `default: true`, in manifest order up to `budgets.install.hudWidgetsOn`; dev: source row |
| Uninstall | delete the install row and its rows in `plugin_grants`, `plugin_crashes`, `plugin_hud_on`, `plugin_hud_place`, `plugin_panel_place`, `hub_marks`, `key_bindings`, `plugin_action_log`, `plugin_activity`; a dev source row goes too. "Keep its data?" (default keep): No also deletes its `documents` and `plugin_settings` rows; Yes keeps both, so a later install from the same source finds them |
| Update applied | install row per spec 15 (`previous_sha256` = old `sha256`, new `sha256` and `version`, `held_sha256` NULL); grants per `rowsAfterUpdate`; delete the `plugin_settings` keys, `plugin_hud_on` and `plugin_hud_place` rows, `plugin_panel_place` and `key_bindings` rows of ids that the new manifest no longer has. Marks stay: a mark without a target is hidden (spec 10 §1.12) |
| Account removed (M9-01) | delete its `plugin_hud_place` and `plugin_panel_place` rows |
| App start | delete `plugin_activity` and `plugin_crashes` rows older than `budgets.activity.days` |

## 4. Grants

```ts
// packages/sdk/src/host/grants.ts
export type GrantState = "granted" | "denied";
export type GrantRow = { readonly capability: CapabilityId; readonly state: GrantState; readonly denyCount: number };
export function requested(m: Manifest): { required: CapabilityId[]; optional: CapabilityId[] }; // manifest order
export function initialRows(m: Manifest): GrantRow[];  // required → granted, optional → denied; denyCount 0
/** granted: denyCount 0. denied: denyCount + 1 (every denial counts). */
export function decide(rows: readonly GrantRow[], id: CapabilityId, state: GrantState): GrantRow[];
export function grantedSet(m: Manifest, rows: readonly GrantRow[]): ReadonlySet<CapabilityId>; // requested ∩ granted; enabled, not withdrawn installs only

export type Access = "ok" | "not-permitted" | "unsupported"; // not-permitted wins (spec 04 §3 order)
/** `unavailable` = the `killed` list of the window's game build: off(build) = kill switches, not
 *  located, actions off under a local match (spec 13). */
export function accessOf(id: CapabilityId, granted: ReadonlySet<CapabilityId>, unavailable: ReadonlySet<CatalogKey>): Access;
export function chainAccess(steps: readonly StaticOp[], granted: ReadonlySet<CapabilityId>, unavailable: ReadonlySet<CatalogKey>): Access; // worst over all steps
export function canAsk(row: GrantRow | undefined): boolean; // denied && denyCount < budgets.install.requestDenials (section 5)
export function rowsAfterUpdate(rows: readonly GrantRow[], changes: AccessChanges): GrantRow[]; // section 9.4
```

**Effective grants per (install, game build).** Main pushes `grantedSet` per install, independent
of the build; each game window receives `GamePluginState.killed` for its own build (spec 07 §4).
Every enforcement point combines them with `accessOf`, so two windows on different builds answer
differently for the same install (B-A8): facts (game renderer fact filter and publisher, spec 13;
membrane fan-out), actions and chains (Main authority, spec 13, build of the sender window),
`game.note` (Main `plugin.note` check: grant and kill switch), `hub.search` (game renderer text
router, spec 10: grant), `net:` and `link:` (Main proxy and link opener, spec 14: grant).

## 5. RequestAccess

| State (from `rows` and `killed`) | Element shows (spec 09 draws it) |
| --- | --- |
| granted; id not in `optional` (also a dev warning "RequestAccess needs an optional permission") | nothing |
| killed or no reader for this build | "Not available with this game version" |
| `canAsk` true | `Allow: <catalog label>`, then `Plugin says: "<reason>"`; the element is pressable |
| `canAsk` false (denied `install.requestDenials` times) | "Change this in the plugin page", with the button "Open plugin page" |

1. A trusted press opens the host access sheet (spec 10 §1.5): `Allow: <catalog label>`,
   `Plugin says: "<reason>"`, buttons "Allow" and "Don't allow"; it ignores presses for
   `budgets.hub.confirmArmingMs`.
2. "Allow": the game renderer calls `plugins.grant { installKey, capability, state: "granted" }`;
   Main writes `decide(…, "granted")` and pushes state (1.1 rule 7). "Don't allow": the same call
   with `state: "denied"`; the count rises by 1. Escape or "Cancel" closes the sheet without a
   call and without a count.
3. A page switch that turns an id off also counts as a denial; turning it on resets the count to
   0 (one counter, no extra wire field).
4. Main refuses `plugins.grant` for an id outside `permissions ∪ optional` with
   `{ ok: false, reason: "not-requested" }`.

## 6. Stored choices

### 6.1 Setting values

```ts
// packages/sdk/src/host/settings.ts
export function settingDefaults(m: Manifest): Record<string, SettingValue>;
/** The normalized value, or undefined when `value` does not fit `setting`. */
export function checkSettingValue(setting: Setting, value: unknown): SettingValue | undefined;
```

| Type | Valid value (bounds: spec 04 §8.5, values in spec 05) | Normalized |
| --- | --- | --- |
| `toggle` | boolean | – |
| `number`, `slider` | finite; within `min`/`max` when given; with `step`, `(v - (min ?? 0)) / step` is an integer within 1e-9 | – |
| `select` | one option value | – |
| `multi` | array of unique option values | sorted in option order |
| `text` | string, length ≤ `maxLength` (cap and default `settings.textChars`, spec 05), no character below U+0020 | – |
| `list` | array of ≤ `maxItems` (cap and default `settings.listItems`, spec 05) strings of 1 to `settings.itemChars` characters, none below U+0020 | – |
| `color` | `^#[0-9a-fA-F]{6}$` | lowercase |
| `key` | `KeyCode | null` (spec 11 key table) | – |

- `plugins.settings.set { installKey, key, value }`: an unknown key or a value that fails
  `checkSettingValue` → `{ ok: false, reason: "invalid" }`; else Main stores the normalized JSON
  and pushes `HostInstall.settings` (spec 07 §4). The membrane sends `{ t: "settings", values }`
  to the worker; plugins read them with `useSettings()` (spec 08).
- Reading: missing row, bad JSON or a value that fails the check (for example after an update
  changed the type) → the default, logged once per (install, key), like `defineSettings`
  (`apps/desktop/src/storage/settings.ts`).

### 6.2 HUD, panels and marks

The record types (`HubLayout`, `HudPlacement`, `PanelPlacement`, `HubMark`) live in
`packages/contracts/src/hub.ts`; `HubMain` and the behaviour are spec 10 §2.1 and §2.2. This
section owns how Main stores them. Each `HubMain` call has an IPC channel (spec 07).

| `HubMain` call · channel | Main does |
| --- | --- |
| `layout()` · `hub.layout.get` | `hudOn` from `plugin_hud_on` for enabled installs; `hud` and `panels` from the place tables for the sender window's account |
| `setHudOn(installKey, hudId, on)` · `hub.hud.on` (also from the launcher) | on: insert, unless the install already has `budgets.install.hudWidgetsOn` rows → `"limit"`; off: delete. Then `"ok"` and a state push |
| `saveHud(p)` · `hub.hud.save`, `savePanel(p)` · `hub.panel.save` | upsert the row for the sender window's account |
| `marks()` · `hub.marks.get` | the `hub_marks` rows by `position` |
| `saveMarks(next)` · `hub.marks.save` | validate every mark (spec 10 §1.12 rules, `budgets.hub.marks`, `budgets.hub.phraseChars`); any failure → `"invalid"` and nothing changes; else replace all rows in one transaction, `position` = array index, `phrase` stored after `norm` |

- A widget, panel or mark whose install is off, or whose command or target is gone, stays stored
  and is hidden (spec 10). The plugin page shows the same HUD switches (7.3); its switch calls
  `hub.hud.on`.
- `norm` = trim, lower case, collapse white space, as in `apps/game/src/hub/search.ts`. Phrases
  are stored normalized, so `UNIQUE (phrase)` holds the rule "This phrase is already used".

### 6.3 Key bindings

Spec 11 owns `KeyChord`, `KeyTarget`, `KeyBinding` (the IPC record only), the suggestion grammar,
the reserved list and the assignment of suggestions (at most `budgets.install.shortcuts` per
install, chain commands included). Storage rules:

- No row for the Hub chord: the spec 11 default. No row for a command: unbound.
- A suggestion that Main assigns is stored with `origin = 'suggested'`, so it stays stable when
  other plugins install later. A player bind or clear stores `origin = 'player'` (`chord` NULL
  for a clear); Main never re-assigns that suggestion.
- Bindings are per app: one keyboard, matched by Main in every game window, edited in the
  launcher, which has no account.
- A stored `chord` that fails the spec 11 schema reads as no row and is logged once.

### 6.4 Action log

```ts
// packages/sdk/src/host/grants.ts
export type ActionLogStep = {
  readonly op: ActionId;
  readonly label: string;  // the host describe() text at authorize time; never args, never a whisper body
  readonly result: ActionResult | "skipped" | null; // null: no report arrived (for example the app quit)
};
export type ActionLogEntry = {
  readonly at: EpochMs; readonly origin: "player" | "agent";
  readonly command: string | null; readonly steps: readonly ActionLogStep[];
};
```

- Main's authority (spec 13) inserts one row per `plugin.action.authorize` call, refusals
  included (P43); a refused request has one step with the refusal. Each `plugin.action.report`
  updates its step; steps after a chain stop become `"skipped"`. In a Dev `--qa` run every call
  is logged `origin: "agent"` (spec 13).
- After each insert Main deletes that install's rows older than its newest
  `budgets.activity.actions` rows. The `Activity` read model that shows them is spec 14.

## 7. The plugin page

`pageModel` builds the whole page from data. No plugin code runs while a page is open (P33).
The launcher and the Hub ("Plugins", and the plugin page chord on a plugin row, spec 11) render it
with `packages/ui/src/PluginPage.vue`. Main serves it through `plugins.page` (spec 07).

### 7.1 Types

```ts
// packages/sdk/src/host/page.ts
export type SourceBadge = "By Moxi" | "Reviewed" | "Not reviewed" | "Development";
export type PageSource =
  | { readonly kind: "official" }
  | { readonly kind: "community"; readonly repo: string; readonly tag: string; readonly commit: string; readonly reviewed: string } // 'owner/name', 'YYYY-MM-DD'
  | { readonly kind: "github"; readonly repo: string; readonly ownerId: number; readonly tag: string; readonly trusted: boolean }
  | { readonly kind: "dev"; readonly folder: string };

export type PageInput = {
  readonly manifest: Manifest; readonly source: PageSource; readonly sha256: string; readonly packageBytes: number;
  readonly ref: RefNames;                                  // spec 04 §4; names for describe()
  readonly shortcutLabels: Readonly<Record<string, string>>; // command id → label (spec 11); before install: the suggestion
  readonly compat: { readonly unavailable: ReadonlySet<CatalogKey> } | null; // current game build (spec 15); null: unknown
  readonly installed: {                                    // null: not installed
    readonly rows: readonly GrantRow[];
    readonly settings: Readonly<Record<string, SettingValue>>; // defaults filled in
    readonly hudOn: readonly string[];                       // hud ids in plugin_hud_on
    readonly status: InstallStatus;                          // section 8
    readonly previous: SemVer | null;
    readonly update: { readonly manifest: Manifest; readonly decision: UpdateDecision } | null;
  } | null;
};

export type PageLine = {
  readonly text: string;
  readonly says: string | null;          // the author's reason; rendered `Plugin says: "<says>"`
  readonly detail: readonly string[];    // host lines under the line
  readonly control:                      // a switch; installed pages only
    | { readonly kind: "grant"; readonly capability: CapabilityId; readonly on: boolean } // plugins.grant
    | { readonly kind: "hud"; readonly widget: string; readonly on: boolean }             // hub.hud.on (6.2)
    | null;
  readonly unavailable: string | null;   // host words; the line is greyed
};
export type PageGroupId = "reads" | "acts" | "shows" | "internet" | "asks" | "adds" | "stores" | "uses" | "never" | "source";
export type PageGroup = { readonly id: PageGroupId; readonly title: string; readonly note: string | null; readonly lines: readonly PageLine[] };
export type PageUpdate = { readonly version: SemVer; readonly text: string; readonly changes: readonly PageLine[]; readonly allow: string; readonly later: string };
export type PageSetting = {
  readonly setting: Setting; readonly value: SettingValue;
  readonly shown: boolean;               // its `when` holds for the current values
  readonly sentTo: string | null;        // internet class, `text` and `list` settings: the chip text of 7.5; else null
};
export type PageModel = {
  readonly name: string; readonly icon: IconRef; readonly accent: HexColor | null;
  readonly badge: SourceBadge; readonly byline: string; readonly description: string;
  readonly warning: { readonly lines: readonly string[]; readonly trustOwner: string | null } | null; // GitHub block
  readonly install: string | null;       // the button label before install; null when installed
  readonly notice: PageNotice | null;    // section 8
  readonly update: PageUpdate | null;
  readonly groups: readonly PageGroup[];
  readonly settings: readonly PageSetting[];                 // installed only, manifest order
  readonly shortcuts: readonly { readonly command: string; readonly title: string; readonly label: string | null }[];
  readonly previous: SemVer | null;      // "Use previous version (1.0.0)"
};
export function pageModel(input: PageInput): PageModel;
export const pageModelSchema: Type<PageModel>; // ArkType, same shape; contracts imports it (spec 07)
/** `net:` hosts, then `link:` hosts, of `permissions`, in manifest order: the order of spec 09's
 *  `SurfaceContext.outboundHosts`, so the page names the host the input chip names. */
export function sentToHosts(m: Manifest): string[];
```

Installed pages also show the enable switch, "Uninstall" with "Keep its data?" (default keep),
Activity (`plugins.activity`, spec 14), "Use previous version (<v>)" when `previous` is set, and
the settings and shortcuts sections. Calls: `plugins.enable`, `plugins.grant`,
`plugins.settings.set`, `plugins.update`, `plugins.uninstall`, `keys.bind` (spec 07), `hub.hud.on`.

### 7.2 Head

| Field | Rule |
| --- | --- |
| `icon` | manifest `icon` or `{ glyph: "command" }` (spec 04 §9), drawn on the `accent` tile. Plugin icons are host glyphs or game art from the player's `Gw.dat`, never package bytes |
| `badge` | official "By Moxi"; community "Reviewed"; GitHub "Not reviewed"; dev "Development" |
| `byline` | parts joined with " · ": `by <author>`; source word (official "Official", community "Community", GitHub "GitHub", dev "Development"); community: `reviewed <date>`; `experimental` when `stage` is set; `version <v>`; the license if set; the size |
| date | `<day> <Mon> <year>` with the fixed months Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec, from the `YYYY-MM-DD` text, no time zone |
| size | under 1 MiB: `max(1, round(bytes / 1024))` + " KB"; else one decimal + " MB" (1 MiB = 1,048,576 bytes) |
| `install` | "Install and allow"; "Install" when `permissions` is empty |
| `warning` | GitHub only: lines "Not reviewed by Moxi", "It comes from github.com/<repo> (owner <owner>, id <ownerId>).", "Moxi still enforces everything on this page. It runs apart from reviewed plugins.", "Updates wait for you." `trustOwner` = owner login while not trusted; the install button stays disabled until the player ticks "Trust plugins from <owner>" (asked once per owner) |

### 7.3 Groups

Fixed order. Titles are stored in sentence case; the component sets them in capitals with CSS,
so screen readers read words. Groups marked "always" appear even when empty, with the empty text.

| Group | Title · note | Lines (in this order) | When empty |
| --- | --- | --- | --- |
| reads (always) | "Reads from the game" | each fact in `permissions`, catalog order: `label`, `says` | internet class or no facts at all: "Nothing. This plugin cannot read anything from your game."; only optional facts: "Nothing unless you allow it under Asks later." |
| acts (always) | "Acts for you" · "only when you press its button or key" | each action in `permissions`, catalog order: `label`, `says`, `detail` = the entry's `detail` line; then each chain command in manifest order (7.4) | "Nothing. This plugin cannot act in your game." |
| shows | "Shows" | `game.note` in `permissions`: `label`, `says` | omitted |
| internet (always) | "Internet" | each `net:` host in `permissions`: text = the host, `says`; each `link:` host: `HostEntry.label(host)`, `says`; then, for the internet class, the three lines of 7.5 | local class: "None. This plugin cannot connect to the internet. What it reads stays on this computer." |
| asks | "Asks later" · "only if you allow it when the plugin asks" | each `optional` id: facts and actions in catalog order, then `game.note`, `hub.search`, `net:`, `link:` in manifest order; text = catalog label (`HostEntry.label(host)` for hosts), `says` | omitted |
| adds | "Adds" | "Hub: " + parts joined " · ": each command title with " (<shortcut label>)" when it has one, `its own search rows` when `hub.items`, `search word "tp"` (several: `search words "tp", "travel"`), `searches that start with a number` when `hub.numbers`; then one line per HUD entry: before install "Over the game: <title> · on from the start" (official with `default: true`) or "Over the game: <title> · off until you turn it on"; installed "Over the game: <title>" with a `hud` control | omitted |
| stores (always) | "Stores" | "Its own data on this computer, up to <`budgets.docs.totalBytes` in MB>" | – |
| uses | "Uses" | one line per `references` table: skills "Skill names and icons from your game files"; maps "Place names and icons from your game files"; items "Item names and icons from your game files"; professions "Profession names and icons from your game files"; heroes "Hero names from your game files" | omitted |
| never (always) | "No plugin can" | one line each: "Read game memory or network traffic", "Press keys or click for you", "Act without your press", "Fight, trade or play for you", "See your password or account", "Read other plugins' data", "Run code it downloads" | – |
| source (always) | "Source" | 7.6 | – |

- Every requested id appears exactly once, in reads, acts, shows, internet or asks (P33).
- The adds group omits the Hub line when it has no parts.
- `control` (installed pages): every id line gets `{ kind: "grant", capability, on: state ===
  "granted" }`; every HUD line gets `{ kind: "hud", widget, on }`.
- `unavailable`: a `game.*` fact or action in `compat.unavailable` → `REFUSAL_TEXT.unsupported`
  ("Not available with this game version").
- Copy buttons, wiki links and toasts need no permission and are not listed.

### 7.4 Chain lines

One line per chain command in the acts group:

`text` = the command title. `detail` = "Runs in order on one press, only in outposts, towns and
Guild Halls:", then one line per step, `<n>. <describe(args, ref)>`, for example `1. Travel to
Kamadan, Jewel of Istan` and `2. Set up your party: Koss, Dunkoro, Tahlkora` (the Hub shows the
same list, spec 10 §1.6). `control` = null. `unavailable` (installed pages): "Needs every step to
be on" when `chainAccess` is `not-permitted`; `REFUSAL_TEXT.unsupported` when `unsupported`.

### 7.5 Internet class lines

1. `It sees only <parts>. It can send those.` Parts, in order: `what you type after "<scope>"`
   (several scopes joined with " or "), `searches that start with a number` (with
   `hub.numbers`), and always `what you type into its own fields (marked "Sent to <chip>")`
   (any view or text setting can have fields). One part stands alone; two are joined with " and
   "; three as "A, B, and C". `<chip>` = the first `sentToHosts` entry, plus " +N" for the
   others, as on the chip (spec 09 §4.4).
2. `<net hosts> also learn<s> your IP address and when you play.` Net hosts of `permissions`
   and `optional`, joined with ", " and a final " and "; "learns" for one host. Omitted without a
   `net:` host.
3. `It cannot read your game. Never type a password or account details into a plugin.`

### 7.6 Source lines

| Source | Lines |
| --- | --- |
| official | "Comes with the Moxi app · SHA-256 <short>"; "Built and reviewed by the Moxi team." |
| community | "github.com/<repo> · tag <tag> · commit <first 7> · SHA-256 <short>"; "Checked by the Moxi plugin list. A matching hash proves delivery, not safety." |
| GitHub | "github.com/<repo> · tag <tag> · SHA-256 <short>"; "Not checked by Moxi. Moxi pinned this hash when you installed it." |
| dev | "Development folder <folder>"; "Reloads when its files change. SHA-256 <short>" |
| all, when `compat` is known and M > 0 | "Works with this game build: <N> of <M> features" (M = requested `game.*` facts and actions; N = M minus those in `unavailable`; the one function is `capabilitySupport(specs, locator)` in `@moxi/gwkit/locate`, which spec 15 calls) |

`<short>` = first 4 hex characters + "…" + last 4.

### 7.7 Example (community plugin, before install)

Manifest: `mokai.quick-travel` "Quick Travel" 1.0.0 by Mo Kai, MIT, accent `#4f8fd8`, icon
`{ "map": 449 }`; permissions `game.progress`, `game.travel`; commands `favourites` (view,
suggestion `mod+shift+t`) and `guild-hall` (static `game.travel { guildHall: true }`);
`hub.scopes ["tp"]`; HUD `last-trip` "Last destination"; `references ["maps"]`. The M1-07 test
asserts this text.

```text
[map icon on #4f8fd8 tile]  Quick Travel                     [ Install and allow ]   Reviewed
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
STORES · Its own data on this computer, up to 5 MB
USES · Place names and icons from your game files
NO PLUGIN CAN · the seven fixed lines of 7.3, joined with " · "
SOURCE
  github.com/mokai/moxi-quick-travel · tag v1.0.0 · commit 3f2a9c1 · SHA-256 9b1e…41c0
  Checked by the Moxi plugin list. A matching hash proves delivery, not safety.
  Works with this game build: 2 of 2 features
```

An internet plugin (Trade Prices: `net:kamadan.gwtoolbox.com`, `link:wiki.guildwars.com`, scope
`price`, `hub.numbers`) shows the host and link lines with their `says`, then the 7.5 lines with
`price` as the scope and the chip "Sent to kamadan.gwtoolbox.com +1"; its READS group is empty.

## 8. Status, notices and list rows

```ts
// packages/sdk/src/host/page.ts
export type InstallStatus = {   // the one definition; spec 15 owns the status rules
  readonly enabled: boolean;                // stored (`enabled`)
  readonly disabledReason: "player" | "crashed" | null; // stored (`disabled_reason`); only these two are stored
  readonly status: "on" | "off" | "withdrawn" | "incompatible" | "damaged"; // computed; `off` = enabled 0
  readonly error: string | null;            // host words for withdrawn, incompatible, damaged
  readonly pluginsOff: boolean;             // run flag (spec 03 §1.13)
  readonly sandboxRefused:                  // the reason of spec 03 `SandboxState`; null when sandboxed or official
    "no-sandbox-switch" | "no-seccomp" | "no-pid-namespace" | "not-sandboxed" | "unknown" | null;
  readonly hostPaused: boolean;             // its host is paused (spec 03 §1.8)
  readonly updatedTo: SemVer | null;        // an update applied in this app run
};
export type PageNotice = { readonly tone: "warning" | "danger"; readonly text: string; readonly action: "turn-on-again" | "start-plugins" | null };
export function noticeOf(status: InstallStatus): PageNotice | null; // first matching row below

// packages/contracts/src/plugins.ts (ArkType schemas exported by @moxi/sdk/host next to the spec 04 §9 types and SourceBadge)
export const pluginRow = type({
  installKey: installKey, name: "string", author: "string", version: "string",
  icon: iconRef, accent: hexColor.or("null"), badge: sourceBadge,
  on: "boolean",                 // enabled
  note: "string | null",         // one host line, below
  update: "'needs-ok' | 'offered' | null",
});
export type PluginRow = typeof pluginRow.infer;
```

| # | When | Notice (tone, text, action) | Row `note` |
| --- | --- | --- | --- |
| 1 | `pluginsOff` | warning, "Plugins are off for this run.", start-plugins | "Plugins are off" |
| 2 | `sandboxRefused` not null | danger, `<reason text>` + " Plugins that are not by Moxi stay off for this run.", none | "Off: no sandbox" |
| 3 | `status` `off` and `disabledReason` crashed | danger, "Turned off after <`budgets.crash.limit`> crashes", turn-on-again | same text |
| 4 | `status` `withdrawn` | danger, "Turned off by Moxi: <error>. Its data is kept.", none | "Withdrawn" |
| 5 | `status` `incompatible` | warning, "Needs a newer Moxi", none | same |
| 6 | `status` `damaged` | danger, "Can't load: <error>", none | same |
| 7 | `hostPaused` | warning, "Plugins paused", start-plugins | "Plugins paused" |
| 8 | otherwise | none | "Needs your OK" when a held update needs consent; "Updated to <v>" when `updatedTo`; else null |

Sandbox reason texts: `no-sandbox-switch` "Moxi was started with --no-sandbox."; `no-seccomp` and
`no-pid-namespace` "Your system did not give Moxi its sandbox. On Linux, install the .deb
package."; `not-sandboxed` "Your system did not give Moxi its sandbox."; `unknown` "Moxi could
not check its sandbox." (Notice texts not quoted from spec 05 are set here.)

- `plugins.enable { enabled: true }` clears `player` and `crashed` (spec 03 deletes the crash
  rows). Main ignores it for `withdrawn`, `incompatible` and `damaged`.
- `plugins.list` returns installed rows sorted by `name` (`localeCompare(b, "en", { sensitivity:
  "base" })`), then install key.

## 9. Install admission and updates

### 9.1 `admitInstall` (P62)

```ts
// packages/sdk/src/host/updates.ts
export type InstallRefusal = "reserved-prefix" | "prefix-not-owner" | "already-installed";
export function admitInstall(input: {
  source: SourceKey; manifest: Manifest;
  ownerLogin: string | null;          // GitHub owner login or the index entry's repo owner; null otherwise
  installed: ReadonlyMap<string, InstallKey>; // plugin id → install key
}): true | { refused: InstallRefusal; message: string };
```

| Rule (first match) | Refusal | Message |
| --- | --- | --- |
| id starts with `moxi.` and source is not `official` | reserved-prefix | "Only plugins by Moxi can use ids that start with moxi." |
| GitHub or community, and the id part before the dot ≠ `ownerLogin` lowercased | prefix-not-owner | "The plugin id must start with its owner's name: <owner>." |
| the id is installed from another source | already-installed | "Uninstall <installed name> first." |

Every store keys by install key, so a refused install cannot reach the data of
`official/moxi.builds`. Spec 15 calls `admitInstall` after parsing and before the page.

### 9.2 `decideUpdate`

```ts
export type UpdateSource = "official" | "community" | "github" | "dev"; // from the SourceKey prefix
export type VersionFacts = {
  readonly manifest: Manifest; readonly sha256: string;
  readonly ownerId: number | null; readonly repoId: number | null; // index entry or GitHub record; null: official, dev
};
export type UpdateInput = {
  readonly source: UpdateSource; readonly installed: VersionFacts; readonly rows: readonly GrantRow[];
  readonly autoUpdate: boolean;     // GitHub only; false elsewhere
  readonly bundled: boolean;        // the candidate came with an app release (official only)
  readonly candidate: { readonly ok: true; readonly version: VersionFacts }
                    | { readonly ok: false; readonly error: ManifestError; readonly sha256: string };
  readonly withdrawn: { readonly installed: string | null; readonly candidate: string | null }; // reason when a withdrawal matches (spec 15)
  readonly host: { readonly api: SemVer; readonly vue: SemVer };                                 // checkHost (spec 04 §8.7)
};
export type AccessChanges = {
  readonly addedRequired: readonly CapabilityId[]; // granted when the update applies
  readonly addedOptional: readonly CapabilityId[]; // start denied
  readonly stillOff: readonly CapabilityId[];      // newly required, denied before: stays denied
  readonly removed: readonly CapabilityId[];       // rows deleted
  readonly newChainOps: readonly { readonly command: string; readonly ops: readonly ActionId[] }[];
  readonly classAfter: PluginClass | null;         // set when the class changes (spec 03 moves the install)
};
export type UpdateDecision =
  | { readonly action: "none" }
  | { readonly action: "apply"; readonly when: "idle" | "now"; readonly changes: AccessChanges }
  | { readonly action: "ask"; readonly changes: AccessChanges }     // GitHub with auto update off
  | { readonly action: "hold"; readonly why: "needs-ok" | "new-owner"; readonly changes: AccessChanges }
  | { readonly action: "consent"; readonly changes: AccessChanges } // dev: sheet, then apply now
  | { readonly action: "refuse"; readonly why: UpdateRefusal; readonly message: string }
  | { readonly action: "turn-off"; readonly message: string };      // the installed version is withdrawn
export type UpdateRefusal = "read-and-internet" | "malformed" | "needs-newer-host"
  | "repo-owner-changed" | "same-version-new-bytes" | "withdrawn";
export function decideUpdate(input: UpdateInput): UpdateDecision;
```

Access changes (I = installed manifest, C = candidate; "requested" = permissions ∪ optional):

- `addedRequired`: in C.permissions, not requested by I.
- `addedOptional`: in C.optional, not requested by I.
- `stillOff`: in C.permissions and in I.optional, with a `denied` row (an optional id the player
  denied that becomes required). Not an escalation.
- `removed`: requested by I, not by C. An id moving between permissions and optional keeps its row.
- `newChainOps`: per chain command id, the ops of C's steps that I's chain with that id did not
  have; a new chain command counts all its ops. Changed order or args of known ops are not new.
- **Escalation** = `addedRequired` non-empty, or any new `net:`/`link:` id (required or
  optional), or `newChainOps` non-empty.

### 9.3 Decision table

First matching row wins. "Index" = official and community.

| # | Situation | Index | GitHub | Dev |
| --- | --- | --- | --- | --- |
| 1 | `withdrawn.installed` set | turn-off | turn-off | turn-off |
| 2 | candidate error `read-and-internet` or `malformed` | refuse | refuse | refuse |
| 3 | error `needs-newer-host`, or `checkHost` fails | refuse `needs-newer-host` (not offered) | same | same |
| 4 | `withdrawn.candidate` set | refuse `withdrawn` (not offered) | same | same |
| 5 | owner id or repo id differs | hold `new-owner` | refuse `repo-owner-changed` | – |
| 6 | same `sha256` | none | none | none |
| 7 | same version, other bytes | `bundled`: go on to row 8; else refuse `same-version-new-bytes` and Main logs it | refuse, with the warning text | go on to row 8 |
| 8 | escalation | hold `needs-ok` | hold `needs-ok` | consent |
| 9 | otherwise (same or fewer, new optional, still off) | apply when idle | auto update on: apply when idle; off: ask | apply now |

- `bundled`: an official package from an app release is trusted like the release, so new bytes
  under the same version are normal there; a changed index pin is not.
- Withdrawals reach every source, dev folders included (DESIGN 11.3: they match id, hash and
  owner).
- Dev refusals keep the last good package running and show "Can't load: <message>" until the
  folder changes again.
- "Idle" = no plugin session is open in any game window (spec 03, spec 07). App start is idle,
  so bundled official updates apply at start.
- `hold new-owner`: the page shows the full consent again. "Allow" grants `permissions` anew and
  resets `optional` to denied, as at a first install.
- "Use previous version": Main runs `decideUpdate` with the previous package as the candidate.
  `apply` and `none` apply at once; `hold` and `consent` show the consent block, and "Allow"
  applies.

`UPDATE_TEXT` (exact):

| Key | Text |
| --- | --- |
| needs-ok | `<name> <new> needs your OK. Version <old> keeps running until you decide.` |
| new-owner | `<name> <new> now comes from a different publisher. It waits for your OK, like a new plugin.` |
| ask | `<name> <new> is available.` |
| consent (dev) | `<name> <new> asks for more. Allow it to reload?` |
| read-and-internet | "This version reads from the game and connects to the internet. Moxi does not allow both." |
| malformed | `Can't load: <ManifestError message>` |
| needs-newer-host | "Needs a newer Moxi" |
| repo-owner-changed | "This repository now belongs to someone else" |
| same-version-new-bytes | index: `Refused: version <v> changed after its release`; GitHub: `The publisher changed <v> after you installed it` |
| withdrawn, turn-off | `Withdrawn by Moxi: <reason>` |
| buttons | needs-ok, new-owner, consent: "Allow and update" / "Not now"; ask: "Update" / "Not now" |

`PageUpdate.changes` lines: `+ Reads: <label>`, `+ Acts: <label>`, `+ Shows: <label>`,
`+ Internet: <host or link label>`, `+ Asks later: <label>`, `+ Reads: <label> (still off)`,
`− <group word>: <label>` for removed ids, and `+ Chain: <command title>` with `detail` = all its
steps, new ones ending in " (new)". `says` carries the new reason.

### 9.4 Applying

- `plugins.update { choice: "allow" }` applies a held or offered candidate at once; the worker
  restarts (spec 07 §4). `"not-now"` keeps the old version and hides the row's "Needs your OK"
  until the next app start; the page block stays. `"previous"` follows 9.3.
- `rowsAfterUpdate`: delete `removed`; insert `addedOptional` as denied with count 0; insert
  `addedRequired` as granted (it is non-empty only after the player allowed a hold or a consent
  sheet); keep every other row as it is, so `stillOff` stays denied.
- A newer candidate replaces an older held one (`held_sha256`); Main keeps exactly one held and
  `budgets.code.previousPackages` previous packages.
- A class change moves the install to the other host of its group (spec 03 §1.3).

## 10. Constants and decisions

Values are in spec 05: `docs.totalBytes`, `install.hudWidgetsOn`, `install.shortcuts`,
`install.requestDenials` ("denied twice", P38), `crash.limit`, `hub.confirmArmingMs`,
`hub.marks`, `hub.phraseChars`, `code.previousPackages`, `activity.actions`, `activity.days`.

Decisions behind the rules above: pure functions in `@moxi/sdk/host` (C3); no tier column (BD6);
a new chain op is an escalation even when granted (BD1); grants pushed without kill switches,
kill switches per window build (B-A8); action log in SQLite with labels only, so no message body
reaches disk; no `decided_at` columns (DESIGN 6.6); "same or fewer permissions applies when
idle" (DESIGN 6.9).

## 11. Today in code (main 848fb6e) and what changes

| Today (where) | Becomes |
| --- | --- |
| Declared = granted; enable, settings and crash policy in plugin-host memory (`apps/plugin-host/src/plugin-host.ts`; `apps/game/src/hub/client.ts`) | grant rows, `plugins.enable`, `plugins.settings.set`, `plugin_settings`, `plugin_crashes` (spec 03); enforcement per section 4 |
| Migration 1 only; bundled plugins load from `plugins/index.json`; no install, update, page or launcher section (`apps/desktop/src/storage/migrations.ts`, `plugin-bundles.ts`; `apps/launcher/src/launcher-data.ts`) | section 3 migrations; installs, `decideUpdate`, `pageModel`, `PluginPage.vue` |
| Hub ranks plugin-given `aliases`; Hub chord in the renderer (`apps/game/src/hub/search.ts`, `App.vue`) | `hub_marks`; `key_bindings` read by Main (spec 11) |
| Invalid stored host setting → default, logged once (`apps/desktop/src/storage/settings.ts`) | same rule for plugin values (6.1) |

## 12. Built by

Files of section 2 are built by the slice named there. Also: M4-02 `plugin_crashes` and bundled
official installs (grants from M4-04); M4-04 the stores, `plugins.grant`, `plugins.enable`,
`plugins.settings.set`, the `hub.*` layout and mark channels, `plugins.page`, `plugins.list` and
`decideUpdate` for bundled packages at start; M4-05, M4-07 crash rows and "Turn on again"
(spec 03), action log rows and activity counts (spec 14); M3-04, M3-07 the `RequestAccess`
states and the access sheet; M3-06 HUD layer, Arrange HUD and panels (spec 10); M5-09, M12-07
binding rows and Shortcuts settings (spec 11); M7-05 dev reload and consent; M14-02, M14-03
GitHub columns, trust, ask and hold flows, withdrawals.

## 13. Checked by

| Proof | What it checks here | Kind | Owner |
| --- | --- | --- | --- |
| P33 | `pageModel` for every catalog id alone and every subset of up to 3 ids plus `net:` and `link:`: each requested id once with host text and `says`; "No plugin can" always; the 7.7 example literally. B: the launcher renders a page for a package whose code throws; 0 workers alive | Gate, N + B | M1-07 (N), M7-04 (B) |
| P35 | a revoke reaches every enforcement point within one publish tick | Gate, N + E | M4-04 (N), M5-07 (E) |
| P36 | Main refuses every ungranted catalog key (N half) | Gate | M4-04 |
| P38 | only a press opens the sheet; after 2 denials "Change this in the plugin page"; `granted` only after "Allow"; no request API in the SDK (type test) | Gate, B | M3-04, M3-07, M4-04 |
| P39 | `decideUpdate` over sources × access changes (same, removed, new optional, new required or host, still off, new chain op) × owner × repo × `api` × `minHost` × same version new bytes × bundled × withdrawn × auto flag, literal decisions. E: a fixture index serves v1, then v2 adding `game.party`; v1 runs until "Allow" | Gate, N + E | M1-07 (N), M14-03 (E) |
| P58 | uninstall with keep and with delete (section 3 lifecycle) | Gate, N | M4-03 |
| P62 | `admitInstall` table; official documents unreachable from another source | Gate, N | M1-07 |
| P81 | the "page lists steps" clause: chain lines of 7.4 | Gate, N | M1-07; proof owners M1-03 (parse half), M5-08, M11-10 |

## 14. Deferred

- M14 (spec 15): community directory pages for plugins that are not installed, "Switch to the
  reviewed source", the GitHub auto-update switch and the trust prompt. M14-04: page lines for
  `kind: "theme"`. Not in 1.0: pins and search phrases for host rows.
