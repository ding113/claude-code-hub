import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.spec.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: [
        "src/lib/rate-limit/time-utils.ts",
        "src/app/v1/_lib/proxy/provider-selector.ts",
        "src/lib/utils/cost-calculation.ts",
        "src/lib/config/env.schema.ts",
      ],
      exclude: [],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 40,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
