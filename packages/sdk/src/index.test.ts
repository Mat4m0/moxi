import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { createTestHost } from "@moxi/sdk/testing";
import { definePlugin, List, Text, type Manifest } from "@moxi/sdk";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

const manifest: Manifest = {
  id: "moxi.test",
  name: "SDK test",
  version: "1.0.0",
  api: 1,
  description: "Exercises the plugin contract",
  permissions: ["game.player", "game.travel"],
  activation: ["hub"],
  commands: [{ id: "open", title: "Open" }],
};

describe("SDK runtime", () => {
  test("a late initial document read cannot overwrite an edit through another document handle", async () => {
    const host = await settle(
      createTestHost(
        manifest,
        definePlugin(({ storage, hud }) => {
          const displayed = storage.doc("value", () => "Initial");
          const edited = storage.doc("value", () => "Ignored");
          hud.widget("value", () => Text(displayed.value()));
          queueMicrotask(() => void edited.set("Edited"));
        }),
        { documents: { value: "Stored" }, documentReadDelay: 1000 },
      ),
    );
    expect(host.state.hud.value).toEqual({ type: "text", text: "Edited", tone: undefined });
  });

  test("game actions without a player choice are refused", async () => {
    const host = await settle(
      createTestHost(
        manifest,
        definePlugin(async ({ game, ui }) => {
          const result = await game.travel({ mapId: 1 });
          ui.toast({ title: result.status });
        }),
      ),
    );
    expect(host.state.actions).toEqual([
      { op: "game.travel", args: { mapId: 1 }, activated: false },
    ]);
    expect(host.state.toasts).toEqual([{ title: "refused" }]);
  });

  test("one player choice cannot activate a second game action", async () => {
    const host = await settle(
      createTestHost(
        manifest,
        definePlugin(({ game, commands, ui }) => {
          commands.action("open", async () => {
            await game.travel({ mapId: 1 });
            const result = await game.travel({ mapId: 2 });
            ui.toast({ title: result.status });
          });
        }),
      ),
    );
    await settle(host.command("open"));
    expect(host.state.actions).toEqual([
      { op: "game.travel", args: { mapId: 1 }, activated: true },
      { op: "game.travel", args: { mapId: 2 }, activated: false },
    ]);
    expect(host.state.toasts).toEqual([{ title: "refused" }]);
  });

  test("an action on a vanished item cannot run its old callback", async () => {
    const host = await settle(
      createTestHost(
        manifest,
        definePlugin(({ hub, storage, ui }) => {
          const visible = storage.doc("visible", () => true);
          hub.items(() =>
            visible.value()
              ? [
                  {
                    id: "item",
                    title: "Item",
                    actions: [
                      { id: "remove", title: "Remove", run: () => visible.set(false) },
                      { id: "run", title: "Run", run: () => ui.toast({ title: "Old callback" }) },
                    ],
                  },
                ]
              : [],
          );
        }),
      ),
    );
    await settle(host.choose("items", "item", "remove"));
    await settle(host.choose("items", "item", "run"));
    expect(host.state.items).toEqual([]);
    expect(host.state.toasts).toEqual([]);
    expect(host.state.errors).toEqual(["stale action item/run: the item changed or vanished"]);
  });

  test("a throwing render retains the previous view and reports the error", async () => {
    const host = await settle(
      createTestHost(
        manifest,
        definePlugin(({ commands, storage }) => {
          const broken = storage.doc("broken", () => false);
          commands.view("open", () => {
            if (broken.value()) throw new Error("Cannot render");
            return List({
              title: "Working",
              items: [
                {
                  id: "item",
                  title: "Item",
                  actions: [{ id: "break", title: "Break", run: () => broken.set(true) }],
                },
              ],
            });
          });
        }),
      ),
    );
    const opened = await settle(host.command("open"));
    if (!opened) throw new Error("Expected a view");
    await settle(host.choose(opened.viewId, "item", "break"));
    expect(host.state.views[opened.viewId]).toMatchObject({ type: "list", title: "Working" });
    expect(host.state.errors).toEqual(["Cannot render"]);
  });

  test("documents with the same name share updates across registered surfaces", async () => {
    const host = await settle(
      createTestHost(
        manifest,
        definePlugin(({ storage, commands, hud }) => {
          const first = storage.doc("value", () => "Initial");
          const second = storage.doc("value", () => "Wrong initial");
          hud.widget("value", () => Text(second.value()));
          commands.action("open", () => first.set("Changed"));
        }),
      ),
    );
    expect(host.state.hud.value).toEqual({ type: "text", text: "Initial", tone: undefined });
    await settle(host.command("open"));
    expect(host.state.hud.value).toEqual({ type: "text", text: "Changed", tone: undefined });
  });

  test("a throwing query handler does not discard another handler's results", async () => {
    const host = await settle(
      createTestHost(
        manifest,
        definePlugin(({ hub }) => {
          hub.query(() => {
            throw new Error("Query failed");
          });
          hub.query(() => [{ id: "answer", title: "Answer", actions: [] }]);
        }),
      ),
    );
    expect(await settle(host.query("anything"))).toEqual([
      { id: "answer", title: "Answer", actions: [] },
    ]);
    expect(host.state.errors).toEqual(["Query failed"]);
  });

  test("a newer query aborts the old query and keeps its action callbacks", async () => {
    let finishOld = (): void => {
      throw new Error("Old query has not started");
    };
    let oldSignal: AbortSignal | undefined;
    let oldPublished = false;
    const host = await settle(
      createTestHost(
        manifest,
        definePlugin(({ hub, commands, ui }) => {
          commands.action("open", () => {});
          hub.query(async (text, _scope, signal) => {
            if (text === "old") {
              oldSignal = signal;
              await new Promise<void>((resolve) => {
                finishOld = resolve;
              });
            }
            return [
              {
                id: text,
                title: text,
                actions: [{ id: "run", title: "Run", run: () => ui.toast({ title: text }) }],
              },
            ];
          });
        }),
      ),
    );
    void host.query("old").then(() => {
      oldPublished = true;
    });
    expect(await settle(host.query("new"))).toMatchObject([{ id: "new", title: "new" }]);
    expect(oldSignal?.aborted).toBe(true);
    finishOld();
    await settle(host.command("open"));
    await settle(host.choose("q", "new", "run"));
    expect(oldPublished).toBe(false);
    expect(host.state.toasts).toEqual([{ title: "new" }]);
    expect(host.state.errors).toEqual([]);
  });
});
