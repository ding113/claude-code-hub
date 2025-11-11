import { defineConfig, devices } from "@playwright/test";

const PORT = 13500;
const BASE_URL = `http://localhost:${PORT}`;
const shouldStartWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER !== "1"; // opt-out for sandboxed envs

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60 * 1000,
  expect: {
    timeout: 10 * 1000,
  },
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: shouldStartWebServer
    ? {
        command: "pnpm dev --hostname 127.0.0.1",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
        env: {
          HOSTNAME: "127.0.0.1",
          HOST: "127.0.0.1",
        },
      }
    : undefined,
  outputDir: "test-results/playwright",
});
