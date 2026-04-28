import { createTestRunnerConfig } from "../vitest.base";

/**
 * /api/v1 管理 API 与前端类型化客户端的测试运行配置。
 *
 * 与 integration.config.ts 同形，但允许文件并行：
 * - 管理 API 单元测试（不依赖真实 PG/Redis）
 * - 前端 fetcher / 错误国际化测试
 */
export default createTestRunnerConfig({
  environment: "node",
  testTimeout: 20000,
  hookTimeout: 20000,
  fileParallelism: true,
  testFiles: [
    "tests/unit/api/v1/**/*.test.ts",
    "tests/api/v1/**/*.test.ts",
    "tests/unit/frontend/**/*.test.ts",
  ],
  api: {
    host: process.env.VITEST_API_HOST || "127.0.0.1",
    port: Number(process.env.VITEST_API_PORT || 51205),
    strictPort: false,
  },
});
