import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisState = vi.hoisted(() => ({
  store: new Map<string, string>(),
  lockResult: "OK" as string | null,
}));

const redisClient = vi.hoisted(() => ({
  status: "ready",
  get: vi.fn(async (key: string) => redisState.store.get(key) ?? null),
  set: vi.fn(async () => redisState.lockResult),
  setex: vi.fn(async (key: string, _ttl: number, value: string) => {
    redisState.store.set(key, value);
    return "OK";
  }),
  del: vi.fn(async () => 1),
  eval: vi.fn(async () => 1),
}));

vi.mock("@/lib/redis", () => ({ getRedisClient: () => redisClient }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const settingsState = vi.hoisted(() => ({ highConcurrency: false }));
vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettingsOnlyCache: () => ({
    enableHighConcurrencyMode: settingsState.highConcurrency,
  }),
  getCachedSystemSettings: vi.fn(),
}));

const statisticsMock = vi.hoisted(() => ({
  sumKeyTotalCost: vi.fn(async () => 0),
  sumUserTotalCost: vi.fn(async () => 0),
  sumProviderTotalCost: vi.fn(async () => 0),
}));
vi.mock("@/repository/statistics", () => statisticsMock);

import {
  HIGH_CONCURRENCY_TOTAL_COST_CACHE_TTL_SECONDS,
  LEASE_REFRESH_WAIT_MS,
  TOTAL_COST_CACHE_TTL_SECONDS,
} from "@/lib/rate-limit/lease";
import { RateLimitService } from "@/lib/rate-limit/service";

describe("RateLimitService total cost cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    redisState.store.clear();
    redisState.lockResult = "OK";
    redisClient.status = "ready";
    settingsState.highConcurrency = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds cache keys per entity type and reset point", () => {
    const resetAt = new Date(1_700_000_000_000);
    expect(RateLimitService.buildTotalCostCacheKey("key", 1, { keyHash: "sk-a", resetAt })).toBe(
      "total_cost:key:sk-a:1700000000000"
    );
    expect(RateLimitService.buildTotalCostCacheKey("key", 1, {})).toBeNull();
    expect(RateLimitService.buildTotalCostCacheKey("user", 2)).toBe("total_cost:user:2");
    expect(RateLimitService.buildTotalCostCacheKey("provider", 3)).toBe(
      "total_cost:provider:3:none"
    );
  });

  it("uses the high-concurrency TTL when that mode is enabled", async () => {
    settingsState.highConcurrency = true;
    statisticsMock.sumUserTotalCost.mockResolvedValue(4);

    await RateLimitService.checkTotalCostLimit(2, "user", 10);

    expect(redisClient.setex).toHaveBeenCalledWith(
      "total_cost:user:2",
      HIGH_CONCURRENCY_TOTAL_COST_CACHE_TTL_SECONDS,
      "4"
    );
  });

  it("computes once for concurrent misses in the same process and releases the lock", async () => {
    let release!: (value: number) => void;
    statisticsMock.sumUserTotalCost.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          release = resolve;
        })
    );

    const first = RateLimitService.checkTotalCostLimit(2, "user", 10);
    const second = RateLimitService.checkTotalCostLimit(2, "user", 10);
    await vi.advanceTimersByTimeAsync(0);
    release(12);

    const [a, b] = await Promise.all([first, second]);
    expect(statisticsMock.sumUserTotalCost).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ allowed: false, current: 12 });
    expect(b).toMatchObject({ allowed: false, current: 12 });
    expect(redisClient.setex).toHaveBeenCalledWith(
      "total_cost:user:2",
      TOTAL_COST_CACHE_TTL_SECONDS,
      "12"
    );
    expect(redisClient.del).toHaveBeenCalledWith("total_cost:user:2:lock");
  });

  it("waits for another process to fill the cache instead of querying", async () => {
    redisState.lockResult = null;

    const pending = RateLimitService.checkTotalCostLimit(9, "provider", 100);
    await vi.advanceTimersByTimeAsync(30);
    redisState.store.set("total_cost:provider:9:none", "33");
    await vi.advanceTimersByTimeAsync(30);

    await expect(pending).resolves.toMatchObject({ allowed: true, current: 33 });
    expect(statisticsMock.sumProviderTotalCost).not.toHaveBeenCalled();
  });

  it("queries directly after the wait times out", async () => {
    redisState.lockResult = null;
    statisticsMock.sumKeyTotalCost.mockResolvedValue(1);

    const pending = RateLimitService.checkTotalCostLimit(5, "key", 10, { keyHash: "sk-x" });
    await vi.advanceTimersByTimeAsync(LEASE_REFRESH_WAIT_MS + 100);

    await expect(pending).resolves.toMatchObject({ allowed: true, current: 1 });
    expect(statisticsMock.sumKeyTotalCost).toHaveBeenCalledWith("sk-x", Infinity, undefined);
  });

  it("treats a failing lock command as not acquired", async () => {
    redisClient.set.mockRejectedValueOnce(new Error("lock failed"));
    statisticsMock.sumUserTotalCost.mockResolvedValue(2);

    const pending = RateLimitService.checkTotalCostLimit(2, "user", 10);
    await vi.advanceTimersByTimeAsync(LEASE_REFRESH_WAIT_MS + 100);

    await expect(pending).resolves.toMatchObject({ allowed: true, current: 2 });
  });

  it("queries the database directly when Redis is not ready", async () => {
    redisClient.status = "end";
    statisticsMock.sumUserTotalCost.mockResolvedValue(3);

    await expect(RateLimitService.checkTotalCostLimit(2, "user", 10)).resolves.toMatchObject({
      allowed: true,
      current: 3,
    });
    expect(redisClient.get).not.toHaveBeenCalled();
  });

  it("increments existing cache entries for entities with total limits", async () => {
    const resetAt = new Date(1_700_000_000_000);

    await RateLimitService.trackTotalCostCache(
      [
        { entityType: "key", entityId: 1, keyHash: "sk-a", resetAt },
        { entityType: "key", entityId: 2 },
        { entityType: "user", entityId: 3 },
        { entityType: "provider", entityId: 4, resetAt: null },
      ],
      0.5
    );

    expect(redisClient.eval).toHaveBeenCalledTimes(1);
    const [script, keyCount, ...rest] = redisClient.eval.mock.calls[0] as unknown as [
      string,
      number,
      ...string[],
    ];
    expect(script).toContain("INCRBYFLOAT");
    expect(script).toContain("EXISTS");
    expect(keyCount).toBe(3);
    expect(rest).toEqual([
      "total_cost:key:sk-a:1700000000000",
      "total_cost:user:3",
      "total_cost:provider:4:none",
      "0.5",
    ]);
  });

  it("skips increments for non-positive cost, no targets, unavailable Redis, and swallows errors", async () => {
    await RateLimitService.trackTotalCostCache([{ entityType: "user", entityId: 1 }], 0);
    await RateLimitService.trackTotalCostCache([{ entityType: "key", entityId: 1 }], 1);
    redisClient.status = "end";
    await RateLimitService.trackTotalCostCache([{ entityType: "user", entityId: 1 }], 1);
    expect(redisClient.eval).not.toHaveBeenCalled();

    redisClient.status = "ready";
    redisClient.eval.mockRejectedValueOnce(new Error("eval failed"));
    await expect(
      RateLimitService.trackTotalCostCache([{ entityType: "user", entityId: 1 }], 1)
    ).resolves.toBeUndefined();
  });
});
