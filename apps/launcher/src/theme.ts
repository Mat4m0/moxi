import type { CustomUiTheme, UiColor } from "@moxi/ui";

export function themeText(theme: CustomUiTheme): string {
  return [
    "gwonmac-theme-v1",
    theme.material,
    theme.window,
    theme.titlebar,
    theme.surface,
    theme.recessed,
    theme.selected,
    theme.accent,
    theme.text,
    theme.mutedText,
    theme.border,
    theme.windowGradient ? "1" : "0",
  ]
    .map((value) => (value.startsWith("#") ? value.toUpperCase() : value))
    .join(":");
}
export function themeFromText(text: string): CustomUiTheme | null {
  const [prefix, material, ...fields] = text.trim().split(":");
  if (
    prefix !== "gwonmac-theme-v1" ||
    (material !== "classic" && material !== "modern") ||
    fields.length !== 10
  )
    return null;
  const gradient = fields[9];
  if (gradient !== "0" && gradient !== "1") return null;
  const [window, titlebar, surface, recessed, selected, accent, ink, mutedText, border] = fields
    .slice(0, 9)
    .map(color);
  if (
    !window ||
    !titlebar ||
    !surface ||
    !recessed ||
    !selected ||
    !accent ||
    !ink ||
    !mutedText ||
    !border
  )
    return null;
  return {
    material,
    window,
    titlebar,
    surface,
    recessed,
    selected,
    accent,
    text: ink,
    mutedText,
    border,
    windowGradient: gradient === "1",
  };
}
function color(value: string): UiColor | null {
  return /^#[0-9a-f]{6}$/iu.test(value) ? `#${value.slice(1).toUpperCase()}` : null;
}
