import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe.sequential("readiness probe respects shutdown flag", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 503 unhealthy when shutting down without calling component checks", async () => {
    const checkDatabase = vi.fn(async () => ({ status: "up" as const, latencyMs: 1 }));
    const checkRedis = vi.fn(async () => ({ status: "up" as const, latencyMs: 1 }));
    const checkProxy = vi.fn(async () => ({ status: "up" as const, latencyMs: 1 }));

    vi.doMock("@/drizzle/db", () => ({ db: { execute: vi.fn() } }));
    vi.doMock("@/lib/redis/client", () => ({ getRedisClient: vi.fn(() => null) }));

    const checkerModule = await import("@/lib/health/checker");
    // Override the public component check exports for isolation: but the actual
    // checker uses internal references — so instead we go through the
    // shutdown flag short-circuit and assert no calls to db.execute were made.
    const dbModule = await import("@/drizzle/db");

    const { markShuttingDown, __resetShutdownStateForTests } = await import(
      "@/lib/lifecycle/shutdown"
    );
    __resetShutdownStateForTests();

    // Sanity: healthy when not shutting down (we mock db.execute to resolve)
    vi.mocked(
      dbModule.db.execute as unknown as (...args: unknown[]) => Promise<unknown>
    ).mockResolvedValue([{ "?column?": 1 }]);
    const healthBefore = await checkerModule.checkReadiness();
    expect(healthBefore.components.database.message).not.toBe("shutting_down");

    markShuttingDown();

    const health = await checkerModule.checkReadiness();
    expect(health.status).toBe("unhealthy");
    expect(health.components.database).toMatchObject({
      status: "down",
      message: "shutting_down",
    });
    expect(health.components.redis).toMatchObject({ status: "down", message: "shutting_down" });
    expect(health.components.proxy).toMatchObject({ status: "down", message: "shutting_down" });

    // The point of the early-return: don't waste time on real component checks.
    // After markShuttingDown(), db.execute should not be called again.
    const callCountBefore = vi.mocked(
      dbModule.db.execute as unknown as (...args: unknown[]) => Promise<unknown>
    ).mock.calls.length;
    await checkerModule.checkReadiness();
    const callCountAfter = vi.mocked(
      dbModule.db.execute as unknown as (...args: unknown[]) => Promise<unknown>
    ).mock.calls.length;
    expect(callCountAfter).toBe(callCountBefore);

    __resetShutdownStateForTests();

    // Unused mocks to keep TS happy
    void checkDatabase;
    void checkRedis;
    void checkProxy;
  });

  it("handleReadinessRequest returns HTTP 503 when shutting down", async () => {
    vi.doMock("@/drizzle/db", () => ({ db: { execute: vi.fn(async () => [{ "?column?": 1 }]) } }));
    vi.doMock("@/lib/redis/client", () => ({ getRedisClient: vi.fn(() => null) }));

    const { handleReadinessRequest } = await import("@/lib/health/checker");
    const { markShuttingDown, __resetShutdownStateForTests } = await import(
      "@/lib/lifecycle/shutdown"
    );
    __resetShutdownStateForTests();

    markShuttingDown();

    const response = await handleReadinessRequest("test_shutdown");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("unhealthy");

    __resetShutdownStateForTests();
  });
});
