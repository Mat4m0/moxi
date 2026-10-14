function plugin(__moxi) {
  const { h, shallowRef, defineComponent } = __moxi.vue;
  const initial = [];
  for (let i = 0; i < 500; i++) {
    initial.push({
      id: "item-" + i,
      title: "Item " + i,
      subtitle: "Bid / ask",
      accessories: [{ text: String(1000 + i) }, { text: String(1100 + i) }, { text: "x" + (10 + (i % 90)) }],
      actions: [{ title: "Copy price", copy: String(1000 + i) }],
    });
  }
  const rows = shallowRef(initial);
  let tick = 0;
  // One row every 500 ms = 2 rows per second.
  const timer = setInterval(() => {
    tick++;
    const next = rows.value.slice();
    const at = (tick * 7) % 500;
    next[at] = { ...next[at], accessories: [{ text: String(1000 + at + 1 + (tick % 5)) }, next[at].accessories[1], next[at].accessories[2]] };
    rows.value = next;
  }, 500);
  __moxi.onClose(() => clearInterval(timer));
  const View = defineComponent({
    setup() {
      return () => h("List", { searchable: false, items: rows.value });
    },
  });
  return { views: { main: View } };
}
