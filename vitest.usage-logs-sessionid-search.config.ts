import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Dashboard Logs（Session ID 搜索：前缀匹配 + LIKE 转义）专项覆盖率配置
 *
 * 目的：
 * - 仅统计本需求可隔离模块的覆盖率（>= 90%）
 * - 同时执行关联单测集合，避免只跑“指标好看”的子集
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],

    include: [
      "tests/unit/repository/usage-logs-sessionid-suggestions.test.ts",
      "tests/unit/repository/usage-logs-sessionid-filter.test.ts",
      "tests/unit/repository/warmup-stats-exclusion.test.ts",
      "tests/unit/repository/escape-like.test.ts",
      "tests/unit/lib/constants/usage-logs.constants.test.ts",
      "tests/unit/lib/utils/clipboard.test.ts",
    ],
    exclude: ["node_modules", ".next", "dist", "build", "coverage", "tests/integration/**"],

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json", "lcov"],
      reportsDirectory: "./coverage-usage-logs-sessionid-search",

      include: [
        "src/repository/_shared/like.ts",
        "src/lib/constants/usage-logs.constants.ts",
        "src/lib/utils/clipboard.ts",
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
