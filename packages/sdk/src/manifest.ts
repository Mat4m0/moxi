import type { Icon, Profession } from "./nodes.ts";
import type { Manifest } from "./protocol.ts";

export class ManifestError extends Error {
  constructor(path: string, rule: string) {
    super(`${path}: ${rule}`);
    this.name = "ManifestError";
  }
}

function fail(path: string, rule: string): never {
  throw new ManifestError(path, rule);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isObject(value)) fail(path, "must be an object");
  return value;
}

function string(value: unknown, path: string, max?: number): string {
  if (typeof value !== "string") fail(path, "must be a string");
  if (max !== undefined && (value.length < 1 || value.length > max))
    fail(path, `must be 1–${max} characters`);
  return value;
}

function matching(value: unknown, path: string, pattern: RegExp, rule: string): string {
  const result = string(value, path);
  if (!pattern.test(result)) fail(path, rule);
  return result;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function unique(values: readonly string[], path: string) {
  const seen = new Set<string>();
  for (const [i, value] of values.entries()) {
    if (seen.has(value)) fail(`${path}[${i}]`, "must be unique");
    seen.add(value);
  }
}

function profession(value: unknown, path: string): Profession {
  switch (value) {
    case "warrior":
    case "ranger":
    case "monk":
    case "necromancer":
    case "mesmer":
    case "elementalist":
    case "assassin":
    case "ritualist":
    case "paragon":
    case "dervish":
      return value;
    default:
      return fail(path, "must be a profession");
  }
}

function icon(value: unknown, path: string): Icon {
  const v = object(value, path);
  const keys = Object.keys(v);
  if (keys.length !== 1 || !["glyph", "skill", "profession"].includes(keys[0] ?? ""))
    fail(path, "must contain exactly one of glyph, skill or profession");
  if ("glyph" in v) return { glyph: string(v.glyph, `${path}.glyph`) };
  if ("skill" in v) {
    if (typeof v.skill !== "number" || !Number.isInteger(v.skill) || v.skill < 0)
      fail(`${path}.skill`, "must be an integer ≥ 0");
    return { skill: v.skill };
  }
  return { profession: profession(v.profession, `${path}.profession`) };
}

export function parseManifest(value: unknown): Manifest {
  const v = object(value, "manifest");
  for (const key of Object.keys(v)) {
    if (
      ![
        "id",
        "name",
        "version",
        "api",
        "description",
        "icon",
        "permissions",
        "activation",
        "commands",
        "scopes",
        "settings",
      ].includes(key)
    )
      fail(key, "unknown field");
  }
  const id = matching(v.id, "id", /^[a-z0-9]+(\.[a-z0-9-]+)+$/, "must be a dotted lowercase id");
  const name = string(v.name, "name", 40);
  const version = matching(
    v.version,
    "version",
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/,
    "must be x.y.z with an optional semver prerelease",
  );
  if (v.api !== 1) fail("api", "must be 1");
  const description = string(v.description, "description", 200);
  const permissions = array(v.permissions, "permissions").map((p, i) => {
    const path = `permissions[${i}]`;
    const permission = string(p, path);
    if (
      !["game.player", "game.target", "game.map", "game.builds.load", "game.travel"].includes(
        permission,
      ) &&
      !/^net:(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
        permission,
      )
    )
      fail(path, "must be a game permission or net:<hostname>");
    return permission;
  });
  unique(permissions, "permissions");
  const activation = array(v.activation, "activation").map((a, i) => {
    if (a !== "game" && a !== "hub" && a !== "command")
      fail(`activation[${i}]`, "must be game, hub or command");
    return a;
  });
  if (activation.length === 0) fail("activation", "must not be empty");
  unique(activation, "activation");
  const commands = array(v.commands, "commands").map((c, i) => {
    const path = `commands[${i}]`;
    const command = object(c, path);
    return {
      id: matching(command.id, `${path}.id`, /^[a-z0-9-]+$/, "must be a lowercase command id"),
      title: string(command.title, `${path}.title`, 60),
      ...(command.subtitle === undefined
        ? {}
        : { subtitle: string(command.subtitle, `${path}.subtitle`) }),
      ...(command.keywords === undefined
        ? {}
        : {
            keywords: array(command.keywords, `${path}.keywords`).map((k, j) =>
              string(k, `${path}.keywords[${j}]`),
            ),
          }),
      ...(command.icon === undefined ? {} : { icon: icon(command.icon, `${path}.icon`) }),
    };
  });
  unique(
    commands.map((c) => c.id),
    "commands",
  );
  const scopes =
    v.scopes === undefined
      ? undefined
      : array(v.scopes, "scopes").map((s, i) =>
          matching(s, `scopes[${i}]`, /^[a-z]+$/, "must be a lowercase word"),
        );
  if (scopes) unique(scopes, "scopes");
  const settings =
    v.settings === undefined
      ? undefined
      : array(v.settings, "settings").map((s, i): NonNullable<Manifest["settings"]>[number] => {
          const path = `settings[${i}]`;
          const setting = object(s, path);
          const key = matching(
            setting.key,
            `${path}.key`,
            /^[a-zA-Z][a-zA-Z0-9]*$/,
            "must start with a letter and contain only letters and digits",
          );
          const label = string(setting.label, `${path}.label`, 60);
          const type = setting.type;
          if (type !== "toggle" && type !== "number")
            fail(`${path}.type`, "must be toggle or number");
          const defaultValue = setting.default;
          if (type === "toggle" && typeof defaultValue !== "boolean")
            fail(`${path}.default`, "must be a boolean for a toggle");
          if (
            type === "number" &&
            (typeof defaultValue !== "number" || !Number.isFinite(defaultValue))
          )
            fail(`${path}.default`, "must be a finite number for a number setting");
          if (typeof defaultValue !== "boolean" && typeof defaultValue !== "number")
            fail(`${path}.default`, "must be a boolean or number");
          return { key, label, type, default: defaultValue };
        });
  if (settings)
    unique(
      settings.map((s) => s.key),
      "settings",
    );
  return {
    id,
    name,
    version,
    api: 1,
    description,
    permissions,
    activation,
    commands,
    ...(v.icon === undefined ? {} : { icon: icon(v.icon, "icon") }),
    ...(scopes === undefined ? {} : { scopes }),
    ...(settings === undefined ? {} : { settings }),
  };
}
