import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Proxy GuardPipeline 专项覆盖率配置
 *
 * 目的：
 * - 针对 /v1/chat/completions 与 /v1/responses 的 GuardPipeline 接入做强约束
 * - 只统计本次相关模块，避免把需要完整 Next/DB/Redis 的重模块纳入阈值
 * - 覆盖率阈值：>= 90%
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],

    include: [
      "tests/unit/proxy/chat-completions-handler-guard-pipeline.test.ts",
      "tests/unit/proxy/guard-pipeline-warmup.test.ts",
    ],
    exclude: ["node_modules", ".next", "dist", "build", "coverage", "tests/integration/**"],

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      reportsDirectory: "./coverage-proxy-guard-pipeline",

      include: [
        "src/app/v1/_lib/codex/chat-completions-handler.ts",
        "src/app/v1/_lib/proxy/guard-pipeline.ts",
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
