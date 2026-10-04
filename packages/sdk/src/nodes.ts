export type Tone = "default" | "muted" | "positive" | "warning" | "danger" | "accent";

export type Icon = { skill: number } | { profession: Profession } | { glyph: string }; // host glyph name, e.g. "map", "copy", "trash"

export type Profession =
  | "warrior"
  | "ranger"
  | "monk"
  | "necromancer"
  | "mesmer"
  | "elementalist"
  | "assassin"
  | "ritualist"
  | "paragon"
  | "dervish";

export type Accessory = { text: string; tone?: Tone | undefined } | { icon: Icon; label: string };

export type Block =
  | { type: "text"; text: string; tone?: Tone | undefined }
  | { type: "skillbar"; skills: readonly number[]; elite?: number | undefined }
  | { type: "meta"; rows: readonly (readonly [label: string, value: string])[] };

export type Confirm = {
  title: string;
  message?: string | undefined;
  confirmLabel?: string | undefined;
};

export type Action = {
  id: string;
  title: string;
  icon?: Icon | undefined;
  shortcut?: string | undefined;
  style?: "default" | "destructive" | undefined;
  confirm?: Confirm | undefined;
} & ({ run: () => unknown } | { push: () => View } | { copy: string });

export type ListItem = {
  id: string;
  title: string;
  subtitle?: string | undefined;
  icon?: Icon | undefined;
  keywords?: readonly string[] | undefined;
  accessories?: readonly Accessory[] | undefined;
  preview?: readonly Block[] | undefined;
  actions: readonly Action[];
};

export type HubItem = ListItem & {
  scope?: string | undefined;
  aliases?: readonly string[] | undefined;
};

export type ListView = {
  type: "list";
  title: string;
  placeholder?: string | undefined;
  items: readonly ListItem[];
  filter?: "host" | "plugin" | undefined;
  onSearch?: (text: string) => void;
  loading?: boolean | undefined;
  empty?: { title: string; description?: string | undefined };
};

export type DetailView = {
  type: "detail";
  title: string;
  blocks: readonly Block[];
  actions: readonly Action[];
};

export type Field =
  | {
      type: "text";
      id: string;
      label: string;
      value?: string | undefined;
      placeholder?: string | undefined;
    }
  | {
      type: "select";
      id: string;
      label: string;
      value?: string | undefined;
      options: readonly { value: string; label: string }[];
    }
  | { type: "toggle"; id: string; label: string; value?: boolean | undefined };

export type FormView = {
  type: "form";
  title: string;
  fields: readonly Field[];
  submit: { title: string; run: (values: Record<string, string | boolean>) => unknown };
};

export type View = ListView | DetailView | FormView;

export type HudNode =
  | { type: "text"; text: string; tone?: Tone | undefined; size?: "s" | "m" | "l" | undefined }
  | { type: "row"; children: readonly HudNode[] };

// Factories: plain functions so authors get inference without JSX tooling.
export const List = (v: Omit<ListView, "type">): ListView => ({ type: "list", ...v });
export const Detail = (v: Omit<DetailView, "type">): DetailView => ({ type: "detail", ...v });
export const Form = (v: Omit<FormView, "type">): FormView => ({ type: "form", ...v });
export const Text = (text: string, tone?: Tone): Block & HudNode => ({ type: "text", text, tone });
export const SkillBar = (skills: readonly number[], elite?: number): Block => ({
  type: "skillbar",
  skills,
  elite,
});
export const Meta = (rows: readonly (readonly [string, string])[]): Block => ({
  type: "meta",
  rows,
});
export const HudText = (
  text: string,
  opts: { tone?: Tone | undefined; size?: "s" | "m" | "l" | undefined } = {},
): HudNode => ({ type: "text", text, ...opts });
