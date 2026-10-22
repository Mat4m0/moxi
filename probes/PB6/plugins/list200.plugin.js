// PB1 fixture (a), Builds class: a List of 200 ItemData rows with previews, rows come from a fact.
import { h, computed, defineComponent } from "vue";
import { definePlugin, useFact } from "@moxi/sdk";

const builds = useFact("inventory.builds");

const items = computed(() =>
  (builds.value.rows ?? []).map((b) => ({
    id: b.id,
    title: b.name,
    subtitle: `${b.prof} / ${b.sec}`,
    icon: { glyph: "build" },
    keywords: [b.prof, b.sec, b.name.toLowerCase()],
    accessories: [{ text: `${b.skills.length} skills` }, { text: b.prof, tone: "neutral" }],
    preview: [
      { kind: "text", text: b.note },
      { kind: "keyvalue", rows: b.skills.map((s, i) => [`Slot ${i + 1}`, String(s)]) },
    ],
    actions: [{ title: "Apply", op: "build.apply", args: { id: b.id } }],
  })),
);

const View = defineComponent({
  setup: () => () => h("ui-list", { title: "Builds", items: items.value }),
});

export default definePlugin({ commands: { main: View } });
