import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Codex Session ID 补全专项覆盖率配置
 *
 * 目的：
 * - 仅统计 Codex Session ID 补全模块，避免把 Next/DB/Redis 等重模块纳入阈值
 * - 为“会话粘性/供应商复用稳定性”类功能设置覆盖率门槛（>= 80%）
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],

    include: ["tests/unit/codex/session-completer.test.ts"],
    exclude: ["node_modules", ".next", "dist", "build", "coverage", "tests/integration/**"],

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      reportsDirectory: "./coverage-codex-session-id-completer",

      include: ["src/app/v1/_lib/codex/session-completer.ts"],
      exclude: ["node_modules/", "tests/", "**/*.d.ts", ".next/"],

      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
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
