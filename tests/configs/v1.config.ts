import { defineConfig } from "vitest/config";
import { sharedResolve } from "../vitest.base";

export default defineConfig({
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/unit/api/v1/**/*.test.ts",
      "tests/api/v1/**/*.test.ts",
      "tests/unit/api/actions/legacy-compatibility.test.ts",
      "tests/unit/api/actions/legacy-deprecation.test.ts",
      "tests/unit/api/actions/legacy-sanitizers.test.ts",
      "tests/unit/config/management-api-env.test.ts",
      "tests/unit/frontend/api-error-i18n.test.ts",
      "tests/unit/frontend/client-action-import-inventory.test.ts",
      "tests/unit/frontend/no-client-actions-import.test.ts",
      "tests/unit/frontend/use-api-mutation.test.tsx",
      "tests/unit/frontend/use-ip-geo.test.tsx",
    ],
    exclude: ["node_modules", ".next", "dist", "build", "coverage"],
    testTimeout: 10000,
    hookTimeout: 10000,
    isolate: true,
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      include: [
        "src/app/api/v1/**/*.ts",
        "src/lib/api/legacy-action-sanitizers.ts",
        "src/lib/api/v1/_shared/**",
        "src/lib/api/v1/schemas/**",
        "src/lib/api-client/v1/errors.ts",
        "src/lib/api-client/v1/fetcher.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 55,
        statements: 80,
      },
    },
  },
  resolve: sharedResolve({ includeMessages: true }),
});
