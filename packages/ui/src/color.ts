import type { UiColor } from "./appearance";

function parseRgb(color: UiColor): readonly [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}
function luminance(color: UiColor): number {
  const [r, g, b] = parseRgb(color).map((channel) => {
    const linear = channel / 255;
    return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrastRatio(a: UiColor, b: UiColor): number {
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
export function compositeColor(foreground: UiColor, background: UiColor, opacity: number): UiColor {
  const target = parseRgb(foreground);
  const hex = parseRgb(background)
    .map((channel, index) =>
      Math.round(channel + (target[index]! - channel) * opacity)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();
  return `#${hex}`;
}
function readableSharedForeground(backgrounds: readonly UiColor[]): UiColor {
  let best: UiColor = "#F7F3E8";
  let score = 0;
  for (let channel = 0; channel <= 255; channel++) {
    const hex = channel.toString(16).padStart(2, "0").toUpperCase();
    const candidate: UiColor = `#${hex}${hex}${hex}`;
    const minimum = Math.min(
      ...backgrounds.map((background) => contrastRatio(background, candidate)),
    );
    if (minimum > score) {
      best = candidate;
      score = minimum;
    }
  }
  return best;
}
export function accessibleForeground(
  preferred: UiColor,
  backgrounds: readonly UiColor[],
  minimum = 4.5,
): UiColor {
  const readable = (ink: UiColor) =>
    backgrounds.every((background) => contrastRatio(background, ink) >= minimum);
  if (readable(preferred)) return preferred;
  for (let step = 1; step <= 255; step++) {
    for (const target of ["#F7F3E8", "#171613"] as const) {
      const candidate = compositeColor(target, preferred, step / 255);
      if (readable(candidate)) return candidate;
    }
  }
  return readableSharedForeground(backgrounds);
}
