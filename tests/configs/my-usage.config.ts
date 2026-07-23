import { createCoverageConfig } from "../vitest.base";

export default createCoverageConfig({
  name: "my-usage",
  environment: "node",
  testFiles: [
    "tests/api/my-usage-readonly.test.ts",
    "tests/api/api-actions-integrity.test.ts",
    "tests/integration/auth.test.ts",
    "tests/api/action-adapter-openapi.unit.test.ts",
    // 无 DB 的单元测试：保证无 DSN 环境（集成用例被 skip）下覆盖率仍达标
    "tests/unit/actions/my-usage-actions-unit.test.ts",
    "tests/unit/actions/my-usage-concurrent-inherit.test.ts",
    "tests/unit/actions/my-usage-date-range-dst.test.ts",
    "tests/unit/actions/my-usage-ip-geo.test.ts",
    "tests/unit/actions/my-usage-readonly-provider-chain.test.ts",
    "tests/unit/actions/my-usage-token-aggregation.test.ts",
    "tests/unit/actions/my-usage-user-5h-reset-boundary.test.ts",
    "tests/unit/auth/admin-token-opaque-fallback.test.ts",
    "tests/unit/auth/auth-cookie-constant-sync.test.ts",
    "tests/unit/auth/login-redirect-safety.test.ts",
    "tests/unit/auth/opaque-admin-session.test.ts",
    "tests/unit/auth/set-auth-cookie-options.test.ts",
  ],
  sourceFiles: [
    "src/actions/my-usage.ts",
    "src/lib/auth.ts",
    "src/lib/api/action-adapter-openapi.ts",
  ],
  thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
  testExclude: ["node_modules", ".next", "dist", "build", "coverage"],
});
