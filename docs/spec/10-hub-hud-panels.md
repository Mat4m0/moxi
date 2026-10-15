# 10 Hub, HUD and panels

## Purpose
The surfaces that plugins and host features share inside one game window: the Hub (search, rows, views, sheets), the HUD layer, panels, toasts and receipts. This
spec owns their rules, the Hub shell contract, query routing, pins and search phrases, attribution and the chain progress UI. All of it lives in `packages/hub`,
mounted by `apps/game` and by `moxi dev`.

## 1. Rules in force
### 1.1 Surfaces and stacking

Each game window has these layers, bottom to top. Each is a fixed, full-window element in the game page; only the element boxes inside a layer take pointer input.

| Layer | Holds | Pointer input | Keys |
| --- | --- | --- | --- |
| Game canvas | the official client | yes | when it has focus |
| HUD | HUD widgets (1.9) | never (only in Arrange HUD, 1.10) | none (Arrange HUD fences) |
| Panels | open panels (1.11) | inside each panel box only | fenced while focus is inside a panel |
| Hub | the Hub panel and its sheets | the Hub panel; a click outside closes the Hub | fenced while open (H2) |
| Sheets | a host sheet shown without Hub or panel (1.5) | the sheet; outside clicks are swallowed | fenced while open |
| Toasts | toasts and receipts (1.6, 1.7) | never | none |

- The HUD layer is `pointer-events: none` and `contain: strict`.  It floats above game panels and tooltips.
- One game window = one Hub, one HUD layer, its own panels and toasts. Only the stored marks (1.12) and HUD switches (1.9) are shared between windows.
- Plugin surfaces (rows, answers, views, panels, HUD widgets, toasts, shortcuts) exist only inside a plugin session (spec 01 §2, I8). Host rows work in every game
  state.

### 1.2 Hub shell rules
The contract suite `packages/hub/test/hub.contract.test.ts` (browser mode) tests each rule through the real Hub.
"Kept" names today's test in `apps/game/src/hub/hub.contract.test.ts`.

| Id | Rule | Test |
| --- | --- | --- |
| H1 | Main's `hub.toggle` event (spec 11) opens a closed Hub and closes an open one. Opening shows a fresh root with an empty search field and focuses it. Closing returns focus to the element that had it before opening, or the game canvas if that element is gone. A `mousedown` outside the Hub panel closes the Hub; that click does not reach the game | new (focus return, outside click) |
| H2 | Key fence: while the Hub is open, its window-capture `keydown` and `keyup` listeners stop every key, auto-repeat included, from reaching the game page. A key pressed while open keeps its `keyup` swallowed after the Hub closed; the listeners leave when no such key is held | kept: "Hub keydown, repeat and matching keyup never reach the game" |
| H3 | A printable key without Cmd/Ctrl moves focus to the search field, unless focus is in a host input element or the view has no search field | kept: "Typing reaches search from %s focus (H03)", "...after a view swap (H03)" |
| H4 | Selection is by row identity. The top row stays selected until the player moves the selection. A reorder keeps the selected identity. A removed selected row leaves no selection; Enter then does nothing. The Hub never runs a replacement row | kept: H12 identity test, "The top result stays selected…" |
| H5 | A resting pointer never changes selection: hover selects only when `movementX` or `movementY` is non-zero | kept: "A resting pointer cannot change selection…" |
| H6 | Enter (not repeat) runs the primary action (the first action) of the selected row or of the open detail. A double-click runs it only when the row is selected and has been visible for `hub.doubleClickGuardMs` | kept: "A double-click cannot run a %s row…" |
| H7 | Cmd/Ctrl+K opens the actions menu: the row's actions in order, then the host actions of 1.12 and "Plugin page". Up/Down move, Enter runs, Cmd/Ctrl+K closes | kept (part of the Enter test) |
| H8 | Escape ladder, one step per physical press (a repeat does nothing): (1) a running chain of this window is cancelled (1.6); (2) the actions menu closes; (3) the sheet closes; (4) the stack goes back one level and restores the parent's query and selection; (5) a non-empty query is cleared; (6) the Hub closes. A view opened directly by a command shortcut is the bottom of its stack: step 4 does not apply, so Escape then closes the Hub with no Home step | kept: H06 test; new: chain step, shortcut-opened view |
| H9 | Cmd/Ctrl+Backspace goes back one level. Cmd/Ctrl+I opens the plugin page of the selected row's install, or of the current view's install | kept (back); new (page) |
| H10 | A confirmation runs only if the row still exists with identical data (same key, same `ItemData`) when the player confirms | kept: "Confirmation runs only for an unchanged item" |
| H11 | Every result belongs to one Hub opening. A command result or an answer that arrives for an earlier opening is dropped and cannot navigate | kept: both "late … result" tests |
| H12 | An install's answers stay on screen until its answers for a newer query arrive, or until `hub.queryDeadlineMs` after that newer query passed with no answer; then they go | kept: "Unrelated query results keep…"; new: deadline |
| H13 | Inside a host input element, keys edit the input: Up/Down, Home/End and printable keys never move the selection. Enter in a single-line input inside a `Form` submits the form (a press of its first `GameAction` is a trusted press, spec 01 §2, spec 09 Form rule); Cmd/Ctrl+Enter submits from any input of the form, `TextArea` included; Enter in a `TextArea` adds a line. Escape runs the ladder from any focus | new: form-focus test |
| H14 | Row-action shortcuts (`ItemAction.shortcut`, grammar in spec 11) are Hub-local: they act on the selected row only, only while the Hub or that panel has focus, and do not count toward `install.shortcuts`. Hub keys win: a shortcut that equals a Hub key (Enter, Escape, arrows, Cmd/Ctrl+K, Cmd/Ctrl+I, Cmd/Ctrl+Backspace) never matches. A row shortcut runs `run`, `copy`, `push`, `link`, `wiki`, `open` and fill-search actions. It never runs a game action: the `game` `ItemAction` has no `shortcut` (spec 01 §2) | kept: "Enter runs the first action and action shortcuts ask before destruction"; new: game-action row |
| H15 | Session guard: with no plugin session the Hub shows host rows only and one quiet line "Plugins start when you enter the world". When the plugin session closes while the Hub is open, every plugin view leaves the stack, the root shows host rows, and the selection is cleared | new |
| H16 | In a view, the first `List`, `Grid` or `Table` in the root (document order) is the view's main collection: the search field filters it and the list keys move its selection. Host filtering ranks its rows with `rank()`; plugin filtering sends the text as that element's search event (spec 09). A view without a collection has no search field; a hidden focus target inside the Hub keeps focus there | new |

### 1.3 Hub rows and ranking
Root rows, in this order:

1. **Notice** (only when it applies): "Plugins paused" with the action "Start plugins"; or the line "Plugins are off for this run" after "Start without plugins".
2. **Pinned** (empty query only): pinned marks in stored order (1.12), when their target exists in this session.
3. **Answers** (non-empty query): rows from `hub.answer`, at most `hub.answersPerQuery` per install, in the plugin's own order, grouped by install (official first,
   then plugin name, then install key). Answers are not filtered by the query text.
4. **Results**: host rows, manifest commands, Hub items and HUD switch rows, ranked by `rank()` from `apps/game/src/hub/search.ts` (moved): tier 0 = exact title or a
   search phrase, tier 1 = title prefix, tier 2 = every query word is a prefix of a title or keyword word; then title, then row key. With an empty query, HUD switch
   rows and host rows other than "Plugins" are left out.

With a plugin scope word (1.4), only that scope's answers and the Hub items whose `scope` equals the word are shown. Hub items beyond `hub.itemsPerSession` per
install are not ranked.

Row keys (identity for H4): `host:<id>`, `cmd:<installKey>:<commandId>`, `item:<installKey>:<itemId>`, `answer:<installKey>:<itemId>`, `hud:<installKey>:<hudId>`,
and `pin:` + the target's `cmd:` or `item:` key for a Pinned row.

| Row | Title (who writes) | Enter does | Footer hint |
| --- | --- | --- | --- |
| Manifest command, view or panel | command `title` (plugin) | opens the view or panel | "Open" |
| Manifest command, static single op | command `title` (plugin) | trusted press → game intent (spec 13) | host label `describe(args)` |
| Manifest command, chain | command `title` (plugin); preview pane lists the steps (1.6) | trusted press → chain (spec 13) | "Run <n> steps" |
| Hub item or answer | `ItemData.title` (plugin) | primary action (1.5) | label of the primary action |
| HUD switch | "Show <widget title>" / "Hide <widget title>" | turns the widget on or off (1.9) | "Show" / "Hide" |
| Host: Plugins | "Plugins" | pushes the host list of installs; Enter on one opens its plugin page | "Open" |
| Host: Arrange HUD | "Arrange HUD" (in a session with at least one widget on) | Arrange HUD (1.10) | "Arrange" |
| Host: Start plugins | "Start plugins" (only while a host is paused) | Main restarts paused hosts | "Start" |

A row whose game action cannot run now stays selectable and shows the reason in place of its footer hint: `ItemData.unavailable` (plugin text), "Turned off in plugin
settings" (grant off, spec 12), or the catalog `available()` reason (spec 04). Enter then does nothing.

`hub.command` from Main (a bound shortcut, spec 11; its press is a trusted press, spec 01 §2): a view command opens the Hub with that view as the bottom of its
stack, or pushes the view when the Hub is already open; a panel command opens or focuses its panel (1.11); a static `game` command or chain shows no UI except its
receipt and any sheet.

### 1.4 Query routing
The Hub routes text only at its root, never inside a view. The pure `routeQuery` (2.3) decides who gets what. For the trimmed-start text `t` and each enabled install
in the session:
| Text class | Install receives | Personal |
| --- | --- | --- |
| First word is a host scope word (`char`, `acc`) followed by a space | nothing; the host feature handles it | – |
| First word is a scope word the install declares (`hub.scopes`), followed by a space | the text after that word, when it is not blank | no |
| `t` starts with a digit `0`–`9` and the install has `hub.numbers: true` | `t` | no |
| Any other non-empty `t`, when the install holds an effective `hub.search` grant and is `local` class | `t` | yes |
| Hub items (`hub.items`) | nothing: the host ranks them | – |

- The first matching row wins for each install. Several installs may declare the same scope word; each receives the text.
- The router checks `local` class for `hub.search` even though spec 04 already refuses that grant to `internet` installs.
- Every change of the search text at the root sends one `query` (spec 07) to each install whose routed text changed, all with one new `qid` from a per-window
  counter. No debounce. An answer counts only if its `qid` is the newest sent to that install in this Hub opening and it arrives within `hub.queryDeadlineMs`. When
  an install's routed text becomes empty, its answers leave at once and it gets no query. Closing the Hub drops every pending query and answer.
- While the first word is a recognised scope word, the search field shows a scope chip: the plugin icon and name; for an `internet` install also "Sends to <first net
  host>" and "+N" for more hosts. Host scope words show "Characters" or "Accounts".

### 1.5 Row actions, sheets and the descriptor guard
How the Hub runs each `ItemAction` (types: spec 08):
| Variant | On press | Label |
| --- | --- | --- |
| `game` | builds the intent and runs the action flow of spec 13; receipt (1.6) | host `describe(args)`; never a plugin title |
| `run` | sends the event to the worker; `confirm` opens a sheet first | plugin `title`; `tone: "danger"` shows danger tone |
| `copy` | the host writes the text to the clipboard; host toast "Copied to clipboard" | plugin `title`, else "Copy" |
| `push` | pushes a view (a new root, spec 01 §3) | plugin `title` |
| `link` | link sheet with the full URL; "Open" asks Main, which checks the `link:` grant and opens the system browser | "Open <host>" |
| `wiki` | Main builds the official wiki URL (spec 14) and opens the system browser; no sheet | "Open in the wiki" |
| `open` | goes to the Hub root, clears the query and selects that install's Hub item | "Show in <plugin name>" |
| fill-search | goes to the Hub root and sets its search text to the given text; routing (1.4) follows | "Search “<text>”" |

- `open` names a plugin id. The action is left out while no enabled install of that id has a Hub item with that id in this session. `open` and fill-search are host
  navigation, not game actions.
- When the Hub builds a game intent, it reads each `field()` value from the host input of the same root inside the press handler, in the same task (spec 09 binds
  fields; P45).

**Sheets.** One host sheet component serves five cases: game confirm (catalog `confirm()`), descriptor guard, plugin `run` confirm, link, and access request
(`RequestAccess`, spec 12).

| Rule | Value |
| --- | --- |
| Where | inside the Hub or panel the press came from; for a press with neither (a command shortcut with the Hub closed), alone at the centre of the game window with its own key fence |
| Arming | presses are ignored for `hub.confirmArmingMs` after it opens |
| Keys | Enter or the confirm button confirms; Escape or "Cancel" dismisses; focus starts on the confirm button |
| Game confirm | title = catalog `confirm()` text (for example "Resign from the mission?"); confirm button = host label |
| Descriptor guard | a press on a game control whose descriptor changed within `hub.descriptorGuardMs` opens the sheet with the label of what would run now; nothing runs until a second press (P42) |
| Chain confirm | when spec 13 asks to confirm a chain, the sheet lists every step label once |
| Link | "Open this address in your browser?", the full URL, "Open", "Cancel" |
| Access | "Allow: <host wording>", then "Plugin says: <reason>", "Allow", "Don't allow" (texts and deny count: spec 12) |
| Trust | the confirm-sheet button press on a game sheet is the trusted press (spec 01 §2) |

### 1.6 Receipts and chain progress
Every game action and chain started in this window gets one receipt in the toast stack (1.7).

- A receipt carries the plugin chip, a title and a status line. Title: the host label for a single action; the command title (plugin text, next to the chip) for a
  chain.
- Status lines (the host message comes from the `ActionReport` of spec 13):
| State | Single action | Chain |
| --- | --- | --- |
| running | "Running…"; a host flow adds its own count ("5/16") | "<i>/<n> · <step label>" |
| done | "Done" | "Done" |
| refused | "Not sent: <message>" | "Stopped at step <i> of <n>: <message>" |
| failed | "Didn't work: <message>" | "Stopped at step <i> of <n>: <message>" |
| cancelled | – | "Stopped: you pressed a key" or "Stopped: you pressed Escape" |

- A running receipt stays until its final state, then lives `hub.toastMs`. It does not count against the install's toast rate, and the visible cap never removes a
  running receipt.
- The preview pane of a chain row, the chain sheet and the expanded receipt list every step with host labels: "Runs in order on one press, only in outposts, towns
  and Guild Halls:" then "1. …", "2. …". The plugin page shows the same list (spec 12).
- Escape in the Hub, a panel or a sheet cancels a running chain of this window first (H8). With the Hub closed, the executor's own input watch cancels it (spec 13).
  The Hub reports a cancel by aborting the `signal` of `GameBridge.act` (spec 02).
- The worker of a `local` install gets the result through spec 13; an `internet` install gets none. The receipt is host UI for the player in both cases.

### 1.7 Toasts
- The Hub owns toasts: queue, rate and display. The membrane only forwards `toast` messages (spec 07 §8); no other layer throttles them.
- `useToast()` (spec 08) sends text and a tone; the Hub maps `neutral`, `good`, `bad` to the tones `neutral`, `good`, `danger` (spec 09).
- Limits: one toast per install per `hub.toastIntervalMs` (a newer one replaces the waiting one); `hub.toastsVisible` at once (a new one removes the oldest
  non-running item); each lives `hub.toastMs`; text is cut at `view.titleChars`.
- A toast takes no pointer input and has no action button. The stack is `role="status"` with `aria-live="polite"`.
- Place: top centre of the game window; while the Hub is open, directly under the Hub panel. When a plugin session closes, its plugin toasts go; its running receipts show their final state.

### 1.8 Attribution
| Surface | Chip |
| --- | --- |
| Hub row of a plugin (command, item, answer, HUD switch) | plugin icon on its `accent` tile and plugin name, at the row's right edge |
| View header in the Hub | chip, then the view title |
| Panel title bar | chip, then the command title |
| Toast and receipt | chip before the text |
| HUD widget root at a `screen:*` anchor | icon tile and name above its top-left corner |
| `Hud` part at a game-geometry anchor | icon tile only (14 px), `aria-label` = plugin name; the tile is the attribution here; full chips in Arrange HUD |
| Every input element of an `internet` install | "Sent to <first net host>" and "+N" (rendered by the element, spec 09; the Hub provides the install's class and hosts to the elements of its roots) |

- Icons are host glyphs or `Gw.dat` art, never plugin bytes (spec 09); plugin names that copy host names are refused (spec 04). Host rows, views and toasts never carry a chip, so a plugin row never looks like a host row.

### 1.9 HUD
- Each manifest `hud` entry (spec 04) is a widget with a title and a default anchor. Widgets are off until the player turns them on; `"default": true` turns one on
  at first install for official installs only. At most `install.hudWidgetsOn` widgets of one install are on; a further switch is refused with the spec 05 text.
- **On/off is stored per install for all accounts; placement and lock are stored per account.** The plugin page switch has no account; positions depend on each
  account's game window.
- When a plugin session opens, the Hub mounts one HUD root (`hud:<n>`) per widget that is on. Turning a widget on or off mounts or unmounts it at once. Session close
  unmounts all.
- HUD elements (spec 09) have no events. Nothing in the HUD takes input in 1.0.
- `Countdown` and `HudCountdown` tick in the host from game-clock deadlines (thresholds: spec 05 §4.2). The HUD layer runs one 100 ms ticker while any countdown is
  mounted and reads the game clock from `GameBridge.now()` (spec 02).

Anchors (the `Anchor` type is spec 04's):

Box placement for a box `w × h`, offset `(dx, dy)`, margin `m` = 12 px, window `W × H`:
| Anchor | `x` | `y` |
| --- | --- | --- |
| `screen:top-left`, `-top-right`, `-bottom-left`, `-bottom-right` | left: `m + dx`; right: `W − m − w + dx` | top: `m + dy`; bottom: `H − m − h + dy` |
| `screen:top`, `screen:bottom` (edge centre) | `(W − w) / 2 + dx` | as top / bottom above |
| `screen:center` | `(W − w) / 2 + dx` | `(H − h) / 2 + dy` |
| `skill:1`…`skill:8`, `effect:<skillId>`, `compass`, `target`: rectangle `r` from `GameBridge` (M11-11), box centred on `r` | `r.x + (r.w − w) / 2 + dx` | `r.y + (r.h − h) / 2 + dy` |

- The rendered box is clamped inside the window; the stored offset stays, so the widget returns when the window grows.
- A game-geometry anchor without a rectangle (not built yet, hidden by the game, effect not on you, loading screen) hides what sits on it. It never falls back to a
  screen anchor.
- A widget root sits at its manifest anchor plus the player's offset. Inside it, a `Hud` element with an `anchor` prop (game-geometry anchors only; spec 09) is
  placed on that anchor out of the widget's flow, moved by the same offset. This is how one Timers widget puts a number on each skill slot and on each effect.
- The HUD layer is `aria-hidden="true"`: readouts change up to 10 times a second and carry no controls.

### 1.10 Arrange HUD
- Started from the "Arrange HUD" host row. The Hub closes; the HUD layer takes pointer input for widget boxes and fences keys, like the Hub.
- Every widget that is on shows as an outlined box with its full chip and its manifest title, even when its content is empty, plus "Lock" and "Reset". A host bar at
  the top reads "Arrange HUD · Drag to move · Esc Done" with "Reset all".
- Drag moves a widget's offset (pointer capture). Keyboard: Tab and Shift+Tab move between boxes; arrows move the focused box 16 px, Shift+arrows 48 px. A locked box
  does not move.
- Every drop and every key move is saved at once through `HubMain.saveHud` (2.2). "Reset" sets `dx = dy = 0` and unlocks; "Reset all" does it for every widget of
  this account. Escape or "Done" ends Arrange HUD. Plugins never see positions (P27).

### 1.11 Panels
A command with `presentation: "panel"` (spec 04) opens a panel. Panels stay inside the game window; there is no OS window for plugin UI.

| Rule | Value |
| --- | --- |
| Instances | one panel per (install, command) per game window. Running the command again focuses the open panel |
| Opening | an open Hub closes first (from its row or from a shortcut). Focus moves to the panel's first focusable element |
| Root | `panel:<n>`; a view pushed inside the panel also gets `panel:<n>` and joins the panel's own stack, with "Back" in the title bar |
| Frame | host title bar: chip, command title, "Back" when the stack is deeper than 1, close "×"; resize handle at the bottom-right corner |
| Size and place | first open: 360 × 480 px at `x = W − w − 24`, `y = 96`; minimum 240 × 160 px; clamped inside the window. Move by dragging the title bar, resize by the handle; keyboard: arrows on the focused title bar move 16 px (Shift 48 px), arrows on the focused handle resize 16 px. Saved per account and (install, command) on each drop or key step |
| Input | pointer input only inside the panel box. While focus is inside a panel, the H2 key fence applies to that panel |
| Escape | (1) running chain, (2) actions menu, (3) sheet, (4) back in the panel stack, (5) focus returns to the game canvas and the panel stays open. "×" closes it |
| Stacking | the last focused panel is on top; the Hub is above every panel. Closing the Hub returns focus to the panel that had it |
| Ends | "×", plugin session close, the install turned off or removed. Panels never reopen by themselves |
| Budget | open views and panels count in `view.rootsPerSession` |

### 1.12 Pins and search phrases
Host-owned marks, stored once for all accounts, keyed by install key and target (spec 12). A mark has a target, a pinned flag and at most one search phrase.

- Targets: a Hub item id or a manifest command id of one install.
- Host actions in the actions menu (H7) of every command row and Hub item row (not answers): "Pin to Home" / "Unpin"; "Add search phrase…" (a host form with one text
  input) / "Remove search phrase"; on Pinned rows also "Move up" / "Move down".
- A phrase is tier 0 in `rank()` for its target. It changes how the row is found, never its title.
- A phrase is refused when saving if it is empty after trim, longer than `hub.phraseChars`, contains a control character, starts with a digit ("A search phrase can't
  start with a number"), starts with a scope word ("This phrase starts with the search word of <plugin name>"), or equals another phrase after normalisation ("This
  phrase is already used"). Normalisation = trim, lower case, collapse white space (`norm` in `search.ts`).
- A stored phrase that a later scope word shadows keeps loading and stops matching.
- At most `hub.marks` marks. "Remove all search phrases" (a confirmed host action on the "Plugins" view) keeps the pins.
- A mark whose target does not exist in the current session is hidden, not deleted. Removing an install deletes its marks (spec 12).

### 1.13 Plugin page, Plugins list and HUD switches in the Hub
- The Hub pushes the plugin page as a host view: `PluginPage.vue` (packages/ui) over the page model that Main returns (`HubMain.page`, spec 12). No plugin code runs
  while it is open. Its switches go to Main as approvals from the game window (spec 12).
- The "Plugins" host view lists installs: chip, name and state text (1.14); Enter opens the page. HUD switch rows call `HubMain.setHudOn`; the page shows the same switches.

### 1.14 Sessions, crashes and restarts (what the player sees)
This spec owns every text a player sees for a host or worker fault; specs 03 and 05 cite it and have no wording of their own. Quoted texts are the spec 05 texts where
spec 05 has the row; "Starting <name>…", "Plugins are restarting", "Restarting" and the error-mark text are this spec's. Crash kinds (`CrashKind`, spec 07) and
policy: spec 03. Each crash row names its kind: "Render threw" is `errors`, "Too large" is `batch`, "Worker stopped" is `start`, `hang`, `flood`, `worker` and a `batch`
that stops the worker.

| State | Views and panels of the install | HUD widgets | Its Hub rows |
| --- | --- | --- | --- |
| Starting | host panel "Starting <name>…" until the first batch | hidden until the first batch | commands listed; items appear when sent |
| Render threw (`errors`; last good tree kept, spec 06) | last good tree and a warning glyph in the header: "<name> had an error. What you see may be out of date." until the next applied batch | last good tree | – |
| Too large (`batch`) | "This view is too large to show" | same | – |
| Worker stopped (`start`: `worker.readyMs`; `hang`: `worker.pongMs`; `flood`; `worker`; a `batch` that stops the worker) | "<name> could not start" / "<name> stopped responding", with "Close" | hidden | commands stay; Enter starts the worker again |
| Turned off after 3 crashes | "Turned off after 3 crashes" with "Plugin page" | hidden | rows show "Turned off after 3 crashes"; Enter opens the plugin page |
| Host restarting (crash or memory cap) | "Plugins are restarting" | hidden | rows show "Restarting"; Enter does nothing |
| Host back | each command root mounts again with a new root id and the same command; views pushed above it leave the stack | mount again | items sent again |
| Host paused | "Plugins paused" with "Start plugins" | hidden | the notice row (1.3) |
| Plugin session closed | views leave the stack (H15); panels close | unmounted | gone |

### 1.15 Frame cost
All Hub, HUD and applier work runs on the game renderer's main thread. Budgets: `wire.applyMsPerFrame`, `wire.hudBytesPerSecond` (spec 05); targets P29 and P30 (spec
01 §1.6, spec 05 §4.4).

- `packages/hub` wraps its work in `performance.measure` entries: `moxi:recv` (port message receipt and decode), `moxi:apply` (applier), `moxi:hud` (HUD apply and
  countdown tick). On a Hub key down that moves the selection it marks `moxi:key`, and in the next animation frame after the selection painted it marks `moxi:paint`.
  The CI harness (M3-08, M6-04) reads them with a `PerformanceObserver`, next to the rAF interval histogram and `contentTracing`.
- Decision rule (P29): above target, HUD applies are batched into one task per frame within the 1 ms cap; still above, PB17 runs (the Hub as a panel-sized view).

## 2. Types and shapes
### 2.1 Placement, marks and receipts

```ts
// packages/contracts/src/hub.ts: IPC edge records. packages/hub imports them as types.
import type { InstallKey } from "@moxi/sdk/host";

/** Per account. Offsets in CSS px from the anchor rule (1.9). */
export type HudPlacement = { installKey: InstallKey; hudId: string; dx: number; dy: number; locked: boolean };
/** Per account. CSS px in the game page. */
export type PanelPlacement = { installKey: InstallKey; commandId: string; x: number; y: number; w: number; h: number };
/** For this window's account; `hudOn` is the same for every account. */
export type HubLayout = {
  hudOn: readonly { installKey: InstallKey; hudId: string }[];
  hud: readonly HudPlacement[];
  panels: readonly PanelPlacement[];
};

export type MarkTarget = { installKey: InstallKey; kind: "item" | "command"; id: string };
/** Pin and/or phrase. Unique by target; array order = pinned order. */
export type HubMark = { target: MarkTarget; pinned: boolean; phrase: string | null };
```

```ts
// packages/hub/src/model.ts
import type { InstallKey, StepState } from "@moxi/sdk/host"; // StepState: host/actions.ts, meaning in spec 13

export type Receipt = {
  id: number;                 // per game window, +1 per press
  installKey: InstallKey;
  title: string;              // host label, or the chain command's title
  chain: boolean;
  steps: readonly {           // one step for a single action
    label: string;            // host describe(args)
    state: StepState;
    message?: string;         // host text from the ActionReport (spec 13)
    count?: { done: number; total: number }; // a host flow inside the step ("5/16")
  }[];
  state: Exclude<StepState, "waiting">;
  cancelledBy?: "key" | "escape";
};
```

Main validates `HudPlacement`, `PanelPlacement` and `HubMark` at the edge (integers, `|dx|, |dy|, x, y ≤ hub.maxOffset`, `w, h` between the panel minimum and
`hub.maxOffset`, phrase rules of 1.12) with ArkType schemas on the channels of spec 07; a value outside the bounds is refused there. The types are in M3-01, the schemas in M4-01.

### 2.2 What `packages/hub` needs from its host
`packages/hub` imports `vue`, `packages/ui`, `@moxi/sdk/host` and the `packages/contracts` hub record types only (spec 02). `apps/game` implements three objects for
it; `moxi dev` implements them with the sim and in-memory stores.

```ts
// From other specs: InstallKey, Sid, Platform, WikiRef (@moxi/sdk/host, spec 01 §3); Manifest (04); IconRef (09);
// PageModel (12); HubPort, GameBridge (02); KeyBinding, KeyTarget, KeyChord (11, 07); AppearanceSettings (contracts); CapabilityId (04);
// RefTable, RefRow (11). HubLayout, HudPlacement, PanelPlacement, HubMark: 2.1.

// packages/hub/src/index.ts. The sheet layer of 1.1 lives inside `hub`.
export function mountHub(
  roots: { hud: HTMLElement; panels: HTMLElement; hub: HTMLElement; toasts: HTMLElement },
  deps: {
    plugins: HubPort;   // one object for every plugin host of this window; spec 02 §5 says how it multiplexes ports
    game: GameBridge;
    main: HubMain;
  },
): { unmount(): void };

// packages/hub/src/main-link.ts. apps/game implements it over window.moxi (channels: spec 07).
export interface HubMain {
  readonly platform: Platform;                       // from the preload (spec 11)
  onToggle(cb: () => void): void;                    // hub.toggle
  onCommand(cb: (installKey: InstallKey, commandId: string) => void): void; // hub.command
  onInstalls(cb: (installs: readonly HubInstall[]) => void): void;                // plugin.state, with the host states
  onKilled(cb: (killed: readonly CapabilityId[]) => void): void;                  // plugin.state `killed`: the game-build compatibility status (spec 13 §3.3)
  onBindings(cb: (bindings: readonly KeyBinding[]) => void): void;                // plugin.state `bindings` (labels only, spec 11)
  onPluginsChanged(cb: () => void): void;                                         // plugins.changed: the Hub then calls layout() again
  onAppearance(cb: (appearance: AppearanceSettings) => void): void;               // appearance.changed
  onSession(cb: (sid: Sid | null) => void): void;    // this window's plugin session
  layout(): Promise<HubLayout>;                       // hub.layout.get; called again after every plugins.changed (spec 07 §4)
  saveHud(p: HudPlacement): Promise<void>;            // hub.hud.save
  savePanel(p: PanelPlacement): Promise<void>;        // hub.panel.save
  setHudOn(installKey: InstallKey, hudId: string, on: boolean): Promise<"ok" | "limit">; // hub.hud.on (also callable from the launcher)
  marks(): Promise<readonly HubMark[]>;               // hub.marks.get
  saveMarks(next: readonly HubMark[]): Promise<"ok" | "invalid">; // hub.marks.save
  page(installKey: InstallKey): Promise<PageModel>;  // plugins.page (spec 12)
  grant(installKey: InstallKey, capability: CapabilityId, state: "granted" | "denied"): Promise<"ok" | "not-requested">; // plugins.grant: Allow, Don't allow, page switches (spec 12)
  enable(installKey: InstallKey, enabled: boolean): Promise<void>;                // plugins.enable (spec 12)
  bind(target: KeyTarget, chord: KeyChord | null): Promise<{ ok: true } | { ok: false; reason: "reserved" | "taken" | "invalid"; by?: KeyTarget }>; // keys.bind
  appearance(): Promise<AppearanceSettings>;         // appearance.get
  reference(table: RefTable, ids: readonly number[]): Promise<readonly RefRow[]>; // ref.get: host labels
  open(target: { link: string; installKey: InstallKey } | { wiki: WikiRef }): Promise<"opened" | "refused">;
  startPlugins(): Promise<void>;                     // plugins.run { run: true }
}

/** Built by apps/game from the plugin.state event (installs, grants, hosts; spec 07 §4). */
export type HubInstall = {
  installKey: InstallKey;
  pluginId: string;
  name: string;
  icon: IconRef;
  accent: string | null;
  official: boolean;
  netHosts: readonly string[];         // empty for local class
  enabled: boolean;
  state: "starting" | "running" | "stopped" | "off-after-crashes" | "restarting" | "paused";
  commands: Manifest["commands"];
  hub: Manifest["hub"];
  hud: Manifest["hud"];
  hubSearch: boolean;                  // effective grant (spec 12)
};
```

Spec 12 stores them: HUD on/off per (install, hudId) for all accounts; placement, lock and panel placement per account; marks per (install, kind, id).

What this spec needs from `GameBridge` (spec 02 owns the signature): action intents in (`act`) and progress per receipt step out (`ActOptions.onProgress`); a chain
cancel (`ActOptions.signal`); the game clock in milliseconds (`now()`); the rectangle of a game-geometry anchor (`view.anchors`, absent when none); whether the
current map is an outpost, for chain rows (`view.facts`).

### 2.3 Routing
```ts
// packages/sdk/src/host/manifest.ts (M1-03). This spec owns the content (the v1 host scopes for character switch and accounts);
// spec 04's parser owns the refusal as plugin scope words.
export const HOST_SCOPE_WORDS = ["char", "acc"] as const;

// packages/sdk/src/host/routing.ts (pure; packages/hub imports it from @moxi/sdk/host)
export type RoutingInstall = {
  installKey: InstallKey;
  scopes: readonly string[];
  numbers: boolean;
  search: boolean;          // effective hub.search grant
  cls: "local" | "internet";
};
/** Routed text per install (1.4); installs that get nothing are absent. */
export function routeQuery(text: string, installs: readonly RoutingInstall[]): Map<InstallKey, string>;
```

## 3. Constants
Every limit named in this spec (`hub.*`, `view.*`, `install.*`, `wire.*`) is a spec 05 `budgets.ts` key; no value is repeated here.

Display constants (not budgets; in `packages/hub/src/layout-constants.ts`, like the countdown thresholds of spec 05 §4.2): HUD margin 12 px; countdown tick 100 ms;
Arrange HUD and panel key steps 16 px and 48 px; panel default 360 × 480 px at `(W − w − 24, 96)`; panel minimum 240 × 160 px; geometry-anchor chip 14 px.

## 4. Decisions
Spec 01 decisions 44 to 47 (Hub in the game renderer, HUD by name with no events, panels inside the game window, per-frame cost measurement) hold here. This spec
adds:
| Decision | Reason | Rejected |
| --- | --- | --- |
| HUD on/off per install for all accounts; placement per account | the plugin page switch has no account; positions depend on each account's window | both per account (the page could not show one state) |
| `Hud` parts with game-geometry anchors inside one widget; no rectangle hides the content | effects come and go, so manifest widgets cannot list them; a number in a corner where a slot should be misleads | one manifest widget per slot or effect; falling back to a screen anchor |
| No query debounce; newest `qid` wins | deterministic without timers; answering is worker work, not game-thread work | today's 40 ms debounce |
| Answers keep plugin order, grouped by install, not filtered by text | an answer ("10 Globs of Ectoplasm = 82 platinum") does not contain the query words | ranking answers with item rows (drops calculator results) |
| Every install that declares a scope word receives its text; host scope words reach no plugin, not even `hub.search` ones | both asked for it, no first-come rule to store; character and account names stay host data | one owner per word; treating host scope words as plain text |
| Marks global, keyed by install key and target; one list with one phrase per target, limits as v1 | the design keys them by install key and item id; v1's shape is proven | per-account marks (pins repeat per account) |
| Receipts live in the toast stack | one place for feedback whether the Hub is open or not | a second status surface |
| Toasts take no input, no action button | nothing over the game steals a click; BD13 | a toast "Undo" button |
| Row shortcuts never run game actions; the `game` `ItemAction` has no `shortcut` | spec 01 §2 lists the trusted presses; a row shortcut is not one | adding row shortcuts to the trusted press list |
| Final Escape in a panel returns focus to the game; "×" closes | a Whispers panel stays beside chat while playing | Escape closes the panel |
| After a host restart command roots remount; pushed views leave | a pushed view's component lives only in the dead worker | closing every view; keeping dead roots |
| A click outside the Hub closes it and is swallowed | nothing new is sent or applied by a dismissing click | passing the click to the game |
| `wiki` opens at once; `link` asks first | the wiki URL is host-built for a moxi-listed host; a `link:` URL is plugin-built | a sheet for both |

## 5. Today in code (main 848fb6e) and what changes
| Today | Where | Changes to | Slice |
| --- | --- | --- | --- |
| Hub shell (687 lines): stack, selection by row key, 40 ms debounce, Escape ladder, lingering key fence, ⌘K menu, confirm dialog, 700 ms double-click guard | `apps/game/src/hub/Hub.vue` | `packages/hub/src/Hub.vue`; rows keyed by install key; H8 chain step, H13–H16; no debounce | M3-01 |
| Contract suite (18 cases on `HubState` snapshots); `tier`, `parseScope`, `rank` | `apps/game/src/hub/hub.contract.test.ts`, `apps/game/src/hub/test/vite.config.ts`, `pnpm test:hub`, `apps/game/src/hub/search.ts` | `packages/hub/test/` on real runtime output (P25) plus the "new" tests of 1.2; `packages/hub/src/search.ts`, phrases replace `aliases` | M3-01 |
| Port client with whole-state snapshots; view ids `view:<pluginId>:<uuid>` (`client.ts:75`); game actions answered `unsupported` (`client.ts:27-36`) | `apps/game/src/hub/client.ts`, `packages/sdk/src/hub-protocol.ts` (legacy SDK after M1-00) | ops applier and root ids (spec 07, spec 01 §3); actions through `GameBridge` | M3-01, M3-02 |
| Every `hub` plugin receives every query; results dropped while a scope word is typed (`Hub.vue:120-131`) | `apps/plugin-host/src/plugin-host.ts:584-613` | `routeQuery` (2.3); answers shown under a scope | M3-01, M5-08 (P37) |
| Hub chord in the renderer by `event.key` (`r`) and `navigator.platform` | `apps/game/src/hub/App.vue` | deleted; Main sends `hub.toggle` (spec 11) | M5-09 |
| Mount on `#hub-root` (fixed, `pointer-events: none`, children `auto`) | `apps/game/index.html`, `apps/game/src/hub/main.ts` | four layer elements (1.1); `mountHub` | M3-01, M3-06 |
| HUD, toasts, host log only in the dev harness; no panels, pins, phrases, receipts, plugin page; one confirm sheet only | `apps/game/src/hub/dev/App.vue:96-116` | product game window: 1.1, 1.5–1.7, 1.9–1.13 | M3-06, M3-07, M4-04 |
| Attribution = plain plugin name (`Hub.vue:593-599`); placeholder names features (`Hub.vue:197`); plugin rows on login and character select (`Hub.vue:74-132`, `rootRows`) | `apps/game/src/hub/Hub.vue` | chips (1.8); placeholder "Search"; session guard H15 | M3-06, M3-01, M5-06 |
| `Blocks.vue`, `Icon.vue`, dev harness with its own palette and chord | `apps/game/src/hub/` | deleted; `packages/ui` elements (spec 09); `pnpm hub` runs `packages/hub` on the sim | M6-03 |

The old Hub keeps running on the legacy SDK until M5-06 switches the game window to `@moxi/hub` (`apps/game/src/hub.ts`, `ports.ts`). The e2e journey in
`e2e/shell.e2e.ts:157-193` (open with Cmd/Ctrl+R, fill "10 ecto in p", Escape clears, Escape closes) keeps working; it presses the chord with `sendInputEvent` once
the chord moves to Main (spec 11).

## 6. Built by
| Slice | Builds from this spec |
| --- | --- |
| M3-01 | `packages/hub` package, `Hub.vue`, `search.ts`, `mountHub`, `HubMain` (uses `routeQuery` from `@moxi/sdk/host`); contract suite moved and extended (1.2); row rules (1.3); query routing (1.4); row shortcuts (H14) |
| M3-02 | applier inside `packages/hub` over the shared tree in `@moxi/sdk/host` (`host/tree.ts`; spec 07 rules); root mount and remount (1.14) |
| M3-06 | layers (1.1), HUD (1.9), Arrange HUD (1.10), panels (1.11), toasts (1.7), attribution (1.8) |
| M3-07, M3-08 | sheets and descriptor guard (1.5), receipts and chain progress (1.6) on a fake executor port; `performance.measure` names (1.15) in the PB8 harness |
| M4-04 | Main stores for `HubLayout`, HUD switches and `HubMark` (tables: spec 12; channels: spec 07) |
| M5-06, M5-08, M5-09 | session guard (H15) with real sessions; receipts on the real executor; `hub.toggle` and `hub.command` from Main |
| M6-03, M6-04 | delete `Blocks.vue`, `Icon.vue` and the dev harness; P29 and P30 Measures |
| M7-04, M11-11, M12-06 | `PluginPage.vue` shared by the launcher and the Hub (1.13); game-geometry anchor rectangles for `GameBridge`; the Hub, HUD and panels in every look (Opus) |

## 7. Checked by
| Proof | What it checks here | Kind | Slice |
| --- | --- | --- | --- |
| P25 | every rule of 1.2 over views from the real runtime (B); the game page gets 0 `keydown`/`keyup` between open and close, the closing key's `keyup` included (E, `sendInputEvent`) | Gate | M3-01 (B); E with M5-09 |
| P27 | a widget at `screen:top-right` in the game renderer DOM; a toast; Arrange HUD drag and lock; offset kept after restart for that account; countdown text never goes up and follows the spec 05 §4.2 thresholds on a fake game clock | Gate (B, E) | M3-06 (B); E with M5-06 |
| P29, P30 | frame cost and key-to-paint from the 1.15 marks on `fixture-busy` | Measure | M3-08 (PB8), M6-04 |
| P31 | a chip on 100 % of plugin rows, views, panels, toasts, receipts and HUD widgets, as a `local` and as an `internet` install; every input of the `internet` install shows "Sent to <host>"; host-name copies refused (spec 04) | Gate (B, N) | M3-04, M3-06 |
| P37 | four installs (scope `price`, `numbers`, `hub.search` granted, none); each string set with one input event: "ecto", "price ecto", "10 ecto in p". Query log: scope install gets "ecto" once; numbers install gets "10 ecto in p"; `hub.search` install gets all three; the fourth gets none. A `routeQuery` table test (N) covers the same rows plus host scope words and `internet` class | Gate (B, N) | M3-01 (N), M5-08 (B) |
| P41 | Enter hint, `GameAction` tooltip, confirm sheet and receipt all read "Travel to Kamadan, Jewel of Istan" for a row titled "Copy template code" | Gate (B) | M3-07 |
| P42 | descriptor changed 100 ms before Enter → sheet and 0 executions until a second press; 600 ms → 1 execution (fake clock) | Gate (B) | M3-07 |
| P45, P38 | the intent carries the input value typed in the same task (P45); only a press on `RequestAccess` opens the access sheet (P38, sheet half) | Gate (B half) | M3-07 |
| P81 | the chain row lists its steps; progress "2/4"; stop line at the first failure; Escape cancels (UI half) | Gate (N, E) | M5-08 |

New regression tests in M3-01 (each names its bug): form focus (H13: typing in a form field moved focus to search, or Up/Down moved the list); outside click (H1: the
click reached the game); shortcut-opened view (H8: Escape showed Home instead of closing).

## 8. Deferred
- The Hub as a panel-sized `WebContentsView` (PB17): only if PB8 or P30 shows a frame or input problem, or before 2.0.
- Trusted Types on the game page (PB12); a pressable HUD, an action button on toasts, whisper drafts (spec 01 §5).
- HUD anchors on the world and mission map windows (with Maps, after Beta); drawing the HUD natively inside the game frame, under game panels and tooltips.

