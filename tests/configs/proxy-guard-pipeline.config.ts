import { createCoverageConfig } from "../vitest.base";

export default createCoverageConfig({
  name: "proxy-guard-pipeline",
  environment: "happy-dom",
  testFiles: [
    "tests/unit/proxy/guard-pipeline-full-chain.test.ts",
    "tests/unit/proxy/guard-pipeline-warmup.test.ts",
  ],
  sourceFiles: ["src/app/v1/_lib/proxy/guard-pipeline.ts"],
  thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
});
