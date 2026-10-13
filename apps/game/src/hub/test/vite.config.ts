import { stageBudget } from "../../../../../e2e/budget.ts";
import { resolve } from "node:path";
import { defineConfig } from "vite-plus";
import vue from "@vitejs/plugin-vue";
import { playwright } from "vite-plus/test/browser-playwright";

const provider = playwright({
  launchOptions: { timeout: stageBudget },
  actionTimeout: stageBudget,
});
// Choose an OS port after Vitest resolves its fixed default, and launch after server setup.
provider.prewarm = ({ config, vitest }) => {
  config.api.port = 0;
  vitest.config.api.port = 0;
};

export default defineConfig({
  root: resolve(import.meta.dirname, "../../../../.."),
  plugins: [vue()],
  test: {
    watch: false,
    testTimeout: stageBudget,
    include: ["apps/game/src/hub/hub.contract.test.ts"],
    browser: {
      enabled: true,
      connectTimeout: stageBudget,
      headless: true,
      screenshotFailures: false,
      provider,
      instances: [{ browser: "chromium" }],
    },
  },
});
