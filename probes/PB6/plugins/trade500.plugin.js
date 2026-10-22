// PB1 fixture (c), Trade class: a 500-row list without previews, a couple of rows change per second.
import { h, computed, defineComponent } from "vue";
import { definePlugin, useFact } from "@moxi/sdk";

const prices = useFact("trade.prices");

const items = computed(() =>
  (prices.value.rows ?? []).map((r) => ({
    id: r.id,
    title: r.name,
    subtitle: r.category,
    icon: { glyph: "coin" },
    accessories: [{ text: `${r.buy}` }, { text: `${r.sell}`, tone: r.sell > r.buy ? "good" : "bad" }],
  })),
);

const View = defineComponent({
  setup: () => () => h("ui-list", { title: "Prices", items: items.value }),
});

export default definePlugin({ commands: { main: View } });
