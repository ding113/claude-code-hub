import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],

    include: [
      "tests/unit/lib/rate-limit/**/*.{test,spec}.ts",
      "tests/unit/proxy/rate-limit-guard.test.ts",
    ],
    exclude: ["node_modules", ".next", "dist", "build", "coverage", "tests/integration/**"],

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      reportsDirectory: "./coverage-quota",

      include: ["src/lib/rate-limit/**", "src/app/v1/_lib/proxy/rate-limit-guard.ts"],
      exclude: ["node_modules/", "tests/", "**/*.d.ts", ".next/", "src/lib/rate-limit/index.ts"],

      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },

    reporters: ["verbose"],
    isolate: true,
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/server-only.mock.ts"),
    },
  },
});
