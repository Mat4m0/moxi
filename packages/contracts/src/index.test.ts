import { expect, test } from "vite-plus/test";
import { validateRequest, type WindowKind, type ChannelName } from "./index.js";
const denied: [ChannelName, WindowKind | undefined, unknown][] = [
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
  ["game.open", "game", undefined],
  ["appearance.set", "game", { uiStyle: "obsidian", uiPanelOpacity: 94, uiFont: "guild-wars" }],
  ["appearance.set", "launcher", { uiStyle: "classic", uiPanelOpacity: 39, uiFont: "guild-wars" }],
  [
    "appearance.set",
    "launcher",
    { uiStyle: "classic", uiPanelOpacity: 94.5, uiFont: "guild-wars" },
  ],
  ["app.info", "pluginHost", undefined],
  ["game.client", "launcher", undefined],
  ["game.client", "pluginHost", undefined],
  ["game.client", "game", {}],
  ["game.open", undefined, undefined],
  ["app.info", "launcher", {}],
];
test.each(denied)(
  "rejects unauthorized windows and malformed messages (%s, %s, %j)",
  (name, kind, input) => {
    expect(() => validateRequest(name, kind, input)).toThrow();
  },
);
test.each([
  ["app.info", "launcher"],
  ["game.open", "launcher"],
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
