import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * thinking signature 整流器专项覆盖率配置
 *
 * 目的：
 * - 仅统计本次新增的整流器模块，避免把 Next/DB/Redis 等重模块纳入阈值
 * - 对“错误整流 + 重试一次”这类稳定性修复设置覆盖率门槛（>= 80%）
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],

    include: [
      "src/app/v1/_lib/proxy/thinking-signature-rectifier.test.ts",
      "tests/unit/proxy/proxy-forwarder-thinking-signature-rectifier.test.ts",
    ],
    exclude: ["node_modules", ".next", "dist", "build", "coverage", "tests/integration/**"],

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      reportsDirectory: "./coverage-thinking-signature-rectifier",

      include: ["src/app/v1/_lib/proxy/thinking-signature-rectifier.ts"],
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
