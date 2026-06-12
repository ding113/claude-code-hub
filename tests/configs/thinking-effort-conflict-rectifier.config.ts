import { createCoverageConfig } from "../vitest.base";

export default createCoverageConfig({
  name: "thinking-effort-conflict-rectifier",
  environment: "node",
  testFiles: [
    "src/app/v1/_lib/proxy/thinking-effort-conflict-rectifier.test.ts",
    "tests/unit/proxy/proxy-forwarder-thinking-effort-conflict-rectifier.test.ts",
  ],
  sourceFiles: ["src/app/v1/_lib/proxy/thinking-effort-conflict-rectifier.ts"],
  thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
});
