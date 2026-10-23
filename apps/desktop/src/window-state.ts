import { type } from "arktype";

export type Rect = { x: number; y: number; width: number; height: number };
export type SavedWindowKind = "launcher" | "game";

// Normal (not full screen, not maximized) bounds plus how the window was last left.
export const savedWindow = type({
  x: "number.integer",
  y: "number.integer",
  width: "number.integer > 0",
  height: "number.integer > 0",
  fullscreen: "boolean",
  maximized: "boolean",
});
export type SavedWindow = typeof savedWindow.infer;

export type WindowPlan = {
  bounds: { x?: number; y?: number; width: number; height: number };
  fullscreen: boolean;
  maximized: boolean;
};

const MIN = { width: 640, height: 480 };
const DEFAULT = { width: 960, height: 640 };
// Enough of the window on a display to still grab its title bar.
const REACHABLE = { width: 100, height: 50 };

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

function overlap(a: Rect, b: Rect) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

function fitSize(area: Rect | undefined, size: { width: number; height: number }) {
  if (!area) return size;
  return {
    width: clamp(size.width, Math.min(MIN.width, area.width), area.width),
    height: clamp(size.height, Math.min(MIN.height, area.height), area.height),
  };
}

/**
 * Where a window opens. `displays` are the work areas, the primary display first. A first
 * launch opens the launcher and the game maximized; a saved window that no
 * display shows any more loses its position and keeps its size.
 */
export function planWindow(
  kind: SavedWindowKind,
  saved: SavedWindow | null,
  displays: readonly Rect[],
): WindowPlan {
  if (!saved) {
    return {
      bounds: fitSize(displays[0], DEFAULT),
      fullscreen: false,
      maximized: true,
    };
  }
  const state = { fullscreen: saved.fullscreen, maximized: saved.maximized };
  let best: Rect | undefined;
  let bestArea = 0;
  for (const display of displays) {
    const shared = overlap(saved, display);
    if (shared.width < REACHABLE.width || shared.height < REACHABLE.height) continue;
    if (shared.width * shared.height > bestArea) {
      best = display;
      bestArea = shared.width * shared.height;
    }
  }
  if (!best) return { bounds: fitSize(displays[0], saved), ...state };
  const size = fitSize(best, saved);
  return {
    bounds: {
      x: clamp(saved.x, best.x, best.x + best.width - size.width),
      y: clamp(saved.y, best.y, best.y + best.height - size.height),
      ...size,
    },
    ...state,
  };
}

/** The state to save: always the normal bounds, so leaving full screen restores the old size. */
export function captureWindow(input: {
  normalBounds: Rect;
  fullscreen: boolean;
  maximized: boolean;
}): SavedWindow {
  const { normalBounds } = input;
  return {
    x: Math.round(normalBounds.x),
    y: Math.round(normalBounds.y),
    width: Math.max(1, Math.round(normalBounds.width)),
    height: Math.max(1, Math.round(normalBounds.height)),
    fullscreen: input.fullscreen,
    maximized: input.maximized,
  };
}
