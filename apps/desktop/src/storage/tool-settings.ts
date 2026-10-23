import { toolId } from "@moxi/contracts";
import { defineSettings } from "./settings";
import type { Database } from "./database";

// Every bundled plugin is on until the player switches it off, so only the off ones are stored.
export function createToolSettings(db: Database, log?: (message: string) => void) {
  const settings = defineSettings(
    db,
    { disabledTools: { schema: toolId.array(), default: [] } },
    log ? { log } : {},
  );
  return {
    disabled: (): string[] => settings.get("disabledTools"),
    set(id: string, enabled: boolean) {
      const others = settings.get("disabledTools").filter((disabled) => disabled !== id);
      settings.set("disabledTools", enabled ? others : [...others, id].sort());
    },
  };
}
