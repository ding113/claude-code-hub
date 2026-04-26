import { createCoverageConfig } from "../vitest.base";

export default createCoverageConfig({
  name: "my-usage",
  environment: "node",
  testFiles: [
    "tests/api/my-usage-readonly.test.ts",
    "tests/api/api-actions-integrity.test.ts",
    "tests/integration/auth.test.ts",
    "tests/api/action-adapter-openapi.unit.test.ts",
    "tests/unit/auth/admin-token-opaque-fallback.test.ts",
    "tests/unit/auth/opaque-admin-session.test.ts",
    "tests/unit/auth/auth-scoped-session-branches.test.ts",
    "tests/security/session-contract.test.ts",
    "tests/security/auth-dual-read.test.ts",
    "tests/unit/proxy/proxy-auth-cookie-passthrough.test.ts",
  ],
  sourceFiles: [
    "src/actions/my-usage.ts",
    "src/lib/auth.ts",
    "src/lib/api/action-adapter-openapi.ts",
  ],
  thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
  testExclude: ["node_modules", ".next", "dist", "build", "coverage"],
});
