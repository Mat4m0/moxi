# Onboarding: understand moxi before you build it

Read this first, then spend your first sessions talking with Claude, not building. The specs
are long (16 files, about 8,500 lines) and every later brief assumes you know why they say
what they say. One or two days of questions save weeks of rework.

## The goal

moxi replaces gwonmac (v1) with an app that:

- runs ArenaNet's official Guild Wars client on **macOS, Windows and Linux**;
- reaches **feature parity with gwonmac** (the list is `docs/build/parity.md`);
- has a **plugin system** so the community can build quality-of-life tools without forking
  the app, in Vue, with UI that follows the moxi look but is not locked to it;
- stays **small enough to maintain**: target about 50-60k lines including tests (v1 is about
  200k);
- can **never become a bot platform**.

## Why a rewrite and not more gwonmac

Measured in v1 (October 2026):

- The pull-request gate took 44 minutes.
- About 24k lines were per-feature certification code; tests were 89k lines.
- The 1 October ArenaNet update cost a 4k-line fix, because function locations were
  constants in code.
- The Hub scored 4/10 in an audit, mostly from key handling copied into every feature.
- It is macOS only, and a plugin system on top of it could not be made safe.

An earlier rewrite attempt (`guild-wars-v2`) failed: it copied all of v1 into an `engine/`
folder and ran one renderer process per plugin (about 128 MiB each). moxi exists because of
both lessons.

## The ideas that make moxi different

1. **Game integration is data.** Where a function or value lives in the client is a signed
   locator file per ArenaNet build, found by fingerprints, not constants in code. An update
   should mean new data, not a code fix.
2. **Plugins see a catalog, not the game.** A plugin gets copied facts (map, party, skills,
   vitals …) and a few named actions (travel, load a build, apply a team, open storage …).
   No memory, no packets, no DOM, no input. The catalog has no combat or economy actions, so
   a bot cannot be written against it.
3. **Every action needs a press by the player.** No timer, fact change or network reply can
   start one. A "chain" (up to 8 quality-of-life steps, outposts only) runs on one press.
4. **Plugins run in sandboxed workers**, grouped into a few hidden host processes (about
   2.5 MiB per plugin instead of 128 MiB). The UI is described by the plugin and drawn by
   moxi, with a closed set of about 45 elements and no plugin CSS.
5. **Read or internet, never both.** A plugin that reads game facts cannot reach the
   internet, so it cannot leak what it sees.
6. **Panels stay inside the game window.**

## What is done

- **Design:** `docs/spec/` 01-16. Settled by two rounds of review; cross-spec conflicts are
  resolved in the text.
- **Probes:** about a dozen small experiments (PB1-PB15; PB8 runs in M3) proved the risky parts (worker memory, sandbox
  on Linux packages, egress blocking, session factory, network stack, two game windows at
  once …). Results are in the specs; code is on the `probe/*` branches.
- **Code on `main`:** a working v2 skeleton: Electron app, game file downloads and updates,
  the official client in a window, a first plugin host and SDK (to be replaced in M1-M6),
  a fake game client for tests, CI with e2e journeys on Linux.
- **Plan:** milestones M0-M15 with about 122 slices (`BOOK-PLAN.md`).

## What is not done

- The build book: `proofs.md`, `milestones.md` and one brief per slice (start page,
  "What the book still needs").
- Everything from M0 on. Nothing is released.

## Decisions already made (do not reopen without a reason)

| Decision | Where |
| --- | --- |
| No combat and no economy automation; quality of life welcome | AGENTS rule 2, spec 04 |
| Chains: ≤ 8 steps, outposts only, stop at first failure, player input cancels | spec 13 |
| `game.vitals`: health, energy, dead, morale, casting; player and heroes; display only | spec 13 |
| Panels inside the game window, no pop-out | spec 10 |
| Electron 44, Vue SFC plugins, ArkType at edges, node:sqlite | spec 01, 02 |
| Electron checks run only in CI; gates are deterministic (20 runs + 5 under CPU load) | docs/build/README |
| Plugin sources at Beta: official + dev folder; GitHub repos and community index before 1.0 | BOOK-PLAN BD5 |

Open decisions are Matthias's; the list is at the end of the start page.

## Your first sessions (read only)

Start in the repo with v1 next to it (setup in `docs/build/README.md`):

```bash
claude --add-dir ../gwonmac
```

Use plan mode or say "read only, change nothing" until you decide to build. Paste these one
by one; each is a separate topic, and a fresh session per topic keeps answers sharp.

**1. The big picture**

```text
Read AGENTS.md, docs/build/inputs/ONBOARDING.md, docs/build/inputs/README.md and
docs/spec/01-foundations.md. Then explain moxi to me in one page: the processes, who trusts
whom, how a plugin gets a fact and how a player's press becomes a game action. Draw the data
flow as a text diagram. Read only.
```

**2. Walk one feature end to end**

```text
Take the Builds feature. Using docs/build/parity.md, the specs and ../gwonmac, show me how it
works in v1 today and how it will work in moxi: manifest, catalog entries, the worker, the
Hub UI, the action path through Main, the tests. List every spec section involved. Read only.
```

**3. My own plugins against the catalog**

```text
Here are the features I built or want (describe them: the /outpost command, the hero
skill-stats panel, …). For each, check docs/spec/04 and 13: can it be built with the
catalog as specified? Which facts and actions does it need, which exist, which are missing,
and would any missing one cross the "no combat or economy automation" line? Read only.
```

**4. Challenge the design**

```text
Act as a skeptical senior reviewer. Read docs/spec/ and BOOK-PLAN.md. Find the 10 biggest
risks: contradictions between specs, things that will not work in Electron 44, plans that
are too large for one slice, and places where the specs and today's code on main disagree.
Cite file and section for each. Read only.
```

**5. Plan your first week**

```text
Read docs/build/inputs/README.md ("What the book still needs") and BOOK-PLAN.md §3 and §5.
Propose how to finish the build book for M0-M2 (proofs.md, milestones.md, the briefs) and
start M0: which parts you write yourself, which you hand to builder sessions, in what order,
and the rough token cost. Read only.
```

## Bring back to Matthias

- Anything from session 3 that needs a new fact or action: that is a product decision.
- The top risks from session 4 you think are real.
- Your plan from session 5, before you start building.

## Tips that saved money here

- Write shared types, IDs and numbers in one session first; parallel writers without that
  core contradicted each other and needed two review rounds.
- Cost grows with context size times tool calls. Keep sessions on one topic; start fresh
  per milestone; keep task state in a plan file, not in the chat.
- Sonnet for writing inside a clear brief, Opus for decisions and review.
