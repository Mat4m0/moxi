import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { userEvent, page } from "vite-plus/test/browser/context";
import { createApp, nextTick } from "vue";
import type { App } from "vue";
import { emptyHubState } from "@moxi/sdk/host";
import type {
  HostToHub,
  HubState,
  HubToHost,
  WireAction,
  WireItem,
  PluginInstance,
} from "@moxi/sdk/host";
import Hub from "./Hub.vue";
import { connectHub } from "./client.ts";

const actions: WireAction[] = [
  { id: "open", title: "Open", kind: "push" },
  {
    id: "delete",
    title: "Delete",
    kind: "run",
    shortcut: "mod+d",
    style: "destructive",
    confirm: { title: "Delete item?", message: "This cannot be undone." },
  },
];
const item = (id: string, title: string): WireItem => ({ id, title, actions });
let state: HubState;
let plugin: PluginInstance;
let sent: HubToHost[];
let receive: (message: HostToHub) => void;
let app: App;
let container: HTMLDivElement;
let closed: number;
let closeOnEscape: boolean;
const mod = navigator.platform.toLowerCase().includes("mac") ? "Meta" : "Control";
const key = (text: string) => userEvent.keyboard(text);
const shortcut = (letter: string) => key(`{${mod}>}${letter}{/${mod}}`);
const search = () => page.getByRole("textbox", { name: "Search" });
const selected = () => container.querySelector('[aria-selected="true"]')?.id ?? null;
async function publish() {
  receive({ t: "state", state: structuredClone(state) });
  await nextTick();
}
function mount() {
  app = createApp(Hub, {
    onClose: () => {
      closed++;
      if (closeOnEscape) app.unmount();
    },
  });
  app.mount(container);
}
async function openView() {
  await key("{Enter}");
  const message = sent.findLast((m) => m.t === "pushView");
  if (!message || message.t !== "pushView") throw new Error("No view request");
  state.views[message.viewId] = {
    pluginId: "fixture",
    view: { type: "list", title: "Child", filter: "host", items: [item("child", "Child")] },
  };
  await publish();
}
beforeEach(async () => {
  sent = [];
  closed = 0;
  closeOnEscape = false;
  state = emptyHubState();
  plugin = {
    manifest: {
      id: "fixture",
      name: "Fixture",
      version: "1.0.0",
      api: 1,
      description: "Contract fixture",
      permissions: [],
      activation: [],
      commands: [],
    },
    script: "",
    bytes: 0,
    enabled: true,
    status: "running",
    items: [item("alpha", "Alpha"), item("beta", "Beta")],
    hud: {},
    subscriptions: [],
    settings: {},
  };
  state.plugins.fixture = plugin;
  connectHub({
    post: (message) => sent.push(message),
    listen: (handler) => {
      receive = handler;
    },
  });
  await publish();
  container = document.createElement("div");
  document.body.append(container);
  mount();
  await nextTick();
});
afterEach(async () => {
  app.unmount();
  container.remove();
  vi.restoreAllMocks();
  await userEvent.cleanup();
});

test.each(["body", "button", "search"])(
  "Typing reaches search from %s focus (H03)",
  async (focus) => {
    if (focus === "body") {
      document.body.tabIndex = -1;
      document.body.focus();
    } else if (focus === "button") container.querySelector("button")?.focus();
    else await search().click();
    await key("alpha");
    await expect.element(search()).toHaveValue("alpha");
  },
);
test("Typing reaches search after a view swap (H03)", async () => {
  await openView();
  container.querySelector("button")?.focus();
  await key("child");
  await expect.element(search()).toHaveValue("child");
});
test("Selection keeps its identity across reordered items and clears when removed (H12)", async () => {
  await key("{ArrowDown}");
  expect(selected()).toBe("item:fixture:beta");
  plugin.items = [item("beta", "Aardvark"), item("alpha", "Zebra")];
  await publish();
  expect(selected()).toBe("item:fixture:beta");
  plugin.items = [item("alpha", "Zebra")];
  await publish();
  expect(selected()).toBe(null);
  await key("{Enter}");
  expect(sent.filter((m) => m.t === "pushView")).toEqual([]);
});
test("The top result stays selected until the player navigates", async () => {
  expect(selected()).toBe("item:fixture:alpha");
  state.queryFor = { text: "", scope: null };
  state.queryResults.fixture = [item("hit", "Hit")];
  await publish();
  expect(selected()).toBe("q:fixture:hit");
  await key("{ArrowDown}");
  state.queryResults.fixture.unshift(item("new", "New"));
  await publish();
  expect(selected()).toBe("item:fixture:alpha");
});
test("A resting pointer cannot change selection when results update", async () => {
  await page.getByRole("option", { name: /Alpha/ }).hover();
  await key("{ArrowDown}");
  await publish();
  await page.getByRole("option", { name: /Alpha/ }).hover();
  expect(selected()).toBe("item:fixture:beta");
});
test.each(["new", "returning"])(
  "A double-click cannot run a %s row until it has been visible for 700 ms",
  async (arrival) => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    plugin.items = [];
    await publish();
    plugin.items = [item(arrival === "new" ? "new" : "alpha", "New")];
    await publish();
    clock.mockReturnValue(1699);
    await page.getByRole("option", { name: /New/ }).dblClick();
    expect(sent.filter((m) => m.t === "pushView")).toEqual([]);
    clock.mockReturnValue(1700);
    await page.getByRole("option", { name: /New/ }).dblClick();
    expect(sent.filter((m) => m.t === "pushView")).toHaveLength(1);
  },
);
test("Escape dismisses one layer and Back restores the parent query and selection (H06)", async () => {
  plugin.items = [item("alpha", "Build Alpha"), item("beta", "Build Beta")];
  await publish();
  await key("build{ArrowDown}");
  expect(selected()).toBe("item:fixture:beta");
  await openView();
  await shortcut("k");
  await key("{ArrowDown}{Enter}");
  await expect.element(page.getByRole("alertdialog")).toBeInTheDocument();
  await key("{Escape>3/}");
  await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
  await expect.element(page.getByRole("alertdialog")).toBeInTheDocument();
  expect(closed).toBe(0);
  await key("{Escape}");
  await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Back", exact: true })).toBeInTheDocument();
  await key("{Escape}");
  await expect.element(search()).toHaveValue("build");
  expect(selected()).toBe("item:fixture:beta");
  await key("{Escape}");
  await expect.element(search()).toHaveValue("");
  expect(closed).toBe(0);
  await key("{Escape}");
  expect(closed).toBe(1);
});
test("Hub keydown, repeat and matching keyup never reach the game", async () => {
  app.unmount();
  const physical: string[] = [];
  const observe = (event: KeyboardEvent) =>
    physical.push(`${event.type}:${event.key}:${event.repeat}`);
  const game: string[] = [];
  const listen = (event: KeyboardEvent) => game.push(event.type);
  window.addEventListener("keydown", observe, true);
  window.addEventListener("keyup", observe, true);
  mount();
  await nextTick();
  window.addEventListener("keydown", listen, true);
  window.addEventListener("keyup", listen, true);
  try {
    await key("{ArrowDown>3/}");
    expect(physical).toEqual([
      "keydown:ArrowDown:false",
      "keydown:ArrowDown:true",
      "keydown:ArrowDown:true",
      "keyup:ArrowDown:false",
    ]);
    expect(game).toEqual([]);
    closeOnEscape = true;
    await key("{Escape>3/}");
    expect(closed).toBe(1);
    expect(game).toEqual([]);
    closeOnEscape = false;
    mount();
    await nextTick();
  } finally {
    window.removeEventListener("keydown", observe, true);
    window.removeEventListener("keyup", observe, true);
    window.removeEventListener("keydown", listen, true);
    window.removeEventListener("keyup", listen, true);
  }
});
test("Enter runs the first action and action shortcuts ask before destruction", async () => {
  await key("{Enter}");
  expect(sent.filter((m) => m.t === "pushView")).toHaveLength(1);
  await key("{Escape}");
  await shortcut("k");
  await expect.element(page.getByRole("menu")).toBeInTheDocument();
  await key("{ArrowDown}{Enter}");
  await expect.element(page.getByRole("alertdialog")).toBeInTheDocument();
  expect(sent.filter((m) => m.t === "invoke")).toEqual([]);
  await key("{Escape}{Escape}");
  await shortcut("d");
  await key("{Enter}");
  expect(sent.filter((m) => m.t === "invoke")).toEqual([
    {
      t: "invoke",
      pluginId: "fixture",
      surface: "items",
      target: "alpha/delete",
      args: undefined,
      grant: true,
    },
  ]);
});
test.each(["changed", "removed", "unchanged"])(
  "Confirmation runs only for an unchanged item (%s snapshot, H12)",
  async (change) => {
    await shortcut("d");
    if (change === "changed") plugin.items[0] = item("alpha", "Changed target");
    else if (change === "removed") plugin.items = [item("beta", "Beta")];
    await publish();
    await key("{Enter}");
    expect(sent.filter((m) => m.t === "invoke")).toEqual(
      change === "unchanged"
        ? [
            {
              t: "invoke",
              pluginId: "fixture",
              surface: "items",
              target: "alpha/delete",
              args: undefined,
              grant: true,
            },
          ]
        : [],
    );
  },
);
test("A late command result cannot navigate a newer Hub session", async () => {
  plugin.manifest.commands = [{ id: "command", title: "A command" }];
  await publish();
  await key("{Enter}");
  const command = sent.find((m) => m.t === "command");
  if (!command || command.t !== "command") throw new Error("No command request");
  app.unmount();
  mount();
  await nextTick();
  receive({ t: "commandResult", requestId: command.requestId, viewId: "old-view" });
  await nextTick();
  await nextTick();
  expect(sent.filter((m) => m.t === "closeView")).toEqual([]);
  await expect.element(search()).toBeInTheDocument();
  expect(selected()).toBe("cmd:fixture:command");
  expect(closed).toBe(0);
  await key("{Enter}");
  const current = sent.findLast((m) => m.t === "command");
  if (!current || current.t !== "command") throw new Error("No current command request");
  state.views.current = {
    pluginId: "fixture",
    view: {
      type: "list",
      title: "Current command",
      filter: "host",
      items: [item("current", "Current item")],
    },
  };
  await publish();
  receive({ t: "commandResult", requestId: current.requestId, viewId: "current" });
  await nextTick();
  await expect.element(page.getByRole("option", { name: /Current item/ })).toBeInTheDocument();
  expect(selected()).toBe("current");
  expect(closed).toBe(0);
});
test("A late query result cannot replace results in a newer Hub session", async () => {
  await key("old");
  app.unmount();
  state.queryResults = {};
  await publish();
  mount();
  await nextTick();
  state.queryFor = { text: "old", scope: null };
  state.queryResults.fixture = [item("old", "Old session result")];
  await publish();
  await expect
    .element(page.getByRole("option", { name: /Old session result/ }))
    .not.toBeInTheDocument();
});

test("Unrelated query results keep the last matching results visible until current results arrive", async () => {
  plugin.manifest.scopes = ["builds"];
  state.queryFor = { text: "", scope: null };
  state.queryResults.fixture = [item("first", "First result")];
  await publish();
  await key("next");
  state.queryFor = { text: "other", scope: null };
  state.queryResults.fixture = [item("wrong", "Wrong query")];
  await publish();
  await expect.element(page.getByRole("option", { name: /First result/ })).toBeInTheDocument();
  await expect.element(page.getByRole("option", { name: /Wrong query/ })).not.toBeInTheDocument();
  state.queryFor = { text: "next", scope: "builds" };
  state.queryResults.fixture = [item("scoped", "Wrong scope")];
  await publish();
  await expect.element(page.getByRole("option", { name: /First result/ })).toBeInTheDocument();
  state.queryFor = { text: "next", scope: null };
  state.queryResults.fixture = [item("next", "Next result")];
  await publish();
  await expect.element(page.getByRole("option", { name: /Next result/ })).toBeInTheDocument();
  await expect.element(page.getByRole("option", { name: /First result/ })).not.toBeInTheDocument();
});
