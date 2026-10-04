import { expect, test } from "vite-plus/test";
import { resolveRendererPath } from "./protocol-path.js";
test.each([
  [
    "moxi://app/launcher/",
    process.platform === "win32" ? "C:\\built\\launcher\\index.html" : "/built/launcher/index.html",
  ],
  [
    "moxi://app/game/assets/main.js",
    process.platform === "win32"
      ? "C:\\built\\game\\assets\\main.js"
      : "/built/game/assets/main.js",
  ],
  [
    "moxi://app/plugin-host/",
    process.platform === "win32"
      ? "C:\\built\\plugin-host\\index.html"
      : "/built/plugin-host/index.html",
  ],
  ["moxi://app/launcher/../secret", undefined],
  ["moxi://app/launcher/%2e%2e/secret", undefined],
  ["moxi://app/launcher/%2e%2e%2fsecret", undefined],
  ["moxi://app/launcher/%5c..%5csecret", undefined],
  ["moxi://app/launcher/%00", undefined],
  ["moxi://app/launcher/%zz", undefined],
  ["moxi://other/launcher/", undefined],
  ["https://app/launcher/", undefined],
  ["moxi://app/unknown/", undefined],
  ["moxi://app:80/launcher/", undefined],
])("serves renderer files without allowing path escape: %s", (url, expected) => {
  expect(
    resolveRendererPath(url, {
      launcher: process.platform === "win32" ? "C:\\built\\launcher" : "/built/launcher",
      game: process.platform === "win32" ? "C:\\built\\game" : "/built/game",
      "plugin-host": process.platform === "win32" ? "C:\\built\\plugin-host" : "/built/plugin-host",
    }),
  ).toBe(expected);
});
