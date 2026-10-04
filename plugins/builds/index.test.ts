import { describe, expect, test } from "vite-plus/test";
import { parseManifest } from "@moxi/sdk/host";
import { createTestHost } from "@moxi/sdk/testing";
import plugin from "./index.ts";
import manifest from "./plugin.json";

describe("builds", () => {
  test("offers saved builds to Hub search, scoped to 'build'", async () => {
    const host = await createTestHost(manifest, plugin);
    expect(host.state.items.find((i) => i.title === "Smiter")).toMatchObject({
      scope: "build",
      subtitle: "Monk",
      actions: [
        { id: "apply", kind: "run" },
        { id: "details", kind: "push" },
        { id: "copy", kind: "copy" },
        { id: "delete", style: "destructive" },
      ],
    });
  });

  test("loading a build is one game action, started by the player's choice", async () => {
    const host = await createTestHost(manifest, plugin);
    await host.choose("items", "b1", "apply");
    expect(host.state.actions).toEqual([
      { op: "game.loadBuild", args: { code: "OwcT0YH4R3bAAAAAAAAA" }, activated: true },
    ]);
    expect(host.state.toasts).toEqual([{ title: "Smiter loaded", tone: "positive" }]);
  });

  test("a refused load is reported, not claimed as done", async () => {
    const host = await createTestHost(manifest, plugin, {
      actionResult: {
        status: "refused",
        reason: "restricted-area",
        message: "Builds can only be loaded in an outpost.",
      },
    });
    await host.choose("items", "b1", "apply");
    expect(host.state.toasts).toEqual([
      {
        title: "Smiter was not loaded",
        message: "Builds can only be loaded in an outpost.",
        tone: "danger",
      },
    ]);
  });

  test("deleting a build removes it from search and from an open library view", async () => {
    const host = await createTestHost(manifest, plugin);
    const library = await host.command("library");
    if (!library) throw new Error("Expected the library view");
    await host.choose(library.viewId, "b1", "delete");
    const titles = (v: { title: string }[]) => v.map((i) => i.title);
    expect(titles(host.state.items)).toEqual([
      "Discordway",
      "Panic Mesmer",
      "Imbagon",
      "Smite Ranger",
    ]);
    const view = host.state.views[library.viewId];
    if (!view || view.type !== "list") throw new Error("Expected the library list");
    expect(titles(view.items)).toEqual(["Discordway", "Panic Mesmer", "Imbagon", "Smite Ranger"]);
  });
});

test("accepts the bundled manifest without author casts", () => {
  expect(parseManifest(manifest)).toEqual(manifest);
});
