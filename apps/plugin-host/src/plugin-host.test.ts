/// <reference types="node" />
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { MessageChannel, Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import type { HostToHub, HubToHost, ToHost } from "@moxi/sdk/host";
import { PluginHost } from "./plugin-host.ts";

const cleanup: (() => void)[] = [];
beforeEach(() =>
  vi.useFakeTimers({
    toFake: ["Date", "performance", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  }),
);
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  vi.useRealTimers();
});

function harness(permissions = ["game.travel"]) {
  const channel = new MessageChannel();
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE documents (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const messages: HostToHub[] = [];
  let signal: (() => void) | undefined;
  channel.port2.on("message", (message: HostToHub) => {
    messages.push(message);
    signal?.();
  });
  const host = new PluginHost(
    {
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
          worker.on("message", (message: ToHost) => handler(message));
          worker.on("error", (error) => onError(error.message));
        },
        terminate: () => {
          void worker.terminate();
        },
      };
    },
    {
      getItem: (key) => {
        const row = db.prepare("SELECT value FROM documents WHERE key = ?").get(key);
        return typeof row?.value === "string" ? row.value : null;
      },
      setItem: (key, value) => {
        db.prepare("INSERT OR REPLACE INTO documents VALUES (?, ?)").run(key, value);
      },
    },
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
  async function command(commandId: string) {
    const id = ++requestId;
    send({ t: "command", requestId: id, pluginId: "test.protocol", commandId });
    await until(() => messages.some((m) => m.t === "commandResult" && m.requestId === id));
  }
  send({ t: "openHub" });
  return { host, messages, send, until, command };
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
      h.host.state.plugins["test.protocol"]!.hud.player.text.includes("Mo Kai"),
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
});
