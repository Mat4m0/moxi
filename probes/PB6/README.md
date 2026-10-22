# PB6: one worker, many sessions (factory per session)

Question: does `__moxiBoot(factory)` with one plugin module instance per session keep sessions apart inside one
worker that shares the Vue runtime? Decides D 3.2 / P10. Node only. No Electron, no Chromium, no login, no ArenaNet data.

```bash
pnpm install
node src/build.mjs                          # runtime-api1.{prod,dev}.js, plugin factory bodies in dist/
node --expose-gc src/run-checks.mjs [ids]   # 21 checks, fresh worker per scenario, exit code 1 on failure
node --expose-gc src/run-measure.mjs        # heap per session (forced GC, 5 runs), eval and mount time, churn
node src/write-result.mjs                   # writes results/PB6.json
```

Pinned: `@vue/runtime-core` 3.5.44, `@vue/compiler-sfc` 3.5.44, esbuild 0.25.0, Node 24.18.0.

## Files

- `src/ops-renderer.mjs`: flat-ops `createRenderer`. `rooted` mode (ids, signs, handlers, buffer per root; a node emits
  nothing until it is attached) and `global` mode (R7's single buffer, used only as a control). `holdOnError`: the C4g remedy.
- `src/runtime.mjs`: the runtime prototype. `boot(factory)`, one session = effect scope + facts + one Vue app per root.
  Every session gets its own `__moxi = { vue, sdk }`; `useFact` is bound by closure, there is no ambient "current session".
- `plugins/*.plugin.js|.vue`: author-shaped sources (`import ... from "vue"` and `"@moxi/sdk"`), built into factory bodies.
- `src/harness.mjs`, `src/worker-prelude.cjs`: worker start, op applier (rebuilds each root tree from the batches), probe hooks.
- `src/run-checks.mjs`, `src/run-measure.mjs`, `results/*.json`.

## Checks (kind: isolation = must hold, control = must fail, finding / expected-leak = recorded)

| Id | What |
| --- | --- |
| C1 C2 C3 | module-level `let`, `ref`, `useFact`, HUD root are per session; a change re-renders only its session; two sessions in one flush give separate batches |
| C1x C3x C9x | controls: shared module scope, single global op buffer. Both corrupt sessions, so the checks can fail |
| C4 C4c C4d | render throw at mount, handler throw (sync, async), module-evaluation throw in session 2: 1, 3, 4 unaffected |
| C4b C4g | a render throw on update blanks the view in stock Vue; remedy: withhold the root's ops, snapshot on recovery |
| C4e C4f | errors outside any component instance (timer, module-level `watch`) cannot be attributed; in the dev build the watcher error drops the whole flush |
| C5 | closing session 3: no ops, no work, all its objects collectable; negative control without `scope.stop()` |
| C6 C6c | app-level `provide`, `getCurrentInstance` after `await` (plain and `<script setup>`), module-level watcher, shared host component |
| C6b C7 | expected leaks: `globalThis` / `Array.prototype` writes, a raw object shared through `globalThis` becomes reactive across sessions |
| C8 | shared scheduler: busy session 4 delays session 1 by its own busy time, same in one flush or in separate tasks |
| C9 C9h | seeded random interleavings (8 sessions, 5 seeds x 400 ops) against an oracle, without and with the last-good-tree remedy |

## For the SDK README (what authors must know)

- Module scope is one session. `globalThis`, built-in prototypes and objects reached through them are shared by all sessions of the install.
- Module-level data is copied per session (a 2,000-row table costs about 235 KiB per session). Read big static data through the host.
- After a plain `await` inside `setup()` the component instance is gone; a compiled `<script setup>` `await` keeps it.
- Errors in timers and in module-level `watch` callbacks are not attributed to a session.
