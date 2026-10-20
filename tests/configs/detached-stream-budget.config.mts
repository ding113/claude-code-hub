import { createCoverageConfig } from "../vitest.base.mts";

export default createCoverageConfig({
  name: "detached-stream-budget",
  environment: "node",
  testFiles: [
    "src/app/v1/_lib/proxy/client-abort-metering.test.ts",
    "src/app/v1/_lib/proxy/detached-stream-budget.test.ts",
  ],
  sourceFiles: [
    "src/app/v1/_lib/proxy/client-abort-metering.ts",
    "src/app/v1/_lib/proxy/detached-stream-budget.ts",
  ],
  thresholds: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80,
  },
});
