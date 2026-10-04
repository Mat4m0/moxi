import { expect, test } from "vite-plus/test";
import { ManifestError, parseManifest } from "@moxi/sdk/host";
import { createTestHost } from "@moxi/sdk/testing";

const valid = {
  id: "author.plugin",
  name: "Plugin",
  version: "1.2.3-beta.1",
  api: 1,
  description: "A plugin",
  permissions: [],
  activation: ["hub"],
  commands: [],
};
const command = { id: "open", title: "Open" };
const setting = { key: "enabled", label: "Enabled", type: "toggle", default: true };

const invalid: [string, unknown, string][] = [
  ["non-object input", null, "manifest: must be an object"],
  ["missing id", { ...valid, id: undefined }, "id: must be a string"],
  ["invalid id", { ...valid, id: "Plugin" }, "id: must be a dotted lowercase id"],
  ["empty name", { ...valid, name: "" }, "name: must be 1–40 characters"],
  ["long name", { ...valid, name: "x".repeat(41) }, "name: must be 1–40 characters"],
  [
    "invalid version",
    { ...valid, version: "1.2" },
    "version: must be x.y.z with an optional semver prerelease",
  ],
  [
    "leading zero version",
    { ...valid, version: "01.2.3" },
    "version: must be x.y.z with an optional semver prerelease",
  ],
  [
    "leading zero prerelease",
    { ...valid, version: "1.2.3-01" },
    "version: must be x.y.z with an optional semver prerelease",
  ],
  ["unsupported api", { ...valid, api: 2 }, "api: must be 1"],
  ["empty description", { ...valid, description: "" }, "description: must be 1–200 characters"],
  [
    "long description",
    { ...valid, description: "x".repeat(201) },
    "description: must be 1–200 characters",
  ],
  [
    "non-array permissions",
    { ...valid, permissions: "game.player" },
    "permissions: must be an array",
  ],
  [
    "unknown permission",
    { ...valid, permissions: ["game.memory"] },
    "permissions[0]: must be a game permission or net:<hostname>",
  ],
  [
    "network URL",
    { ...valid, permissions: ["net:https://example.com"] },
    "permissions[0]: must be a game permission or net:<hostname>",
  ],
  [
    "invalid hostname",
    { ...valid, permissions: ["net:-example.com"] },
    "permissions[0]: must be a game permission or net:<hostname>",
  ],
  [
    "duplicate permission",
    { ...valid, permissions: ["game.map", "game.map"] },
    "permissions[1]: must be unique",
  ],
  ["empty activation", { ...valid, activation: [] }, "activation: must not be empty"],
  [
    "unknown activation",
    { ...valid, activation: ["launcher"] },
    "activation[0]: must be game, hub or command",
  ],
  [
    "duplicate activation",
    { ...valid, activation: ["hub", "hub"] },
    "activation[1]: must be unique",
  ],
  [
    "invalid command id",
    { ...valid, commands: [{ ...command, id: "Open" }] },
    "commands[0].id: must be a lowercase command id",
  ],
  ["duplicate command", { ...valid, commands: [command, command] }, "commands[1]: must be unique"],
  [
    "empty command title",
    { ...valid, commands: [{ ...command, title: "" }] },
    "commands[0].title: must be 1–60 characters",
  ],
  [
    "long command title",
    { ...valid, commands: [{ ...command, title: "x".repeat(61) }] },
    "commands[0].title: must be 1–60 characters",
  ],
  [
    "invalid subtitle",
    { ...valid, commands: [{ ...command, subtitle: 1 }] },
    "commands[0].subtitle: must be a string",
  ],
  [
    "invalid keywords",
    { ...valid, commands: [{ ...command, keywords: "open" }] },
    "commands[0].keywords: must be an array",
  ],
  [
    "invalid keyword",
    { ...valid, commands: [{ ...command, keywords: [1] }] },
    "commands[0].keywords[0]: must be a string",
  ],
  [
    "invalid command icon",
    { ...valid, commands: [{ ...command, icon: { skill: -1 } }] },
    "commands[0].icon.skill: must be an integer ≥ 0",
  ],
  ["invalid scope", { ...valid, scopes: ["Build"] }, "scopes[0]: must be a lowercase word"],
  ["duplicate scope", { ...valid, scopes: ["build", "build"] }, "scopes[1]: must be unique"],
  [
    "invalid setting key",
    { ...valid, settings: [{ ...setting, key: "1key" }] },
    "settings[0].key: must start with a letter and contain only letters and digits",
  ],
  ["duplicate setting", { ...valid, settings: [setting, setting] }, "settings[1]: must be unique"],
  [
    "empty setting label",
    { ...valid, settings: [{ ...setting, label: "" }] },
    "settings[0].label: must be 1–60 characters",
  ],
  [
    "long setting label",
    { ...valid, settings: [{ ...setting, label: "x".repeat(61) }] },
    "settings[0].label: must be 1–60 characters",
  ],
  [
    "unknown setting type",
    { ...valid, settings: [{ ...setting, type: "text" }] },
    "settings[0].type: must be toggle or number",
  ],
  [
    "wrong toggle default",
    { ...valid, settings: [{ ...setting, default: 1 }] },
    "settings[0].default: must be a boolean for a toggle",
  ],
  [
    "wrong number default",
    { ...valid, settings: [{ ...setting, type: "number", default: true }] },
    "settings[0].default: must be a finite number for a number setting",
  ],
  [
    "infinite default",
    { ...valid, settings: [{ ...setting, type: "number", default: Infinity }] },
    "settings[0].default: must be a finite number for a number setting",
  ],
  [
    "NaN default",
    { ...valid, settings: [{ ...setting, type: "number", default: NaN }] },
    "settings[0].default: must be a finite number for a number setting",
  ],
  ["invalid glyph", { ...valid, icon: { glyph: 1 } }, "icon.glyph: must be a string"],
  ["negative skill", { ...valid, icon: { skill: -1 } }, "icon.skill: must be an integer ≥ 0"],
  ["fractional skill", { ...valid, icon: { skill: 1.5 } }, "icon.skill: must be an integer ≥ 0"],
  [
    "unknown profession",
    { ...valid, icon: { profession: "druid" } },
    "icon.profession: must be a profession",
  ],
  [
    "ambiguous icon",
    { ...valid, icon: { glyph: "book", skill: 0 } },
    "icon: must contain exactly one of glyph, skill or profession",
  ],
  ["unknown top-level key", { ...valid, permisions: [] }, "permisions: unknown field"],
];

test.each(invalid)("rejects %s instead of starting a broken plugin", (_bug, value, message) => {
  expect(() => parseManifest(value)).toThrowError(message);
  try {
    parseManifest(value);
  } catch (error) {
    expect(error).toBeInstanceOf(ManifestError);
    if (!(error instanceof ManifestError)) throw error;
    expect(error.message).toBe(message);
  }
});

test("preserves supported permissions, icons and numeric settings", () => {
  const value = {
    ...valid,
    permissions: [
      "game.player",
      "game.target",
      "game.map",
      "game.builds.load",
      "game.travel",
      "net:example.com",
    ],
    activation: ["game", "hub", "command"],
    icon: { skill: 0 },
    commands: [
      { ...command, icon: { profession: "monk" }, subtitle: "Details", keywords: ["open"] },
    ],
    scopes: ["build"],
    settings: [{ key: "amount", label: "Amount", type: "number", default: 0 }],
  };
  expect(parseManifest(value)).toEqual(value);
});

test("test host rejects malformed input before executing plugin setup", async () => {
  let started = false;
  await expect(
    createTestHost({ ...valid, api: 2 }, () => {
      started = true;
    }),
  ).rejects.toThrowError("api: must be 1");
  expect(started).toBe(false);
});
