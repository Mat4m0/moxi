import {
  definePlugin,
  List,
  Form,
  Detail,
  SkillBar,
  Meta,
  Text,
  type HubItem,
  type Profession,
} from "@moxi/sdk";

type Build = {
  id: string;
  name: string;
  profession: Profession;
  code: string;
  skills: number[];
  elite: number;
  tags: string[];
};

const SAMPLE: Build[] = [
  {
    id: "b1",
    name: "Smiter",
    profession: "monk",
    code: "OwcT0YH4R3bAAAAAAAAA",
    skills: [240, 241, 242, 243, 244, 245, 246, 247],
    elite: 240,
    tags: ["pve", "hero"],
  },
  {
    id: "b2",
    name: "Discordway",
    profession: "necromancer",
    code: "OAhjQoGYIP3hhWVVaO5EBAA",
    skills: [1, 2, 3, 4, 5, 6, 7, 8],
    elite: 1,
    tags: ["hero", "team"],
  },
  {
    id: "b3",
    name: "Panic Mesmer",
    profession: "mesmer",
    code: "OQBDApwTOhwcgM4mmBaCeAUA",
    skills: [11, 12, 13, 14, 15, 16, 17, 18],
    elite: 11,
    tags: ["hero"],
  },
  {
    id: "b4",
    name: "Imbagon",
    profession: "paragon",
    code: "OQGkUhmDjkcC5BXYcV1ChYPHAAA",
    skills: [21, 22, 23, 24, 25, 26, 27, 28],
    elite: 21,
    tags: ["pve"],
  },
  {
    id: "b5",
    name: "Smite Ranger",
    profession: "ranger",
    code: "OgcTc5+8ZiHRn5AqAAAAAAA",
    skills: [31, 32, 33, 34, 35, 36, 37, 38],
    elite: 31,
    tags: ["pvp"],
  },
];

const NAMES: Record<Profession, string> = {
  warrior: "Warrior",
  ranger: "Ranger",
  monk: "Monk",
  necromancer: "Necromancer",
  mesmer: "Mesmer",
  elementalist: "Elementalist",
  assassin: "Assassin",
  ritualist: "Ritualist",
  paragon: "Paragon",
  dervish: "Dervish",
};

function profession(value: string | boolean | undefined): Profession {
  switch (value) {
    case "warrior":
    case "ranger":
    case "monk":
    case "necromancer":
    case "mesmer":
    case "elementalist":
    case "assassin":
    case "ritualist":
    case "paragon":
    case "dervish":
      return value;
    default:
      throw new Error("Unknown profession");
  }
}

export default definePlugin(({ game, hub, commands, storage, ui }) => {
  const library = storage.doc<Build[]>("library", () => SAMPLE);

  async function apply(build: Build) {
    const result = await game.loadBuild({ code: build.code });
    if (result.status === "done") ui.toast({ title: `${build.name} loaded`, tone: "positive" });
    else
      ui.toast({ title: `${build.name} was not loaded`, message: result.message, tone: "danger" });
  }

  const remove = (id: string) => library.set(library.value().filter((b) => b.id !== id));

  const item = (b: Build): HubItem => ({
    id: b.id,
    title: b.name,
    subtitle: NAMES[b.profession],
    icon: { profession: b.profession },
    scope: "build",
    keywords: [NAMES[b.profession], ...b.tags],
    accessories: b.tags.map((text) => ({ text, tone: "muted" as const })),
    preview: [
      SkillBar(b.skills, b.elite),
      Meta([
        ["Profession", NAMES[b.profession]],
        ["Template", b.code],
      ]),
    ],
    actions: [
      { id: "apply", title: "Load on my character", run: () => apply(b) },
      { id: "details", title: "Show details", shortcut: "mod+i", push: () => details(b.id) },
      { id: "copy", title: "Copy template code", shortcut: "mod+c", copy: b.code },
      {
        id: "delete",
        title: "Delete build",
        style: "destructive",
        shortcut: "mod+backspace",
        confirm: {
          title: `Delete ${b.name}?`,
          message: "The template code is removed from your library.",
          confirmLabel: "Delete",
        },
        run: () => remove(b.id),
      },
    ],
  });

  // A pushed view is reactive too: deleting the build from another window updates it.
  const details = (id: string) => {
    const b = library.value().find((x) => x.id === id);
    if (!b)
      return Detail({
        title: "Build removed",
        blocks: [Text("This build no longer exists.", "muted")],
        actions: [],
      });
    return Detail({
      title: b.name,
      blocks: [
        SkillBar(b.skills, b.elite),
        Meta([
          ["Profession", NAMES[b.profession]],
          ["Template", b.code],
          ["Tags", b.tags.join(", ")],
        ]),
      ],
      actions: item(b).actions.filter((a) => a.id !== "details"),
    });
  };

  hub.items(() => library.value().map(item));

  commands.view("library", () =>
    List({
      title: "Build Library",
      placeholder: "Search builds…",
      items: library.value().map(item),
      empty: { title: "No builds yet", description: "Use New Build to save a template code." },
    }),
  );

  commands.view("new", () =>
    Form({
      title: "New Build",
      fields: [
        { type: "text", id: "name", label: "Name", placeholder: "Smiter" },
        {
          type: "select",
          id: "profession",
          label: "Profession",
          value: "monk",
          options: Object.entries(NAMES).map(([value, label]) => ({ value, label })),
        },
        { type: "text", id: "code", label: "Template code", placeholder: "OwcT0YH4R3bA…" },
      ],
      submit: {
        title: "Save Build",
        run: async (v) => {
          const name = String(v.name ?? "").trim();
          const code = String(v.code ?? "").trim();
          if (!name || !code)
            return ui.toast({ title: "Name and template code are required", tone: "danger" });
          const build: Build = {
            id: crypto.randomUUID(),
            name,
            code,
            profession: profession(v.profession),
            skills: [0, 0, 0, 0, 0, 0, 0, 0],
            elite: 0,
            tags: [],
          };
          await library.set([...library.value(), build]);
          ui.toast({ title: `${name} saved`, tone: "positive" });
        },
      },
    }),
  );
});
