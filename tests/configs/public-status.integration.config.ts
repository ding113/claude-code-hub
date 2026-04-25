import { createTestRunnerConfig } from "../vitest.base";

export default createTestRunnerConfig({
  environment: "node",
  testTimeout: 20000,
  hookTimeout: 20000,
  maxWorkers: 2,
  fileParallelism: false,
  testFiles: [
    "tests/integration/public-status/route-redis-only.test.ts",
    "tests/integration/public-status/config-publish.test.ts",
    "tests/integration/public-status/rebuild-lifecycle.test.ts",
  ],
  api: {
    host: process.env.VITEST_API_HOST || "127.0.0.1",
    port: Number(process.env.VITEST_API_PORT || 51204),
    strictPort: false,
  },
});
