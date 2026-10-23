import { type } from "arktype";
import { savedWindow, type SavedWindow, type SavedWindowKind } from "../window-state";
import { defineSettings } from "./settings";
import type { Database } from "./database";

export function createWindowStateSettings(db: Database, log?: (message: string) => void) {
  const nullable = savedWindow.or(type("null"));
  const settings = defineSettings(
    db,
    {
      launcherWindow: { schema: nullable, default: null },
      gameWindow: { schema: nullable, default: null },
    },
    log ? { log } : {},
  );
  const key = (kind: SavedWindowKind) => (kind === "launcher" ? "launcherWindow" : "gameWindow");
  return {
    get: (kind: SavedWindowKind): SavedWindow | null => settings.get(key(kind)),
    set: (kind: SavedWindowKind, value: SavedWindow) => settings.set(key(kind), value),
  };
}
