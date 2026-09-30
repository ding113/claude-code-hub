import { createCoverageConfig } from "../vitest.base.mts";

export default createCoverageConfig({
  name: "responses-ws-payload-limits",
  environment: "node",
  testFiles: [
    "tests/unit/server-ws-payload-*.test.ts",
    "tests/unit/server-ws-close-handshake.test.ts",
    "src/app/v1/_lib/responses-ws/__tests__/eligibility.test.ts",
    "src/app/v1/_lib/responses-ws/__tests__/internal-secret.test.ts",
    "src/app/v1/_lib/responses-ws/__tests__/upstream-adapter.test.ts",
    "tests/unit/proxy/proxy-forwarder-raw-passthrough-regression.test.ts",
  ],
  sourceFiles: [
    "server-lib/responses-ws-payload.js",
    "server-lib/responses-ws-error-message.js",
    "src/app/v1/_lib/responses-ws/eligibility.ts",
  ],
  thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
});
