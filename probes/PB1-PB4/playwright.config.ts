import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "launcher-idle.e2e.ts",
  outputDir: "out/playwright",
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 60_000 },
  reporter: [["list"]],
});
