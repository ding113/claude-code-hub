import { createTestRunnerConfig } from "../vitest.base";

export default createTestRunnerConfig({
  environment: "node",
  testTimeout: 20000,
  hookTimeout: 20000,
  testFiles: [
    "tests/integration/webhook-targets-crud.test.ts",
    "tests/integration/notification-bindings.test.ts",
    "tests/integration/auth.test.ts",
    "tests/integration/provider-endpoint-sync-race.test.ts",
    "tests/integration/provider-endpoint-regression-742.test.ts",
    "tests/integration/usage-ledger.test.ts",
    "tests/api/users-actions.test.ts",
    "tests/api/providers-actions.test.ts",
    "tests/api/keys-actions.test.ts",
    "tests/api/my-usage-readonly.test.ts",
  ],
  api: {
    host: process.env.VITEST_API_HOST || "127.0.0.1",
    port: Number(process.env.VITEST_API_PORT || 51204),
    strictPort: false,
  },
});
