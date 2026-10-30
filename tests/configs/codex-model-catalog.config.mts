import { defineConfig } from "vitest/config";
import { sharedResolve } from "../vitest.base.mts";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/unit/lib/codex-model-catalog.test.ts",
      "tests/unit/models/codex-model-catalog-fetcher.test.ts",
      "tests/unit/models/codex-models-manifest-fallback.test.ts",
      "tests/unit/models/codex-model-catalog-service.test.ts",
      "tests/unit/models/codex-model-catalog-cache.test.ts",
    ],
    testTimeout: 10000,
    isolate: true,
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      reportsDirectory: "./coverage/codex-model-catalog",
      include: [
        "src/lib/codex-model-catalog.ts",
        "src/app/v1/_lib/models/codex-model-catalog-fetcher.ts",
        "src/app/v1/_lib/models/codex-model-catalog-service.ts",
        "src/lib/cache/codex-model-catalog-cache.ts",
      ],
      thresholds: {
        perFile: true,
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    server: { deps: { inline: ["next-intl"] } },
  },
  resolve: sharedResolve({ includeMessages: true }),
});
