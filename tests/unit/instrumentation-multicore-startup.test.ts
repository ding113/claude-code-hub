import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "NEXT_RUNTIME",
  "NODE_ENV",
  "CI",
  "CCH_MULTICORE_ACTIVE",
  "CCH_MULTICORE_BACKGROUND_OWNER",
  "CCH_MULTICORE_WORKER_INDEX",
  "CCH_MULTICORE_WORKER_COUNT",
  "ENABLE_RATE_LIMIT",
  "REDIS_URL",
] as const;

const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

describe.sequential("request-only multicore instrumentation startup", () => {
  it("initializes local caches without migrations, schedulers or queue consumers", async () => {
    vi.resetModules();
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NODE_ENV = "production";
    process.env.CCH_MULTICORE_ACTIVE = "1";
    process.env.CCH_MULTICORE_BACKGROUND_OWNER = "0";
    process.env.CCH_MULTICORE_WORKER_INDEX = "1";
    process.env.CCH_MULTICORE_WORKER_COUNT = "2";
    process.env.ENABLE_RATE_LIMIT = "true";
    delete process.env.CI;
    process.env.REDIS_URL = "redis://redis:6379";

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };
    const startCacheCleanup = vi.fn();
    const startBackgroundReload = vi.fn();
    const initLangfuse = vi.fn(async () => {});
    const bindLifecycleGlobals = vi.fn();
    const checkDatabaseConnection = vi.fn(async () => true);
    const runMigrations = vi.fn(async () => {});
    const ensureGroupMultiplierCacheSubscription = vi.fn(async () => true);
    const ensureSystemSettingsCacheSubscription = vi.fn(async () => true);
    const reloadErrorRules = vi.fn(async () => {});
    const getProxyRuntimeSettings = vi.fn(async () => ({}));
    const backgroundQueueModuleFactory = vi.fn(() => ({ scheduleAutoCleanup: vi.fn() }));

    vi.doMock("@/drizzle/admitted-client", () => ({ findSafeDatabaseError: () => null }));
    vi.doMock("@/lib/cache/session-cache", () => ({ startCacheCleanup }));
    vi.doMock("@/lib/lifecycle/benign-errors", () => ({
      getBenignBrokenPipeCode: () => null,
    }));
    vi.doMock("@/lib/logger", () => ({ logger }));
    vi.doMock("@/lib/redis/pubsub", () => ({
      CHANNEL_API_KEYS_UPDATED: "api-keys",
      subscribeCacheInvalidation: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/security/api-key-vacuum-filter", () => ({
      apiKeyVacuumFilter: { startBackgroundReload, invalidateAndReload: vi.fn() },
    }));
    vi.doMock("@/lib/langfuse", () => ({ initLangfuse }));
    vi.doMock("@/lib/lifecycle/shutdown", () => ({ bindLifecycleGlobals }));
    vi.doMock("@/lib/cache/provider-group-multiplier-cache", () => ({
      ensureGroupMultiplierCacheSubscription,
    }));
    vi.doMock("@/lib/config/system-settings-cache", () => ({
      ensureSystemSettingsCacheSubscription,
    }));
    vi.doMock("@/lib/migrate", () => ({
      checkDatabaseConnection,
      runMigrations,
      withAdvisoryLock: vi.fn(),
    }));
    vi.doMock("@/lib/error-rule-detector", () => ({
      errorRuleDetector: { reload: reloadErrorRules },
    }));
    vi.doMock("@/lib/system-settings/proxy-runtime", () => ({ getProxyRuntimeSettings }));
    vi.doMock("@/lib/log-cleanup/cleanup-queue", backgroundQueueModuleFactory);

    const processOn = vi
      .spyOn(process, "on")
      .mockImplementation((() => process) as typeof process.on);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    const { register } = await import("@/instrumentation");
    await register();

    expect(processOn).toHaveBeenCalledWith("uncaughtException", expect.any(Function));
    expect(processOn).toHaveBeenCalledWith("unhandledRejection", expect.any(Function));
    expect(initLangfuse).toHaveBeenCalledTimes(1);
    expect(startCacheCleanup).toHaveBeenCalledWith(60);
    expect(bindLifecycleGlobals).toHaveBeenCalledTimes(1);
    expect(ensureGroupMultiplierCacheSubscription).toHaveBeenCalledTimes(1);
    expect(ensureSystemSettingsCacheSubscription).toHaveBeenCalledTimes(1);
    expect(checkDatabaseConnection).toHaveBeenCalledTimes(1);
    expect(startBackgroundReload).toHaveBeenCalledWith({ reason: "startup" });
    expect(reloadErrorRules).toHaveBeenCalledTimes(1);
    expect(getProxyRuntimeSettings).toHaveBeenCalledTimes(1);
    expect(runMigrations).not.toHaveBeenCalled();
    expect(backgroundQueueModuleFactory).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("[Multicore] Request-only gateway worker ready");
  });
});
