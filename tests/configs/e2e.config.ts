import { createTestRunnerConfig } from "../vitest.base";

export default createTestRunnerConfig({
  environment: "node",
  testTimeout: 15000,
  hookTimeout: 20000,
  fileParallelism: false,
  testFiles: ["tests/e2e/**/*.{test,spec}.ts"],
  extraExclude: ["tests/integration/**"],
  api: {
    host: process.env.VITEST_API_HOST || "127.0.0.1",
    port: Number(process.env.VITEST_API_PORT || 51204),
    strictPort: false,
  },
});
