# 09 Elements and theme

## Purpose

The closed UI vocabulary that plugins render through the host: the element registry, every
element with its props and events, the shared data types of views and drawings, and the theme
contract that makes plugin UI follow every look with zero plugin work.

## 1. Rules in force

1. **One registry.** `packages/sdk/src/host/elements.ts` defines every element once and feeds the
   author components and Volar types (spec 08), the decoder tables (spec 07), the test-kit
   serializer (spec 08), a docs table, and the type `Record<ElementTag, Component>` that
   `packages/ui` must satisfy, so a missing host component is a type error.
2. **Indices, never names.** Names cross the wire as registry indices (2.3). Within `api: 1` an
   index is never reused or renumbered; new ones append.
3. **Prop values only.** No functions, HTML, CSS strings, class names or style objects. Functions
   appear only as event handlers and inside `ItemAction` (wire signs: spec 07). URLs appear only
   as `https` links on a granted `link:` host (`Link.href`) or host-built wiki links (`{ wiki }`).
   Packages carry no images; every picture is a host glyph or game art.
4. **Collections are data.** `List`, `Grid`, `Table` and `Transcript` take arrays of rows with
   stable `id`s, sent as keyed `ITEMS` patches; one row change costs one upsert (P12).
5. **Surfaces.** A root is a view, a panel or a HUD widget (spec 01 §2). `view` and `panel` roots
   take every element except the HUD group; a HUD root holds `Hud` elements only (4.8). No
   element opens an OS window.
6. **Structure rules come from the registry.** The one decoder (spec 07), used by membrane,
   applier and test kit, refuses a batch that creates an element outside its root's surface,
   inserts an element the parent's `children` rule does not allow, or leaves a non-empty text node
   under an element whose `children` is not `"text"`. Empty text nodes are Vue anchors and may sit
   anywhere. The compile gate (spec 08) reports the same errors at build.
7. **A drop never starts a game action** (spec 13). Only the final `reorder`, `drop` or `move`
   event with plugin ids crosses to the worker.
8. **The theme is host-owned.** Host components use only `--ui-*` tokens and the plugin accent
   variables (section 5). A theme or look switch sends no worker message (P23).
9. **Grows by real need.** A new element ships with a host release, is additive, and moves the
   plugin's `minHost` through its `since`. Everything here has `since: "1.0.0"`.
10. **Budgets** are spec 05's (`view.*`, `wire.*`, `install.*`). Each string prop below is a
    `title` string (cap `view.titleChars`) unless marked `text` (cap `view.textChars`), `id`
    (never truncated; longer than `view.titleChars` is malformed) or `url` (2.1). Text children
    take the cap their element names in section 4.

HUD elements have no events; every input of an `internet`-class install carries the host chip
"Sent to <host>", and no input is masked (4.4).

## 2. The registry

### 2.1 Types

```ts
// packages/sdk/src/host/elements.ts — no ArkType import: the worker runtime bundles it.
export type Surface = "view" | "panel" | "hud";

export type PropType =
  | "id" | "title" | "text" | "url" | "badge" // strings (rule 10); badge = string or number
  | "bool" | "number" | "unit" | "time" // unit: finite, clamped to 0..1; time: epoch ms
  | { enum: readonly (string | number)[] }
  | "tone" | "icon" | "space" | "color" | "colors" | "strings" | "key" | "field" | "wiki" | "anchor"
  | "intent" | "action" | "actions" | "blocks" | "skills"
  | "options" | "suggestions" | "columns" | "keyValues" | "empty" | "widths" | "sort" | "camera"
  | "series" | "scene" | "layers"
  | "items" | "cells" | "rows" | "lines"; // collections: sent only with the ITEMS op

export type PropSpec = { type: PropType; required?: true; model?: true; since: string };
export type EventSpec<Payload> = { since: string; payload?: Payload }; // payload: type marker only

export type ElementSpec = {
  index: number; // wire index, 2.3
  surfaces: readonly Surface[];
  children: "none" | "text" | "any" | readonly string[]; // allowed child tags
  props: Readonly<Record<string, PropSpec>>; // prop index = position, first = 1
  events: Readonly<Record<string, EventSpec<unknown>>>; // event index = position, first = 1
  since: string; // HOST_API level that first has it (spec 04 §10.3)
};

export const elements = { /* one entry per element of 2.3; props and events in the order of section 4 */
  List: { index: 7, surfaces: ["view", "panel"], children: "none", since: "1.0.0",
    props: { items: { type: "items", required: true, since: "1.0.0" } /* … */ },
    events: { reorder: { since: "1.0.0" } as EventSpec<{ from: number; to: number }> /* … */ } },
} as const satisfies Record<string, ElementSpec>;
export type ElementTag = keyof typeof elements;
```

The props and events of each element are the TypeScript types in section 4, in the order
written. A prop's `PropType` follows from its TypeScript type:

| TypeScript type in section 4 | `PropType` | Decoder accepts |
| --- | --- | --- |
| `string` (no mark) / `// text` / `// id` / `// url` | `title` / `text` / `id` / `url` | a string; caps per rule 10; a `url` is never truncated, longer than `view.textChars` is malformed |
| `string \| number` / `boolean` | `badge` / `bool` | a `title` string or finite number / a boolean |
| `number` / `// unit` / `// time` | `number` / `unit` / `time` | a finite number; `unit` is clamped to 0..1 |
| union of literals (also `Size`), `Tone`, `Space` | `{ enum }`, `tone`, `space` | one listed value; the types in section 3 |
| `IconRef` | `icon` | spec 04 §9; a glyph name the host lacks is drawn as `dot` (not malformed) |
| `Anchor` (game-geometry anchors only) | `anchor` | `skill:1`…`skill:8`, `effect:<skillId>`, `compass`, `target` (spec 04) |
| `HexColor`, `HexColor[]`, `string[]` | `color`, `colors`, `strings` | `^#[0-9a-fA-F]{6}$`; arrays of those or of `title` strings |
| `KeyCode \| null` | `key` | spec 11 `KeyCode` |
| `field?: string` | `field` | `^[a-z][a-z0-9-]{0,31}$` (4.4) |
| `WikiRef` | `wiki` | the `wiki` value of `ItemAction` (spec 08) |
| `GameIntent`, `ItemAction`, `ItemAction[]` | `intent`, `action`, `actions` | spec 08 types, spec 07 encoding |
| `Block[]`, `SkillSlot[]`, `SelectOption[]`, `Suggestion[]`, `TableColumn[]`, `KeyValueRow[]`, `EmptyData`, `(number \| "auto")[]`, `TableSort`, `MapCamera`, `Series[]`, `MapLayer[]` | `blocks`, `skills`, `options`, `suggestions`, `columns`, `keyValues`, `empty`, `widths`, `sort`, `camera`, `series`, `layers` | the type in section 3 |
| `ItemData[]`, `CellData[]`, `RowData[]`, `TranscriptLine[]` | `items`, `cells`, `rows`, `lines` | rows via `ITEMS` only |
| `Shape[]` | `scene` | the type in section 3; a PROP value like any other (spec 07) |

A `| null` in a `modelValue` type also admits `null`. A wrong type, unknown enum value or unknown
index makes the batch malformed (spec 07). `modelValue` props carry `model: true`; their PROP
value is the pair `[value, revision]` (4.4).

### 2.2 Host components

```ts
// packages/ui/src/elements/index.ts — one host component per element, in src/elements/*.vue
export const hostElements: Record<ElementTag, Component> = { Stack, Columns /* , … */ };

// packages/ui/src/elements/surface.ts — provided by the applier on every root
export type SurfaceContext = {
  installKey: InstallKey; // spec 01 §3
  pluginName: string;
  pluginClass: PluginClass; // "local" | "internet"
  outboundHosts: readonly string[]; // granted net: hosts, then granted link: hosts, manifest order
  surface: Surface;
};
export const SURFACE: InjectionKey<SurfaceContext> = Symbol("moxi.surface");
```

- A host component receives decoded, truncated props and emits events under their registry
  names; the applier turns an emit into an `EVENT` message (spec 07). It never sees signs,
  indices or the wire.
- No `<style>` blocks: element styles live in `packages/ui/src/elements.css` next to
  `components.css`, with the tokens of section 5 only. No `v-html` or `innerHTML` in
  `packages/ui` or `packages/hub` (lint rule, P6).
- Every interactive element is reachable by keyboard, shows the `--ui-focus` ring, has an
  accessible name (label prop, text children or host label) and uses the native element where one
  exists. `Icon` without a `label` takes the reference name, or is `aria-hidden` when decorative.
  `Chart` renders a screen-reader data table. `Canvas` and `MapView` need `label`.

### 2.3 Index table (frozen)

Index 0 is never used. "Later" elements get the next free index when their slice builds them.
Children in brackets; no bracket = `none`. `text` = text nodes only. `any` = every element of
the root's surface except `Tab`, which only `Tabs` takes.

| Indices | Elements | Built by |
| --- | --- | --- |
| 1–6 | 1 `Stack` [any], 2 `Columns` [any, one child per column], 3 `Section` [any], 4 `Divider`, 5 `Tabs` [`Tab` only], 6 `Tab` [any; only inside `Tabs`] | M3-03 |
| 7–12 | 7 `List`, 8 `Grid`, 9 `Table`, 10 `Detail` [any], 11 `Form` [any], 12 `Empty` | M3-03 |
| 13–20 | 13 `Text` [text], 14 `Heading` [text], 15 `Badge` [text], 16 `Icon`, 17 `SkillBar`, 18 `KeyValue`, 19 `Progress`, 20 `Countdown` | M3-03 |
| 21–29 | 21 `TextField`, 22 `TextArea`, 23 `NumberField`, 24 `Select`, 25 `Toggle`, 26 `Slider`, 27 `ColorField`, 28 `KeyField`, 29 `TagField` | M3-04 |
| 30–33 | 30 `Button` [text], 31 `GameAction`, 32 `RequestAccess`, 33 `Link` [text] | M3-04 (`GameAction` progress and receipts: M3-07) |
| 34–36 | 34 `Chart`, 35 `Canvas`, 36 `MapView` | M3-05 |
| 37–41 | 37 `Hud` [`HudText`, `HudIcon`, `HudBar`, `HudCountdown`], 38 `HudText` [text], 39 `HudIcon`, 40 `HudBar`, 41 `HudCountdown` | M3-06 |
| later | `Transcript`, `SkillCard` | M13-04, M13-01 |

Surfaces: 1–36 and later elements: `view`, `panel`; 37–41: `hud`. The root container (node 0,
spec 07) takes `any` in view and panel roots and `Hud` only in HUD roots.

## 3. Shared data types

All in `packages/sdk/src/host/elements.ts`; `@moxi/sdk` re-exports them as types (spec 02).
Spec 08 owns `ItemData`, `ItemAction`, `GameIntent`, `FieldRef`, `ActionResult`, `WikiRef`; spec 04
owns `IconRef`, `GLYPHS`, `Profession`, `HexColor`, `EpochMs`, `Anchor`; `KeyCode` is
`@moxi/sdk/host`'s (spec 11).

```ts
export type Tone = "neutral" | "accent" | "good" | "warning" | "danger" | "muted";
export type Size = "s" | "m" | "l";
export type Space = "none" | "s" | "m" | "l";
export type SkillSlot = { skill: number } | null; // a skill bar has 8 slots; extra entries are dropped
export type KeyValueRow = { key: string; value: string; tone?: Tone; icon?: IconRef };
export type EmptyData = { title: string; description?: string /* text */; icon?: IconRef };

// Preview and tooltip content (ItemData.preview, CellData.tooltip). No images.
export type Block =
  | { type: "text"; text: string /* text */; tone?: Tone; size?: Size }
  | { type: "heading"; text: string }
  | { type: "keyvalue"; rows: KeyValueRow[] }
  | { type: "skillbar"; skills: SkillSlot[] }
  | { type: "skill"; skill: number; rank?: number } // concise SkillCard; icon and name until skill text exists
  | { type: "progress"; value: number /* unit */; label?: string; tone?: Tone };
export type DragData = { type: string; id: string }; // type ^[a-z][a-z0-9-]{0,23}$; "skill" = id is a skill id
export type CellData = { // Grid
  id: string /* id */; icon: IconRef; title?: string; badge?: string | number; progress?: number /* unit */;
  marked?: boolean; // plugin mark, such as "used in this build"; not the host selection
  tooltip?: Block[]; keywords?: string[]; // keywords: host filter
  unavailable?: string; // reason; the host dims the cell and disables its game actions
  drag?: DragData; // draggable (4.6)
  actions?: ItemAction[]; // the first one runs on Enter or double-click
};
export type CellValue = string | number | { text: string; tone?: Tone; icon?: IconRef };
export type TableColumn = {
  key: string /* id */; title: string; kind?: "text" | "number" | "price" | "badge" | "icon"; sortable?: boolean;
  align?: "start" | "end"; // default: "end" for number and price, else "start"
  width?: number | "auto"; // a flex weight 1..12, or auto
};
export type TableSort = { key: string; dir: "asc" | "desc" };
export type RowData = { // Table; cells keyed by TableColumn.key
  id: string /* id */; cells: Record<string, CellValue>; keywords?: string[]; unavailable?: string; actions?: ItemAction[];
};
export type SelectOption = { // disabled: the reason shown on the option
  value: string /* id */; label: string; group?: string; disabled?: string; detail?: string; icon?: IconRef;
};
export type Suggestion = { value: string; label?: string; detail?: string; icon?: IconRef };
export type Series = { // Chart; kind default "line"
  id: string /* id */; label: string; kind?: "line" | "area" | "bar" | "step"; tone?: Tone;
  points: Float64Array; // x0, y0, x1, y1 … with x ascending; time x in epoch ms
};
export type Paint = Tone | `profession:${Profession}` | `rgba(${number}, ${number}, ${number}, ${number})`;
export type Shape = // Canvas and MapView layers
  | { t: "rect"; x: number; y: number; w: number; h: number; fill?: Paint; stroke?: Paint; id?: string; tip?: string }
  | { t: "circle"; x: number; y: number; r: number; fill?: Paint; stroke?: Paint; id?: string; tip?: string }
  | { t: "path"; points: Float32Array; closed?: boolean; stroke: Paint; width?: number; id?: string; tip?: string }
  | { t: "text"; x: number; y: number; text: string; size?: Size; paint?: Paint }
  | { t: "icon"; x: number; y: number; size: number; icon: IconRef; id?: string; tip?: string }
  | { t: "raster"; x: number; y: number; w: number; h: number; cols: number; rows: number; cells: Uint8Array; palette: Paint[] };
export type MapLayer = { id: string /* id */; z: number; scene: Shape[]; minZoom?: number; maxZoom?: number };
export type MapCamera = { x: number; y: number; zoom: number }; // world units; zoom 1 = whole map fits
export type TranscriptLine = { // Transcript
  id: string /* id */; at: number /* time */; author?: string; text: string /* text */;
  side?: "in" | "out" | "system"; tone?: Tone; actions?: ItemAction[];
};
export type FieldValue = string | number | boolean | string[] | KeyCode | null;
```

Shape rules: `rgba` takes integers 0..255 and an alpha 0..1. `path.points` holds x, y pairs (even
length ≥ 4). `raster` needs `cols × rows === cells.length`; a cell value at or above
`palette.length` is transparent. `tip` is shown only on shapes with an `id`. Shapes count toward
`view.sceneShapes` and their typed arrays toward `view.sceneTypedBytes`; a `Series` point counts
as one shape. Over a cap the host shows a placeholder (spec 05). Typed arrays on the wire are
`Float32Array`, `Float64Array`, `Uint8Array` and `Uint32Array` (spec 07 `PropValue`).

Times: every time prop (`// time`) is `EpochMs`, the scale of `Observed.at` and of every fact
deadline (spec 04). The host ticks countdowns and ages from its own clock (spec 10); the plugin
never re-renders for a clock.

## 4. Elements

### 4.1 Layout

```ts
type StackProps = {
  direction?: "column" | "row"; gap?: Space; padding?: Space; wrap?: boolean; // defaults: column, gap "m", padding "none"
  align?: "start" | "center" | "end" | "stretch"; justify?: "start" | "center" | "end" | "between";
};
type ColumnsProps = { widths?: (number | "auto")[]; gap?: Space }; // flex weight 1..12 per child; missing = 1
type SectionProps = { title?: string; subtitle?: string; collapsible?: boolean; open?: boolean };
type SectionEvents = { "update:open": boolean };
type TabsProps = { modelValue?: string /* id */ }; // the selected Tab id; without it the host keeps the selection
type TabsEvents = { "update:modelValue": string };
type TabProps = { id: string /* id */; title: string; icon?: IconRef; badge?: string | number; progress?: number /* unit */; dot?: boolean };
```

- `Columns` stacks its children into one column when its box is narrower than the
  `--ui-columns-min` container width (section 5).
- `Tabs` shows only the selected `Tab`'s children; the first `Tab` is selected at mount. `Tab`
  ids are unique within one `Tabs`; a duplicate id is malformed.
- `Section` with `collapsible` draws a host disclosure; `open` defaults to `true`.
- `Divider` has no props and no events.

### 4.2 Views

```ts
type ViewCommon = { title?: string; actions?: ItemAction[] }; // actions: view commands ("New build"): footer and actions menu
type CollectionCommon = ViewCommon & {
  placeholder?: string; // filter text field placeholder
  filter?: "host" | "plugin"; // default "host"
  loading?: boolean; // host loading row; no empty state while true
  empty?: EmptyData; // shown with 0 rows and no filter text; with filter text: "No matches"
};
type ListProps = CollectionCommon & {
  items: ItemData[]; reorderable?: boolean;
  collapsible?: boolean; // ItemData.section headings fold
  highlight?: string[]; // words the host marks in titles and subtitles (filter "plugin")
  quickKeys?: boolean; // keys 1–9 press the first 9 rows while the filter is empty
};
type ListEvents = {
  reorder: { from: number; to: number };
  search: { text: string }; // filter "plugin" only
  assign: { slot: number; id: string }; // quickKeys: Cmd/Ctrl+1..9 on the selected row, slot 1..9
};
type GridProps = CollectionCommon & {
  cells: CellData[]; reorderable?: boolean; cellSize?: Size; // cellSize default "m"
  columns?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | "auto"; // default "auto": as many as fit
};
type GridEvents = { reorder: { from: number; to: number }; search: { text: string } };
type TableProps = CollectionCommon & { columns: TableColumn[]; rows: RowData[]; sort?: TableSort };
type TableEvents = { sort: TableSort; search: { text: string } };
type DetailProps = ViewCommon & { title: string; subtitle?: string; icon?: IconRef };
type FormProps = ViewCommon & { title: string; submitLabel?: string; dirty?: boolean };
type FormEvents = { submit: { values: Record<string, FieldValue> }; discard: {} };
type EmptyProps = EmptyData & { actions?: ItemAction[] };
```

- **Main collection.** In a view, the first `List`, `Grid` or `Table` is the one the Hub search
  field filters and the Hub keys select in (spec 10, H16). In a panel, a collection with a
  `placeholder` gets its own host filter field above it.
- **Filter.** Host filter matches title, subtitle and keywords (and table cell text). Plugin
  filter sends `search` with the newest text (timing: spec 10).
- **Rows.** `List` draws `ItemData` (spec 08): icon, title, subtitle, accessories (host-ticked
  `age`), `skills` strip, `section` headings in first-seen order, `unavailable` as a dimmed row
  with its reason and disabled game actions; `preview` blocks go to the Hub preview pane. `Grid`
  draws `CellData`: icon at `cellSize`, title, badge, progress bar, an accent ring when `marked`,
  tooltip blocks on hover and focus.
- **Table** sorts in the host: a press on a sortable header toggles asc/desc and emits `sort`;
  the `sort` prop sets the order at mount. `number` cells use `Intl.NumberFormat("en-US")`.
  `price` cells take whole gold: below 1,000 "250 g"; from 1,000 platinum with at most two
  decimals and no trailing zeros, "1.25 plat", "82 plat".
- **Reorder** is off while filter text is not empty. `from` and `to` are positions in the last
  applied `ITEMS` order.
- **Form.** `submit` carries the values of every input with a `field` key inside the Form, except
  protected inputs (4.4). Enter in a single-line input presses the Form's first `GameAction` if it
  has one (a trusted press, spec 01 §2); otherwise it submits. When `dirty` is true the host shows
  "Unsaved", a Discard control (emits `discard`) and a leave confirmation on going back (Escape
  ladder: spec 10).

### 4.3 Content

```ts
type TextProps = { tone?: Tone; size?: Size; weight?: "regular" | "medium" | "bold"; wrap?: boolean }; // text children; wrap default true
type HeadingProps = { level?: 1 | 2 | 3 }; // default 2; text children (title cap)
type BadgeProps = { tone?: Tone; icon?: IconRef }; // text children (title cap)
type IconProps = { icon: IconRef; size?: Size | "xl"; label?: string; tone?: Tone };
type SkillBarProps = { skills: SkillSlot[]; editable?: boolean; size?: "s" | "m" };
type SkillBarEvents = { // editable only; slots 0..7
  drop: { type: string; id: string; slot: number }; move: { from: number; to: number };
  clear: { slot: number }; select: { slot: number };
};
type KeyValueProps = { rows: KeyValueRow[]; columns?: 1 | 2 };
type ProgressProps = { value?: number /* unit */; label?: string; detail?: string; tone?: Tone }; // no value = indeterminate
type CountdownProps = {
  until?: number /* time */; since?: number /* time */; // exactly one
  format?: "cooldown" | "clock" | "relative"; tone?: Tone; size?: Size; // format default: until → cooldown, since → clock
};
```

- `Text` children use the `text` cap; with `wrap: false` the text keeps one line with "…" and the
  full text as a tooltip. `Icon` sizes: s 16 px, m 20 px, l 32 px, xl 64 px; `tone` colours
  glyphs only.
- `SkillBar` accepts drops of `DragData.type === "skill"` only. The host draws the elite marker
  from reference data. There is no drop preview: the plugin decides the outcome after the drop
  (replace, or move a duplicate) and renders it.
- `Countdown` formats (the same code drives `HudCountdown`; constants in
  `packages/ui/src/elements/countdown.ts`, thresholds of spec 05 §4.2):

| Format | Input | Shows | Tone |
| --- | --- | --- | --- |
| `cooldown` | `until`; r = until − now | r ≤ 0: nothing. r < 3 s: one decimal rounded up, "2.4". r < 99 s: whole seconds rounded up, "45". Else whole minutes rounded up, "2m" | danger below 2 s, warning below 5 s, else `tone` |
| `clock` | `until` (down, stops at "0:00") or `since` (up) | "m:ss" below 1 h, "h:mm:ss" from 1 h | `tone` |
| `relative` | `since` only | below 10 s "now"; then "12 s ago", "5 min ago", "3 h ago", "2 d ago" (floored) | `tone` |

### 4.4 Inputs

```ts
type InputCommon = {
  label: string; hideLabel?: boolean; // label: required accessible name; hideLabel: hidden, still announced
  field?: string; // key for field() refs and Form values; ^[a-z][a-z0-9-]{0,31}$
  hint?: string; error?: string; disabled?: boolean;
};
type TextFieldProps = InputCommon & { modelValue?: string; placeholder?: string; suggestions?: Suggestion[] };
type TextAreaProps = InputCommon & { modelValue?: string /* text */; placeholder?: string; rows?: 2 | 3 | 4 | 6 | 8 };
type NumberFieldProps = InputCommon & {
  modelValue?: number; min?: number; max?: number; step?: number; // step default 1
  display?: "field" | "stepper"; suffix?: string; placeholder?: string;
};
type SelectProps = InputCommon & {
  modelValue?: string /* id */ | null; options: SelectOption[]; placeholder?: string;
  searchable?: boolean; clearable?: boolean; display?: "menu" | "segmented";
};
type ToggleProps = InputCommon & { modelValue?: boolean; detail?: string };
type SliderProps = InputCommon & { modelValue?: number; min: number; max: number; step?: number; format?: "number" | "percent" };
type ColorFieldProps = InputCommon & { modelValue?: HexColor; swatches?: HexColor[] };
type KeyFieldProps = InputCommon & { modelValue?: KeyCode | null };
type TagFieldProps = InputCommon & { modelValue?: string[]; suggestions?: Suggestion[]; placeholder?: string };
// Every input: events { "update:modelValue": <its modelValue type> }.
// TextField and TagField also: { pick: { value: string } } when the player picks a suggestion.
```

- **v-model.** The host input owns what it shows. Each player change raises the input's revision
  by 1 and sends `update:modelValue`. Every `modelValue` the runtime sends for that node carries
  the newest revision it has received (0 before any change). The applier applies a `modelValue`
  only when its revision equals the input's current one; an older one is stale and ignored, so
  typed characters are never lost. Wire form: the PROP value and the event payload are both
  `[value, revision]`; the runtime unwraps the pair, so the handler gets the plain value.
- **Event rate.** Text inputs send one `update:modelValue` per `input` event; `Slider` at most one
  per animation frame while dragging plus one on release; `NumberField` only valid numbers, clamped
  to `min`/`max` on blur. `KeyField` captures one key press while focused (Escape cancels; Delete
  and Backspace set `null`; reserved chords never reach it, spec 11). `Select` with `display:
  "segmented"` shows a menu when the options do not fit one row.
- **`field`.** A `field` key is unique within its root; a second input with the same key loses
  its binding and the dev console warns. At press time the Hub resolves `{ field: key }` in an
  intent's args from the input with that key in the same root (spec 13).
- **Protected inputs.** An input whose `field` key fills an argument that the catalog marks
  `required` or `or-social` (`ActionEntry.inputs`, spec 04 §6.3: the whisper `body` and `to`, the
  invite `to`) of a `GameAction` intent in the same root: the applier ignores every plugin
  `modelValue` for it, so it starts empty; it sends no `update:modelValue` and stays out of Form
  values. An `or-social` input ignores plugin `suggestions` and suggests names from this
  session's `game.social` value only (intent rules: spec 13).
- **"Sent to" chip.** In an `internet`-class install every input shows "Sent to <host>" with the
  first entry of `SurfaceContext.outboundHosts`, and " +N" for the others: "Sent to
  kamadan.gwtoolbox.com +1". `link:` hosts count because typed text can travel in a link.

### 4.5 Actions

```ts
type ButtonProps = { // text children (title cap)
  variant?: "primary" | "secondary" | "plain"; tone?: "neutral" | "accent" | "danger"; icon?: IconRef; disabled?: boolean;
  confirm?: string; // host confirm text before `press` or `action`
  action?: ItemAction; // host kinds only: copy, link, wiki, open, fill-search
};
type ButtonEvents = { press: {} };
type GameActionProps = { intent: GameIntent; variant?: "primary" | "secondary" };
type GameActionEvents = { result: ActionResult }; // local class only; never sent to internet installs
type RequestAccessProps = { permission: string /* id */ }; // an id from the manifest's `optional`
type LinkProps = { href?: string /* url */; wiki?: WikiRef }; // exactly one; text children (title cap)
```

- `Button.action` with `game`, `run` or `push` is malformed: use `GameAction`, `@press` or
  `useNavigation()`. A Button with both `action` and a `press` handler is malformed. The host
  handles each kind as for row actions (spec 10 §1.5).
- `GameAction` has no title: the host writes the label from the catalog and shows `available()`
  reasons, the descriptor guard, host-flow progress and receipts (specs 10, 13). It never holds a
  chain; chains are manifest commands only.
- `RequestAccess` renders "Allow: <host wording>" with the author's reason. A trusted press opens
  the host sheet (spec 12). After `install.requestDenials` denials it shows "Change this in the
  plugin page". Granted, or a `permission` not in `optional`, it renders nothing (the latter also
  warns in the dev console).
- `Link.href` must be an `https:` URL on a granted `link:` host of the install. A press opens a
  host sheet with the full URL and "Open", which asks Main to open it in the browser. Any other
  `href` renders as plain text with no press. `Link.wiki` opens the official wiki page at once:
  Main builds the URL from the English reference name (spec 14).

### 4.6 Drag and drop

- `reorderable` on `List` and `Grid`, `drag` on `CellData`, and `SkillBar` with `editable` are the
  only drag sources and targets in 1.0. The host runs the whole gesture (pointer capture, drag
  image, auto-scroll, target highlight); a drag stays inside its root and never reaches the game
  canvas or another root.
- One drop emits exactly one event: `drop { type, id, slot }` on a SkillBar slot, `move` between
  SkillBar slots, `reorder` in a list or grid. A drop on a target that does not accept the drag
  type, or outside every target, emits nothing (P28).
- **Keyboard path.** The actions menu of a focused draggable cell has "Move to…": a host picker
  of every target in the root that accepts the cell's type ("Slot 1" … "Slot 8", with the current
  skill name); choosing one emits the same `drop`. A focused editable slot has "Move to…" (other
  slots, emits `move`) and "Clear slot" (emits `clear`). A selected row or cell of a reorderable
  collection has "Move up", "Move down", "Move to top", "Move to bottom" (emit `reorder`). Key
  bindings: spec 10.

### 4.7 Drawing

```ts
type ChartProps = {
  title: string; series: Series[]; // title: accessible name and data-table caption
  x?: "time" | "number"; // default "number"; time axis in en-US date format
  yFormat?: "number" | "price" | "percent"; zoomable?: boolean; height?: Size;
};
type ChartEvents = { range: { from: number; to: number } }; // zoomable only, after a zoom or pan
type CanvasProps = { width: number; height: number; scene: Shape[]; label: string };
type CanvasEvents = { press: { shape: string } };
type MapViewProps = { map: number; layers: MapLayer[]; view?: MapCamera; label?: string };
type MapViewEvents = { press: { layer: string; shape: string } };
```

- The host redraws only when the scene, the theme or the pixel ratio changes. A hit test returns
  the topmost shape with an `id`; plugins never get pointer coordinates.
- `Chart` draws the hover readout (nearest x, every series' value) and a hidden data table.
  `Canvas` `width` and `height` define the coordinate space; the host scales it to the available
  width and keeps the aspect ratio.
- `MapView` coordinates are game world units of `map`. Pan and zoom are host-owned and emit
  nothing. `view` sets the camera at mount and when it changes; without it the view fits all
  shapes. The base map is game art from the player's `Gw.dat`; until that exists the host draws
  the layers on `--ui-well-fill`. Drawing on the game's own map waits for gwkit map anchors
  (Later: Maps).

### 4.8 HUD

```ts
type HudProps = { direction?: "row" | "column"; gap?: Space; anchor?: Anchor }; // game-geometry anchors only
type HudTextProps = { tone?: Tone; size?: Size }; // text children (title cap)
type HudIconProps = { icon: IconRef; size?: Size; badge?: string | number; tone?: Tone };
type HudBarProps = { value: number /* unit */; tone?: Tone; label?: string; width?: Size };
type HudCountdownProps = { until?: number /* time */; since?: number /* time */; format?: "cooldown" | "clock"; size?: Size };
```

- The manifest gives the widget's anchor and title (spec 04); the player places it (spec 10). A
  `Hud` without `anchor` sits in the widget's box; with `anchor` it sits on that game rectangle,
  moved by the same offset (spec 10 §1.9). Plugins never see positions.
- `Hud` draws a host backplate (`--ui-hud-backplate`) so text stays readable over the game.
  HUD elements carry no events, no actions and no inputs.

### 4.9 Later elements

```ts
// Transcript (M13-04): a chat log that stays at the end.
type TranscriptProps = {
  lines: TranscriptLine[]; highlight?: string[];
  follow?: boolean; // default true; scrolled up, the host shows "N new" to jump back
  unreadFrom?: string /* id */; // line id: the host draws a "New" divider before it
};
type TranscriptEvents = { reachTop: {} }; // the player scrolled to the oldest line: load older

// SkillCard (M13-01): a host-drawn skill description at an attribute rank.
type SkillCardProps = { skill: number; rank?: number; mode?: "concise" | "full" };
```

`SkillCard` draws name, icon, costs, activation, recharge and the description at `rank` from
reference data (spec 14), once skill descriptions exist there.

## 5. Theme

### 5.1 Tokens

- The token source is `packages/ui/src/tokens.css` (`--ui-*`; `--gw-*` only feeds `--ui-*`).
  `applyAppearance` (`packages/ui/src/appearance.ts`) sets the look on the document root
  (`data-ui-style`, `data-ui-font`, corrected variables); looks change there (M12-02), never in an
  element. Host element components use `--ui-*` tokens and the variables of 5.3 only: no colour
  literal and no `--gw-*` token in `packages/ui/src/elements/` or `elements.css`.
- New tokens (in `tokens.css`): `--ui-hud-backplate` (recessed colour at 72 % opacity),
  `--ui-columns-min` (480 px), and the tone inks of 5.2.

### 5.2 Style vocabulary → tokens

| Plugin value | Ink (text, glyph, stroke) | Fill (badge, bar, tile) |
| --- | --- | --- |
| `neutral` | `--ui-text` | `--ui-raised-fill` |
| `muted` | `--ui-text-muted` | `--ui-well-fill` |
| `accent` | `--plugin-accent` | `--plugin-accent-fill` |
| `good` | `--ui-tone-good-ink` | `--ui-success-raised-fill` |
| `warning` | `--ui-tone-warning-ink` | `--ui-warning-raised-fill` |
| `danger` | `--ui-tone-danger-ink` | `--ui-danger-soft-fill` |
| `profession:<name>` (Paint) | `--ui-profession-<name>` | same |

| Plugin value | Token |
| --- | --- |
| `Size` s / m / l (text) | `--ui-type-caption-size` / `--ui-type-body-size` / `--ui-type-subtitle-size` |
| `Heading` level 1 / 2 / 3 | `--ui-type-title-size` / `--ui-type-subtitle-size` / `--ui-type-body-size` at `--ui-font-weight-semibold` |
| `weight` medium / bold | `--ui-font-weight-medium` / `--ui-font-weight-bold` |
| `Space` none / s / m / l | 0 / `--ui-space-2` / `--ui-space-3` / `--ui-space-5` |

**Tone inks.** `appearanceVariables` emits `--ui-tone-good-ink`, `--ui-tone-warning-ink` and
`--ui-tone-danger-ink` per look: `accessibleForeground(base, lookBackgrounds(settings), 4.5)`,
with `base` the look's success, warning or danger colour. These base colours move from
`tokens.css` into the palettes of `appearance.ts` as hex (one owner); the local `backgrounds` list
of `appearanceVariables` becomes the exported `lookBackgrounds(settings)`. Text on a tone fill
uses neutral ink or that tone's ink.

### 5.3 Plugin accent

```ts
// packages/ui/src/appearance.ts
export function accentVariables(accent: UiColor | undefined, settings: AppearanceSettings): {
  "--plugin-accent": UiColor; // accessibleForeground(accent, lookBackgrounds(settings), 4.5)
  "--plugin-accent-fill": UiColor; // compositeColor(accent, <look surface>, 0.2)
  "--plugin-accent-ink": UiColor; // readableForeground(accent): text on a solid accent tile
};
// accent undefined → the look's own accent colour.
```

The game renderer sets these variables on each plugin surface root (and the Hub on plugin rows
and icon tiles) from the manifest `accent` (spec 04), and recomputes them on every appearance
change. No worker takes part.

### 5.4 Density, game art, looks

- Density: `view` and `hud` surfaces are compact (`--ui-control-height-compact`), `panel` surfaces
  comfortable (`--ui-control-height`). The host sets it.
- Game art: `IconRef` `skill`, `item`, `profession` and `map` resolve to `moxi://app/ref/…` URLs
  (spec 14) that only host components load (spec 01 I9). Until the `Gw.dat` reader exists (M12-01):
  skills, items and maps show the glyphs `bolt`, `chest` and `map` with the reference name as
  tooltip; professions show a letter tile in `--ui-profession-<name>` with `--ui-profession-ink`.
  Glyph paths live in `packages/ui/src/glyphs.ts` (24-px grid, stroke).
- Looks: Classic and Modern today are `data-ui-style="classic" | "obsidian"` plus the custom look.
  Every element is checked in each (P23).

## 6. Constants

Budget keys used here: `view.nodesPerRoot`, `view.rowsPerCollection`, `view.rootsPerSession`,
`view.titleChars`, `view.textChars`, `view.sceneShapes`, `view.sceneTypedBytes`,
`wire.retainedRowBytes`, `install.hudWidgetsOn`, `install.requestDenials` (values and countdown
thresholds: spec 05). Icon pixels, `--ui-columns-min` and backplate opacity are component
constants.

## 7. Decisions

- **One registry** for components, types, decoder tables, kit serializer and docs (today: three hand-written wire copies). Not parallel definitions.
- **Collections are data props** with keyed `ITEMS` patches (one node per list, host virtualization). Not child components per row (10× the nodes).
- **About 44 elements** that grow by need. Not about 70 with SVG, Markdown and images.
- **Theme by tokens, `accent`, game art and draw lists.** Not plugin CSS, class names or iframe panels. **No `Image`**: packages carry no image bytes.
- **Declarative draw lists**: host-owned pixels, theme and hit tests. Not OffscreenCanvas or WebGL (plugin pixels, unbounded GPU).
- **Text content as children** (`<Text>…</Text>`): one way to write text. Not a `text` prop on some elements.
- **`modelValue` with a revision check**: typed characters are never lost to a late echo. Not "ignore props while focused".
- **Tables sort in the host**: 10,000 rows without a round trip. Not plugin re-sorting.
- **No drop preview on `SkillBar`** (per-hover questions cannot cross to the worker) and **drags stay in one root** (every 1.0 drag is inside one view). Not host-coded placement rules or cross-root drags.
- **`Link.href` through a host sheet; wiki links open at once** (a wiki URL is host-built). Not `href` without a sheet.
- **HUD elements have no events**: plugins never see pixels or the camera. Not a pressable HUD.

## 8. Today in code (main 848fb6e) and what changes

- Wire shapes: `packages/sdk/src/nodes.ts`, `protocol.ts`, `apps/plugin-host/src/worker-messages.ts` → `packages/sdk/src/host/elements.ts`; the three copies are deleted (M1-04, M6-03).
- Views, blocks, tone, icons: `apps/game/src/hub/Hub.vue`, `Blocks.vue`, `Icon.vue` and the types in `nodes.ts` → `packages/ui/src/elements/`, `Tone`/`Block` (section 3), `IconRef` (spec 04) (M3-03, M6-03, M12-01).
- Inputs (`text`, `select`, `toggle` only) → 9 input elements (M3-04). HUD (`HudText`, `row`, dev harness `apps/game/src/hub/dev/App.vue` only) → HUD elements (M3-06).
- Theme: `packages/ui` `tokens.css`, `components.css`, `appearance.ts`, `color.ts`; no `.vue` files, no plugin `accent`, a third palette in the dev harness → element components, tone inks, accent variables; the dev palette goes (M3-03, M6-03).
- Drawing, drag and drop: none → 4.6, 4.7 (M3-03, M3-05).

## 9. Built by

| Slice | Builds from this spec |
| --- | --- |
| M1-04 | registry (2.1, 2.3) and data types (section 3); model test: every string prop is `id`, `title`, `text`, `url` or `badge`; no prop named `class` or `style`; element indices unique and dense from 1 |
| M1-05 | decoders per `PropType` and the structure rules of rule 6 (spec 07 codec) |
| M2-01, M2-05, M2-06 | author components, kit serializer and compile gate from the registry (specs 06, 08) |
| M3-02 | applier: `hostElements`, `SurfaceContext`, the `modelValue` revision check |
| M3-03 | elements 1–20, tone inks, `accentVariables`, `glyphs.ts`, `elements.css`, kitchen-sink fixture views |
| M3-04, M3-05, M3-06 | elements 21–33 with `field`, protected inputs, "Sent to" chip; 34–36; 37–41 |
| M3-07 | `GameAction` progress and receipts (specs 10, 13) |
| M6-03 | deletes `nodes.ts`, `protocol.ts` wire types, `worker-messages.ts` shapes, `Blocks.vue`, `Icon.vue`, the dev palette |
| M12-01, M11-11 | game art for `IconRef` and `MapView`; `Hud.anchor` (spec 04 §10.3) |
| M13-01 to M13-04 | `SkillCard`; `List.quickKeys`; `List.highlight`, `Chart.zoomable`; `Transcript` |

## 10. Checked by

| Proof | What it checks here | Kind | Owner |
| --- | --- | --- | --- |
| P23 | kitchen sink in Classic, Modern and a high-contrast custom look, accents `#d8a84e` and `#ffff00`: 0 worker messages on a switch; colours equal the tokens; text ≥ 4.5:1 (large ≥ 3:1); HUD text against the backplate over white and black | Gate (B) | M3-03 |
| P26 | the Build Library rebuilds with registry elements only | Gate + Review | M6-01 |
| P28 | 1 `drop` `{ type, id, slot }` per drop; 0 for a wrong target; 1 `reorder` per gesture with valid indices; "Move to…" gives the same events; 0 game actions; hit tests return own shape ids | Gate (B) | M3-03, M3-05 |
| P31, P45, P38 | "Sent to <host>" on every input of an internet install; `field()` takes the value at press time and a protected body ignores plugin `modelValue`; `RequestAccess` states | Gate (B) | M3-04 |
| P27 | `HudCountdown` text never goes up; formats and tones equal the table in 4.3 | Gate (B) | M3-06 |
| P6 | no attribute outside the registry's prop table | Gate (B) | M3-02 |
| P12 | a one-row rename = 1 `ITEMS` upsert | Gate | M2-03, M3-02 |
| P78, P79 | an element touches ≤ 2 production files; element components ≤ 2,500 counted lines (rules: spec 01 §4) | Review | M6-04 |

## 11. Deferred

- **Theme packages** (M14-04): data-only token sets the player picks once for the app and all
  plugins; manifest `kind` and `tokens` return then (spec 04).
- **`DropZone`**: a generic drop target, built when a plugin needs a target other than `SkillBar`
  or a reorderable collection. Shape: props `{ accepts: string[]; label: string }`, children any,
  event `drop: { type: string; id: string }`.
- **Game-map layers** (Later: Maps): the `MapLayer` model drawn over the game's own map through
  gwkit map anchors; no plugin API change.
