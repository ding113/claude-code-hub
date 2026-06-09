import type Redis from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsMock = {
  getCachedSystemSettings: vi.fn(async () => ({ quotaDbRefreshIntervalSeconds: 10 })),
};

vi.mock("@/lib/config/system-settings-cache", () => settingsMock);

describe("cost-display-cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsMock.getCachedSystemSettings.mockResolvedValue({ quotaDbRefreshIntervalSeconds: 10 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("buildCostDisplayCacheKey", () => {
    it("uses cost_cache:<type>:<id>:<period>_rolling format", async () => {
      const { buildCostDisplayCacheKey } = await import("@/lib/redis/cost-display-cache");
      expect(buildCostDisplayCacheKey("key", 1, "5h")).toBe("cost_cache:key:1:5h_rolling");
      expect(buildCostDisplayCacheKey("provider", 45, "daily")).toBe(
        "cost_cache:provider:45:daily_rolling"
      );
      expect(buildCostDisplayCacheKey("user", 7, "5h")).toBe("cost_cache:user:7:5h_rolling");
    });
  });

  describe("buildCostDisplayCacheScanPattern (bug10)", () => {
    it("derives scan pattern from type/id with cost_cache prefix", async () => {
      const { buildCostDisplayCacheScanPattern, COST_CACHE_KEY_PREFIX } = await import(
        "@/lib/redis/cost-display-cache"
      );
      expect(COST_CACHE_KEY_PREFIX).toBe("cost_cache");
      expect(buildCostDisplayCacheScanPattern("key", 1)).toBe("cost_cache:key:1:*");
      expect(buildCostDisplayCacheScanPattern("user", 7)).toBe("cost_cache:user:7:*");
      expect(buildCostDisplayCacheScanPattern("provider", 45)).toBe("cost_cache:provider:45:*");
    });
  });

  describe("getCachedRollingCost", () => {
    it("returns null when key is absent", async () => {
      const redis = { get: vi.fn(async () => null) } as unknown as Redis;
      const { getCachedRollingCost } = await import("@/lib/redis/cost-display-cache");

      const result = await getCachedRollingCost(redis, "key", 1, "5h");

      expect(result).toBeNull();
      expect(redis.get).toHaveBeenCalledWith("cost_cache:key:1:5h_rolling");
    });

    it("returns parsed number when value present", async () => {
      const redis = { get: vi.fn(async () => "12.34") } as unknown as Redis;
      const { getCachedRollingCost } = await import("@/lib/redis/cost-display-cache");

      const result = await getCachedRollingCost(redis, "provider", 45, "daily");

      expect(result).toBeCloseTo(12.34, 10);
    });

    it("returns null when value is not a finite number", async () => {
      const redis = { get: vi.fn(async () => "not-a-number") } as unknown as Redis;
      const { getCachedRollingCost } = await import("@/lib/redis/cost-display-cache");

      const result = await getCachedRollingCost(redis, "user", 7, "5h");

      expect(result).toBeNull();
    });
  });

  describe("setCachedRollingCost", () => {
    it("writes the cost with SET EX using the configured TTL (within jitter band)", async () => {
      settingsMock.getCachedSystemSettings.mockResolvedValueOnce({
        quotaDbRefreshIntervalSeconds: 10,
      });
      const set = vi.fn(async () => "OK");
      const redis = { set } as unknown as Redis;
      const { setCachedRollingCost } = await import("@/lib/redis/cost-display-cache");

      await setCachedRollingCost(redis, "key", 1, "5h", 3.5);

      expect(set).toHaveBeenCalledTimes(1);
      const callArgs = set.mock.calls[0];
      expect(callArgs[0]).toBe("cost_cache:key:1:5h_rolling");
      expect(callArgs[1]).toBe("3.5");
      expect(callArgs[2]).toBe("EX");
      const ttl = callArgs[3] as number;
      expect(ttl).toBeGreaterThanOrEqual(9);
      expect(ttl).toBeLessThanOrEqual(11);
    });

    it("never lets TTL fall below MIN_EFFECTIVE_TTL even when refresh interval is 1 (bug05)", async () => {
      // Repeat the call to hit both jitter branches; the floor must hold for both.
      settingsMock.getCachedSystemSettings.mockResolvedValue({
        quotaDbRefreshIntervalSeconds: 1,
      });
      const set = vi.fn(async () => "OK");
      const redis = { set } as unknown as Redis;
      const { setCachedRollingCost } = await import("@/lib/redis/cost-display-cache");

      const observed = new Set<number>();
      for (let i = 0; i < 50; i++) {
        set.mockClear();
        await setCachedRollingCost(redis, "user", 7, "daily", 1.25);
        observed.add(set.mock.calls[0][3] as number);
      }
      for (const ttl of observed) {
        expect(ttl).toBeGreaterThanOrEqual(3);
      }
    });

    it("falls back to 10s TTL when settings lookup fails", async () => {
      settingsMock.getCachedSystemSettings.mockRejectedValueOnce(new Error("db down"));
      const set = vi.fn(async () => "OK");
      const redis = { set } as unknown as Redis;
      const { setCachedRollingCost } = await import("@/lib/redis/cost-display-cache");

      await setCachedRollingCost(redis, "provider", 45, "5h", 0.5);

      const ttl = set.mock.calls[0][3] as number;
      expect(ttl).toBeGreaterThanOrEqual(9);
      expect(ttl).toBeLessThanOrEqual(11);
    });

    it("clamps TTL to the next boundary when boundaryAtMs is closer than configured TTL (bug09)", async () => {
      const set = vi.fn(async () => "OK");
      const redis = { set } as unknown as Redis;
      const { setCachedRollingCost } = await import("@/lib/redis/cost-display-cache");

      const now = Date.now();
      // Boundary in 2 seconds — TTL should clamp under configured 10s.
      await setCachedRollingCost(redis, "user", 1, "5h", 2.5, { boundaryAtMs: now + 2000 });

      const ttl = set.mock.calls[0][3] as number;
      expect(ttl).toBeLessThanOrEqual(3);
      expect(ttl).toBeGreaterThanOrEqual(1);
    });

    it("never falls below MIN_EFFECTIVE_TTL even when boundary is sub-second (bug09)", async () => {
      const set = vi.fn(async () => "OK");
      const redis = { set } as unknown as Redis;
      const { setCachedRollingCost } = await import("@/lib/redis/cost-display-cache");

      const now = Date.now();
      await setCachedRollingCost(redis, "user", 1, "5h", 1, { boundaryAtMs: now + 100 });

      const ttl = set.mock.calls[0][3] as number;
      expect(ttl).toBeGreaterThanOrEqual(1);
    });

    it("uses configured TTL when boundaryAtMs is omitted (bug09 — backward compat)", async () => {
      const set = vi.fn(async () => "OK");
      const redis = { set } as unknown as Redis;
      const { setCachedRollingCost } = await import("@/lib/redis/cost-display-cache");

      await setCachedRollingCost(redis, "user", 1, "5h", 1);

      const ttl = set.mock.calls[0][3] as number;
      expect(ttl).toBeGreaterThanOrEqual(9);
      expect(ttl).toBeLessThanOrEqual(11);
    });
  });

  describe("mgetCachedRollingCost", () => {
    it("returns empty array for empty input without calling redis", async () => {
      const mget = vi.fn(async () => []);
      const redis = { mget } as unknown as Redis;
      const { mgetCachedRollingCost } = await import("@/lib/redis/cost-display-cache");

      const result = await mgetCachedRollingCost(redis, []);

      expect(result).toEqual([]);
      expect(mget).not.toHaveBeenCalled();
    });

    it("returns parsed costs aligned with input order, with nulls for misses", async () => {
      const mget = vi.fn(async () => ["1.5", null, "0"]);
      const redis = { mget } as unknown as Redis;
      const { mgetCachedRollingCost } = await import("@/lib/redis/cost-display-cache");

      const result = await mgetCachedRollingCost(redis, [
        { type: "provider", id: 1, period: "5h" },
        { type: "provider", id: 2, period: "5h" },
        { type: "provider", id: 3, period: "5h" },
      ]);

      expect(result).toEqual([1.5, null, 0]);
      expect(mget).toHaveBeenCalledWith(
        "cost_cache:provider:1:5h_rolling",
        "cost_cache:provider:2:5h_rolling",
        "cost_cache:provider:3:5h_rolling"
      );
    });
  });
});
