function plugin(__moxi) {
  const { h, shallowRef, defineComponent } = __moxi.vue;
  const initial = [];
  for (let i = 0; i < 500; i++) {
    initial.push({ id: "item-" + i, name: "Item " + i, bid: 1000 + i, ask: 1100 + i, qty: 10 + (i % 90) });
  }
  const rows = shallowRef(initial);
  let tick = 0;
  // One row every 500 ms = 2 rows per second.
  const timer = setInterval(() => {
    tick++;
    const next = rows.value.slice();
    const at = (tick * 7) % 500;
    next[at] = { ...next[at], bid: next[at].bid + 1 + (tick % 5) };
    rows.value = next;
  }, 500);
  __moxi.onClose(() => clearInterval(timer));
  const Row = defineComponent({
    props: ["row"],
    setup(props) {
      return () =>
        h("TradeRow", {
          id: props.row.id,
          title: props.row.name,
          bid: props.row.bid,
          ask: props.row.ask,
          qty: props.row.qty,
          onSelect: () => {},
        });
    },
  });
  const View = defineComponent({
    setup() {
      return () => h("List", { searchable: false }, rows.value.map((r) => h(Row, { key: r.id, row: r })));
    },
  });
  return { views: { main: View } };
}
