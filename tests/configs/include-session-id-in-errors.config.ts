import { createCoverageConfig } from "../vitest.base";

export default createCoverageConfig({
  name: "include-session-id-in-errors",
  environment: "happy-dom",
  testFiles: [
    "tests/unit/proxy/responses-session-id.test.ts",
    "tests/unit/proxy/proxy-handler-session-id-error.test.ts",
    "tests/unit/proxy/error-handler-session-id-error.test.ts",
  ],
  sourceFiles: ["src/app/v1/_lib/proxy/error-session-id.ts", "src/app/v1/_lib/proxy-handler.ts"],
  thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
});
