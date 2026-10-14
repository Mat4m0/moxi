function plugin(__moxi) {
  const { h, ref, defineComponent } = __moxi.vue;
  const range = ref(1200);
  let tick = 0;
  const timer = setInterval(() => {
    tick++;
    range.value = 1200 + ((tick * 37) % 900);
  }, 100);
  __moxi.onClose(() => clearInterval(timer));
  const Hud = defineComponent({
    setup() {
      return () =>
        h(
          "HudText",
          { icon: "target", tone: range.value > 1800 ? "warn" : "normal" },
          "Target " + (range.value / 10).toFixed(1) + " e",
        );
    },
  });
  return { views: { hud: Hud } };
}
