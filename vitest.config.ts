import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ==================== 全局配置 ====================
    globals: true, // 使用全局 API (describe, test, expect)
    projects: [
      {
        extends: true,
        test: {
          environment: "happy-dom",
          include: [
            "tests/unit/**/*.{test,spec}.tsx",
            "tests/api/**/*.{test,spec}.tsx",
            "src/**/*.{test,spec}.tsx",
          ],
        },
      },
    ],

    // 测试前置脚本
    setupFiles: ["./tests/setup.ts"],

    // UI 配置
    // Vitest UI/Server 使用的是 test.api（不是 Vite 的 server 配置）
    // 默认仅允许本机访问，避免浏览器尝试连接 0.0.0.0 导致 UI 显示 Disconnected
    api: {
      host: process.env.VITEST_API_HOST || "127.0.0.1",
      port: Number(process.env.VITEST_API_PORT || 51204),
      strictPort: false,
    },
    open: false, // 不自动打开浏览器（手动访问 http://localhost:51204/__vitest__/）

    // ==================== 覆盖率配置 ====================
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json"],
      reportsDirectory: "./coverage",

      // 排除文件
      exclude: ["node_modules/", "tests/", "*.config.*", "**/*.d.ts", ".next/", "dist/", "build/"],

      // 覆盖率阈值（可选）
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 40,
        statements: 50,
      },

      // 包含的文件
      include: ["src/**/*.ts", "src/**/*.tsx"],
    },

    // ==================== 超时配置 ====================
    testTimeout: 10000, // 单个测试超时 10 秒
    hookTimeout: 10000, // 钩子函数超时 10 秒

    // ==================== 并发配置 ====================
    maxConcurrency: 5, // 最大并发测试数
    pool: "threads", // 使用线程池（推荐）

    // ==================== 文件匹配 ====================
    include: [
      "tests/unit/**/*.{test,spec}.ts", // 单元测试
      "tests/api/**/*.{test,spec}.ts", // API 测试
      "src/**/*.{test,spec}.ts", // 支持源码中的测试
    ],
    exclude: [
      "node_modules",
      ".next",
      "dist",
      "build",
      "coverage",
      "**/*.d.ts",
      // 排除需要 Next.js 完整运行时的集成测试
      "tests/integration/**",
      "tests/api/users-actions.test.ts",
      "tests/api/providers-actions.test.ts",
      "tests/api/keys-actions.test.ts",
    ],

    // ==================== 监听模式配置 ====================
    // 不在配置文件中强制 watch=false，否则 vitest --ui 可能会在执行完一次后退出，UI 显示 Disconnected
    // 通过命令行参数控制：vitest（watch）/ vitest run（单次运行）

    // ==================== 报告器配置 ====================
    reporters: ["verbose"], // 详细输出

    // ==================== 隔离配置 ====================
    isolate: true, // 每个测试文件在独立环境中运行

    // ==================== Mock 配置 ====================
    mockReset: true, // 每个测试后重置 mock
    restoreMocks: true, // 每个测试后恢复原始实现
    clearMocks: true, // 每个测试后清除 mock 调用记录

    // ==================== 快照配置 ====================
    resolveSnapshotPath: (testPath, snapExtension) => {
      return testPath.replace(/\.test\.([tj]sx?)$/, `${snapExtension}.$1`);
    },
  },

  // ==================== 路径别名（与 tsconfig.json 保持一致）====================
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Mock server-only 包，避免测试环境报错
      "server-only": path.resolve(__dirname, "./tests/server-only.mock.ts"),
    },
  },
});
