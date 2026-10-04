import { resolve } from "node:path";
import { defineConfig } from "vite-plus";
import vue from "@vitejs/plugin-vue";
import { playwright } from "vite-plus/test/browser-playwright";

export default defineConfig({
  root: resolve(import.meta.dirname, "../../../../.."),
  plugins: [vue()],
  test: {
    watch: false,
    expect: { poll: { timeout: 500 } },
    api: { host: "127.0.0.1", port: 4618, strictPort: true },
    include: ["apps/game/src/hub/hub.contract.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright({ actionTimeout: 1000 }),
      instances: [{ browser: "chromium" }],
    },
  },
});
