import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisState = vi.hoisted(() => ({
  store: new Map<string, string>(),
  lockResult: "OK" as string | null,
}));

const mockRedis = vi.hoisted(() => {
  const pipelineCalls: Array<[string, number, string]> = [];
  return {
    status: "ready",
    pipelineCalls,
    get: vi.fn(async (key: string) => redisState.store.get(key) ?? null),
    mget: vi.fn(async (...keys: string[]) => keys.map((key) => redisState.store.get(key) ?? null)),
    ttl: vi.fn(async () => -2),
    set: vi.fn(async () => redisState.lockResult),
    del: vi.fn(async () => 1),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      redisState.store.set(key, value);
      return "OK";
    }),
    pipeline: vi.fn(() => {
      const pipeline = {
        setex: vi.fn((key: string, ttl: number, value: string) => {
          pipelineCalls.push([key, ttl, value]);
          redisState.store.set(key, value);
          return pipeline;
        }),
        exec: vi.fn(async () => []),
      };
      return pipeline;
    }),
  };
});

vi.mock("@/lib/redis", () => ({ getRedisClient: () => mockRedis }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const statisticsMocks = vi.hoisted(() => ({
  sumEntityCostInTimeRanges: vi.fn(),
  sumKeyCostInTimeRange: vi.fn(),
  sumUserCostInTimeRange: vi.fn(),
  sumProviderCostInTimeRange: vi.fn(),
}));
vi.mock("@/repository/statistics", () => statisticsMocks);

const settingsMocks = vi.hoisted(() => ({
  getCachedSystemSettings: vi.fn(),
}));
vi.mock("@/lib/config/system-settings-cache", () => settingsMocks);

import {
  buildLeaseKey,
  HIGH_CONCURRENCY_MIN_LEASE_TTL_SECONDS,
  LEASE_REFRESH_WAIT_MS,
  LEASE_STALE_GRACE_SECONDS,
  serializeLease,
} from "@/lib/rate-limit/lease";
import { type GetCostLeaseParams, LeaseService } from "@/lib/rate-limit/lease-service";

const nowMs = 1_706_400_000_000;

function settings(overrides: Record<string, unknown> = {}) {
  return {
    quotaDbRefreshIntervalSeconds: 10,
    quotaLeasePercent5h: 0.05,
    quotaLeasePercentDaily: 0.05,
    quotaLeasePercentWeekly: 0.05,
    quotaLeasePercentMonthly: 0.05,
    quotaLeaseCapUsd: null,
    enableHighConcurrencyMode: false,
    ...overrides,
  };
}

function windows(entityId = 7): GetCostLeaseParams[] {
  return [
    { entityType: "user", entityId, window: "5h", limitAmount: 10, resetMode: "rolling" },
    {
      entityType: "user",
      entityId,
      window: "daily",
      limitAmount: 20,
      resetTime: "00:00",
      resetMode: "fixed",
    },
    { entityType: "user", entityId, window: "weekly", limitAmount: 50, resetMode: "fixed" },
    { entityType: "user", entityId, window: "monthly", limitAmount: 100, resetMode: "fixed" },
  ];
}

function seedLease(
  params: GetCostLeaseParams,
  overrides: { snapshotAtMs?: number; remainingBudget?: number; limitAmount?: number } = {}
) {
  const resetMode = params.resetMode ?? "fixed";
  redisState.store.set(
    buildLeaseKey(params.entityType, params.entityId, params.window, resetMode),
    serializeLease({
      entityType: params.entityType,
      entityId: params.entityId,
      window: params.window,
      resetMode,
      resetTime: params.resetTime ?? "00:00",
      snapshotAtMs: overrides.snapshotAtMs ?? nowMs,
      currentUsage: 1,
      limitAmount: overrides.limitAmount ?? params.limitAmount,
      remainingBudget: overrides.remainingBudget ?? 0.5,
      ttlSeconds: 10,
      costResetAtMs: null,
      windowResetAtMs: null,
    })
  );
}

describe("LeaseService batched lease access", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    vi.clearAllMocks();
    redisState.store.clear();
    redisState.lockResult = "OK";
    mockRedis.status = "ready";
    mockRedis.pipelineCalls.length = 0;
    settingsMocks.getCachedSystemSettings.mockResolvedValue(settings());
    statisticsMocks.sumEntityCostInTimeRanges.mockResolvedValue([1, 2, 3, 4]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns cached leases without touching the database", async () => {
    for (const params of windows()) seedLease(params);

    const leases = await LeaseService.getCostLeases("user", 7, windows());

    expect(leases.every((lease) => lease !== null)).toBe(true);
    expect(mockRedis.mget).toHaveBeenCalledTimes(1);
    expect(statisticsMocks.sumEntityCostInTimeRanges).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("refreshes all missing windows with one usage_ledger scan and one pipeline write", async () => {
    const leases = await LeaseService.getCostLeases("user", 7, windows());

    expect(statisticsMocks.sumEntityCostInTimeRanges).toHaveBeenCalledTimes(1);
    const [, , ranges] = statisticsMocks.sumEntityCostInTimeRanges.mock.calls[0] as [
      string,
      number,
      unknown[],
    ];
    expect(ranges).toHaveLength(4);
    expect(leases.map((lease) => lease?.currentUsage)).toEqual([1, 2, 3, 4]);
    expect(leases.map((lease) => lease?.window)).toEqual(["5h", "daily", "weekly", "monthly"]);

    expect(mockRedis.pipelineCalls).toHaveLength(4);
    expect(mockRedis.pipelineCalls.every(([, ttl]) => ttl === 10 + LEASE_STALE_GRACE_SECONDS)).toBe(
      true
    );
    expect(mockRedis.set).toHaveBeenCalledWith(
      "lease:refresh_lock:user:7",
      "1",
      "EX",
      expect.any(Number),
      "NX"
    );
    expect(mockRedis.del).toHaveBeenCalledWith("lease:refresh_lock:user:7");
  });

  it("refreshes only invalid windows and keeps valid siblings untouched", async () => {
    const params = windows();
    seedLease(params[0]);
    seedLease(params[1], { limitAmount: 999 }); // limit changed -> refresh
    seedLease(params[2]);
    // monthly missing -> refresh
    statisticsMocks.sumEntityCostInTimeRanges.mockResolvedValue([8, 9]);

    const leases = await LeaseService.getCostLeases("user", 7, params);

    const [, , ranges] = statisticsMocks.sumEntityCostInTimeRanges.mock.calls[0] as [
      string,
      number,
      unknown[],
    ];
    expect(ranges).toHaveLength(2);
    expect(leases.map((lease) => lease?.currentUsage)).toEqual([1, 8, 1, 9]);
  });

  it("uses the per-window query when only one window needs a database refresh", async () => {
    const params = windows();
    seedLease(params[0]);
    seedLease(params[1]);
    seedLease(params[2]);
    statisticsMocks.sumUserCostInTimeRange.mockResolvedValue(42);

    const leases = await LeaseService.getCostLeases("user", 7, params);

    expect(statisticsMocks.sumEntityCostInTimeRanges).not.toHaveBeenCalled();
    expect(statisticsMocks.sumUserCostInTimeRange).toHaveBeenCalledTimes(1);
    expect(leases[3]?.currentUsage).toBe(42);
    expect(mockRedis.setex).toHaveBeenCalledTimes(1);
  });

  it("reads fixed 5h usage from Redis instead of the database", async () => {
    const params: GetCostLeaseParams[] = [
      { entityType: "key", entityId: 3, window: "5h", limitAmount: 10, resetMode: "fixed" },
      { entityType: "key", entityId: 3, window: "weekly", limitAmount: 10, resetMode: "fixed" },
    ];
    redisState.store.set("key:3:cost_5h_fixed", "2.5");
    mockRedis.ttl.mockResolvedValue(600);
    statisticsMocks.sumKeyCostInTimeRange.mockResolvedValue(4);

    const leases = await LeaseService.getCostLeases("key", 3, params);

    expect(leases[0]?.currentUsage).toBe(2.5);
    expect(leases[0]?.windowResetAtMs).toBe(nowMs + 600_000);
    expect(leases[1]?.currentUsage).toBe(4);
    expect(statisticsMocks.sumEntityCostInTimeRanges).not.toHaveBeenCalled();
  });

  it("applies the high-concurrency floor to the lease TTL", async () => {
    settingsMocks.getCachedSystemSettings.mockResolvedValue(
      settings({ enableHighConcurrencyMode: true, quotaDbRefreshIntervalSeconds: 10 })
    );

    const leases = await LeaseService.getCostLeases("user", 7, windows());

    expect(leases[0]?.ttlSeconds).toBe(HIGH_CONCURRENCY_MIN_LEASE_TTL_SECONDS);
  });

  it("shares one in-flight refresh between concurrent callers in the same process", async () => {
    let release!: (value: number[]) => void;
    statisticsMocks.sumEntityCostInTimeRanges.mockImplementation(
      () =>
        new Promise<number[]>((resolve) => {
          release = resolve;
        })
    );

    const first = LeaseService.getCostLeases("user", 7, windows());
    const second = LeaseService.getCostLeases("user", 7, windows());
    await vi.advanceTimersByTimeAsync(0);
    release([1, 2, 3, 4]);
    const [a, b] = await Promise.all([first, second]);

    expect(statisticsMocks.sumEntityCostInTimeRanges).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("serves expired leases while another process holds the refresh lock", async () => {
    for (const params of windows()) {
      seedLease(params, { snapshotAtMs: nowMs - 11_000, remainingBudget: 0.25 });
    }
    redisState.lockResult = null;

    const leases = await LeaseService.getCostLeases("user", 7, windows());

    expect(leases.map((lease) => lease?.remainingBudget)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(statisticsMocks.sumEntityCostInTimeRanges).not.toHaveBeenCalled();
  });

  it("waits for the lock holder's leases when no expired lease is available", async () => {
    redisState.lockResult = null;

    const pending = LeaseService.getCostLeases("user", 7, windows());
    await vi.advanceTimersByTimeAsync(30);
    for (const params of windows()) seedLease(params, { remainingBudget: 0.75 });
    await vi.advanceTimersByTimeAsync(30);

    const leases = await pending;
    expect(leases.map((lease) => lease?.remainingBudget)).toEqual([0.75, 0.75, 0.75, 0.75]);
    expect(statisticsMocks.sumEntityCostInTimeRanges).not.toHaveBeenCalled();
  });

  it("refreshes directly after waiting too long for another process", async () => {
    redisState.lockResult = null;

    const pending = LeaseService.getCostLeases("user", 7, windows());
    await vi.advanceTimersByTimeAsync(LEASE_REFRESH_WAIT_MS + 100);
    const leases = await pending;

    expect(statisticsMocks.sumEntityCostInTimeRanges).toHaveBeenCalledTimes(1);
    expect(leases.every((lease) => lease !== null)).toBe(true);
  });

  it("refreshes directly when the lock command fails", async () => {
    mockRedis.set.mockRejectedValueOnce(new Error("redis timeout"));

    const leases = await LeaseService.getCostLeases("user", 7, windows());

    expect(statisticsMocks.sumEntityCostInTimeRanges).toHaveBeenCalledTimes(1);
    expect(leases.every((lease) => lease !== null)).toBe(true);
  });

  it("refreshes from the database without Redis coordination when Redis is not ready", async () => {
    mockRedis.status = "end";

    const leases = await LeaseService.getCostLeases("user", 7, windows());

    expect(mockRedis.mget).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(statisticsMocks.sumEntityCostInTimeRanges).toHaveBeenCalledTimes(1);
    expect(leases.every((lease) => lease !== null)).toBe(true);
  });

  it("fails open for every window when the database refresh fails", async () => {
    statisticsMocks.sumEntityCostInTimeRanges.mockRejectedValue(new Error("db down"));

    const leases = await LeaseService.getCostLeases("user", 7, windows());

    expect(leases).toEqual([null, null, null, null]);
    expect(mockRedis.del).toHaveBeenCalledWith("lease:refresh_lock:user:7");
  });

  it("fails open when reading cached leases throws", async () => {
    mockRedis.mget.mockRejectedValueOnce(new Error("redis read failed"));

    await expect(LeaseService.getCostLeases("user", 7, windows())).resolves.toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("returns an empty list for no windows", async () => {
    await expect(LeaseService.getCostLeases("user", 7, [])).resolves.toEqual([]);
    await expect(LeaseService.refreshCostLeasesFromDb("user", 7, [])).resolves.toEqual([]);
  });
});
