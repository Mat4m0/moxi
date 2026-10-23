# 11 Input and shortcuts

This spec says which code handles which key (Main's chord router, the Hub, the game page), and defines the chord shape,
the shortcut grammar, the reserved chords, how manifest suggestions become bindings, how players rebind, and how keys are
labelled.

Terms (install key, plugin session, trusted press, chain): [01](01-foundations.md). Channels and events (`keys.list`,
`keys.bind`, `hub.toggle`, `hub.command`, `GamePluginState.bindings`): [07](07-wire-and-ipc.md). Binding table:
[12](12-consent-grants-and-updates.md). Cap: `budgets.install.shortcuts` ([05](05-budgets.md)).

## 1. Rules in force

### 1.1 Who handles a key

| Key | Handled by | When |
| --- | --- | --- |
| Hub chord | Main router → `hub.toggle` | every game window, in every game state (login, character select, world) |
| Bound command chord | Main router → `hub.command { install, command }` | only while that window has an open plugin session and the install runs (1.4) |
| Hub keys: Enter, Escape, arrows, mod+K, mod+I, mod+Enter, mod+Backspace | the Hub ([10](10-hub-hud-panels.md)) | while the Hub has focus |
| Row-action shortcuts (`ItemAction.shortcut`) | the Hub (1.9) | while the Hub or a panel has focus, on the selected row |
| Every other key | the game page | always; the Hub's key fence holds keys while it is open (10, H2) |

Main matches keys in `before-input-event` on each game window's `webContents`, before the page sees them, by physical
`KeyboardEvent.code`, even while the game has a busy thread. The launcher and the plugin hosts have no router.

### 1.2 Chord shape

A chord is **mod** (Cmd on macOS, Ctrl on Windows and Linux), an optional Shift, and one chord key (3.1). No other
modifier: no Alt or Option (Option+key types characters on macOS, Ctrl+Alt is AltGr elsewhere), no Ctrl on macOS, no
Windows or Super key. A key without mod is never a chord: players type Shift+letter in chat and in the password field. One
rule for the Hub chord, command chords and row-action shortcuts.

### 1.3 Reserved and unique

The chords in 3.2 are kept for the system, text editing and the Hub: no command takes one, with or without Shift (only the
Hub target may take mod+R). One chord has at most one target in the whole binding store.

### 1.4 The router

`createChordRouter` (2.1) is the exact algorithm; one instance per game window.

1. **Match**: `matchesChord` (2.1): a key down, not an auto-repeat, not in an IME composition, with the chord's code and
   Shift state, mod held, no Alt, no Ctrl on macOS, no Meta elsewhere.
2. **Swallow and remember.** Main calls `event.preventDefault()` on a matched key down and remembers its code. Chromium then
   withholds the key up (and every key up until the next key down), so a remembered code is dropped at its next non-repeat
   key down, at its key up if one arrives (swallowed), and on window `blur`. Its auto-repeats are swallowed and fire
   nothing; other repeats pass. One press fires once.
3. **AltGr.** Ctrl+Alt never matches. On Linux X11 AltGr arrives as its own key (`key === "AltGraph"`) and the next key
   has Ctrl without Alt: nothing matches while AltGraph is down.
4. **Live chords** (`liveChords`, 2.4), read at each key down: host chords always; a command chord only while the window
   has an open plugin session and its install is on with a `running` host. While that host is `starting` or `restarting`
   the chord is swallowed and fires nothing (03 §1.9). Otherwise (host paused or refused, install off, no session) the key
   reaches the page as a normal key.
5. **Fire.** Main sends that window `hub.toggle` or `hub.command { install, command }`. A command chord press is a
   trusted press (01 §2, kind 2): Main matched it with `input.isAutoRepeat === false` while a plugin session is open. The
   game renderer drops a `hub.command` without an open session; otherwise the Hub opens the view or panel (10 §1.3) or
   sends `plugin.action.authorize` with `from: { command }` for a static op or chain (13).

### 1.5 Clearing the stuck modifier

A swallowed key down makes Chromium drop the page's key ups, so the page still holds mod. `UNSTICK_DELAY_MS` after each
swallowed key down (a newer one restarts the timer), Main sends the window a key down with `isAutoRepeat`, then a key up,
for mod (`Meta` on macOS, `Control` elsewhere), and the same pair for `Shift` when the swallowed input held Shift (pair in
2.4). The key down ends Chromium's suppression, so real key ups reach the page again; the key up clears the page's state.
These events pass the router: a modifier is never a chord key.

### 1.6 Application menu

Before the first window opens, `setAppMenu` (2.4) calls `Menu.setApplicationMenu(null)` on Windows and Linux (the default
View > Reload is Ctrl+R and reloads the game). On macOS it sets `Menu.buildFromTemplate([{ role: "appMenu" }, { role:
"editMenu" }, { role: "windowMenu" }])`: Quit, Hide, the Edit commands text fields need (Cmd+C, V, X, A, Z), Minimize. No
View menu, so no Reload and no DevTools key. Every accelerator of these menus is in 3.2 or uses Option.

### 1.7 Manifest suggestions

1. `commands[].shortcut` is a suggestion in the grammar of 3.3. Chain commands are commands like any other (BD1).
2. Main decides each (install, command) **once**, when the command id first appears: every command at install; at an
   update or dev-folder reload, only the ids the old manifest did not have. `assignSuggestions` (2.1) walks those commands
   in manifest order. It binds a suggestion only if it parses, is not reserved, is free (no target holds it, no earlier
   command in this run took it) and the install holds fewer than `budgets.install.shortcuts` suggested chords. A
   suggestion not bound then is never tried again, so a chord that becomes free later never starts something the player
   did not choose.
3. An update that changes a suggestion changes nothing stored. An update that removes a command, and an uninstall, delete its
   row (12 §3).
4. On first run Main assigns the bundled official plugins in bundled index order; their suggestions must all be assignable
   together (review rule for `plugins/*`). v1's Trade default ⌘K is reserved (3.2), so Trade suggests another chord.
5. A shortcut problem never refuses a plugin: it is a manifest warning (04 §8.6, texts in 4.1) and the command stays
   unbound. `@moxi/sdk/vite` and `moxi check` fail the build on `syntax` and warn on `needs-mod` and `reserved`.
6. The plugin page shows each command's chord or "No shortcut" (12); `assignSuggestions` is pure, so it can show what an
   install would assign.

### 1.8 Player bindings

1. Bindings are app-wide: one set per computer, for every account and window.
2. Players change chords only in the launcher (Settings → Shortcuts, launcher plugin page); it has no router, so every
   chord reaches its capture. Capture (capture phase of `keydown`): modifier-only key downs, repeats and composing events
   are ignored; Escape cancels; Backspace or Delete with no modifier clears (not for the Hub); a chord key with mod
   becomes a `KeyChord`; anything else shows its 4.2 text and keeps listening.
3. Main checks every `keys.bind` (07): the target exists; `keyChord` accepts the chord; `reservedUse` is null (the Hub
   target may take mod+R); no other target holds it. Refusals: `invalid`, `reserved`, `taken` with `by`. On `taken` the
   launcher asks (4.2); "Use here" sends `keys.bind { target: by, chord: null }`, then the first request again. When `by`
   is the Hub, there is no "Use here".
4. The player may bind any number of commands; `budgets.install.shortcuts` limits only Main's assignment from suggestions.
5. The Hub chord can be changed but never cleared (the only way into the Hub in the game window): `keys.bind { target: hub,
   chord: null }` is `invalid`. "Restore default" binds `HUB_CHORD_DEFAULT`, or a command's `suggested` chord, through the
   same checks.
6. The game window shows chords and never captures; it may send `keys.bind` with `chord: null` (Clear on the in-game plugin
   page). After any change Main pushes `GamePluginState` to every game window and `plugins.changed` (07).

### 1.9 Row-action shortcuts

1. `ItemAction.shortcut` uses the grammar of 3.3. The Hub parses it with `parseShortcut`; a problem makes it inactive:
   no keycap, no match, a warning in the test kit and `moxi dev`.
2. The Hub matches it with `matchesChord`, by physical code like Main (dispatch order and focus: 10 H14). A row shortcut
   never runs a game action, and the `game` ItemAction has no `shortcut` (R19; a game action needs a trusted press, 01 §2).
3. It is inactive while its chord equals a chord in `GamePluginState.bindings`: Main takes a live bound chord first.
4. Row shortcuts are not stored, not rebindable and not counted in `budgets.install.shortcuts`.

### 1.10 Rules for other parts

- **Hub fence** (10 H2) stops only keys that went down while the Hub was open: the opening chord's mod and Shift key ups reach
  the game, and a 1.5 pair that arrives while the Hub is open is held by the fence, both halves; one that arrives before the Hub opens reaches the game.
- **Chain cancel** (13 §7.3) counts trusted key downs of non-modifier keys only, so a chain survives its own shortcut: Main
  swallows the chord and its repeats, its key ups do not count, and the 1.5 pair holds only modifier keys.
- **Game keyboard input** (layouts, Cmd/Ctrl rules, text editing, paste; M9-06) runs in the game page after the router;
  a swallowed key never reaches it.
- Chords stay live while the game's chat input has focus. They need mod, so typed text never matches; a bound chord
  pressed while chatting is the player's own command.

### 1.11 Platform and labels

1. The launcher and game preloads expose `window.moxi.platform: Platform`, mapped from `process.platform` (`darwin` →
   `macos`, `win32` → `windows`, `linux` → `linux`). It replaces every `navigator.platform` sniff. `packages/hub` gets it
   from its mount.
2. One label function set in `packages/ui` (2.5) draws every chord and key. Matching is by physical code, so labels
   follow the layout through the Keyboard Map API (`navigator.keyboard.getLayoutMap()`): German `KeyZ` shows `Y`, AZERTY
   `KeyQ` shows `A`. A digit key always shows its digit; a layout character is used when it is one character in
   U+0021–U+007E or U+00A1–U+00FF, uppercased when that stays one character; otherwise the US label of 3.1. Renderers read
   the layout at start and on window `focus`.
3. Keycaps: macOS `⇧`, `⌘`, key (`⇧⌘T`); Windows and Linux `Ctrl`, `Shift`, key (`Ctrl+Shift+T`). Only renderers make
   labels (Main has no layout map): IPC shapes carry the `KeyChord`, and the renderer that draws it calls `chordLabel`.

### 1.12 Key fields and `key` settings

A `key` setting (04 §8.5) and the `KeyField` element (09) hold one `KeyCode` (3.1) or `null` (`KeyBinding` is only the IPC
record, 2.2); no modifiers. `keyFromEvent` (2.5) captures: it takes a non-repeat, non-composing key down with no Ctrl, Alt
or Meta whose code is in `KEY_CODES`; Escape cancels; Backspace and Delete set `null`; Tab moves focus as usual; other
keys are ignored. Main's router does not touch these keys, because none carries mod.

### 1.13 Tests press keys through Main

End-to-end tests press chords with `webContents.sendInputEvent` (`e2e/keys.ts`). CDP keys (`page.keyboard.press`, also
`pnpm drive key`) never reach `before-input-event`. Electron checks run in CI only (BD17).

## 2. Types and functions

### 2.1 `packages/sdk/src/host/keys.ts` (exported by `@moxi/sdk/host`)

```ts
import { type } from "arktype";
export type Platform = "macos" | "windows" | "linux"; // also the manifest `platforms` values (04)
type Letter = "A" | "B" | /* … every capital … */ "Z";
type Digit = "0" | "1" | /* … */ "9";
type FNumber = 1 | 2 | /* … */ 24;
type Punctuation = "Minus" | "Equal" | "BracketLeft" | "BracketRight" | "Backslash" | "Semicolon"
  | "Quote" | "Comma" | "Period" | "Slash";
/** Physical keys a chord may use (`KeyboardEvent.code`). */
export type ChordCode = `Key${Letter}` | `Digit${Digit}` | `F${FNumber}` | Punctuation;
/** Physical keys a `key` setting or a KeyField may hold. */
export type KeyCode = ChordCode | "Backquote" | "IntlBackslash" | `Numpad${Digit}` | "NumpadDecimal"
  | "NumpadAdd" | "NumpadSubtract" | "NumpadMultiply" | "NumpadDivide"
  | "Space" | "Insert" | "Home" | "End" | "PageUp" | "PageDown";
export declare const CHORD_CODES: readonly ChordCode[]; // order of 3.1
export declare const KEY_CODES: readonly KeyCode[];      // CHORD_CODES first, then the rest of 3.1
/** mod (Cmd on macOS, Ctrl elsewhere) is always held, so it is not stored. */
export type KeyChord = { readonly code: ChordCode; readonly shift: boolean };
export const keyChord = type({ code: type.enumerated(...CHORD_CODES), shift: "boolean" });
export const HUB_CHORD_DEFAULT: KeyChord = { code: "KeyR", shift: false };
export const sameChord = (a: KeyChord, b: KeyChord): boolean => a.code === b.code && a.shift === b.shift;
export type ChordProblem = "syntax" | "needs-mod" | "reserved";
/** Grammar of 3.3, for manifest suggestions and row-action shortcuts. */
export declare function parseShortcut(text: string):
  | { readonly ok: true; readonly chord: KeyChord }
  | { readonly ok: false; readonly problem: ChordProblem };
/** What a reserved chord is kept for ("Copy"), from 3.2, or null. Shift does not matter. */
export declare function reservedUse(chord: KeyChord): string | null;
/** One key event, from Electron `Input` (Main) or a DOM `KeyboardEvent` (Hub, dev page). */
export type KeyInput = {
  readonly type: "down" | "up";
  readonly code: string;
  readonly key: string;
  readonly ctrl: boolean; readonly alt: boolean; readonly shift: boolean; readonly meta: boolean;
  readonly repeat: boolean;
  readonly composing: boolean;
};
export function matchesChord(input: KeyInput, chord: KeyChord, platform: Platform): boolean {
  const mac = platform === "macos";
  return input.type === "down" && !input.repeat && !input.composing && !input.alt
    && input.meta === mac && input.ctrl === !mac
    && input.code === chord.code && input.shift === chord.shift;
}
/** 1.7: one result per listed command, in order. */
export declare function assignSuggestions(args: {
  readonly commands: readonly { readonly id: string; readonly shortcut?: string }[]; // new command ids only, manifest order
  readonly bound: readonly KeyChord[];  // every chord any target holds now
  readonly assignedBefore: number;      // this install's `suggested` rows (2.3)
}): readonly { readonly command: string; readonly chord: KeyChord | null }[];
export type LiveChord<T> = { readonly chord: KeyChord; readonly target: T; readonly run: boolean };
export type Route<T> = { readonly swallow: boolean; readonly fire: T | null };
/** 1.4. One router per game window (and one in the dev page). */
export function createChordRouter<T>(platform: Platform) {
  const swallowed = new Set<string>(); // codes swallowed on key down whose key up has not come
  let altGraph = false;
  const mac = platform === "macos";
  const pass: Route<T> = { swallow: false, fire: null };
  return {
    handle(input: KeyInput, live: () => readonly LiveChord<T>[]): Route<T> {
      if (input.key === "AltGraph") { altGraph = input.type === "down"; return pass; }
      if (input.type === "up") return { swallow: swallowed.delete(input.code), fire: null };
      if (swallowed.has(input.code)) {
        if (input.repeat) return { swallow: true, fire: null };
        swallowed.delete(input.code); // stale: Chromium withheld its key up
      }
      if (altGraph || input.repeat || !(mac ? input.meta : input.ctrl)) return pass; // most keys end here
      const hit = live().find((entry) => matchesChord(input, entry.chord, platform));
      if (!hit) return pass;
      swallowed.add(input.code);
      return { swallow: true, fire: hit.run ? hit.target : null };
    },
    reset(): void { swallowed.clear(); altGraph = false; }, // window blur
  };
}
```

### 2.2 `packages/contracts/src/keys.ts`

```ts
import { type } from "arktype";
import { installKey, keyChord, type KeyChord, type Platform } from "@moxi/sdk/host";
export { keyChord, type KeyChord, type Platform }; // contracts re-exports (R2); ids come from 01

export const hostChord = type("'hub'"); // a host feature that needs a chord adds its id in its own slice
export const keyTarget = type({ kind: "'host'", id: hostChord })
  .or({ kind: "'command'", installKey, command: /^[a-z0-9][a-z0-9-]{0,39}$/ });
export const keyBinding = type({
  target: keyTarget,
  chord: keyChord.or("null"),     // the chord now; null: no shortcut
  suggested: keyChord.or("null"), // host: its default; command: the suggestion if parseShortcut accepts it
});
export type KeyTarget = typeof keyTarget.infer;
export type KeyBinding = typeof keyBinding.infer;
```

`keys.list` returns the Hub and every command of every install; `GamePluginState.bindings` the Hub and the commands of enabled
installs.

### 2.3 Store (`key_bindings`, 12 §6.4)

`assignSuggestions` writes `origin = 'suggested'` rows (always with a chord); `keys.bind` writes `origin = 'player'` rows
(`chord` NULL = cleared). No Hub row: `HUB_CHORD_DEFAULT`; no command row: unbound. The cap counts an install's
`suggested` rows.

### 2.4 Main

```ts
// apps/desktop/src/plugins/bindings.ts
export type InstallRunState = "running" | "waiting" | "off"; // waiting: host starting or restarting
export declare function liveChords(
  bindings: readonly KeyBinding[],
  sessionOpen: boolean, // this game window has a sid (03 §1.12)
  installState: (install: InstallKey) => InstallRunState,
): readonly LiveChord<KeyTarget>[];
export declare function assignCommands(install: InstallKey, newCommands: Manifest["commands"]): void; // 1.7
export declare function bindKey(target: KeyTarget, chord: KeyChord | null): // the keys.bind handler (07)
  | { ok: true }
  | { ok: false; reason: "reserved" | "taken" | "invalid"; by?: KeyTarget };

// apps/desktop/src/shell/input.ts
export const UNSTICK_DELAY_MS = 5;
export declare function setAppMenu(platform: Platform): void; // 1.6
/** Attached in createWindow for kind "game". Maps Electron Input: "keyDown" and "rawKeyDown" → down,
 *  "keyUp" → up, other types pass. Swallow → event.preventDefault() and the 1.5 timer; fire → send. */
export declare function attachChordRouter(
  win: BrowserWindow,
  platform: Platform,
  live: () => readonly LiveChord<KeyTarget>[],
  fire: (target: KeyTarget) => void, // hub.toggle or hub.command to this window
): void;
```

The 1.5 pair, with `[keyCode, flag]` = `["Meta", "meta"]` on macOS, `["Control", "control"]` elsewhere, then `["Shift", "shift"]`:

```ts
wc.sendInputEvent({ type: "keyDown", keyCode, modifiers: [flag, "isAutoRepeat"] });
wc.sendInputEvent({ type: "keyUp", keyCode, modifiers: [] });
```

### 2.5 `packages/ui/src/keys.ts`

```ts
export type KeyLayout = ReadonlyMap<string, string>; // KeyboardLayoutMap entries: code → character
export declare function readKeyLayout(): Promise<KeyLayout | undefined>; // undefined: API missing or refused
export declare function keyName(code: KeyCode, layout?: KeyLayout): string;                      // "Y", "1", "F5", "Num 1"
export declare function keycaps(chord: KeyChord, platform: Platform, layout?: KeyLayout): string[]; // ["⇧", "⌘", "T"]
export declare function chordLabel(chord: KeyChord, platform: Platform, layout?: KeyLayout): string; // "⇧⌘T", "Ctrl+Shift+T"
export declare function keyFromEvent(event: KeyboardEvent): KeyCode | "cancel" | "clear" | null; // 1.12
```

### 2.6 `e2e/keys.ts`

```ts
export type KeyEvent = { type: "keyDown" | "keyUp"; keyCode: string; modifiers?: string[] };
/** Sends the events in order to the focused game window with webContents.sendInputEvent. */
export declare function sendKeys(app: ElectronApplication, events: readonly KeyEvent[]): Promise<void>;
/** mod down, key down, key up, mod up (Shift around the key when the chord has it). */
export declare function pressChord(app: ElectronApplication, chord: KeyChord): Promise<void>;
```

## 3. Tables

### 3.1 Key table

| Grammar name | `code` | Chord key | US label |
| --- | --- | --- | --- |
| `a`–`z` | `KeyA`–`KeyZ` | yes | `A`–`Z` |
| `0`–`9` | `Digit0`–`Digit9` | yes | `0`–`9` (always) |
| `f1`–`f24` | `F1`–`F24` | yes | `F1`–`F24` |
| `minus`, `equal`, `bracketleft`, `bracketright`, `backslash` | `Minus`, `Equal`, `BracketLeft`, `BracketRight`, `Backslash` | yes | `-` `=` `[` `]` `\` |
| `semicolon`, `quote`, `comma`, `period`, `slash` | `Semicolon`, `Quote`, `Comma`, `Period`, `Slash` | yes | `;` `'` `,` `.` `/` |
| – | `Backquote`, `IntlBackslash` | no | `` ` `` `<` |
| – | `Numpad0`–`Numpad9`, `NumpadDecimal`, `NumpadAdd`, `NumpadSubtract`, `NumpadMultiply`, `NumpadDivide` | no | `Num 0`–`Num 9`, `Num .`, `Num +`, `Num -`, `Num *`, `Num /` |
| – | `Space`, `Insert`, `Home`, `End`, `PageUp`, `PageDown` | no | `Space`, `Ins`, `Home`, `End`, `PgUp`, `PgDn` |

No other code is a chord key or a `key` value: Escape, Tab, Enter, Backspace, Delete and the arrows are Hub, focus and
text-editing keys; Space, Tab and Backquote with mod are OS switchers.

### 3.2 Reserved chords (mod = Cmd on macOS, Ctrl elsewhere; with or without Shift)

| Chord | Kept for | Chord | Kept for |
| --- | --- | --- | --- |
| mod+Q | Quit | mod+Y | Redo |
| mod+W | Close | mod+R | the Hub (the Hub target may take it) |
| mod+A | Select all | mod+H | Hide |
| mod+C | Copy | mod+M | Minimize |
| mod+V | Paste | mod+I | plugin details in the Hub |
| mod+X | Cut | mod+K | more actions in the Hub |
| mod+Z | Undo and redo | | |

One list for every OS, by physical code. Q, W, A, Z and Y cover the AZERTY (A↔Q, Z↔W) and QWERTZ (Y↔Z) swaps, so editing
chords stay reserved there. Alt+F4 and Ctrl+Alt cannot be chords (1.2).

### 3.3 Shortcut grammar

```text
shortcut = [ "mod+" ] [ "shift+" ] name    ; lowercase, in this order, no spaces
name     = a grammar name of 3.1 marked "chord key"
```

A text without `mod+` that is otherwise valid is `needs-mod`; any other text is `syntax`; a valid chord in 3.2 is
`reserved`.

| Text | Result |
| --- | --- |
| `mod+shift+t` | `{ code: "KeyT", shift: true }` |
| `mod+1`, `mod+f5`, `mod+slash` | `Digit1`, `F5`, `Slash`, no Shift |
| `shift+k`, `shift+1`, `k` | `needs-mod` |
| `alt+a`, `ctrl+alt+k`, `Mod+T`, `shift+mod+t`, `mod+space`, `mod+` | `syntax` |
| `mod+c`, `mod+shift+z`, `mod+k` | `reserved` |

## 4. Messages

### 4.1 Authors (manifest warnings at `commands[<i>].shortcut`; dev warnings for row shortcuts)

| Problem | Text |
| --- | --- |
| `syntax` | `"<text>" is not a shortcut. Write mod+<key> or mod+shift+<key>; keys are a–z, 0–9, f1–f24, minus, equal, bracketleft, bracketright, backslash, semicolon, quote, comma, period, slash.` |
| `needs-mod` | `"<text>" needs mod (Cmd on macOS, Ctrl elsewhere): players type keys without it.` |
| `reserved` | `"<text>" is kept for <use> and stays unbound.` |

### 4.2 Players (launcher capture; `<chord>` = `chordLabel`)

| Case | Text |
| --- | --- |
| Hint | macOS: "Press ⌘ and a key, with ⇧ if you like. Escape cancels. Delete removes the shortcut." Windows, Linux: with "Ctrl" and "Shift". The Hub's hint has no last sentence |
| Another modifier held | "Use only ⌘ and ⇧ with the key." (Windows, Linux: "Use only Ctrl and Shift with the key.") |
| Not a chord key | "This key cannot be a shortcut. Use a letter, a digit, F1–F24 or a punctuation key." |
| `reserved` | "<chord> is kept for <use>." |
| `taken` by a command | "<chord> is used by <command title> (<plugin name>). Use it here instead?" Buttons "Use here", "Cancel" |
| `taken` by the Hub | "<chord> opens the Hub. Choose another key." |
| No chord | "No shortcut" |

## 5. Constants

- `HUB_CHORD_DEFAULT` = `{ code: "KeyR", shift: false }` (Cmd+R on macOS, Ctrl+R elsewhere), `packages/sdk/src/host/keys.ts`.
  BD12. Q4 and D8 (Hub chord on Windows and Linux) are open (01 §7, milestones.md); a change is player-visible and is said in
  the pull request.
- `UNSTICK_DELAY_MS` = `5`, `apps/desktop/src/shell/input.ts`. The PB9 value; input timing, not a plugin budget, so not in 05.

## 6. Decisions

| Decision | Reason | Rejected |
| --- | --- | --- |
| Chords in Main's `before-input-event`, by physical code; a chord is mod, optional Shift and a chord key | works while the game has focus or a busy thread; one meaning on every layout and OS; AltGr and Option typing cannot match by shape | the renderer chord by `event.key` with platform sniffing (today); the record `{ code, ctrl, alt, shift, meta }`; `alt` in the grammar |
| Remember swallowed codes (dropped at the next non-repeat key down, key up or blur); then a synthetic mod (and Shift) pair | Chromium withholds the key up of a swallowed key down; the pair ends its suppression and clears the page's modifier | a held set cleared only by key up (the second press never fires); modifier flags in a game input ledger (moxi has none) |
| Null menu on Windows and Linux; macOS app, Edit and Window menus | no Reload or DevTools key; macOS text fields need the Edit menu | Electron's default menu (Ctrl+R reloads the game) |
| One reserved list for every OS (includes H, M, I, K and "with or without Shift") | a manifest gets the same bindings on every OS | lists per OS |
| A suggestion is tried only when its command first appears | a freed chord never starts a command the player did not choose | recomputing defaults at every start (v1) |
| `Platform`, `KeyChord` and the grammar live in `@moxi/sdk/host`; contracts re-exports them (R2) | the manifest parser, the Hub and the dev page need them, and the SDK cannot import contracts | both in `packages/contracts` |
| Bindings app-wide; rebinding only in the launcher | habits belong to the player, not the character (v1 parity); the launcher has no router, so every chord can be captured, with no new channel | per account; capture in the game window with a channel that pauses Main's router |
| Row shortcuts Hub-local, inactive while equal to a bound chord | they act on the selected row only; Main takes a bound chord first | routing them through Main; counting them in the cap |
| Labels from the Keyboard Map API | US labels would send German and French players to the wrong key | US labels only; matching letters by character (v1) |
| The Hub chord can change, never be cleared; chords stay live while chat has focus | the Hub chord is the only way into the Hub; mod keeps typed text from matching, and gwkit cannot tell chat focus | a clearable Hub chord; suspending chords while chatting |

## 7. Today in code (main 848fb6e) and what changes

| Item | Today | Change | Slice |
| --- | --- | --- | --- |
| Hub chord | `apps/game/src/hub/App.vue:4-19` (`event.key === "r"`) | Main router; the mount listens to `hub.toggle` | M5-09 |
| Menu, router | none in `apps/desktop/src/shell/main.ts` (default menu) | `setAppMenu`; `attachChordRouter` in `createWindow` (`main.ts:120`), `kind === "game"` | M5-09 |
| Platform | sniffs at `apps/game/src/hub/App.vue:6`, `Hub.vue:25`, `dev/App.vue:22`, `hub.contract.test.ts:37`; `apps/desktop/src/shell/preload.ts:10-51` has none | `window.moxi.platform`; `packages/hub` gets it from its mount; tests pass it | M4-01, M3-01 |
| Row-action shortcuts | `Hub.vue:286-297` `matches()` by `event.key`, accepts `alt`; keycaps `Hub.vue:462-472` | `parseShortcut`, `matchesChord`, inactive rules; keycaps from `packages/ui` | M3-01 |
| Launcher shortcut UI | none: the launcher Shortcuts page was cut | capture a `KeyChord`; `keys.list`, `keys.bind`; 4.2 texts | M7-04, M12-07 |
| Dev harness chord | `apps/game/src/hub/dev/App.vue:31-73` | deleted with the harness; `packages/hub/dev/` runs `createChordRouter` on a window `keydown` listener | M6-03, M7-06 |
| E2E chord | CDP `game.keyboard.press` at `e2e/shell.e2e.ts:171`, `e2e/plugin-isolation.e2e.ts:60`; `pnpm drive key` (`scripts/drive.ts:71`) is CDP too and stays | `pressChord` | M5-09 |
| Probe router | `probes/PB7-PB9/lib/chord.cjs` (branch `probe/PB7-PB9`) | port as `createChordRouter`; rows from `lib/chord.test.cjs` | M5-09 |

## 8. Built by

| Slice | Builds from this file |
| --- | --- |
| M1-03 | `keys.ts` in `@moxi/sdk/host` except the router: tables, `Platform`, `KeyChord`, `keyChord`, `HUB_CHORD_DEFAULT`, `parseShortcut`, `reservedUse`, `matchesChord`, `assignSuggestions`; suggestion warnings (4.1) |
| M2-06, M7-06 | build and `moxi check` fail on `syntax`; `moxi dev` page router |
| M4-01 | `packages/contracts/src/keys.ts`; `keys.list`, `keys.bind`, `hub.toggle`, `hub.command`; `window.moxi.platform` |
| M4-04 | the store (2.3), `assignCommands` on install, update, dev reload and uninstall, `bindKey`, `liveChords` |
| M3-01, M3-04 | row-action shortcuts (1.9), `packages/ui/src/keys.ts` labels, platform from the mount; `KeyField` capture with `keyFromEvent` (1.12) |
| M5-09 | `createChordRouter`, `shell/input.ts` (router, 1.5 pair, menu), renderer chord removed, `e2e/keys.ts`, e2e files moved to `pressChord`, P74 |
| M5-08 | the chain-cancel input rule (1.10) |
| M7-04, M12-07 | launcher plugin page (chords, capture, Clear, Restore default); Settings → Shortcuts (the Hub chord and every command, conflicts) |

## 9. Checked by

Proofs run as `pnpm gate` (N) or in CI (E3: Linux on every pull request, Windows nightly; macOS when its lane exists,
BD17). The hand-built `Input` rows test the logic only; system evidence comes from the E3 rows.

| Proof | What it checks here | Where | Owner |
| --- | --- | --- | --- |
| P74 | N `packages/sdk/src/host/keys.test.ts`. `parseShortcut`: the 3.3 rows. `matchesChord`: US Ctrl+R hits; Ctrl+Shift+R misses mod+R; plain R misses; Windows AltGr (Ctrl+Alt+R) misses; German AltGr+Q misses `KeyQ`; German Ctrl+Z (`KeyY`) hits `KeyY` and misses `KeyZ`; AZERTY `KeyQ` misses `KeyA`; AZERTY `Digit1` (`&`) hits; a dead key on `Quote` misses `KeyK`; macOS Cmd+R hits; macOS Ctrl+R and Cmd+Option+A miss; a composing key down misses. Router streams (fires in order): press, mod up, press → 2; key down and 3 repeats → 1, repeats swallowed; 3 presses with mod held and no key ups → 3; rollover R down, A down, R up, R up → 1 fire, A passes, first R up swallowed, second passes; X11 AltGraph down, Ctrl+R → 0, AltGraph up, Ctrl+R → 1; `blur` during AltGraph → the next Ctrl+R fires; `run: false` → swallowed, 0 fires. `assignSuggestions`: `shift+k`, `shift+1`, `alt+a`, `ctrl+alt+k`, `mod+c` → `null`; then `mod+j`, `mod+shift+j`, `mod+l`, `mod+shift+l`, `mod+u` → the first four bound, the fifth `null`; a chord another target holds → `null`; `assignedBefore: 3` → one more; the same chord twice in one manifest → the second `null`. N `apps/desktop/src/plugins/bindings.test.ts`: `liveChords` (no session → Hub only; `running` → run; `waiting` → `run: false`; `off` → absent); `bindKey` (`reserved`, `taken` with `by`, Hub clear → `invalid`, Hub takes mod+R, unknown target → `invalid`). E3 `e2e/shortcuts.e2e.ts` with `sendKeys`: press, release, press of the Hub chord → open, then closed; a press with mod held twice → 2 toggles; a held chord with auto-repeat → 1 toggle; 0 page reloads; the page key spy sees no `KeyR` down or up; after a chord the spy's last mod event is a key up (also Shift after a mod+Shift chord); `Menu.getApplicationMenu()` is `null` on Windows and Linux; a plugin chord on the fixture login screen and in character select reaches the page as a normal key with 0 worker messages and no session; in the world it runs its command once | N, E3 | M5-09 (M1-03 for `parseShortcut` and `assignSuggestions` rows, M4-04 for `bindKey`) |
| P46 | a `game.resign` command's shortcut pressed with `pressChord`: 0 worker messages, the confirm sheet first, 1 executor call after confirming | E3 | M5-08 |
| P81 | a chain started from its shortcut runs every step; the shortcut's key ups and the 1.5 pair do not cancel it | N, E | M5-08 |
| P25 | the Hub opened by `pressChord`: keys pressed while open never reach the game; the opening chord's mod key up does | B, E3 | M3-01, M5-09 |
| P8 (owner 07) | `keys.*` is not in the `pluginHost` channel list | N | M4-01 |

N tests without a proof id, each with its bug: `packages/ui/src/keys.test.ts` (labels: `{ KeyT, shift }` → `⇧⌘T` on macOS
and `Ctrl+Shift+T` on Windows; a German layout map shows `KeyZ` as `Y`; AZERTY shows `KeyQ` as `A` and `Digit1` as `1`; a
Russian layout falls back to `A` for `KeyA`; no layout → US labels; `keyFromEvent` ignores a key with Ctrl and takes
`Numpad1`); `packages/hub` row shortcuts (an `alt+a` row shortcut never matches; a row shortcut equal to a bound chord
shows no keycap).

Not measured: macOS (Cmd, the Meta pair of 1.5, the menu) until a macOS CI lane exists; a real Windows AltGr layout.

## 10. Deferred

- **More host chords.** Host features add an id to `hostChord` in their own slice; M13-09 adds `character.switch` with
  v1's default mod+E.
- **Capture in the game window.** Needs a channel that pauses Main's router for that window.
- **Mouse buttons in `key` settings** (v1 skill keys allowed them): keyboard codes only in 1.0.
