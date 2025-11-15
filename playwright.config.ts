import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E Test Configuration
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./e2e",
  // 超时时间（30秒）
  timeout: 30 * 1000,
  // 期望超时（5秒）
  expect: {
    timeout: 5000,
  },
  // 失败时重试1次
  retries: process.env.CI ? 2 : 0,
  // 并行工作者
  workers: process.env.CI ? 1 : undefined,
  // 报告器
  reporter: "html",
  // 共享配置
  use: {
    // Base URL
    baseURL: process.env.BASE_URL || "http://localhost:13500",
    // 截图
    screenshot: "only-on-failure",
    // 视频
    video: "retain-on-failure",
    // 追踪
    trace: "on-first-retry",
  },

  // 项目配置
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // 开发服务器配置（注释掉，手动启动）
  // webServer: {
  //   command: "pnpm dev",
  //   url: "http://localhost:13500",
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120 * 1000,
  //   env: {
  //     ...process.env,
  //     NEXT_TELEMETRY_DISABLED: "1",
  //     PORT: "13500",
  //   },
  // },
});
