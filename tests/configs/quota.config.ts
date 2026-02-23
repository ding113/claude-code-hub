import { createCoverageConfig } from "../vitest.base";

export default createCoverageConfig({
  name: "quota",
  environment: "node",
  testFiles: [
    "tests/unit/lib/rate-limit/**/*.{test,spec}.ts",
    "tests/unit/proxy/rate-limit-guard.test.ts",
  ],
  sourceFiles: ["src/lib/rate-limit/**", "src/app/v1/_lib/proxy/rate-limit-guard.ts"],
  thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
  coverageExclude: ["src/lib/rate-limit/index.ts"],
});
