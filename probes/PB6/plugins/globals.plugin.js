// Vue-global probes: app-level provide, getCurrentInstance after async gaps, module-level effects, shared reactive state.
import { ref, reactive, watch, h, defineComponent, Suspense, getCurrentInstance, inject } from "vue";
import { definePlugin, useFact, probe, Counter } from "@moxi/sdk";
import AsyncSetup from "./AsyncSetup.vue";

const KEY = Symbol.for("moxi.session");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const target = useFact("game.target");

// module-level watcher: no component instance, so Vue cannot route its errors to a session handler
const watcherRuns = ref(0);
watch(target, (t) => {
  probe("watcher");
  watcherRuns.value++;
  if (t.watchBoom) throw new Error("boom in module-level watcher");
});

// the same raw object reached through globalThis is wrapped by Vue's one global proxy cache
const shared = (globalThis.__shared ??= reactive({ n: 0 }));

// module-level effect on shared state: it only stops if the runtime stops the session scope
watch(() => shared.n, () => probe("sharedWatcher"));

const bumps = ref(0);

const RawAsync = defineComponent({
  async setup() {
    const before = getCurrentInstance() !== null;
    const sidBefore = inject(KEY).sid;
    await delay(target.value.delayMs ?? 5);
    const after = getCurrentInstance() !== null; // plain await: no restore
    const sidAfter = inject(KEY)?.sid ?? "none";
    return () => h("ui-text", { text: `raw sid=${sidBefore}/${sidAfter} inst=${before}/${after}` });
  },
});

const View = defineComponent({
  setup() {
    const sid = inject(KEY).sid;
    return () => {
      probe("render");
      return h("ui-stack", null, [
        h("ui-text", { text: `inject sid=${sid}` }),
        h("ui-text", { text: `watcherRuns=${watcherRuns.value} shared=${shared.n}` }),
        h("ui-button", { label: "bumpShared", onPress: () => { shared.n++; } }),
        h(Suspense, null, {
          default: () => h("ui-stack", null, [h(RawAsync), h(AsyncSetup)]),
          fallback: () => h("ui-text", { text: "loading" }),
        }),
        h(Counter, { label: "c", onBump: (v) => { bumps.value = v; } }),
        h("ui-text", { text: `bumped=${bumps.value}` }),
      ]);
    };
  },
});

export default definePlugin({ commands: { main: View } });
