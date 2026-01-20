import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Include CCH session id in client errors - scoped coverage config
 *
 * 目的：
 * - 验证错误响应中附带 sessionId 的行为（message + header）
 * - 覆盖率只统计本次改动相关模块，避免引入 Next/DB/Redis 重模块
 * - 覆盖率阈值：>= 90%
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],

    include: [
      "tests/unit/proxy/responses-session-id.test.ts",
      "tests/unit/proxy/proxy-handler-session-id-error.test.ts",
      "tests/unit/proxy/error-handler-session-id-error.test.ts",
      "tests/unit/proxy/chat-completions-handler-guard-pipeline.test.ts",
    ],
    exclude: ["node_modules", ".next", "dist", "build", "coverage", "tests/integration/**"],

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      reportsDirectory: "./coverage-include-session-id-in-errors",

      include: [
        "src/app/v1/_lib/proxy/error-session-id.ts",
        "src/app/v1/_lib/proxy-handler.ts",
        "src/app/v1/_lib/codex/chat-completions-handler.ts",
      ],
      exclude: ["node_modules/", "tests/", "**/*.d.ts", ".next/"],

      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },

    reporters: ["verbose"],
    isolate: true,
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/server-only.mock.ts"),
    },
  },
});
