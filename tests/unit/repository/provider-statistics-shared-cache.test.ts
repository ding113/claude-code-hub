import { beforeEach, describe, expect, it, vi } from "vitest";

describe("getProviderStatistics shared cache", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reads through the Redis cache-aside helper keyed by timezone and memoizes in process", async () => {
    const executeMock = vi.fn(async () => [
      { id: 1, today_cost: "1.5", today_calls: 3, last_call_time: null, last_call_model: "m" },
    ]);
    const cacheAside = vi.fn(
      async (_redis: unknown, options: { compute: () => Promise<unknown> }) => options.compute()
    );

    vi.doMock("@/drizzle/db", () => ({
      db: {
        execute: executeMock,
        select: () => ({ from: () => ({ where: async () => [] }) }),
      },
    }));
    vi.doMock("@/lib/utils/timezone", () => ({
      resolveSystemTimezone: vi.fn(async () => "Asia/Tokyo"),
    }));
    vi.doMock("@/lib/redis/cache-aside", () => ({ getOrComputeWithRedisLock: cacheAside }));
    vi.doMock("@/lib/redis/client", () => ({ getRedisClient: () => ({ marker: "redis" }) }));
    vi.doMock("@/lib/redis/dashboard-cache-ttl", () => ({
      resolveDashboardCacheTtlSeconds: (defaultTtl: number) => defaultTtl,
    }));
    vi.doMock("@/lib/logger", () => ({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() },
    }));

    const { getProviderStatistics } = await import("@/repository/provider");
    const first = await getProviderStatistics();
    const second = await getProviderStatistics();

    expect(first).toEqual(second);
    expect(cacheAside).toHaveBeenCalledTimes(1);
    const [redis, options] = cacheAside.mock.calls[0] as [
      unknown,
      { cacheKey: string; ttlSeconds: number },
    ];
    expect(redis).toEqual({ marker: "redis" });
    expect(options.cacheKey).toBe("provider-statistics:v1:tz:Asia/Tokyo");
    expect(options.ttlSeconds).toBe(10);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});
