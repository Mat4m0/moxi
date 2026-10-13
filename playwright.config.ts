import { stageBudget } from "./e2e/budget.ts";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: ".evidence/t1/playwright",
  workers: 1,
  timeout: 12 * stageBudget,
  expect: { timeout: stageBudget },
  use: { actionTimeout: stageBudget, navigationTimeout: stageBudget },
  reporter: "list",
});
