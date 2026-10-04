import { accessibleForeground, compositeColor, parseRgb, readableForeground } from "./color";

export type UiColor = `#${string}`;
export type UiFont = "guild-wars" | "inter" | "system" | "avenir" | "georgia" | "palatino";
export interface CustomUiTheme {
  material: "classic" | "modern";
  window: UiColor;
  titlebar: UiColor;
  surface: UiColor;
  recessed: UiColor;
  selected: UiColor;
  accent: UiColor;
  text: UiColor;
  mutedText: UiColor;
  border: UiColor;
  windowGradient: boolean;
}
export interface AppearanceSettings {
  uiStyle: "classic" | "obsidian" | "custom";
  uiPanelOpacity: number;
  uiFont: UiFont;
  uiCustomTheme?: CustomUiTheme;
}
const palettes: Record<CustomUiTheme["material"], Readonly<CustomUiTheme>> = {
  classic: {
    material: "classic",
    window: "#0B0B0B",
    titlebar: "#292927",
    surface: "#202225",
    recessed: "#080807",
    selected: "#1B3554",
    accent: "#E6C882",
    text: "#F1EBDD",
    mutedText: "#B7B09F",
    border: "#D8D2BF",
    windowGradient: true,
  },
  modern: {
    material: "modern",
    window: "#1B1A18",
    titlebar: "#22211F",
    surface: "#2B2926",
    recessed: "#11100F",
    selected: "#3C3832",
    accent: "#D5B86E",
    text: "#F4EFE5",
    mutedText: "#BDB5A8",
    border: "#5F5A52",
    windowGradient: false,
  },
};
export function defaultCustomUiTheme(material: CustomUiTheme["material"]): Readonly<CustomUiTheme> {
  return Object.freeze(palettes[material]);
}
export function appearanceVariables(
  settings: AppearanceSettings,
): Readonly<Record<string, string>> {
  const theme =
    settings.uiStyle === "custom"
      ? (settings.uiCustomTheme ?? palettes.classic)
      : palettes[settings.uiStyle === "obsidian" ? "modern" : "classic"];
  const base = palettes[theme.material];
  const opacity = settings.uiPanelOpacity / 100;
  const variables: Record<string, string> = { "--ui-panel-opacity": String(opacity) };
  const backgrounds = [
    compositeColor(theme.window, "#FFFFFF", opacity),
    compositeColor(theme.window, "#000000", opacity),
    theme.titlebar,
    theme.surface,
    theme.recessed,
  ];
  const text = accessibleForeground(theme.text, backgrounds);
  const muted = accessibleForeground(theme.mutedText, backgrounds);
  if (muted !== theme.mutedText) {
    variables["--ui-text-muted"] = muted;
    variables["--ui-text-faint"] = muted;
  }
  if (settings.uiStyle !== "custom") return variables;
  if (theme.window !== base.window)
    variables["--ui-panel-fill"] =
      `rgb(${parseRgb(theme.window).join(" ")} / var(--ui-effective-panel-opacity))`;
  if (theme.titlebar !== base.titlebar || theme.windowGradient !== base.windowGradient) {
    const fill = theme.windowGradient
      ? `linear-gradient(180deg, color-mix(in srgb, ${theme.titlebar} 92%, ${theme.border}), ${theme.titlebar} 38%, color-mix(in srgb, ${theme.titlebar} 78%, ${theme.recessed}))`
      : `linear-gradient(${theme.titlebar}, ${theme.titlebar})`;
    variables["--ui-title-fill"] = fill;
    if (theme.material === "classic") variables["--ui-art-head-fill"] = fill;
  }
  if (theme.surface !== base.surface) {
    const fill =
      theme.material === "modern"
        ? `linear-gradient(${theme.surface}, ${theme.surface})`
        : `linear-gradient(color-mix(in srgb, ${theme.surface} 78%, ${theme.border}), ${theme.surface} 22%, color-mix(in srgb, ${theme.surface} 86%, ${theme.recessed}))`;
    variables["--ui-raised-fill"] = fill;
    variables["--ui-command-fill"] = fill;
  }
  if (theme.recessed !== base.recessed) {
    for (const key of [
      "--ui-well",
      "--ui-focus-halo",
      "--ui-scroll-track-color",
      "--ui-scroll-track",
    ])
      variables[key] = theme.recessed;
    variables["--ui-well-fill"] = `color-mix(in srgb, ${theme.recessed} 88%, transparent)`;
    variables["--ui-pressed-layer"] = `color-mix(in srgb, ${theme.recessed} 28%, transparent)`;
  }
  if (theme.selected !== base.selected) {
    variables["--ui-selection-fill"] =
      `linear-gradient(color-mix(in srgb, ${theme.selected} 84%, transparent), color-mix(in srgb, ${theme.selected} 70%, ${theme.recessed}))`;
    variables["--ui-selection-hover-fill"] =
      `linear-gradient(color-mix(in srgb, ${theme.selected} 88%, ${text}), color-mix(in srgb, ${theme.selected} 82%, ${theme.recessed}))`;
    variables["--ui-selection-ink"] = readableForeground(theme.selected);
    variables["--ui-scroll-thumb-color"] =
      `color-mix(in srgb, ${theme.selected} 76%, ${theme.border})`;
    variables["--ui-scroll-thumb"] = "var(--ui-scroll-thumb-color)";
    variables["--ui-accent-fill"] = `linear-gradient(${theme.selected}, ${theme.selected})`;
  }
  if (theme.accent !== base.accent) {
    const ink = readableForeground(theme.accent);
    for (const key of ["--ui-accent", "--ui-focus", "--ui-selection-marker"])
      variables[key] = theme.accent;
    for (const key of ["--ui-accent-ink", "--ui-primary-ink"]) variables[key] = ink;
    for (const key of ["--ui-primary-fill", "--ui-ring-gold"])
      variables[key] = `linear-gradient(${theme.accent}, ${theme.accent})`;
    variables["--ui-accent-hover"] = `color-mix(in srgb, ${theme.accent} 82%, ${text})`;
    variables["--ui-accent-strong"] = `color-mix(in srgb, ${theme.accent} 70%, ${theme.window})`;
  }
  if (theme.text !== base.text || text !== theme.text) {
    for (const key of ["--ui-text", "--ui-text-bright", "--ui-display-text"]) variables[key] = text;
  }
  if (theme.mutedText !== base.mutedText || muted !== theme.mutedText) {
    variables["--ui-text-muted"] = muted;
    variables["--ui-text-faint"] = muted;
  }
  if (theme.border !== base.border) {
    variables["--ui-control-mark"] = theme.border;
    variables["--ui-line"] = `color-mix(in srgb, ${theme.border} 62%, ${theme.window})`;
    for (const [key, amount] of [
      ["--ui-line-soft", 22],
      ["--ui-edge", 38],
      ["--ui-edge-strong", 72],
      ["--ui-edge-inner", 14],
    ] as const)
      variables[key] = `color-mix(in srgb, ${theme.border} ${amount}%, transparent)`;
    variables["--ui-frame"] =
      theme.material === "modern"
        ? `linear-gradient(${theme.border}, ${theme.border})`
        : `linear-gradient(180deg, color-mix(in srgb, ${theme.border} 94%, white), ${theme.border} 48%, color-mix(in srgb, ${theme.border} 48%, black))`;
    variables["--ui-frame-top"] = theme.border;
    variables["--ui-ring-gilt"] =
      theme.material === "modern"
        ? `linear-gradient(${theme.border}, ${theme.border})`
        : `linear-gradient(180deg, color-mix(in srgb, ${theme.border} 82%, white), color-mix(in srgb, ${theme.border} 42%, black))`;
    for (const key of ["--ui-ring-quiet", "--ui-ring-empty"])
      variables[key] = "linear-gradient(var(--ui-edge), var(--ui-edge))";
    variables["--ui-ring-mark"] = "linear-gradient(var(--ui-edge-strong), var(--ui-edge-strong))";
  }
  return variables;
}
