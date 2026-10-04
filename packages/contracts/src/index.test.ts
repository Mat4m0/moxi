import { expect, test } from "vite-plus/test";
import { validateRequest, type WindowKind, type ChannelName } from "./index.js";
const denied: [ChannelName, WindowKind | undefined, unknown][] = [
  ["game.open", "game", undefined],
  ["app.info", "pluginHost", undefined],
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
] as const)("allows the window's declared actions (%s, %s)", (name, kind) => {
  expect(validateRequest(name, kind, undefined)).toBe(undefined);
});
