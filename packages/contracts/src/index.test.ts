import { expect, test } from "vite-plus/test";
import { validateRequest, type WindowKind, type ChannelName } from "./index.js";
const denied: [ChannelName, WindowKind | undefined, unknown][] = [
  [
    "plugin.doc.read",
    "launcher",
    { plugin: "notes", scope: "global", account: null, name: "build" },
  ],
  [
    "plugin.doc.write",
    "game",
    {
      ref: { plugin: "notes", scope: "global", account: null, name: "build" },
      value: "saved",
      expectedRevision: 0,
    },
  ],
  ["plugin.bundles", "game", undefined],
  [
    "plugin.doc.read",
    "pluginHost",
    { plugin: "notes", scope: "account", account: null, name: "build" },
  ],
  [
    "plugin.doc.read",
    "pluginHost",
    { plugin: "notes", scope: "global", account: "alice", name: "build" },
  ],
  [
    "plugin.doc.write",
    "pluginHost",
    {
      ref: { plugin: "notes", scope: "global", account: null, name: "build" },
      value: "saved",
      expectedRevision: -1,
    },
  ],

  ["download.pause", "game", undefined],
  ["download.pause", "pluginHost", undefined],
  ["download.resume", "game", undefined],
  ["download.resume", "pluginHost", undefined],
  ["download.pause", "launcher", {}],
  ["download.resume", "launcher", {}],
  ["client.readiness", "game", undefined],
  ["client.readiness", "pluginHost", undefined],
  ["client.retry", "game", undefined],
  ["client.retry", "pluginHost", undefined],
  ["game.net.connect", "launcher", { id: 1, destination: "8.8.8.8:6112" }],
  ["game.net.write", "pluginHost", { id: 1, bytes: new Uint8Array([1]) }],
  ["game.net.close", "launcher", { id: 1 }],
  ["game.net.ack", "pluginHost", { id: 1, bytes: 1 }],
  ["game.dns", "launcher", "File1.ArenaNetworks.com"],
  ["game.net.healthy", "pluginHost", "00000000-0000-4000-8000-000000000001"],
  ["game.net.write", "game", { id: 1, bytes: [1, 2, 3] }],
  ["game.net.ack", "game", { id: 1, bytes: 0 }],
  ["game.net.connect", "game", { id: -1, destination: "8.8.8.8:6112" }],
  ["accounts.play", "game", { ids: ["main"] }],
  ["accounts.list", "game", undefined],
  ["accounts.remove", "pluginHost", { id: "main" }],
  ["accounts.play", "launcher", { ids: [] }],
  ["accounts.play", "launcher", { ids: ["../escape"] }],
  ["accounts.archive", "launcher", { id: "main" }],
  ["accounts.save", "launcher", { id: "a/b", name: "Alice" }],
  ["accounts.save", "launcher", { id: "alice" }],
  ["accounts.save", "launcher", { name: "Alice" }],
  ["accounts.select", "game", { ids: ["main"] }],
  ["accounts.select", "launcher", { ids: ["../escape"] }],
  ["accounts.select", "launcher", { ids: Array.from({ length: 65 }, (_, index) => `a${index}`) }],
  ["accounts.select", "launcher", { id: "main" }],
  ["tools.set", "game", { id: "moxi.builds", enabled: false }],
  ["tools.set", "pluginHost", { id: "moxi.builds", enabled: false }],
  ["tools.set", "launcher", { id: "../escape", enabled: false }],
  ["tools.set", "launcher", { id: "moxi.builds" }],
  ["tools.set", "launcher", { id: "moxi.builds", enabled: "no" }],
  ["app.info", "pluginHost", undefined],
  ["game.client", "launcher", undefined],
  ["game.client", "pluginHost", undefined],
  ["game.client", "game", {}],
  ["accounts.play", undefined, { ids: ["main"] }],
  ["app.info", "launcher", {}],
];
test.each(denied)(
  "rejects unauthorized windows and malformed messages (%s, %s, %j)",
  (name, kind, input) => {
    expect(() => validateRequest(name, kind, input)).toThrow();
  },
);
test.each([
  ["download.pause", "launcher"],
  ["download.resume", "launcher"],
  ["app.info", "launcher"],
  ["accounts.list", "launcher"],
  ["tools.list", "launcher"],
  ["tools.list", "pluginHost"],
  ["app.info", "game"],
  ["game.client", "game"],
] as const)("allows the window's declared actions (%s, %s)", (name, kind) => {
  expect(validateRequest(name, kind, undefined)).toBe(undefined);
});

test("accepts copied TCP bytes from the game window", () => {
  expect(
    validateRequest("game.net.write", "game", { id: 1, bytes: new Uint8Array([1, 2, 3]) }),
  ).toEqual({ id: 1, bytes: new Uint8Array([1, 2, 3]) });
});

test("accepts a new account and a play request from the launcher", () => {
  const account = { id: "alice-2", name: "Alice" };
  expect(validateRequest("accounts.save", "launcher", account)).toEqual(account);
  expect(validateRequest("accounts.play", "launcher", { ids: ["alice-2", "main"] })).toEqual({
    ids: ["alice-2", "main"],
  });
});
