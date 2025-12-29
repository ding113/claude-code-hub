import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    api: {
      host: process.env.VITEST_API_HOST || "127.0.0.1",
      port: Number(process.env.VITEST_API_PORT || 51204),
      strictPort: false,
    },
    open: false,
    testTimeout: 10000,
    hookTimeout: 10000,
    maxConcurrency: 5,
    pool: "threads",
    include: ["tests/e2e/**/*.{test,spec}.ts"],
    exclude: [
      "node_modules",
      ".next",
      "dist",
      "build",
      "coverage",
      "**/*.d.ts",
      "tests/integration/**",
    ],
    reporters: ["verbose"],
    isolate: true,
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    resolveSnapshotPath: (testPath, snapExtension) => {
      return testPath.replace(/\.test\.([tj]sx?)$/, `${snapExtension}.$1`);
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/server-only.mock.ts"),
    },
  },
});
