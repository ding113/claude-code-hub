import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Dashboard Logs（Session ID + 秒级时间筛选）专项覆盖率配置
 *
 * 目的：
 * - 仅统计本需求可纯函数化/可隔离模块的覆盖率（>= 90%）
 * - 仍然执行关键回归相关的单测集合，避免只跑“指标好看”的子集
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],

    include: [
      "tests/unit/repository/usage-logs-sessionid-filter.test.ts",
      "tests/unit/repository/usage-logs-sessionid-suggestions.test.ts",
      "tests/unit/dashboard-logs-query-utils.test.ts",
      "tests/unit/dashboard-logs-time-range-utils.test.ts",
      "tests/unit/dashboard-logs-filters-time-range.test.tsx",
      "tests/unit/dashboard-logs-sessionid-suggestions-ui.test.tsx",
      "tests/unit/dashboard-logs-virtualized-special-settings-ui.test.tsx",
      "src/app/[locale]/dashboard/logs/_components/usage-logs-table.test.tsx",
    ],
    exclude: ["node_modules", ".next", "dist", "build", "coverage", "tests/integration/**"],

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json", "lcov"],
      reportsDirectory: "./coverage-logs-sessionid-time-filter",

      include: [
        "src/app/[locale]/dashboard/logs/_utils/logs-query.ts",
        "src/app/[locale]/dashboard/logs/_utils/time-range.ts",
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
