import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Shared resolve alias
// ---------------------------------------------------------------------------

export function sharedResolve(opts?: { includeMessages?: boolean }) {
  const alias: Record<string, string> = {
    "@": path.resolve(root, "src"),
    "server-only": path.resolve(root, "tests/server-only.mock.ts"),
  };
  if (opts?.includeMessages) {
    alias["@messages"] = path.resolve(root, "messages");
  }
  return { alias };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const setupFiles = [path.resolve(root, "tests/setup.ts")];

const resolveSnapshotPath = (testPath: string, snapExtension: string) => {
  return testPath.replace(/\.test\.([tj]sx?)$/, `${snapExtension}.$1`);
};

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseWorkerLimit(
  value: string | undefined,
  fallback: number | string
): number | string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (/^\d+%$/.test(trimmed)) return trimmed;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

const defaultTestExclude = [
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "**/*.d.ts",
  "tests/integration/**",
];

// ---------------------------------------------------------------------------
// Factory: scoped coverage config (8 specialized configs)
// ---------------------------------------------------------------------------

interface CoverageConfigOptions {
  name: string;
  environment: "node" | "happy-dom";
  testFiles: string[];
  sourceFiles: string[];
  thresholds: {
    lines: number;
    functions: number;
    branches: number;
    statements: number;
  };
  coverageExclude?: string[];
  coverageReporters?: string[];
  testTimeout?: number;
  /** Override the default test exclude list (e.g. my-usage omits tests/integration/**) */
  testExclude?: string[];
}

export function createCoverageConfig(opts: CoverageConfigOptions) {
  return defineConfig({
    test: {
      globals: true,
      environment: opts.environment,
      setupFiles,
      testTimeout: opts.testTimeout,
      include: opts.testFiles,
      exclude: opts.testExclude ?? defaultTestExclude,
      coverage: {
        provider: "v8",
        reporter: opts.coverageReporters ?? ["text", "html", "json"],
        reportsDirectory: path.resolve(root, `coverage/${opts.name}`),
        include: opts.sourceFiles,
        exclude: [
          "node_modules/",
          "tests/",
          "**/*.d.ts",
          ".next/",
          ...(opts.coverageExclude ?? []),
        ],
        thresholds: opts.thresholds,
      },
      reporters: ["verbose"],
      isolate: true,
      mockReset: true,
      restoreMocks: true,
      clearMocks: true,
      resolveSnapshotPath,
    },
    resolve: sharedResolve(),
  });
}

// ---------------------------------------------------------------------------
// Factory: test runner config (e2e / integration)
// ---------------------------------------------------------------------------

interface TestRunnerConfigOptions {
  environment: "node" | "happy-dom";
  testFiles: string[];
  testTimeout?: number;
  hookTimeout?: number;
  maxWorkers?: number | string;
  maxConcurrency?: number;
  fileParallelism?: boolean;
  pool?: "threads" | "forks" | "vmThreads" | "vmForks";
  extraExclude?: string[];
  api?: {
    host?: string;
    port?: number;
    strictPort?: boolean;
  };
}

export function createTestRunnerConfig(opts: TestRunnerConfigOptions) {
  const baseExclude = ["node_modules", ".next", "dist", "build", "coverage", "**/*.d.ts"];
  const maxWorkers =
    opts.maxWorkers ?? parseWorkerLimit(process.env.VITEST_STATEFUL_MAX_WORKERS, 2);

  return defineConfig({
    test: {
      globals: true,
      environment: opts.environment,
      setupFiles,
      ...(opts.api ? { api: opts.api, open: false } : {}),
      testTimeout: opts.testTimeout ?? 10000,
      hookTimeout: opts.hookTimeout ?? 10000,
      teardownTimeout: parsePositiveInt(process.env.VITEST_TEARDOWN_TIMEOUT_MS, 15000),
      slowTestThreshold: parsePositiveInt(process.env.VITEST_SLOW_TEST_THRESHOLD_MS, 1000),
      maxConcurrency:
        opts.maxConcurrency ?? parsePositiveInt(process.env.VITEST_STATEFUL_MAX_CONCURRENCY, 3),
      pool: opts.pool ?? "threads",
      maxWorkers,
      fileParallelism:
        opts.fileParallelism ?? parseBoolean(process.env.VITEST_FILE_PARALLELISM, true),
      include: opts.testFiles,
      exclude: [...baseExclude, ...(opts.extraExclude ?? [])],
      reporters: ["verbose"],
      isolate: true,
      mockReset: true,
      restoreMocks: true,
      clearMocks: true,
      resolveSnapshotPath,
    },
    resolve: sharedResolve(),
  });
}
