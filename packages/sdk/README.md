# @moxi/sdk

Build plugins for Moxi: search results in the Hub, views with actions,
small readouts over the game, and game actions the player starts.

Status: 0.x. The contract may still change before 1.0.

## A plugin in two files

`plugin.json` tells the host what the plugin offers and needs. The host reads
it without running any plugin code.

```json
{
  "id": "community.target-distance",
  "name": "Target Distance",
  "version": "1.0.0",
  "api": 1,
  "description": "Shows how far your target is.",
  "icon": { "glyph": "target" },
  "permissions": ["game.player", "game.target"],
  "activation": ["game"],
  "commands": [],
  "settings": [
    { "key": "showRangeName", "label": "Show range name", "type": "toggle", "default": true }
  ]
}
```

`index.ts` is one ES module whose default export is `definePlugin(setup)`.

```ts
import { definePlugin, HudText } from "@moxi/sdk";

export default definePlugin(({ game, hud }) => {
  hud.widget("distance", () => {
    const me = game.player();
    const target = game.target();
    if (!me.ok || !target.ok || !target.value) return null; // nothing to show is valid
    const { x, y } = target.value.position;
    return HudText(
      String(Math.round(Math.hypot(x - me.value.position.x, y - me.value.position.y))),
    );
  });
});
```

`setup` runs once per game session (and once for the launcher, without a game).
Everything it registers is removed when the plugin stops.

## Manifest

| Field         | Meaning                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`          | Unique and stable forever, e.g. `community.target-distance`                                                                    |
| `api`         | SDK major version; `1`                                                                                                         |
| `permissions` | Facts and actions the plugin may use: `game.player`, `game.target`, `game.map`, `game.builds.load`, `game.travel`              |
| `activation`  | When the host starts the plugin: `game` (with each game session), `hub` (first Hub open), `command` (only when a command runs) |
| `commands`    | Hub commands: `{ id, title, subtitle?, keywords?, icon? }`                                                                     |
| `scopes`      | Leading words that narrow Hub search to this plugin, e.g. `["build"]`                                                          |
| `settings`    | `{ key, label, type: "toggle" \| "number", default }`, shown in Settings                                                       |

## The context

| Member                       | Purpose                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| `manifest`, `signal`         | Identity; `signal` aborts when the plugin stops                          |
| `game`                       | Facts and actions (below)                                                |
| `hub.items(render)`          | Searchable items. The host ranks them; no plugin code runs per keystroke |
| `hub.query(handler)`         | Answers computed from the typed text, e.g. `10 ecto in p`                |
| `commands.view(id, render)`  | A manifest command that shows a view                                     |
| `commands.action(id, run)`   | A manifest command without UI                                            |
| `hud.widget(id, render)`     | A small readout over the game; return `null` to hide it                  |
| `storage.doc(name, initial)` | A JSON document stored by the host, shared by all game windows           |
| `settings()`                 | The current values of the manifest settings                              |
| `ui.toast(...)`              | Report the result of something the player did                            |

Render functions are reactive. They run again when a fact, setting, document
or `ref` they read changes, and the host receives the new tree. You never post
or diff anything yourself.

## Facts never pretend

Every fact is an `Observed<T>`:

```ts
type Observed<T> =
  | { ok: true; value: T; at: number }
  | {
      ok: false;
      reason: "not-in-game" | "loading" | "unsupported" | "not-permitted" | "restricted-area";
    };
```

`unsupported` means the current Guild Wars build is not supported for this fact
yet, usually for a short time after an ArenaNet update. Render something
sensible for every reason; hiding a widget is often right.

## Actions have one honest outcome

```ts
const result = await game.loadBuild({ code });
// { status: "done" }                         the effect was observed in the game
// { status: "refused", reason, message }     nothing was sent
// { status: "failed", message }              sent, but the effect was not observed
```

The host enforces these rules; your plugin does not need to:

- A game action needs its permission and a fresh player action: a click or
  key press on your plugin's UI in the last 3 seconds. Each press allows one
  action. Typing in search allows none.
- Actions are refused in places where they are not allowed (for example PvP)
  and while the map loads. A second action of the same kind while one runs is
  refused as `busy`, never queued.
- There is no automatic retry. After `failed`, read the facts again before you
  offer the action again.

## UI nodes

Plugins describe UI; the host renders it with its own components, so keys,
focus, theme and accessibility work the same everywhere.

- Views: `List`, `Detail`, `Form`.
- Blocks for details and previews: `Text`, `SkillBar`, `Meta`.
- HUD: `HudText` and rows of them.

```ts
commands.view("library", () =>
  List({
    title: "Build Library",
    items: builds.value().map((b) => ({
      id: b.id, // selection follows ids, never positions
      title: b.name,
      subtitle: b.profession,
      preview: [SkillBar(b.skills)],
      actions: [
        { id: "load", title: "Load Build", run: () => game.loadBuild({ code: b.code }) }, // first action = Enter
        { id: "copy", title: "Copy Template Code", shortcut: "mod+c", copy: b.code },
        {
          id: "delete",
          title: "Delete Build",
          style: "destructive",
          confirm: { title: `Delete ${b.name}?` },
          run: () => remove(b.id),
        },
      ],
    })),
  }),
);
```

`mod` is ⌘ on macOS and Ctrl elsewhere. An action addressed to an item that
changed or disappeared is refused, so a re-render never redirects a key press.

## Testing

`@moxi/sdk/testing` runs your plugin in-process against a scripted game,
through the same protocol the real host uses.

```ts
import { createTestHost } from "@moxi/sdk/testing";
import manifest from "./plugin.json";
import plugin from "./index.ts";

const me = {
  ok: true,
  at: 0,
  value: { name: "Mo Kai", profession: "monk", position: { x: 0, y: 0 } },
} as const;

test("hides the distance when nothing is targeted", async () => {
  const host = await createTestHost(manifest, plugin, {
    game: { player: me, target: { ok: true, at: 0, value: null } },
  });
  expect(host.state.hud.distance).toBeNull();
});
```

Assert on what the player sees (`state.items`, `state.views`, `state.hud`) and on
what the plugin asked the game to do (`state.actions`).

## Not in the API

Raw memory, packets, pointers, arbitrary function calls, synthetic input, DOM
access, timers that start game actions, and calls between plugins. These are
left out on purpose: they would let a plugin play the game or break it.
