import { defineConfig } from "vite-plus";
export default defineConfig({
  pack: [
    {
      entry: { main: "src/shell/main.ts" },
      format: "esm",
      outDir: "dist",
      platform: "node",
      deps: {
        neverBundle: ["electron"],
        alwaysBundle: [/^@moxi\/contracts(?:\/|$)/, "arktype", /^@ark\//],
        onlyBundle: false as const,
      },
      dts: false,
      clean: false,
    },
    ...(["launcher", "game", "pluginHost"] as const).map((kind) => ({
      entry: { [kind]: `src/shell/preload-${kind}.ts` },
      format: "cjs" as const,
      outDir: "dist",
      platform: "node" as const,
      deps: {
        neverBundle: ["electron"],
        alwaysBundle: [/^@moxi\/contracts(?:\/|$)/],
        onlyBundle: false as const,
      },
      dts: false,
      clean: false,
    })),
  ],
});
