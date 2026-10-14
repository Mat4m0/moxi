function plugin(__moxi) {
  const { h, ref, computed, defineComponent } = __moxi.vue;
  const PROFS = ["Warrior", "Ranger", "Monk", "Necromancer", "Mesmer", "Elementalist", "Assassin", "Ritualist", "Paragon", "Dervish"];
  const ROLES = ["Farmer", "Tank", "Support", "Speed Clear", "Solo"];
  const builds = [];
  for (let i = 0; i < 200; i++) {
    const primary = PROFS[i % 10];
    const secondary = PROFS[(i * 7 + 3) % 10];
    const skills = [];
    for (let k = 0; k < 8; k++) skills.push("skill-" + ((i * 31 + k * 17) % 1400));
    builds.push({
      id: "build-" + i,
      name: primary + "/" + secondary + " " + ROLES[i % 5] + " #" + i,
      profession: primary + "/" + secondary,
      template: "OQ" + i + "AbCdEfGhIjKlMnOpQrStUvWx",
      preview: primary + "/" + secondary + ": " + skills.join(", "),
    });
  }
  const query = ref("");
  const selected = ref("");
  const filtered = computed(() => builds.filter((b) => b.name.indexOf(query.value) >= 0));
  const Row = defineComponent({
    props: ["build"],
    setup(props) {
      return () =>
        h(
          "ItemData",
          {
            id: props.build.id,
            title: props.build.name,
            subtitle: props.build.profession,
            onSelect: () => {
              selected.value = props.build.id;
            },
          },
          [h("Preview", { kind: "build" }, props.build.preview)],
        );
    },
  });
  const View = defineComponent({
    setup() {
      return () =>
        h(
          "List",
          {
            searchable: true,
            onSearch: (text) => {
              query.value = text;
            },
          },
          filtered.value.map((b) => h(Row, { key: b.id, build: b })),
        );
    },
  });
  return { views: { main: View } };
}
