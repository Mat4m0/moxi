import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: ".evidence/c2/playwright",
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: [["list", { printSteps: true }]],
});
