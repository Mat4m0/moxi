import { defineConfig } from "vite-plus";

// Packs the PB14 mini Main with the same bundler settings as apps/desktop.
export default defineConfig({
  pack: [
    {
      entry: { main: "src/main.ts" },
      format: "esm",
      outDir: "dist",
      platform: "node",
      deps: {
        neverBundle: ["electron"],
        alwaysBundle: [/^@moxi\/contracts(?:\/|$)/, "arktype", /^@ark\//],
        onlyBundle: false as const,
      },
      dts: false,
      clean: true,
    },
  ],
});
