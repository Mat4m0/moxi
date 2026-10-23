# Parity ledger

Every user-facing feature of gwonmac v1 has one row: what moxi does with it, where it lives,
how it is checked, which slice owns it and what it may cost in lines.

- **Baseline:** v1 Beta `v2026.10.0-beta.1`, plus Progress and Reminders from v1's local HEAD
  `ddc48b66` (in `../gwonmac`, never released). The one-page Settings catalogue (A17) is
  HEAD-only and outside this baseline; M12-07 builds it.
- **Gate:** the M13 gate in [milestones.md](milestones.md) passes when every row whose verdict
  is keep or merge (not deferred, not a D12 drop) passes its journey, or Matthias dropped the row.
- **Rule:** no combat or economy automation. Quality of life is welcome. No parity row needs
  an action that starts without a trusted press.

## How to read a row

| Column | Meaning |
| --- | --- |
| In v1 | **Stable** `v2026.8.11`, **Beta** `v2026.10.0-beta.1`, or **HEAD** (local only) |
| Verdict | keep · merge into a plugin · defer · drop. A drop marked D12 is a proposal until Matthias decides D12; until then the row has no journey and the M13 gate skips it |
| Home | `host`, `host tweak` (host changes game behaviour; never plugin code), or a bundled plugin |
| Capabilities | Catalog ids ([spec/04](../spec/04-catalog-and-manifest.md)) needed; `–` = none |
| Journey | What the check proves |
| Check | Strongest check kind (below); every row also has Sim tests |
| Slice | The slice that owns the journey |
| v1 → moxi | v1 product lines (no tests) → non-test line budget of the owning slices |

| Check | What it is |
| --- | --- |
| Live agent | A journey in the real game through the `moxi-dev` MCP (from M10), inside the AGENTS live rules: outposts, towns and the Guild Hall only. The M3/M9 slice owns the Sim or fixture journey; M10-03 writes the live journey, which runs at the M13 gate (rows A01–A04, A08, A12, A16, A20) |
| Read-only live | Live facts and UI only; the action itself runs in Sim, or Matthias does it |
| Sim | `pnpm hub` with the simulated game and the SDK test kit |
| CI | Fixture-client e2e, or a packaged lane on the draft PR |
| Matthias | Feel, and what agents may not do live: explorable areas, skills, chat, whispers, invites, Steam |

Line budgets: v1 counts include v1's per-build game-reading code (certification transforms,
Rust kernel). In moxi that is the game layer (M11: gwkit readers and role specs), shared and
not counted here.

## Host features (A01–A24)

| ID | Feature | Player gets | In v1 | Verdict | Home | Capabilities | Journey | Check | Slice | v1 → moxi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A01 | Accounts, Play, Show, multi-open | Account list; play one or several; Show brings a game forward | Stable; profiles Beta | keep | host | – | Create, edit, archive, remove an account; Hub row `acc <name>`; two accounts open at once; Show fronts the right window | Live agent | M9-01 | 4,996 → ≤ 450 (+ launcher UI, M12-03) |
| A02 | Game files | Download, verify, background fill, Repair, Reset; Play once a healthy client exists | Stable | keep | host | – | Live: Play starts at once with a healthy client while the check runs. CI on the fixture client: Repair restores a damaged chunk; Reset downloads again | CI + Live agent | M9-07 | 4,880 → ≤ 150 |
| A03 | Game network | The game reaches ArenaNet servers and its web pages, nothing else | Stable | keep | host | – | Socket policy table; the flight recorder shows only allowed destinations | Live agent | M9-08 | 1,033 → ≤ 100 |
| A04 | Saved login, return after reload | Sign in once; later launches fill the login; after a reload the game returns to the same character (once, within 30 s) | Stable | keep | host | – | CI on the fixture login screen: store, forget, change a login; return fires once and never after 30 s; no secret in captured output. Live: use (Dev login) and the return after reload | CI + Live agent | M9-04 | 1,356 → ≤ 600 (M9-03 ≤ 350, M9-04 ≤ 250) |
| A05 | Steam sign-in | Sign in on Steam's own page; token kept per account | Stable | keep | host tweak | – | Only Steam's origins load; sign-in completes; token kept per account | Matthias | M13-11 | 816 → ≤ 400 shared (A07) |
| A06 | Input | Keys keep their physical place on every layout; real text editing in game fields; pasted names cleaned | Stable; paste cleaning Beta | keep | host | – | Tables per keyboard layout, Command/Ctrl rule and paste case | Sim + Matthias (feel) | M9-06 | 1,481 → ≤ 400 |
| A07 | Controller | Gamepad plays the game; optional PlayStation button symbols | Stable | keep gamepad; drop PlayStation symbols (proposed, D12) | host tweak | – | Gamepad input reaches the fixture client; feel in the real game | Sim + Matthias | M13-11 | 530 → shared (A05); symbols 267 → 0 |
| A08 | Game window | Reload, relog, Cmd-Q dialog that can reload instead, menus, window place per account, loading cover | Stable | keep | host | – | Reload, relog, the Hub row `reload`, the Cmd-Q flow and window place per account on the fixture client; live: Show fronts the right window | CI + Live agent | M9-05 | 2,692 → ≤ 300 |
| A09 | Native cursor | The game's own cursor shapes | Stable | keep | host tweak | – | Cursor shape follows game UI in screenshots | Live agent + Matthias (feel) | M13-10 | 1,150 → ≤ 600 shared (A10, A13) |
| A10 | Double-click repair | Double-clicks work as on Windows | Stable | keep | host tweak | – | Patch validates on the 7-build corpus; Matthias double-clicks a list row and it registers (no item use), the agent reads facts and screenshots | Read-only live + Matthias (feel) | M13-10 | 861 → shared |
| A11 | 4 GB mode, memory warning | Client may use up to 4 GB; low-memory warning that reloads only that account | Stable | keep | host tweak | – | With the setting, the heap limit reads 4 GB after restart; the warning shows at the fixture threshold | Live agent (metrics) + Sim | M11-12 | 1,187 → ≤ 350 (with the patch layer) |
| A12 | Render scale | Render quality 1, 1.5 or 2; open windows update at once | Stable | keep | host tweak | – | The setting changes the canvas size in every open window | Live agent (screenshots, metrics) | M9-05 | 508 → in M9-05 |
| A13 | Texture packs | Import a TexMod `.tpf`; one look for new windows; back to Official | Beta | keep | host tweak | – | A fixture `.tpf` imports; a matching texture swaps in a new window; Official restores it | Live agent (vs references) + Matthias (final look) | M13-10 | 1,623 → shared (A09) |
| A14 | Template files | Saving in the game's template dialog works; the host command "Save to game templates" writes a pasted or row-copied template code where that dialog finds it | Stable | keep repair and write; drop Templates pane (proposed, D12) | host tweak | – | Save and reopen a template in the game dialog; a pasted code saved with the command shows in it | Live agent | M13-12 | 4,496 → ≤ 300; pane 815 → 0 |
| A15 | Character Switch | Cmd-E card list of every character; switch without logout; Hub row `char <name>` | Beta | keep | host tweak | – | Switch from an outpost and from character select; search by name; the Hub row switches | Live agent | M13-09 | 3,607 → ≤ 400 shared (B16) |
| A16 | Hub shell | Cmd-R palette over the game: exact search, list keys, Escape ladder, pins, phrases, receipts | Beta | keep | host (`packages/hub`) | `hub.search` | Hub contract suite; live: open, search, run, Escape back, close | Live agent + Matthias (feel) | M3-01 (contract suite) + M10-03 (live) | 3,777 → ≤ 400 (moved from `apps/game/src/hub`) |
| A17 | Settings | One catalogue, same names in launcher and Hub; Hub search finds a setting; Retry or Revert a failed save | HEAD; split pages Stable | keep | host | – | Hub search for a setting focuses its control; a failed save offers Retry and Revert | Live agent + Matthias (feel) | M12-07 | 2,031 → ≤ 500 shared (A18, A19) |
| A18 | Appearance | Modern or Classic, font, text size 100–200 %, opacity | Stable | keep | host | – | Each control changes launcher, Hub and panels; Back to defaults with Undo | Live agent (vs references) | M12-07 | 2,839 → shared (+ looks model, M12-02) |
| A19 | Shortcuts | Rebind or clear shortcuts and the Hub chord; a conflict asks first; chat aliases `/tp`, `/chest`, `/xunlai`, `/trade` | Stable; full set Beta | keep; the launcher page is cut until shortcuts have a real store | host | – | Rebind with a conflict; capture by physical key; a chat alias opens the Hub at that command; the action still needs Enter (Sim) | Live agent + Sim | M12-07 | 1,113 → shared (+ chord in Main, M5-09) |
| A20 | App updates | Automatic check; Stable by default, Beta optional; never downgrades or blocks Play | Stable | keep; the launcher page is cut until the updater exists | host | – | CI on the packaged lane: update N → N+1, a downgrade is refused, Play stays available during the check; Matthias: the Dev app updates itself on his machine | CI + Matthias | M9-10 | 760 → ≤ 300 |
| A21 | Diagnostics | Open logs; export a report after seeing it; nothing uploads by itself | Stable | keep (rebuild small) | host | – | Preview shows the whole export; export holds no secret; recorder ring holds 10 min | Sim + Matthias (own sessions) | M9-12 | 6,168 → ≤ 600 (M9-09 ≤ 350, M9-12 ≤ 250) |
| A22 | Launcher content | News, game-update notes, Known issues, Today in Tyria, links | Beta (News only wired) | drop: the launcher has no News or content page | host | – | Fresh, stale and empty sources show dated items or a plain empty state | Sim + Live agent (read) | M12-05 | 791 → ≤ 300 (M12-04) + UI (M12-05) |
| A23 | Diagnostics extras | Support overlay, traces, memory attribution, visual problem report | Stable, Beta | drop (proposed, D12) | – | – | – | – | – | 3,251 → 0 |
| A24 | Core/Tools modes | Two launch modes, "Enable Tools", Restart launcher; region rule per feature | Stable, Beta | drop modes (proposed, D12); keep region rules as catalog data | host (catalog) | – | Table test: each catalog entry's regions match the v1 table below or are a named difference in the test table | Sim | M1-01 | 1,356 → 0 (+ region data, M1-01) |

Notes:

- A02: Repair and Reset do not exist on `main`: both buttons call `client.retry`
  (`apps/launcher/src/launcher-data.ts`, `download`). M9-07 builds them; its budget may grow.
- A11: the low-memory warning that reloads one account is part of M11-12's scope.
- A12: M9-05 builds and owns render scale; M13-10 drops it from its scope.
- A16: pins and phrases are host data stored by M4-04.
- A19: the Hub chord on Windows and Linux is Ctrl+R until Matthias decides D8. The chat-alias
  hook needs the game layer; its owner is open (see Facts and powers).
- A24: of v1's 1,356 lines, 497 are the modes (Drop list); the other 859 (preloads, tools host,
  region contracts) are replaced by the plugin model and are not part of D12.

## Tools features (B01–B23)

| ID | Feature | Player gets | In v1 | Verdict | Home | Capabilities | Journey | Check | Slice | v1 → moxi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B01 | Builds and Teams | Save, tag, search, edit builds and teams; template codes and bundles; load on you or a hero; party setup with a diff and progress "5/16"; capture the live party | Stable; Hub rows Beta | keep | Builds | `game.builds.load`, `game.team.apply`, `game.party`, `game.skills`, `game.progress`, `game.player`, `hub.search` | Load a build on you and a hero; apply a team with progress; capture the party; 10,000 builds stay fast | Live agent | M13-01 | 17,164 → ≤ 1,400 (M6-01 ≤ 900, M13-01 ≤ 500) |
| B02 | Travel | 199 destinations by word or own phrase; locked maps disabled; favourites 1–9; recents per character; Guild Hall; travel to an online friend; "Leave this area?" | Stable; friends Beta | keep | Travel | `game.travel`, `game.map`, `game.progress`, `game.player`, `game.social`, `hub.search` | Travel to an outpost, a favourite and the Guild Hall; locked maps disabled; recents per character; friend list live, friend travel in Sim | Live agent; friend travel: Read-only live + Matthias | M13-02 | 7,708 → ≤ 600 |
| B03 | Progress page | What a title still needs; Enter travels to the next place | HEAD | merge into Travel; defer | Travel | `game.progress`, `game.map`, `game.travel` | – | – | Later | 1,224 → later |
| B04 | Trade | Kamadan and Pre-Searing feed, search, filters, copy name, saved offers, followed players, trader prices and history (230 items) | Stable; prices Beta | keep | Trade | `net:kamadan.gwtoolbox.com`, `net:ascalon.gwtoolbox.com`, `link:kamadan.gwtoolbox.com`, `link:ascalon.gwtoolbox.com` | Feed arrives, also in PvP; search and filters; save and remove an offer; price history; Whisper (a built-in Hub row action, Hub code and not plugin API) fills `whisper <name>` into the Hub search | Live agent (read) + Sim (fixture servers) | M13-03 | 4,777 → ≤ 950 shared (B07: M7-03 ≤ 250, M13-03 ≤ 700) |
| B05 | Whispers | Whispers panel: conversations, unread mark, mute, find a friend; nothing stored on disk | Beta | merge into People | People | `game.social`, `game.whisper`, `hub.search` | Received whispers group by conversation (live); send with a typed body to a typed or social target (Sim) | Read-only live + Matthias (send) | M13-04 | 1,759 → ≤ 500 shared (B06) |
| B06 | People, invite, travel and invite | Hub finds friends, conversations, recent and chat names; `whisper <name>`, `invite <name>`; rows "Travel to <friend>" and then "Invite <friend>" (two presses) | Beta | merge into People | People | `game.social`, `game.party.invite`, `game.travel`, `hub.search` | People list matches the game's friend list (live); invite; travel, then invite (Sim, two presses) | Read-only live + Matthias (invite) | M13-04 | 391 → shared (B05) |
| B07 | Calculators | `10 ecto in p` in the Hub: trader estimates with times, offline gold and platinum math, stacks and sums, key rates, own rates, title calculators | Beta | merge into Trade | Trade | Trade's `net:kamadan.gwtoolbox.com` for live rates; offline math needs none | Math table; live rates show their observation time; math works offline | Sim + Live agent (read values) | M13-03 | 638 → shared (B04; today's calculator rebuilt in M6-02) |
| B08 | Xunlai Storage | Open the storage window in an outpost: Hub row, shortcut, `/chest` | Stable | merge into Quick actions | Quick actions | `game.storage.open` | Hub row and shortcut open storage in an outpost; refused outside outposts (explorable and PvP) with a plain receipt | Live agent | M13-06 | 290 → ≤ 150 shared (B17, B18) |
| B09 | Quick Item Move | Ctrl-click moves a stack between bags and storage | Beta | defer | host tweak | – | – | – | Later | 1,008 → later |
| B10 | Target Distance | Distance to your target and its range band | Stable | keep | Target Distance | `game.player`, `game.target` | Distance and band match on a friendly NPC in an outpost that Matthias selects; the agent reads facts and screenshots | Read-only live + Matthias | M13-07 | 863 → ≤ 80 (+ rebuilt in M6-02) |
| B11 | Skill cooldowns | Recharge numbers on the 8 skill slots; amber under 5 s, red under 2 s; colour preset | Stable; native draw Beta | merge into Timers | Timers | `game.skills` | Numbers sit on slots 1–8 (anchors live); countdowns in Sim; combat by Matthias | Read-only live + Sim + Matthias | M13-05 | 2,379 → ≤ 600 shared (B12, B13, B15) |
| B12 | Skill key labels | Your own key labels on the 8 skill slots | Stable | merge into Timers | Timers | – | A captured key shows on its slot over the real skill bar | Read-only live | M13-05 | 456 → shared |
| B13 | Effect timers | Remaining time on your own effect icons | Beta | merge into Timers | Timers | `game.skills` | A fixture effect shows its time on its icon; indefinite effects show none | Sim + Matthias | M13-05 | 1,339 → shared |
| B14 | Alcohol timer | Countdown of your alcohol level | Beta | merge into Timers; defer | Timers | – (alcohol fact deferred) | – | – | Later | 389 → later |
| B15 | Reminders | A chat line only you see 1 min before a con or pcon ends, and at the end; optional chime | HEAD | merge into Timers | Timers | `game.skills`, `game.note` | A fixture effect at 60 s prints one note, expiry one more; the note rate limit holds (P84) | Sim + Matthias (one live check) | M13-05 | 306 → shared |
| B16 | Chat filters | Hide ally drops, Hall of Heroes and title notices | Beta | keep | host tweak | – | Each toggle hides its notice kind in incoming chat | Live agent (Hall of Heroes, titles) + Sim + Matthias (ally drops) | M13-09 | 300 → shared (A15) |
| B17 | Call Target | A shortcut calls your target to the party | Beta | merge into Quick actions | Quick actions | `game.target.call` | The shortcut calls the target through the executor (no injected keys) | Sim + Matthias (one live check) | M13-06 | ~50 → shared |
| B18 | Resign | Shortcut or Hub row `resign` asks first, then resigns | Beta | merge into Quick actions | Quick actions | `game.resign` | Host confirm; Enter resigns, Escape cancels; refused outside explorable areas | Sim + Matthias (one live check) | M13-06 | 303 → shared |
| B19 | Maps: common | Map styles, compass control, visited maps | Beta | defer | Maps | – | – | – | Later | 6,421 → later |
| B20 | Maps: exploration grid | Exploration cells on mission and world maps | Beta | defer | Maps | – | – | – | Later | 1,959 → later |
| B21 | Maps: walkable terrain | Shades ground you cannot walk on | Beta | drop (proposed, D12) | – | – | – | – | – | 2,921 → 0 |
| B22 | Maps: compass ranges | Range rings on the Compass | Beta | defer (first Maps piece) | Maps | `game.player` | – | – | Later | 764 → later |
| B23 | Elite skills | Hunt list per character, next target, filters, 925 capture locations, wiki links | Beta | keep planner; defer map markers | Elite skills | `game.progress`, `game.player` | Filters and Hunt list (Sim); a learned elite leaves the list; a wiki link opens | Sim + Matthias (one live check) | M13-08 | 3,048 → ≤ 500 |

Notes:

- B04, B07: Trade is internet class (no game facts). It uses its scope word `trade`, never
  `hub.search`. The feed also shows in PvP; v1 hid it there. Trader item icons are game art from the player's `Gw.dat` (M12-01).
- B05, B06: the whisper body is always typed by the player; the target is typed or a friend or
  whisper partner from `game.social`. A plugin cannot pre-fill a whisper.
- B06: travel and invite are two presses in 1.0; no combined flow.
- B08, B17, B18: the Hub rows and shortcuts themselves need no permission; each action needs
  its own grant. Quick actions uses 3 of the 4 shortcuts per install.
- B11–B13: the HUD is a DOM layer above the game frame; v1 drew under game panels and tooltips.
  Live session 1 (after M8) checks the z-order.
- B23: `{ wiki }` links need no permission. The boss link opens the elite skill's wiki page; no
  boss reference kind is added. The Builds skill inspector reaches Elite skills by filling the
  Hub search.

## Merged plugin set

Rule: one plugin per permission family and data owner, never one plugin per command. Capabilities are those of its rows. All are official bundled plugins with `moxi.<name>` ids;
`moxi.calculator` folds into `moxi.trade` in M13-03.

| Plugin | Id | Rows | Class (host) | Hub scopes from v1 | Slices | v1 → moxi |
| --- | --- | --- | --- | --- | --- | --- |
| Builds | `moxi.builds` | B01 | reads + acts (`official.local`) | `build`, `team` | M6-01, M13-01 | 17,164 → ≤ 1,400 |
| Travel | `moxi.travel` | B02, B03 (deferred) | reads + acts (`official.local`) | `travel` | M13-02 | 8,932 → ≤ 600 |
| Trade | `moxi.trade` | B04, B07 | internet (`official.internet`) | `trade` | M7-03, M13-03 | 5,415 → ≤ 950 |
| People | `moxi.people` | B05, B06 | reads + acts (`official.local`) | `whisper`, `invite` | M13-04 | 2,150 → ≤ 500 |
| Timers | `moxi.timers` | B11, B12, B13, B14 (deferred), B15 | reads + shows (`official.local`) | – | M13-05 | 4,869 → ≤ 600 |
| Quick actions | `moxi.quick-actions` | B08, B17, B18 | acts (`official.local`) | – | M13-06 | 593 → ≤ 150 |
| Target Distance | `moxi.target-distance` | B10 | reads (`official.local`) | – | M6-02, M13-07 | 863 → ≤ 80 (+ M6-02) |
| Elite skills | `moxi.elite-skills` | B23 | reads (`official.local`) | – | M13-08 | 3,048 → ≤ 500 |
| **Total** | | | | | | **43,034 → ≤ 5,080** (M6-02's ≤ 300 counted once)¹ |

¹ The v1 totals include 1,613 deferred lines (B03 1,224, B14 389); without them 41,421.

The v1 Hub scopes `char` and `acc` stay with the host (A15, A01). Host tweaks (rows with Home
`host tweak`, plus deferred B09) are never plugin code and each fails closed on its own.

## v1 region rules (test data for catalog `regions`)

v1's `FEATURE_SELECTION_POLICIES` (`../gwonmac/src/shared/feature-contracts.ts:59`). `pve` =
the map is known to be PvE; `non-pvp` = PvE or not yet known; `any` = everywhere. M1-01 carries
each rule into the action's `regions` and `available()`, and into fact withholding
(`restricted-area`). The table test names every difference (spec/04 differs on purpose:
storage is outpost-only, whisper all maps, resign explorable-only, progress all maps).

| v1 rule | v1 features |
| --- | --- |
| `any` | characterSwitch, callTarget |
| `non-pvp` | tools, buildLibrary, tradeChat, xunlaiStorage, quickItemMove, chatFilters |
| `pve` | whispers, resign, cartography, targetReadout, teamApply, travel, skillKeyLabels, skillCooldowns, alcoholTimer, progress, reminders, effectTimers |

## Drop list

Proposed drops: v1 lines never ported (v1 savings, not moxi savings). Matthias decides them as one decision, D12 (Open decisions).

| Candidate | Row | v1 lines | Files | Why |
| --- | --- | ---: | ---: | --- |
| Diagnostics overlay | A23 | 579 | 1 | The flight recorder and `pnpm drive` cover it |
| Input trace view | A23 | 539 | 3 | Developer view; no player job |
| PlayStation button symbols | A07 | 267 | 2 | Cosmetic; clashes with texture packs on the same atlas |
| Profession command trace | A23 | 422 | 3 | Developer trace |
| Other traces and memory attribution | A23 | 1,053 | 4 | v1 bug tools; the flight recorder measures memory |
| Visual problem report | A23 | 658 | 4 | Third-party upload page; the diagnostics export replaces it |
| Templates pane (file import and export) | A14 | 815 | 2 | Template codes and bundles already move builds |
| Core/Tools launch modes and restart | A24 | 497 | 7 | Plugins switch live; region rules survive as data |
| Maps: walkable terrain | B21 | 2,921 | 8 | Rust reachability kernel; plugins are TypeScript only |
| Cartography evidence export | – | 1,203 | 4 | Diagnostic export; not a player feature |
| **Total** | | **8,954** | **38** | |

## Deferred

| Item | Row | v1 lines | Why | Comes back |
| --- | --- | ---: | --- | --- |
| Progress page | B03 | 1,224 | Never released; needs mission, vanquish and Cartographer records beyond `game.progress` (M11-06) | Later, as a Travel page |
| Quick Item Move | B09 | 1,008 | Largest v1 transform; per-build item and trade offsets; never checked live | Later (host tweak) |
| Alcohol timer and alcohol reminders | B14, part of B15 | 389 | Needs an alcohol-level fact that is not an effect; niche | Later |
| Maps: common and exploration grid | B19, B20 | 8,380 | Need map-window anchors and a map-data fact (bitmap, bounds) | Later, after compass ranges |
| Maps: compass ranges | B22 | 764 | Needs only `game.player` and the `compass` anchor (M11-11); Maps wait until after Beta | Later, first Maps piece |
| Elite map markers | part of B23 | – | Need map-window anchors | Later, with Maps |
| Whisper sound modes | part of B05 | – | No audio capability in api 1; only `game.note` has a chime | Later, if an audio capability is added |
| Whisper drafts | part of B05 | – | Not in 1.0 | Later |
| Share a custom palette as text | part of A18 | – | Not in the settings slices | Later |

## Facts and powers v1 used that the launch catalog did not name

| Fact or power | Rows | Resolution | Where |
| --- | --- | --- | --- |
| Character key (privacy-safe, 16 hex) | B01, B02, B23 | added to `game.player` | M11-02 |
| Guild Hall: owned, and you are in it | B02 | added to the player and map facts | M11-02 |
| Alcohol level | B14, B15 | deferred with the alcohol timer | Later |
| Chat participants (names seen in chat) | B05, B06 | folded into `game.social` | M11-07 |
| Account heroes and hero behaviour | B01 | folded into `game.party` | M11-03 |
| Exploration bitmap, map bounds, terrain raster | B20, B21 | deferred with Maps (terrain dropped) | Later |
| HUD anchors `skill:1..8`, `effect:<skillId>`, `compass`, `target` | B11, B12, B13, B22 | added | M11-11 |
| HUD anchors on the map windows | B19, B20, B23 | deferred with Maps | Later |
| Audio output | B05 | deferred | Later |
| Key capture setting | B12 | added: `KeyField` element and a key setting type | M3-04, M1-03 |
| Manifest shortcut for a game action | B08, B17, B18 | added: `commands[].shortcut` with a static `game` op, matched in Main | M1-03, M5-09 |
| Travel and invite as one press | B06 | not built: two presses, "Travel to <friend>" then "Invite <friend>"; no combined flow, no new catalog id | M13-04 |
| Write a build into the game's template folder | A14, B01 | host command "Save to game templates" for a pasted or row-copied template code; no plugin API | M13-12 |
| Chat aliases `/tp`, `/chest`, `/xunlai`, `/trade` | A19 | a game-side chat hook opens the Hub at the command; the action still needs Enter | owner M11-12 (patch layer); M12-07 depends on M11-12 |

## Beyond v1 (not parity)

| Addition | What the player gets | Slices | Proof |
| --- | --- | --- | --- |
| Action chains | One press runs up to 8 steps of `game.travel`, `game.builds.load`, `game.team.apply`, `game.storage.open`, in outposts only | M1-03, M5-08, M11-10 | P81 |
| `game.vitals` | Health, energy, dead, morale and the cast skill, for you and your heroes; display only; no v1 feature reads it | M1-01, M5-07, M11-05 | P82 |
| `game.inventory` | Bags, storage and gold; only if Matthias says yes (Q7) | M11-13 | – |
| Today in Tyria | Replaces v1's placeholder Dailies (A22) | M12-04, M12-05 | – |

## Open decisions for Matthias

| ID | Decision | Default in this ledger | Rows |
| --- | --- | --- | --- |
| D12 | Approve the drop list (8,954 v1 lines) | Drop all ten; until decided the rows are proposals | A07, A14, A23, A24, B21 |
| Q7 | `game.inventory` (bags, storage, gold) in api 1 | Not at launch; M11-13 runs only on a yes; parity needs none | – |
| D8 | Hub chord on Windows and Linux | Ctrl+R | A16, A19 |
| – | Whisper sound modes (Off, Background, Every message) | Deferred: no audio capability in api 1 | B05 |
| – | Timers numbers float above game panels and tooltips | Accept for 1.0; judged at live session 1 | B11, B12, B13 |
| – | v1 HEAD `ddc48b66` is on no branch or tag in `../gwonmac` | Push a branch or tag before the v1 archive in M15-05 | A17, B03, B15 |

## Parity differences

| Difference | Rows |
| --- | --- |
| Travel and invite are two presses, not one flow | B06 |
| The Trade feed shows in PvP (v1 hid it) | B04 |
