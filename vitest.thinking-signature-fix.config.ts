import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Thinking Signature Fix 专项覆盖率配置
 *
 * 目的：
 * - 该功能属于“故障恢复/降级重试”类逻辑，必须有高覆盖率以保证稳定性
 * - 不把 proxy 转发主链路的大文件（如 forwarder.ts）纳入 80% 阈值，避免指标失真
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],

    include: [
      "tests/unit/proxy/thinking-signature-recovery.test.ts",
      "tests/unit/proxy/proxy-forwarder-thinking-signature-recovery.test.ts",
    ],
    exclude: ["node_modules", ".next", "dist", "build", "coverage", "tests/integration/**"],

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      reportsDirectory: "./coverage-thinking-signature-fix",

      include: ["src/app/v1/_lib/proxy/thinking-signature-recovery.ts"],
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
