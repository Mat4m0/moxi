import { type } from "arktype";
import { appearanceFields, appearanceSettings, type AppearanceSettings } from "@moxi/contracts";
import { defineSettings } from "./settings";
import type { Database } from "./database";

export function createAppearanceSettings(db: Database, log?: (message: string) => void) {
  const settings = defineSettings(
    db,
    {
      uiStyle: { schema: appearanceFields.uiStyle, default: "classic" },
      uiPanelOpacity: { schema: appearanceFields.uiPanelOpacity, default: 94 },
      uiFont: { schema: appearanceFields.uiFont, default: "guild-wars" },
      uiCustomTheme: { schema: appearanceFields.uiCustomTheme.or(type("null")), default: null },
    },
    log ? { log } : {},
  );
  return {
    get(): AppearanceSettings {
      const { uiCustomTheme, ...values } = settings.all();
      return uiCustomTheme === null ? values : { ...values, uiCustomTheme };
    },
    set(input: AppearanceSettings) {
      const value = appearanceSettings.assert(input);
      db.exec("BEGIN IMMEDIATE");
      try {
        settings.set("uiStyle", value.uiStyle);
        settings.set("uiPanelOpacity", value.uiPanelOpacity);
        settings.set("uiFont", value.uiFont);
        settings.set("uiCustomTheme", value.uiCustomTheme ?? null);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
