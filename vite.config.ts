import { builtinModules } from "node:module";
import { defineConfig } from "vite-plus";
import type { OxlintOverride } from "vite-plus/lint";

// Cross-package imports use workspace entry points, never relative source paths.
function imports(allowed: string[], otherPackages: string[], sdkTypesOnly = false) {
  const scopes = allowed
    .filter((name) => name.startsWith("@"))
    .map((name) => name.slice(0, name.indexOf("/")));
  return {
    "no-restricted-imports": [
      "error",
      {
        paths: sdkTypesOnly
          ? [{ name: "@moxi/sdk", allowTypeImports: true, message: "UI may use SDK types only." }]
          : [],
        // Oxlint stops at an allowlist match, so relative restrictions come first.
        patterns: [
          {
            regex: `^\\.{1,2}/(?:.*/)?(?:${["apps", "packages", "plugins", "tools", ...otherPackages].join("|")})(/|$)`,
            message: "Use the permitted workspace entry points for other packages.",
          },
          {
            group: [
              "*",
              "!./**",
              "!../**",
              ...scopes.map((name) => `!${name}`),
              ...allowed.map((name) => `!${name}`),
            ],
            message: `Allowed external imports: ${allowed.join(", ") || "none"}.`,
          },
        ],
      },
    ],
  } satisfies OxlintOverride["rules"];
}

const desktopImports = ["@moxi/contracts", "@moxi/gwkit", "node:*", ...builtinModules];
const rendererPackages = ["desktop", "launcher", "game", "plugin-host"];

export default defineConfig({
  fmt: { ignorePatterns: ["AGENTS.md", "CLAUDE.md", "docs/**"] },
  lint: {
    options: { typeAware: true, typeCheck: true },
    rules: { "typescript/no-explicit-any": "error" },
    overrides: [
      { files: ["packages/gwkit/**"], rules: imports([], ["contracts", "sdk", "ui"]) },
      {
        files: ["packages/sdk/**"],
        rules: imports(["@vue/reactivity"], ["contracts", "gwkit", "ui"]),
      },
      { files: ["packages/contracts/**"], rules: imports(["arktype"], ["sdk", "gwkit", "ui"]) },
      {
        files: ["packages/ui/**"],
        rules: imports(["vue", "@moxi/sdk"], ["contracts", "gwkit", "sdk"], true),
      },
      { files: ["plugins/**"], rules: imports(["@moxi/sdk"], ["contracts", "gwkit", "ui", "sdk"]) },
      {
        files: ["apps/desktop/**"],
        rules: imports(desktopImports, ["launcher", "game", "plugin-host"]),
      },
      {
        files: ["apps/desktop/src/shell/**"],
        rules: imports([...desktopImports, "electron"], ["launcher", "game", "plugin-host"]),
      },
      {
        files: ["apps/launcher/**"],
        rules: imports(
          ["vue", "@moxi/contracts", "@moxi/ui"],
          rendererPackages.filter((name) => name !== "launcher"),
        ),
      },
      {
        files: ["apps/game/**"],
        rules: imports(
          ["vue", "@moxi/contracts", "@moxi/ui", "@moxi/gwkit", "@moxi/sdk"],
          rendererPackages.filter((name) => name !== "game"),
        ),
      },
      {
        files: ["apps/plugin-host/**"],
        rules: imports(
          ["vue", "@moxi/contracts", "@moxi/ui", "@moxi/sdk"],
          rendererPackages.filter((name) => name !== "plugin-host"),
        ),
      },
    ],
  },
  test: { passWithNoTests: true, watch: false },
});
