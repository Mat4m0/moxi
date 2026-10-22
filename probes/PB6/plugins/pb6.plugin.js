// The PB6 plugin as an author writes it: module-level `let`, module-level useFact, one component that renders both.
import { ref, h, defineComponent } from "vue";
import { definePlugin, useFact, probe } from "@moxi/sdk";

let rawCount = 0; // module-level plain variable
const count = ref(0); // module-level reactive state
const target = useFact("game.target"); // module-level composable
const seenGlobals = ref("");

if (target.value.moduleBoom) throw new Error("boom at module evaluation");

function poison() {
  globalThis.cache = { writer: target.value.name };
  Array.prototype.last = function () {
    return this[this.length - 1];
  };
}

function readGlobals() {
  const last = typeof [].last === "function" ? [1, 2, 3].last() : null;
  seenGlobals.value = JSON.stringify({ cache: globalThis.cache ?? null, last });
}

const View = defineComponent({
  setup() {
    probe("setup");
    return () => {
      probe("render");
      const t = target.value;
      if (t.boom) throw new Error("boom in render");
      if (t.busyMs) for (const end = performance.now() + t.busyMs; performance.now() < end; );
      return h("ui-stack", null, [
        h("ui-text", { text: `target=${t.name}` }),
        h("ui-text", { text: `count=${count.value} raw=${rawCount}` }),
        h("ui-button", {
          label: "inc",
          onPress: () => {
            rawCount++;
            count.value++;
          },
        }),
        h("ui-button", { label: "poison", onPress: poison }),
        h("ui-button", { label: "readGlobals", onPress: readGlobals }),
        h("ui-button", { label: "throwInHandler", onPress: () => { throw new Error("boom in handler"); } }),
        h("ui-button", { label: "throwInAsyncHandler", onPress: async () => { throw new Error("boom in async handler"); } }),
        h("ui-button", { label: "throwInTimer", onPress: () => { setTimeout(() => { throw new Error("boom in timer"); }, 0); } }),
        h("ui-text", { text: `globals=${seenGlobals.value}` }),
      ]);
    };
  },
});

const Hud = defineComponent({
  setup() {
    return () => {
      probe("hud-render");
      return h("ui-hudtext", { text: `hud:${target.value.name}` });
    };
  },
});

export default definePlugin({ commands: { main: View }, hud: { w1: Hud } });
