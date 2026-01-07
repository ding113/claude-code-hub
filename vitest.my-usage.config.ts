import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * my-usage 专项覆盖率配置
 *
 * 目的：
 * - 仅统计本次改动相关模块，避免把需要完整 Next/Redis/Bull 的重模块纳入全局阈值
 * - 对“只读 Key 自助查询”这类安全敏感接口设置更高覆盖率门槛（>= 80%）
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],

    include: [
      "tests/api/my-usage-readonly.test.ts",
      "tests/api/api-actions-integrity.test.ts",
      "tests/integration/auth.test.ts",
      "tests/api/action-adapter-openapi.unit.test.ts",
    ],
    exclude: ["node_modules", ".next", "dist", "build", "coverage"],

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      reportsDirectory: "./coverage-my-usage",

      include: [
        "src/actions/my-usage.ts",
        "src/lib/auth.ts",
        "src/lib/api/action-adapter-openapi.ts",
      ],
      exclude: ["node_modules/", "tests/", "**/*.d.ts", ".next/"],

      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
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
