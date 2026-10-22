# How moxi is built

This folder is the build plan for moxi 1.0. It holds no status: Opus tracks status outside
the repository. The design itself is in [`docs/spec/`](../spec/); this folder says in which
order it is built and how each piece is proven.

| File | What it holds |
| --- | --- |
| [milestones.md](milestones.md) | The milestones in order: goal, slices, gate, review |
| [slices/](slices/) | One brief per slice, named `M<milestone>-<nn>-<name>.md` |
| [proofs.md](proofs.md) | Every proof (P1 and up), with the slice that owns it |
| [parity.md](parity.md) | Every v1 feature: keep, merge, defer or drop, with its journey |

## Roles

| Role | Who | Does |
| --- | --- | --- |
| Owner | Matthias | Product decisions, live game sessions, merges, every publication |
| Lead | Opus | Writes and updates briefs, starts workers, reviews every result, pushes slice branches for CI, asks Matthias to merge |
| Worker | Sonnet or Haiku (the brief names the model) | Builds exactly one slice in its own worktree and reports |

A brief marked **O** is built by Opus itself (UI, copy, looks, final security calls).
**S (+O taste)** means a Sonnet worker builds and Opus does a taste pass before review ends.

## Setup

```text
~/gw/moxi            this repo; the lead session runs here
~/gw/moxi.wt/<id>    one git worktree per slice
~/gw/gwonmac         v1, read only, checked out at tag v2026.10.0-beta.1 (the parity baseline)
~/gw/GWCA            optional: game memory layouts (github.com/gwdevhub/GWCA), read only
```

Start every session with the references attached, so agents can check v1 behavior:

```bash
claude --add-dir ../gwonmac --add-dir ../GWCA
```

Claude Code 2.1.224 or later (sessions message each other with `SendMessage`). The roles live
in `.claude/agents/`: `builder` builds one slice, `reviewer` reviews one with fresh eyes.

## Sessions

| Session | Runs where | Does |
| --- | --- | --- |
| Lead (one, Opus) | `moxi` | Writes briefs, starts builders and reviewers, reads their reports, reviews the diff, pushes, opens draft PRs |
| Builder (one per slice) | `moxi.wt/<id>` | One brief, builds and commits, sends its report to the lead |
| Reviewer (one per finished slice) | `moxi.wt/<id>` | Brief + diff + specs + v1; verdict to the lead; never edits |

Start a builder as its own background session, so it has its own chat and can be resumed:

```bash
git worktree add ../moxi.wt/M1-03 -b slice/M1-03 main
cd ../moxi.wt/M1-03 && claude --bg -n M1-03 --agent builder --add-dir ../../gwonmac \
  "Build docs/build/slices/M1-03.md"
claude agents              # list sessions; claude attach M1-03 to look in
```

Short lookups ("where does v1 do X?") are subagents of the lead, not sessions. Start a new
lead session for each milestone and continue from the milestone's goal and the merged PRs;
a long lead chat gets slow and expensive.

## How one slice runs

1. **Pick.** Opus takes the first slice in [milestones.md](milestones.md) whose dependencies
   are merged. At most three workers build at the same time.
2. **Worktree.** `git worktree add ../moxi.wt/<id> -b slice/<id> main`.
3. **Start.** Opus starts the worker with the brief path and nothing else. The brief, this
   file, `AGENTS.md` and the spec sections the brief names are the whole assignment.
4. **Preflight.** The worker runs the brief's preflight commands first. If one fails, it
   stops and reports; it never adapts the brief on its own.
5. **Build.** Only the files in the brief's scope, plus the lockfile and the configs the scope
   obviously needs.
6. **Check.** Every command in "Done when", in order, with real output. See "Checks" below.
7. **Evidence.** `.evidence/<id>/evidence.md` (git-ignored): each command, exit code and the
   tail of its output; numbers for Measures.
8. **Commit.** Atomic Conventional Commits on `slice/<id>`, staged by pathspec. The worker
   never pushes.
9. **Report.** The worker's final message: status, summary, changes with commit hashes,
   verification (each check, its result), evidence paths, anomalies, assumptions, issues.
10. **Review.** Opus reads the whole diff, reruns the key check, opens the evidence, checks
    that no test or e2e coverage was deleted, checks the line budget, and reruns
    `pnpm gate` for every changed test file.
11. **CI.** Opus pushes `slice/<id>` and opens a draft pull request. Electron checks (e2e,
    packaged, probes) run there and only there.
12. **Merge.** With CI green and the review done, Opus asks Matthias to merge (AGENTS:
    merging needs his OK). After the merge: delete the branch and the worktree.

A worker that cannot finish reports `partial` or `blocked` with the exact reason. Opus then
fixes the brief or takes the slice itself. A brief is never "interpreted" into something else.

## Checks

| Check | Command | Where |
| --- | --- | --- |
| Format, lint, types, unit and browser tests | `pnpm check` | local |
| One area | `pnpm test <path>`; Hub browser suite: `pnpm test:hub` | local |
| No flakes | `pnpm gate <changed test files>`: 20 runs, then 5 with all CPU cores busy | local |
| Electron journeys | `pnpm e2e` | **CI only** (draft PR) |
| Packaged builds, Windows, macOS | `build.yml`, `nightly.yml` | **CI only** |
| Live game | `moxi-dev` MCP, after the M8 review | with Matthias only |

Gate vs Measure:

- **Gate**: deterministic. It waits for the complete final state, controls time with a fake
  clock, has no retries and no short timeouts. Gates block a merge.
- **Measure**: a timing or memory number. Median of 5 runs, in CI, with the decision rule the
  proof states. Measures never block a merge by themselves; Opus applies the decision rule.

## Rules that every brief inherits

- `AGENTS.md` wins over habits. The spec sections the brief names win over the brief's
  summary of them. If the brief and a spec disagree, stop and ask.
- Port knowledge, not code, from v1 (`Mat4m0/gwonmac`, cloned read-only next to this repo as
  `../gwonmac`). Probe code on the `probe/*` branches (`archive/probe-*` tags after M0-07) was
  written for this design and may be ported closely, with tests.
- **Workers never start Electron, the real game or a packaged app on the local machine.** No
  window may open on the builder's machine, hidden or not; Electron checks run in CI.
- **Never read `~/.config/moxi-dev/login.env`** or print anything from it.
- No fixed ports: listen on port 0 and pass the real port along.
- Tests: name the realistic bug first; test through the public interface; tables for input
  matrices; literal expected values; fake clocks; mock only ArenaNet, the clock and external
  HTTP. No test reads source, docs or config text.
- Network is available for `pnpm install` and documentation; tests never use the internet.
- Never wait on anything for more than 4 minutes in one blocking call. Long runs go to the
  background; CI waits are Opus's job, not the worker's.
- If a number in the brief contradicts what you measure, report it; do not force it.
- Comments explain intent or a non-obvious constraint in one or two lines.
- No new dependency without a reason in the report; never one with native code.

## Stop and ask Opus (every slice)

- A preflight line fails, or the base code differs from what the brief describes.
- The work needs a file outside the scope, a lint-boundary change, a public API change
  outside the slice, or a new dependency with native code.
- A spec section is ambiguous for the step you are on.
- Anything in AGENTS "Ask Matthias first": publication, live game, signing, app identity,
  update URLs, deleting player data, rule changes.
- The line budget will be exceeded by more than 20 %.

## Writing and changing briefs

- Opus owns every brief. A brief changes before its slice starts, never during.
- When a merged slice changes something a later brief depends on, Opus updates that brief
  (preflight lines, paths, names) in the same pull request or the next one.
- Templates: see any file in [slices/](slices/); the table header, Outcome, Read first,
  Preflight, Scope, Build, Tests, Done when, Evidence, Stop and ask, Out of scope.
