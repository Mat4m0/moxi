import vue from "@vitejs/plugin-vue";
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

const desktopImports = [
  "@moxi/contracts",
  "@moxi/contracts/windows",
  "@moxi/gwkit",
  "arktype",
  "node:*",
  "node:*/*",
  ...builtinModules,
];
const rendererPackages = ["desktop", "launcher", "game", "plugin-host"];

export default defineConfig({
  plugins: [vue()],
  fmt: { ignorePatterns: ["AGENTS.md", "CLAUDE.md", "docs/**"] },
  lint: {
    options: { typeAware: true, typeCheck: true },
    rules: { "typescript/no-explicit-any": "error" },
    overrides: [
      { files: ["packages/gwkit/**"], rules: imports(["arktype"], ["contracts", "sdk", "ui"]) },
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
          ["vue", "@moxi/contracts", "@moxi/ui", "@moxi/ui/*", "lucide-vue-next"],
          rendererPackages.filter((name) => name !== "launcher"),
        ),
      },
      {
        files: ["apps/game/**"],
        rules: imports(
          [
            "vue",
            "@moxi/contracts",
            "@moxi/ui",
            "@moxi/ui/*",
            "@moxi/gwkit",
            "@moxi/sdk",
            "@moxi/sdk/host",
          ],
          rendererPackages.filter((name) => name !== "game"),
        ),
      },
      {
        files: ["apps/plugin-host/**"],
        rules: imports(
          [
            "vue",
            "arktype",
            "@moxi/contracts",
            "@moxi/ui",
            "@moxi/ui/*",
            "@moxi/sdk",
            "@moxi/sdk/host",
          ],
          rendererPackages.filter((name) => name !== "plugin-host"),
        ),
      },
      // Tests, e2e and scripts may use dev tooling, but still never reach into another package's files.
      {
        files: ["**/*.test.ts", "**/test/**", "e2e/**", "scripts/**", "**/vite.config.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  regex: "^\\.{1,2}/(?:.*/)?(?:apps|packages|plugins|tools)(/|$)",
                  message: "Use the permitted workspace entry points for other packages.",
                },
              ],
            },
          ],
        },
      },
    ],
  },
  test: {
    passWithNoTests: true,
    watch: false,
    exclude: ["**/node_modules/**", "**/.git/**", "**/hub.contract.test.ts"],
  },
});
