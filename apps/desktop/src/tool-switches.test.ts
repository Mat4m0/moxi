import { expect, test } from "vite-plus/test";
import { createTools } from "./tool-switches";

const bundles = async () => [
  { manifest: { id: "moxi.builds", name: "Builds", description: "Save builds", version: "1.0.0" } },
  { manifest: { id: "moxi.calculator", name: "Calculator", description: "Do sums" } },
];
function memoryStore() {
  const off = new Set<string>();
  return {
    disabled: () => [...off],
    set: (id: string, enabled: boolean) => (enabled ? off.delete(id) : off.add(id)),
  };
}

test("every bundled plugin is on until the player switches it off", async () => {
  const tools = createTools({ bundles, store: memoryStore() });
  expect(await tools.list()).toEqual([
    { id: "moxi.builds", name: "Builds", description: "Save builds", enabled: true },
    { id: "moxi.calculator", name: "Calculator", description: "Do sums", enabled: true },
  ]);
});

test("switching a plugin off and on returns the new list each time", async () => {
  const tools = createTools({ bundles, store: memoryStore() });
  expect((await tools.set("moxi.calculator", false)).map((tool) => tool.enabled)).toEqual([
    true,
    false,
  ]);
  expect((await tools.set("moxi.calculator", true)).map((tool) => tool.enabled)).toEqual([
    true,
    true,
  ]);
});

test("a plugin id that is not bundled is refused and saves nothing", async () => {
  const store = memoryStore();
  const tools = createTools({ bundles, store });
  await expect(tools.set("moxi.unknown", false)).rejects.toThrow("Unknown tool.");
  expect(store.disabled()).toEqual([]);
});

test("a bundle with a manifest that has no name is a startup error, not a blank switch", async () => {
  const tools = createTools({
    bundles: async () => [{ manifest: { id: "moxi.broken" } }],
    store: memoryStore(),
  });
  await expect(tools.list()).rejects.toThrow();
});
