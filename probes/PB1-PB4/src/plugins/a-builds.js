function plugin(__moxi) {
  const { h, ref, computed, defineComponent } = __moxi.vue;
  const PROFS = ["Warrior", "Ranger", "Monk", "Necromancer", "Mesmer", "Elementalist", "Assassin", "Ritualist", "Paragon", "Dervish"];
  const ROLES = ["Farmer", "Tank", "Support", "Speed Clear", "Solo"];
  const builds = [];
  for (let i = 0; i < 200; i++) {
    const primary = PROFS[i % 10];
    const secondary = PROFS[(i * 7 + 3) % 10];
    const skills = [];
    for (let k = 0; k < 8; k++) skills.push((i * 31 + k * 17) % 1400);
    builds.push({
      id: "build-" + i,
      name: primary + "/" + secondary + " " + ROLES[i % 5] + " #" + i,
      profession: i % 10,
      subtitle: primary + "/" + secondary,
      template: "OQ" + i + "AbCdEfGhIjKlMnOpQrStUvWx",
      skills,
      attributes: "Strength " + (8 + (i % 5)) + ", Tactics " + (6 + (i % 7)) + ", Swordsmanship " + (9 + (i % 4)),
    });
  }
  const query = ref("");
  const selected = ref("");
  const rows = computed(() =>
    builds
      .filter((b) => b.name.indexOf(query.value) >= 0)
      .map((b) => ({
        id: b.id,
        title: b.name,
        subtitle: b.subtitle,
        icon: { profession: b.profession },
        keywords: [b.subtitle, b.template],
        accessories: [{ text: String(b.skills.length) + " skills" }],
        preview: [
          { type: "text", text: b.subtitle + " " + b.template },
          { type: "skillbar", skills: b.skills },
          { type: "keyvalue", pairs: [["Attributes", b.attributes], ["Template", b.template]] },
        ],
        actions: [
          { title: "Apply build", run: () => { selected.value = b.id; } },
          { title: "Copy template", copy: b.template },
        ],
      })),
  );
  const View = defineComponent({
    setup() {
      return () =>
        h("List", {
          searchable: true,
          items: rows.value,
          onSearch: (text) => {
            query.value = text;
          },
        });
    },
  });
  return { views: { main: View } };
}
