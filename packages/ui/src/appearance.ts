import { accessibleForeground, compositeColor } from "./color";

export type UiColor = `#${string}`;
export type UiFont = "guild-wars" | "inter" | "system" | "avenir" | "georgia" | "palatino";
export interface AppearanceSettings {
  uiStyle: "classic" | "obsidian";
  uiPanelOpacity: number;
  uiFont: UiFont;
}
// The surfaces the panel text must stay readable on; the rest of each look lives in tokens.css.
const palettes: Record<AppearanceSettings["uiStyle"], Record<string, UiColor>> = {
  classic: {
    window: "#0B0B0B",
    titlebar: "#292927",
    surface: "#202225",
    recessed: "#080807",
    mutedText: "#B7B09F",
  },
  obsidian: {
    window: "#1B1A18",
    titlebar: "#22211F",
    surface: "#2B2926",
    recessed: "#11100F",
    mutedText: "#BDB5A8",
  },
};
export function appearanceVariables(
  settings: AppearanceSettings,
): Readonly<Record<string, string>> {
  const palette = palettes[settings.uiStyle];
  const opacity = settings.uiPanelOpacity / 100;
  const variables: Record<string, string> = { "--ui-panel-opacity": String(opacity) };
  // The panel is translucent over a game that can be bright or dark, so muted text is raised
  // until it is readable over both.
  const backgrounds = [
    compositeColor(palette.window!, "#FFFFFF", opacity),
    compositeColor(palette.window!, "#000000", opacity),
    palette.titlebar!,
    palette.surface!,
    palette.recessed!,
  ];
  const muted = accessibleForeground(palette.mutedText!, backgrounds);
  if (muted !== palette.mutedText) {
    variables["--ui-text-muted"] = muted;
    variables["--ui-text-faint"] = muted;
  }
  return variables;
}

const applied = new WeakMap<HTMLElement, string[]>();
// Applies settings to a document root, replacing whatever an earlier call set.
export function applyAppearance(root: HTMLElement, settings: AppearanceSettings) {
  for (const key of applied.get(root) ?? []) root.style.removeProperty(key);
  const variables = appearanceVariables(settings);
  applied.set(root, Object.keys(variables));
  for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value);
  root.dataset.uiStyle = settings.uiStyle;
  root.dataset.uiFont = settings.uiFont;
}
