import type { Type } from "arktype";
import type { Database } from "./database";

export function defineSettings<S extends Record<string, Type<unknown>>>(
  db: Database,
  definitions: {
    [K in keyof S]: { schema: S[K]; default: NoInfer<S[K]["infer"]> };
  },
  { log = console.warn }: { log?: (message: string) => void } = {},
) {
  const reported = new Set<keyof S>();
  const select = db.prepare("SELECT json FROM settings WHERE key = ?");
  const save = db.prepare(
    "INSERT INTO settings (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json",
  );
  function get<K extends keyof S & string>(key: K): S[K]["infer"];
  function get(key: keyof S & string): unknown {
    const definition = definitions[key];
    if (!definition) throw new Error("Unknown setting.");
    const fallback = definition.schema.assert(structuredClone(definition.default));
    const row = select.get(key);
    if (!row) return fallback;
    try {
      if (typeof row.json !== "string") throw new Error("Invalid setting JSON.");
      const parsed: unknown = JSON.parse(row.json);
      return definition.schema.assert(parsed);
    } catch {
      if (!reported.has(key)) {
        reported.add(key);
        log(`Invalid stored setting ${JSON.stringify(key)}; using default.`);
      }
      return fallback;
    }
  }
  function all(): { [K in keyof S]: S[K]["infer"] };
  function all(): unknown {
    return Object.fromEntries(Object.keys(definitions).map((key) => [key, get(key)]));
  }
  return {
    get,
    set<K extends keyof S & string>(key: K, value: S[K]["infer"]) {
      const definition = definitions[key];
      if (!definition) throw new Error("Unknown setting.");
      definition.schema.assert(value);
      const json = JSON.stringify(value);
      if (json === undefined) throw new Error("Setting must be JSON serializable.");
      save.run(key, json);
      reported.delete(key);
    },
    all,
  };
}
