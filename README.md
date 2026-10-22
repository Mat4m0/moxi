# moxi

Play Guild Wars on macOS, Windows and Linux with ArenaNet's official client, plus a launcher,
a Hub and plugins. moxi is the successor of [gwonmac](https://github.com/Mat4m0/gwonmac).

**Status: in development, built in the open.** Nothing is released yet. For a playable app
today, use gwonmac.

## What it is

- **The official game, untouched.** moxi downloads ArenaNet's WebAssembly client and runs it
  in Electron. It ships no game files.
- **Plugins for quality of life.** Plugins are Vue components that run in a sandbox. They see
  a fixed set of game facts (map, party, skills, …) and can offer a few named actions, such as
  travel or loading a build. Every action needs a press by the player.
- **No bots.** There is no combat and no economy automation, and the plugin API has no way
  to add it.
- **No telemetry.** Nothing about you leaves your machine except what the game itself sends.

## Contributing

- `AGENTS.md`: the rules for every change, by people or agents.
- `docs/spec/`: the design. `docs/build/`: the build order and how one slice is built.

```bash
pnpm install
pnpm hub      # Hub and plugins in a browser with a simulated game
pnpm check    # format, lint, types and tests: the pull-request gate
```

## License

GPL-3.0-only (`LICENSE`). Guild Wars artwork and marks belong to ArenaNet and NCSOFT and are
not covered by this license; see `THIRD-PARTY-NOTICES.md`. This is a fan project, not
affiliated with or endorsed by ArenaNet or NCSOFT.
