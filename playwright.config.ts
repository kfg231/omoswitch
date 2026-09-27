import { defineConfig } from "@playwright/test";

// Chromium download from cdn.playwright.dev times out on this machine, so the
// suite runs against the locally installed Edge (same Chromium engine).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    channel: "msedge",
    locale: "ja-JP",
    viewport: { width: 1440, height: 960 },
  },
  webServer: {
    command: "pnpm dev:mock",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
