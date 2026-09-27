import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: { command: "pnpm dev:mock", url: "http://localhost:1420", reuseExistingServer: true },
});
