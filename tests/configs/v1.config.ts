import { createTestRunnerConfig } from "../vitest.base";

/** 默认 vitest UI 端口（与现有约定保持一致） */
const DEFAULT_VITEST_API_PORT = 51205;

/** 解析 VITEST_API_PORT，校验范围合法时使用，否则回退默认值 */
function resolveTestApiPort(): number {
  const raw = process.env.VITEST_API_PORT;
  if (!raw) return DEFAULT_VITEST_API_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return DEFAULT_VITEST_API_PORT;
}

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
    port: resolveTestApiPort(),
    strictPort: false,
  },
});
