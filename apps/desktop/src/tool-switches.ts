import { toolId, type Tool } from "@moxi/contracts";
import { type } from "arktype";

const bundleInfo = type({ id: toolId, name: "string", description: "string" });

/** The bundled plugins the player can switch on and off, and which of them are on. */
export function createTools({
  bundles,
  store,
}: {
  bundles: () => Promise<readonly { manifest: unknown }[]>;
  store: { disabled(): string[]; set(id: string, enabled: boolean): void };
}) {
  let known: Promise<{ id: string; name: string; description: string }[]> | undefined;
  async function list(): Promise<Tool[]> {
    known ??= bundles().then((entries) =>
      entries.map(({ manifest }) => bundleInfo.assert(manifest)),
    );
    const off = new Set(store.disabled());
    return (await known).map(({ id, name, description }) => ({
      id,
      name,
      description,
      enabled: !off.has(id),
    }));
  }
  return {
    list,
    /** Saves the switch and returns the new list. An id that is not a bundled plugin is refused. */
    async set(id: string, enabled: boolean): Promise<Tool[]> {
      if (!(await list()).some((tool) => tool.id === id)) throw new Error("Unknown tool.");
      store.set(id, enabled);
      return list();
    },
  };
}
