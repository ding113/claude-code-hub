import { createCoverageConfig } from "../vitest.base";

export default createCoverageConfig({
  name: "logs-sessionid-time-filter",
  environment: "happy-dom",
  testFiles: [
    "tests/unit/repository/usage-logs-sessionid-filter.test.ts",
    "tests/unit/repository/usage-logs-sessionid-suggestions.test.ts",
    "tests/unit/dashboard-logs-query-utils.test.ts",
    "tests/unit/dashboard-logs-time-range-utils.test.ts",
    "tests/unit/dashboard-logs-filters-time-range.test.tsx",
    "tests/unit/dashboard-logs-sessionid-suggestions-ui.test.tsx",
    "tests/unit/dashboard-logs-virtualized-special-settings-ui.test.tsx",
    "src/app/[locale]/dashboard/logs/_components/usage-logs-table.test.tsx",
  ],
  sourceFiles: [
    "src/app/[locale]/dashboard/logs/_utils/logs-query.ts",
    "src/app/[locale]/dashboard/logs/_utils/time-range.ts",
  ],
  thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
  coverageReporters: ["text", "html", "json", "lcov"],
});
