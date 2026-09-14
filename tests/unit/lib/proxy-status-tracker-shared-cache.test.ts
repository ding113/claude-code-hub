import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheAside: vi.fn(),
  highConcurrencyTtl: false,
}));

vi.mock("@/drizzle/db", () => ({ db: { select: vi.fn(), execute: vi.fn() } }));
vi.mock("@/lib/redis/client", () => ({ getRedisClient: () => ({ marker: "redis" }) }));
vi.mock("@/lib/redis/cache-aside", () => ({ getOrComputeWithRedisLock: mocks.cacheAside }));
vi.mock("@/lib/redis/dashboard-cache-ttl", () => ({
  resolveDashboardCacheTtlSeconds: (defaultTtl: number, highTtl: number) =>
    mocks.highConcurrencyTtl ? highTtl : defaultTtl,
}));

import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";

describe("ProxyStatusTracker shared cache", () => {
  it("serves status from the shared Redis cache and keeps the in-process memo", async () => {
    const cached = { users: [{ userId: 1, userName: "a", activeCount: 0, activeRequests: [] }] };
    mocks.cacheAside.mockResolvedValue(cached);
    mocks.highConcurrencyTtl = true;

    const tracker = new ProxyStatusTracker();
    await expect(tracker.getAllUsersStatus()).resolves.toEqual(cached);
    await expect(tracker.getAllUsersStatus()).resolves.toEqual(cached);

    expect(mocks.cacheAside).toHaveBeenCalledTimes(1);
    const [redis, options] = mocks.cacheAside.mock.calls[0] as [
      unknown,
      { cacheKey: string; ttlSeconds: number },
    ];
    expect(redis).toEqual({ marker: "redis" });
    expect(options.cacheKey).toBe("proxy-status:v1");
    expect(options.ttlSeconds).toBe(5);
  });
});
