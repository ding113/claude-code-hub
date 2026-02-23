import { createCoverageConfig } from "../vitest.base";

export default createCoverageConfig({
  name: "usage-logs-sessionid-search",
  environment: "happy-dom",
  testFiles: [
    "tests/unit/repository/usage-logs-sessionid-suggestions.test.ts",
    "tests/unit/repository/usage-logs-sessionid-filter.test.ts",
    "tests/unit/repository/warmup-stats-exclusion.test.ts",
    "tests/unit/repository/escape-like.test.ts",
    "tests/unit/lib/constants/usage-logs.constants.test.ts",
    "tests/unit/lib/utils/clipboard.test.ts",
  ],
  sourceFiles: [
    "src/repository/_shared/like.ts",
    "src/lib/constants/usage-logs.constants.ts",
    "src/lib/utils/clipboard.ts",
  ],
  thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
  coverageReporters: ["text", "html", "json", "lcov"],
});
