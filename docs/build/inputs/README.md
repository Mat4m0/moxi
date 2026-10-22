# Start here: taking over the v2 build

This folder is temporary. It holds the inputs for the parts of the build book that do not
exist yet. Delete it in the pull request that adds the last of them.

New here? Read [ONBOARDING.md](ONBOARDING.md) first: the goal, why v2 exists, what is
done, and prompts for your first read-only sessions with Claude.

## What moxi v2 is

Electron hosts ArenaNet's official WebAssembly client. Plugins are Vue SFCs that run in
sandboxed workers. They see only a curated catalog of facts and a few named actions, and
every action needs a trusted press by the player. The line: **no combat and no economy
automation; quality of life is welcome.** Plugin panels stay inside the game window.

## Read in this order

1. `AGENTS.md`: rules that never bend, live-session limits, Ask Matthias first.
2. `docs/spec/01-foundations.md`, then the other specs as a slice needs them. The specs are
   the design of record (about 8,500 lines, 16 files).
3. `docs/build/README.md`: setup (v1 next to the repo), sessions, and how one slice runs.
4. `BOOK-PLAN.md` (here): milestones M0-M15 with about 122 slices, the book decisions
   BD1-BD30, the brief template and the new proofs P80-P84.
5. `docs/build/parity.md`: every v1 feature and what happens to it.

`PROOFS.md` (P1-P79) and `DESIGN.md` are the old sources the specs were written from.
`DESIGN.md` is superseded by `docs/spec/`; open it only to resolve a "D x.y" reference in
`PROOFS.md`.

## What the book still needs (do this first)

1. Six small loose ends in the specs:
   - `isTarget` in `host/port.ts` needs the ROOT_ID pattern, but `ids.ts` imports ArkType:
     move the pattern to a runtime-safe module (spec 01 §3, spec 02).
   - Spec 10 has two fault texts ("could not start" for `start`, "stopped responding" for
     the rest). Pick one wording or keep both on purpose.
   - `plugins.run` has no host argument, so "Start plugins" unpauses every host. Accept it
     or add `host?`.
   - `HubInstall.state` lacks `"refused"` (spec 03 `HostStatus` has it): add a spec 10 row
     or drop it.
   - Spec 05 §4.3: the compat fetch "every 30 min" has no budget key.
   - A doc `set()` with a non-JSON value throws `TypeError` and sends nothing: confirm.
2. `docs/build/proofs.md`: P1-P79 from `PROOFS.md` plus P80-P84 from `BOOK-PLAN.md` §6.
   Drop the "state today" column (no status in the repo), cite spec sections instead of
   "D x.y", and name the slice that owns each proof (BOOK-PLAN §5).
3. `docs/build/milestones.md`: from BOOK-PLAN §5, with goal, slices, gate and exit review
   per milestone.
4. `docs/build/slices/<ID>.md`: one brief per slice, using the template in BOOK-PLAN §3.
   Keep each brief at 60-120 lines. Write the briefs for M0-M2 first and start building;
   later briefs get a re-check against merged code before their milestone starts.
5. `docs/ARCHITECTURE.md`: rewrite as a short v2 overview (≤ 250 lines) that links to the
   specs.

What worked when writing the specs: one session writes the shared types, IDs and numbers
first, then parallel writers fill in the rest with a hard length cap. Parallel writers
without that shared core contradicted each other.

## Working agreement

- Work on branches, open draft pull requests, never push to `main`. Matthias merges.
- Electron checks (e2e, packaged builds, probes) run in CI. Agents never open app windows
  locally.
- Live game sessions only after the M8 review, within the AGENTS live rules, on your own
  account.
- Port knowledge from v1 (`Mat4m0/gwonmac`, cloned read-only next to this repo as
  `../gwonmac`), not its code. Probe code on the `probe/*` branches was written for this
  design and may be ported closely, with tests (PB6 session factory: `probe/PB6`; net stack:
  `probe/PB11`).

## Decisions only Matthias makes

Hub chord on Windows/Linux (D8), `game.inventory` in api 1 (Q7), the v1 drop list (D12),
the macOS CI lane (free now that the repo is public), AppImage release, a standing merge approval,
Windows signing, icons, the distribution host and signing keys, the `.deb` maintainer,
whether removing an account deletes its game data. Each slice that hits one stops and asks.

## State of `main` (2026-10-22)

- `main` is at `848fb6e`. CI on `main` is red; draft PR #1 (`slice/ci-green`) fixes it and
  is milestone slice M0-01.
- `slice/x5-robustness` (startup robustness) is M0-02.
- Draft PRs #2-#7 are probes. M0-07 archives them after their results are in the specs.
