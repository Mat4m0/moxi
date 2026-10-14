# AGENTS.md

Moxi hosts ArenaNet's official Guild Wars WebAssembly client on macOS, Windows
and Linux, with a launcher, a Hub and plugins. It replaces gwonmac. Matthias
owns product decisions, live game checks and every publication. Status: before
1.0.0; nothing is published yet.

Read `docs/ARCHITECTURE.md` before your first change. It owns processes,
package boundaries, storage and testing.

## Commands

```bash
pnpm install            # Node and pnpm versions are pinned in the repo
pnpm dev                # Dev app, real game, hot reload; never touches player data
pnpm dev --fixture      # Dev app with the fake game client (no ArenaNet, no login)
pnpm dev --background   # agents: no Dock icon, invisible windows, never takes focus (not on Linux)
pnpm hub                # Hub, HUD and plugins in a browser with a simulated game
pnpm check              # exactly the pull-request gate: format, lint, types, tests
pnpm test <path>        # one area
pnpm drive <step>       # agents: drive the running Dev app (screens, keys, screenshots)
```

## Where things live

- `apps/desktop`: Main and preloads. Electron APIs only in `src/shell/`.
- `apps/launcher`, `apps/game`, `apps/plugin-host`: renderers.
- `packages/contracts`: IPC channels and their schemas.
- `packages/gwkit`: WASM integration and game facts/actions. No Electron, no Vue.
- `packages/sdk`: the public plugin API (`@moxi/sdk`) and its test kit.
- `packages/ui`: design tokens and components, including Guild Wars widgets.
- `plugins/*`: bundled plugins. They import only `@moxi/sdk`.
- `compat/`: role specs (source) and signed locator files (generated; never edit).

## Rules that never bend

1. ArenaNet's downloaded files stay untouched. Derived copies are rebuildable.
2. Plugins get copied facts and named actions only: no memory, packets, DOM,
   input or Node. A game action needs a permission and a fresh player action.
   Multi-step game flows are host actions, never plugin sequences.
3. No telemetry. Nothing about the player leaves the machine except what the
   game itself sends, the static files the app downloads, and what the player
   sends on purpose (such as feedback) after seeing what it contains.
4. Every capability fails closed on its own; the plain game always stays playable.
5. Credentials exist only in Main (`safeStorage`); never in logs, renderers,
   plugins, diagnostics or test output.

## Live game sessions (agents)

Agents never engage in economy or combat. Within that, test as much as
possible live through the `moxi-dev` MCP server; Main refuses everything else.

- Allowed: login, characters, relog, reload; all launcher, Hub and HUD UI;
  opening and reading every game window (inventory, storage, heroes, skills,
  map, quests, guild, friends, party); moving own items between bags and
  storage; travel between outposts, towns and the Guild Hall; applying builds
  and teams; adding or removing heroes and henchmen; reading every fact.
- Never: explorable areas, missions, PvP, skills or attacks; trading,
  merchants, traders, crafters, salvaging; dropping, using or giving away
  items or gold; chat, whispers, emotes or invites to players; guild changes;
  free clicks or keys on the game canvas.
- Never read the Dev login file (`~/.config/moxi-dev/login.env`) or print
  its values. Keep sessions short and at a human pace; player input always wins.

## Code

- Simplest correct code. Prefer delete > simplify > replace > add. No
  abstraction, option or layer without a second real use.
- One owner per fact. No duplicated state, no "just in case" caches.
- Types make invalid states unrepresentable. No `any`; no casts to silence
  the checker. Validate with ArkType only at process, file and network edges.
- Comments explain intent or a non-obvious constraint, in one or two lines.
  No essays, no history, no "evidence" in comments.
- Names say what a thing is for players or for the domain, not how it is built.
- Errors that a player can hit have a plain message and a fallback; internal
  invariant failures throw.
- No new dependency without a reason in the pull request. Never one with
  native code without asking Matthias.

## Tests

- Before writing a test, name the realistic bug it catches. No bug, no test.
- Test behavior through public interfaces: domain functions, the SDK test kit,
  the Hub shell suite, the fake client. Never test private helpers or types.
- Tables for input matrices; literal expected values; one regression test per bug.
- Mock only ArenaNet, the clock and external HTTP. Fake timers, no sleeps.
- No flaky tests. Wait for the complete final state, never a partial one;
  control time with a fake or mocked clock; no retries and no short timeouts.
  A new or changed test file must pass 20 runs in a row before it merges. A
  test that fails once without a code change is a bug: fix it or delete it
  the same day.
- No tests that read source, docs or config text. Boundaries are lint rules.

## Players depend on this (from 1.0.0)

Before 1.0.0, data and APIs may change freely. From the first public release:

- Database migrations are expand-only: add tables, columns and settings; drop,
  rename or retype only one Stable release later.
- Never give an existing settings key a new meaning; add a new key.
- Every release must update cleanly from the last two Stable versions.
- The plugin API is additive within `api: 1`. A break needs `api: 2` and a
  decision approved by Matthias.
- Changed defaults or shortcuts are player-visible: say what changes for
  players in the pull request.
- Nothing published is edited: releases, feeds and signed data only move
  forward with a new version.

## How to work

- One outcome per commit and per pull request. Conventional Commits:
  `<type>(<scope>): <description>`. The pull-request title becomes the
  release-notes line, so write it for players: `fix(hub): Escape goes back one level`.
- Unfinished features do not reach players. A new tool may merge as a bundled
  plugin with `"stage": "experimental"`, which only Dev and Beta show.
- UI changes include a before/after screenshot from `pnpm hub` or the fixture app.
- Update the owning doc in the same change. Keep docs short; no status
  ledgers, evidence logs or plans in the repository.
- `pnpm check` passes before every commit you report as done.

## Releases

- Nothing is released yet. `.github/workflows/build.yml` builds unsigned
  installers on demand and on `v*` tags and publishes nothing.
- Planned, with `docs/RELEASING.md` once the pipeline exists: merging to
  `main` publishes Dev; Beta and Stable are shipped only by Matthias;
  versions are computed from titles. Never edit version numbers or tags.

## When something breaks after a release

| Problem | Path |
| --- | --- |
| An ArenaNet update turned a feature off | Confirm or fix locators as data. App code only if game behavior changed |
| A feature misbehaves for everyone | Propose a kill switch in compatibility data; Matthias approves; then fix |
| Regression in Stable | Fix on `main`, then Matthias ships Beta or Stable from that commit |
| A release is bad | Ship the last good commit as the next patch; never delete or edit a release |

## Ask Matthias first

Merging pull requests, publishing anything (Beta, Stable, SDK, compatibility
data, notices), announcements, live game sessions with his accounts, changes to
signing, app identity or update URLs, dependencies with native code, deleting
player data, and any change to the rules above.
