import { createCoverageConfig } from "../vitest.base.mts";

export default createCoverageConfig({
  name: "responses-ws-payload-fallback",
  environment: "node",
  testFiles: [
    "src/app/v1/_lib/responses-ws/__tests__/payload-too-large.test.ts",
    "src/app/v1/_lib/responses-ws/__tests__/upstream-adapter.test.ts",
    "tests/unit/proxy/proxy-forwarder-raw-passthrough-regression.test.ts",
  ],
  sourceFiles: ["src/app/v1/_lib/responses-ws/payload-too-large.ts"],
  thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
});
