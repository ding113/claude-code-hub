import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sharedResolve } from "../vitest.base";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/provider-batch-ledger-postgres.test.ts"],
    exclude: ["node_modules", ".next", "dist", "build", "coverage", "**/*.d.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 15_000,
    fileParallelism: false,
    maxWorkers: 1,
    isolate: true,
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    reporters: ["verbose"],
  },
  resolve: sharedResolve(),
  root,
});
