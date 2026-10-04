/// <reference types="node" />
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { MessageChannel, Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import type { HostToHub, HubToHost } from "@moxi/sdk/host";
import { createPluginDocuments } from "@moxi/desktop/plugin-documents";
import { migrations } from "@moxi/desktop/storage";
import { PluginHost } from "./plugin-host.ts";

const cleanup: (() => void)[] = [];
beforeEach(() =>
  vi.useFakeTimers({
    toFake: ["Date", "performance", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  }),
);
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function harness(
  permissions = ["game.travel"],
  scheduleFrame = (callback: () => void) => callback(),
  sharedDocuments?: ReturnType<typeof createPluginDocuments>,
) {
  const channel = new MessageChannel();
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration.sql);
  const documents = sharedDocuments ?? createPluginDocuments(db);
  let terminated = 0;
  const messages: HostToHub[] = [];
  let signal: (() => void) | undefined;
  channel.port2.on("message", (message: HostToHub) => {
    messages.push(message);
    signal?.();
  });
  const host = new PluginHost(
    {
      onClose: (handler) => channel.port1.on("close", handler),
      post: (message) => channel.port1.postMessage(message),
      listen: (handler) => channel.port1.on("message", handler),
    },
    () => {
      const worker = new Worker(
        new URL("../test-fixtures/test/protocol-worker.ts", import.meta.url),
      );
      return {
        postMessage: (message) => worker.postMessage(message),
        listen: (handler, onError) => {
          worker.on("message", (message: unknown) => handler(message));
          worker.on("error", (error) => onError(error.message));
        },
        terminate: () => {
          terminated++;
          void worker.terminate();
        },
      };
    },
    {
      read: async (ref) => documents.read(ref),
      write: async (request) => documents.write(request),
      onChange: (listener) => documents.onChange(listener),
    },
    scheduleFrame,
  );
  cleanup.push(() => {
    host.dispose();
    channel.port1.close();
    channel.port2.close();
    db.close();
  });
  host.register(
    {
      id: "test.protocol",
      name: "Protocol fixture",
      version: "1.0.0",
      api: 1,
      description: "Exercises malicious and late worker messages.",
      permissions,
      activation: ["hub"],
      commands: [],
    },
    "fixture",
    0,
  );
  const send = (message: HubToHost) => channel.port2.postMessage(message);
  const until = (condition: () => boolean) =>
    new Promise<void>((resolve) => {
      signal = () => {
        if (condition()) {
          signal = undefined;
          resolve();
        }
      };
      signal();
    });
  let requestId = 0;
  async function command(commandId: string, pluginId = "test.protocol") {
    const id = ++requestId;
    send({ t: "command", requestId: id, pluginId, commandId });
    await until(() => messages.some((m) => m.t === "commandResult" && m.requestId === id));
  }
  send({ t: "openHub" });
  return { documents, host, messages, send, until, command, channel, terminated: () => terminated };
}

test.each([
  { age: 3000, expected: "done" },
  { age: 3001, expected: "needs-user-action" },
])("a captured activation expires after 3 seconds (age $age)", async ({ age, expected }) => {
  const h = harness();
  await h.command("capture");
  for (let elapsed = 0; elapsed < age;) {
    const step = Math.min(1000, age - elapsed);
    vi.advanceTimersByTime(step);
    elapsed += step;
    await h.command("clear");
  }
  await h.command("use");
  if (expected === "done") {
    await h.until(() => h.messages.some((m) => m.t === "gameAction"));
    const action = h.messages.find((m) => m.t === "gameAction");
    if (action?.t !== "gameAction") throw new Error("Missing game action");
    h.send({ t: "actionResult", requestId: action.requestId, result: { status: "done" } });
  }
  await h.until(
    () => h.host.state.plugins["test.protocol"]!.items[0]?.title.includes(expected) ?? false,
  );
  expect(h.host.state.plugins["test.protocol"]!.items[0]?.title).toBe(
    expected === "done"
      ? '{"status":"done"}'
      : '{"status":"refused","reason":"needs-user-action","message":"Game actions must start from your own click or key press."}',
  );
});

test("a malicious worker cannot reuse one activation for a second game action", async () => {
  const h = harness();
  await h.command("capture");
  await h.command("use");
  await h.until(() => h.messages.some((m) => m.t === "gameAction"));
  const action = h.messages.find((m) => m.t === "gameAction");
  if (action?.t !== "gameAction") throw new Error("Missing game action");
  h.send({ t: "actionResult", requestId: action.requestId, result: { status: "done" } });
  await h.until(
    () => h.host.state.plugins["test.protocol"]!.items[0]?.title === '{"status":"done"}',
  );
  await h.command("use");
  await h.until(
    () =>
      h.host.state.plugins["test.protocol"]!.items[0]?.title.includes("needs-user-action") ?? false,
  );
  expect(h.messages.filter((m) => m.t === "gameAction")).toHaveLength(1);
});

test("the watchdog terminates a hanging worker and withdraws its UI", async () => {
  const h = harness();
  await h.command("capture");
  h.send({ t: "command", requestId: 99, pluginId: "test.protocol", commandId: "freeze" });
  await h.until(() => h.host.state.plugins["test.protocol"]!.items[0]?.title === "Hanging");
  vi.advanceTimersByTime(3000);
  await h.until(() => h.messages.some((m) => m.t === "commandResult" && m.requestId === 99));
  const p = h.host.state.plugins["test.protocol"]!;
  expect({ status: p.status, reason: p.crashReason, items: p.items, hud: p.hud }).toEqual({
    status: "crashed",
    reason: "Stopped responding",
    items: [],
    hud: {},
  });
});

test("an older query arriving last cannot replace the current query", async () => {
  const h = harness();
  await h.command("capture");
  h.send({ t: "query", text: "old", scope: null });
  await h.until(
    () => h.host.state.plugins["test.protocol"]!.items[0]?.title === "Old query received",
  );
  h.send({ t: "query", text: "new", scope: null });
  await h.until(() => h.host.state.queryResults["test.protocol"]?.[0]?.title === "new");
  await h.command("clear");
  expect(h.host.state.queryResults["test.protocol"]).toEqual([
    { id: "new", title: "new", actions: [] },
  ]);
});

test("subscribing to undeclared facts never exposes player or target data", async () => {
  const h = harness(["game.player"]);
  h.send({
    t: "facts",
    values: {
      player: { ok: true, at: 123, value: { name: "Mo Kai" } },
      target: { ok: true, at: 123, value: { name: "Secret target" } },
      map: { ok: false, reason: "loading" },
    },
  });
  await h.until(
    () =>
      h.host.state.plugins["test.protocol"]!.hud.player?.type === "text" &&
      h.host.state.plugins["test.protocol"]!.hud.player.text.includes("Mo Kai") &&
      h.host.state.plugins["test.protocol"]!.hud.target !== undefined,
  );
  const hud = h.host.state.plugins["test.protocol"]!.hud;
  expect(hud).toEqual({
    player: { type: "text", text: '{"ok":true,"at":123,"value":{"name":"Mo Kai"}}' },
    target: { type: "text", text: '{"ok":false,"reason":"not-permitted"}' },
  });
});

test("a delayed command cannot restore a view from a closed Hub session", async () => {
  const h = harness();
  await h.command("capture");
  h.send({ t: "command", requestId: 99, pluginId: "test.protocol", commandId: "delayed-view" });
  await h.until(() => h.host.state.plugins["test.protocol"]!.items[0]?.title === "View pending");
  h.send({ t: "closeHub" });
  h.send({ t: "openHub" });
  await h.command("release-view");
  await h.until(() => h.messages.some((m) => m.t === "commandResult" && m.requestId === 99));
  expect(h.messages.find((m) => m.t === "commandResult" && m.requestId === 99)).toEqual({
    t: "commandResult",
    requestId: 99,
    viewId: null,
  });
  expect(h.host.state.views).toEqual({});
  expect(h.host.state.plugins["test.protocol"]!.status).toBe("running");
});

test("Results from a new query never mix with another plugin's previous query and closing clears them", async () => {
  const h = harness();
  h.host.register(
    {
      id: "test.second",
      name: "Second fixture",
      version: "1.0.0",
      api: 1,
      description: "Second query contributor",
      permissions: [],
      activation: ["hub"],
      commands: [],
    },
    "fixture",
    0,
  );
  await h.command("capture");
  h.send({ t: "query", text: "first", scope: null });
  await h.until(() => Object.keys(h.host.state.queryResults).length === 2);
  expect(h.host.state.queryFor).toEqual({ text: "first", scope: null });
  const before = h.messages.length;
  h.send({ t: "query", text: "second", scope: "builds" });
  await h.until(() =>
    h.messages
      .slice(before)
      .some(
        (m) =>
          m.t === "state" &&
          m.state.queryFor?.text === "second" &&
          Object.keys(m.state.queryResults).length === 2,
      ),
  );
  const firstResult = h.messages
    .slice(before)
    .find((m) => m.t === "state" && m.state.queryFor?.text === "second");
  if (firstResult?.t !== "state") throw new Error("Missing query results");
  expect(firstResult.state.queryFor).toEqual({ text: "second", scope: "builds" });
  expect(Object.values(firstResult.state.queryResults)).toEqual([
    [{ id: "new", title: "new", actions: [] }],
  ]);
  h.send({ t: "closeHub" });
  await h.until(() => h.host.state.queryFor === null);
  expect(h.host.state.queryResults).toEqual({});
  h.send({ t: "openHub" });
  await h.command("clear");
  expect({ queryFor: h.host.state.queryFor, queryResults: h.host.state.queryResults }).toEqual({
    queryFor: null,
    queryResults: {},
  });
  h.send({ t: "query", text: "old", scope: null });
  await h.until(
    () =>
      h.host.state.plugins["test.protocol"]!.items[0]?.title === "Old query received" &&
      h.host.state.plugins["test.second"]!.items[0]?.title === "Old query received",
  );
  h.send({ t: "closeHub" });
  h.send({ t: "openHub" });
  h.send({ t: "query", text: "current", scope: null });
  await h.until(
    () =>
      h.host.state.queryFor?.text === "current" &&
      Object.keys(h.host.state.queryResults).length === 2,
  );
  await h.command("clear");
  expect(h.host.state.queryFor).toEqual({ text: "current", scope: null });
  expect(Object.values(h.host.state.queryResults)).toEqual([
    [{ id: "new", title: "new", actions: [] }],
    [{ id: "new", title: "new", actions: [] }],
  ]);
});

test("closing a game port stops its workers and withdraws every plugin surface", async () => {
  const h = harness();
  await h.command("capture");
  h.channel.port2.close();
  await new Promise<void>((done) => h.channel.port1.once("close", done));
  expect(h.terminated()).toBe(1);
  expect(h.host.state.plugins["test.protocol"]!.status).toBe("stopped");
  expect(h.host.state.plugins["test.protocol"]!.items).toEqual([]);
  expect(h.host.state.plugins["test.protocol"]!.hud).toEqual({});
  expect(h.host.state.views).toEqual({});
  expect(h.host.state.queryResults).toEqual({});
  expect(h.host.state.toasts).toEqual([]);
});

test("100 plugin updates share one snapshot per frame without leaking worker code", async () => {
  const frames: (() => void)[] = [];
  const h = harness([], (callback) => frames.push(callback));
  for (let i = 0; i < 100; i++) await h.command("clear");
  expect(h.messages.filter((message) => message.t === "state")).toHaveLength(0);
  expect(frames).toHaveLength(1);
  frames.shift()!();
  await h.until(() => h.messages.some((message) => message.t === "state"));
  const snapshot = h.messages.find((message) => message.t === "state");
  if (snapshot?.t !== "state") throw new Error("Missing snapshot");
  expect(snapshot.state.plugins["test.protocol"]).not.toHaveProperty("script");
  expect(snapshot.state.plugins["test.protocol"]).not.toHaveProperty("bytes");
  for (let i = 0; i < 100; i++) await h.command("clear");
  expect(h.messages.filter((message) => message.t === "state")).toHaveLength(1);
  expect(frames).toHaveLength(1);
  frames.shift()!();
  await h.until(() => h.messages.filter((message) => message.t === "state").length === 2);
  expect(h.messages.filter((message) => message.t === "state")).toHaveLength(2);
});

test("plugin documents round-trip through the document port and receive changes without browser storage", async () => {
  const h = harness();
  const second = harness([], undefined, h.documents);
  await h.command("doc-read");
  await second.command("doc-read");
  await h.until(() => h.host.state.plugins["test.protocol"]!.items[0]?.title === "null");
  await second.until(() => second.host.state.plugins["test.protocol"]!.items[0]?.title === "null");
  await h.command("doc-write");
  await h.until(() => h.host.state.plugins["test.protocol"]!.hud.document?.type === "text");
  await second.until(
    () => second.host.state.plugins["test.protocol"]!.hud.document?.type === "text",
  );
  expect(second.host.state.plugins["test.protocol"]!.hud.document).toEqual({
    type: "text",
    text: '{"text":"saved"}',
  });
  expect(
    h.documents.read({ plugin: "test.protocol", scope: "global", account: null, name: "notes" }),
  ).toEqual({ value: { text: "saved" }, revision: 1 });
  await h.command("doc-read");
  await h.until(
    () => h.host.state.plugins["test.protocol"]!.items[0]?.title === '{"text":"saved"}',
  );
  expect(h.host.state.plugins["test.protocol"]!.hud.document).toEqual({
    type: "text",
    text: '{"text":"saved"}',
  });
});

test("items:null stops only the sender, counts as a crash and leaves another worker usable", async () => {
  const h = harness();
  h.host.register(
    {
      id: "test.second",
      name: "Second",
      version: "1.0.0",
      api: 1,
      description: "Healthy worker",
      permissions: [],
      activation: ["hub"],
      commands: [],
    },
    "fixture",
    0,
  );
  await h.command("clear", "test.second");
  for (let i = 0; i < 3; i++) {
    await h.command('send:{"t":"items","items":null}');
    const broken = h.host.state.plugins["test.protocol"]!;
    expect({ status: broken.status, reason: broken.crashReason, items: broken.items }).toEqual({
      status: "crashed",
      reason: "Sent an invalid or oversized message",
      items: [],
    });
  }
  expect(h.host.state.plugins["test.protocol"]!.enabled).toBe(false);
  expect(h.host.state.log[0]?.text).toBe("Protocol fixture: Sent an invalid or oversized message");
  await h.command("clear", "test.second");
  expect(h.host.state.plugins["test.second"]!.status).toBe("running");
  expect(h.host.state.plugins["test.second"]!.items).toEqual([
    { id: "Ready", title: "Ready", actions: [] },
  ]);
});

test("a worker cannot take over another worker's host-issued view id", async () => {
  const h = harness();
  h.host.register(
    {
      id: "test.second",
      name: "Second",
      version: "1.0.0",
      api: 1,
      description: "Other worker",
      permissions: [],
      activation: ["hub"],
      commands: [],
    },
    "fixture",
    0,
  );
  await h.command("view");
  const viewId = Object.keys(h.host.state.views)[0]!;
  await h.command(
    "send:" +
      JSON.stringify({
        t: "view",
        viewId,
        view: { type: "list", title: "Stolen", items: [], filter: "host" },
      }),
    "test.second",
  );
  expect(h.host.state.plugins["test.second"]!.crashReason).toBe(
    "Tried to change a view it does not own",
  );
  expect(h.host.state.views[viewId]).toEqual({
    pluginId: "test.protocol",
    view: { type: "list", title: "Owned view", items: [], filter: "host" },
  });
  await h.command("clear");
  expect(h.host.state.plugins["test.protocol"]!.status).toBe("running");
});

test.each([
  { kind: "items", size: 500, crashed: false },
  { kind: "items", size: 501, crashed: true },
  { kind: "nodes", size: 2000, crashed: false },
  { kind: "nodes", size: 2001, crashed: true },
  { kind: "text", size: 4000, crashed: false },
  { kind: "text", size: 4001, crashed: true },
])("oversized $kind cannot enter Hub state (size $size)", async ({ kind, size, crashed }) => {
  const h = harness();
  const payload =
    kind === "items"
      ? {
          t: "items",
          items: Array.from({ length: size }, (_, i) => ({
            id: String(i),
            title: "Item",
            actions: [],
          })),
        }
      : kind === "nodes"
        ? {
            t: "hud",
            id: "tree",
            node: {
              type: "row",
              children: Array.from({ length: size - 1 }, () => ({ type: "text", text: "Leaf" })),
            },
          }
        : { t: "items", items: [{ id: "text", title: "x".repeat(size), actions: [] }] };
  await h.command("send:" + JSON.stringify(payload));
  const plugin = h.host.state.plugins["test.protocol"]!;
  expect(plugin.status).toBe(crashed ? "crashed" : "running");
  if (crashed) expect({ items: plugin.items, hud: plugin.hud }).toEqual({ items: [], hud: {} });
  else if (kind === "items") expect(plugin.items).toHaveLength(500);
  else if (kind === "text") expect(plugin.items[0]!.title).toHaveLength(4000);
  else {
    const tree = plugin.hud.tree;
    if (tree?.type !== "row") throw new Error("Missing HUD tree");
    expect(tree.children).toHaveLength(1999);
  }
});

test.each([
  { count: 500, crashed: false },
  { count: 501, crashed: true },
])(
  "a message flood stops at the rolling one-second limit (count $count)",
  async ({ count, crashed }) => {
    const h = harness();
    await h.command("capture");
    vi.spyOn(performance, "now").mockReturnValue(1000);
    await h.command(`rate:${count - 1}`);
    expect(h.host.state.plugins["test.protocol"]!.status).toBe(crashed ? "crashed" : "running");
    if (crashed)
      expect(h.host.state.plugins["test.protocol"]!.crashReason).toBe(
        "Sent too many messages in one second",
      );
    else {
      vi.spyOn(performance, "now").mockReturnValue(2000);
      await h.command("clear");
      expect(h.host.state.plugins["test.protocol"]!.items).toEqual([
        { id: "Ready", title: "Ready", actions: [] },
      ]);
    }
  },
);

test.each(["close", "stop"])(
  "ten superseded unanswered queries settle without replies and %s settles the last one",
  async (end) => {
    const h = harness();
    await h.command("capture");
    const pending: Promise<void>[] = [];
    for (let i = 0; i <= 10; i++) {
      const text = `hold:${i}`;
      pending.push(h.host.query(text, null));
      await h.until(() => h.host.state.plugins["test.protocol"]!.items[0]?.title === text);
    }
    await Promise.all(pending.slice(0, 10));
    if (end === "close") h.send({ t: "closeHub" });
    else h.host.stopPlugin("test.protocol");
    await pending[10];
    expect(h.host.state.queryResults).toEqual({});
    expect(h.host.state.queryFor).toBe(null);
  },
);

test.each([
  { t: "unknown" },
  { t: "subscribe", slice: "credentials" },
  { t: "hud", id: "broken", node: { type: "row", children: null } },
  { t: "view", viewId: "anything", view: null },
  { t: "request", reqId: 1, op: "doc.read", args: null, activation: null },
  { t: "request", reqId: 1, op: "toast", args: { title: null }, activation: null },
])("malformed worker payloads fail closed: %j", async (payload) => {
  const h = harness();
  await h.command("send:" + JSON.stringify(payload));
  expect(h.host.state.plugins["test.protocol"]!.crashReason).toBe(
    "Sent an invalid or oversized message",
  );
});

test.each([
  { surface: "view", size: 500, crashed: false },
  { surface: "view", size: 501, crashed: true },
  { surface: "query", size: 500, crashed: false },
  { surface: "query", size: 501, crashed: true },
  { surface: "detail", size: 2000, crashed: false },
  { surface: "detail", size: 2001, crashed: true },
])(
  "$surface results cannot bypass the item or tree bounds (size $size)",
  async ({ surface, size, crashed }) => {
    const h = harness();
    await h.command('send:{"t":"items","items":[]}');
    if (surface === "query") await h.host.query(`items:${size}`, null);
    else await h.command(`${surface === "view" ? "view-items" : "view-nodes"}:${size}`);
    expect(h.host.state.plugins["test.protocol"]!.status).toBe(crashed ? "crashed" : "running");
    if (crashed) expect(h.host.state.views).toEqual({});
    else if (surface === "query")
      expect(h.host.state.queryResults["test.protocol"]).toHaveLength(500);
    else {
      const view = Object.values(h.host.state.views)[0]!.view;
      if (view.type === "list") expect(view.items).toHaveLength(500);
      else if (view.type === "detail") expect(view.blocks).toHaveLength(1999);
      else throw new Error("Unexpected view");
    }
  },
);

test.each([
  { size: 499, crashed: false },
  { size: 500, crashed: true },
])(
  "the item budget includes catalogs and query results together (query size $size)",
  async ({ size, crashed }) => {
    const h = harness();
    await h.command("clear");
    await h.host.query(`items:${size}`, null);
    expect(h.host.state.plugins["test.protocol"]!.status).toBe(crashed ? "crashed" : "running");
    if (crashed)
      expect(h.host.state.plugins["test.protocol"]!.crashReason).toBe("Published too many items");
    else expect(h.host.state.queryResults["test.protocol"]).toHaveLength(499);
  },
);

test.each([
  { surface: "views", size: 32, crashed: false },
  { surface: "views", size: 33, crashed: true },
  { surface: "hud", size: 32, crashed: false },
  { surface: "hud", size: 33, crashed: true },
])(
  "repeated $surface cannot grow without limit (size $size)",
  async ({ surface, size, crashed }) => {
    const h = harness();
    await h.command('send:{"t":"hud","id":"player","node":null}');
    await h.command('send:{"t":"hud","id":"target","node":null}');
    for (let i = 0; i < size; i++) {
      if (surface === "views") await h.command("view");
      else
        await h.command(
          "send:" +
            JSON.stringify({ t: "hud", id: `widget:${i}`, node: { type: "text", text: "Widget" } }),
        );
    }
    expect(h.host.state.plugins["test.protocol"]!.status).toBe(crashed ? "crashed" : "running");
    if (crashed)
      expect({
        views: h.host.state.views,
        hud: h.host.state.plugins["test.protocol"]!.hud,
      }).toEqual({ views: {}, hud: {} });
    else if (surface === "views") expect(Object.keys(h.host.state.views)).toHaveLength(32);
    else {
      expect(Object.keys(h.host.state.plugins["test.protocol"]!.hud)).toHaveLength(32);
      await h.command('send:{"t":"hud","id":"absent","node":null}');
      expect(h.host.state.plugins["test.protocol"]!.status).toBe("running");
    }
  },
);

test("a late render of a closed view is ignored without falsely crashing its worker", async () => {
  const h = harness();
  await h.command("view");
  const viewId = Object.keys(h.host.state.views)[0]!;
  h.send({ t: "closeView", viewId });
  await h.command(
    "send:" +
      JSON.stringify({
        t: "view",
        viewId,
        view: { type: "list", title: "Restored", items: [], filter: "host" },
      }),
  );
  expect(h.host.state.plugins["test.protocol"]!.status).toBe("running");
  expect(h.host.state.views).toEqual({});
});

test.each([
  { bound: "depth", size: 64, crashed: false },
  { bound: "depth", size: 65, crashed: true },
  { bound: "values", size: 16000, crashed: false },
  { bound: "values", size: 16001, crashed: true },
])(
  "worker payload traversal is bounded before schema recursion ($bound $size)",
  async ({ bound, size, crashed }) => {
    const h = harness();
    let extra: unknown = {};
    if (bound === "depth") {
      for (let i = 1; i < size; i++) extra = { nested: extra };
    } else {
      extra = Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [
          String(i),
          Array.from({ length: i < 7 ? 2000 : size - 14011 }, () => "x"),
        ]),
      );
    }
    await h.command("send:" + JSON.stringify({ t: "ready", extra }));
    expect(h.host.state.plugins["test.protocol"]!.status).toBe(crashed ? "crashed" : "running");
  },
);
