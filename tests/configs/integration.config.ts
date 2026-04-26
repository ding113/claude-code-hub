import { createTestRunnerConfig } from "../vitest.base";

export default createTestRunnerConfig({
  environment: "node",
  testTimeout: 20000,
  hookTimeout: 20000,
  fileParallelism: false,
  testFiles: [
    "tests/integration/usage-ledger.test.ts",
    "tests/integration/my-usage-imported-ledger.test.ts",
  ],
  api: {
    host: process.env.VITEST_API_HOST || "127.0.0.1",
    port: Number(process.env.VITEST_API_PORT || 51204),
    strictPort: false,
  },
});
