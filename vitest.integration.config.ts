import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    api: {
      host: process.env.VITEST_API_HOST || "127.0.0.1",
      port: Number(process.env.VITEST_API_PORT || 51204),
      strictPort: false,
    },
    open: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    maxConcurrency: 5,
    pool: "threads",
    // 仅运行"需要数据库"的集成测试（避免把所有重依赖测试默认跑进 CI）
    // 说明：包括 tests/integration/ 目录和从主配置排除的需要 DB 的 API 测试
    include: [
      "tests/integration/webhook-targets-crud.test.ts",
      "tests/integration/notification-bindings.test.ts",
      "tests/integration/auth.test.ts",
      // 需要 DB 的 API 测试（从主配置排除，在此运行）
      "tests/api/users-actions.test.ts",
      "tests/api/providers-actions.test.ts",
      "tests/api/keys-actions.test.ts",
      "tests/api/my-usage-readonly.test.ts",
    ],
    exclude: ["node_modules", ".next", "dist", "build", "coverage", "**/*.d.ts"],
    reporters: ["verbose"],
    isolate: true,
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    resolveSnapshotPath: (testPath, snapExtension) => {
      return testPath.replace(/\.test\.([tj]sx?)$/, `${snapExtension}.$1`);
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/server-only.mock.ts"),
    },
  },
});
