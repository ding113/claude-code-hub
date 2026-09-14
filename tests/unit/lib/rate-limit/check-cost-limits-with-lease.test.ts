import { beforeEach, describe, expect, it, vi } from "vitest";

const leaseMocks = vi.hoisted(() => ({
  getCostLeases: vi.fn(),
  decrementLeaseBudget: vi.fn(),
  settleLeaseBudgets: vi.fn(),
}));

vi.mock("@/lib/rate-limit/lease-service", () => ({ LeaseService: leaseMocks }));
vi.mock("@/lib/redis", () => ({ getRedisClient: () => null }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/repository/statistics", () => ({}));
vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettingsOnlyCache: () => null,
}));

import { RateLimitService } from "@/lib/rate-limit/service";

function lease(window: string, remainingBudget: number, currentUsage = 1) {
  return { window, remainingBudget, currentUsage };
}

describe("RateLimitService.checkCostLimitsWithLease", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not read leases when no window has a limit", async () => {
    const result = await RateLimitService.checkCostLimitsWithLease(1, "key", {
      limit_5h_usd: null,
      limit_daily_usd: 0,
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    expect(result).toEqual({ allowed: true });
    expect(leaseMocks.getCostLeases).not.toHaveBeenCalled();
  });

  it("reads all configured windows in one batched call with the effective reset points", async () => {
    const costResetAt = new Date("2026-01-01T00:00:00.000Z");
    const limit5hResetAt = new Date("2026-02-01T00:00:00.000Z");
    leaseMocks.getCostLeases.mockResolvedValue([lease("5h", 1), lease("monthly", 1)]);

    const result = await RateLimitService.checkCostLimitsWithLease(5, "user", {
      limit_5h_usd: 10,
      limit_daily_usd: null,
      limit_weekly_usd: null,
      limit_monthly_usd: 100,
      cost_reset_at: costResetAt,
      limit_5h_cost_reset_at: limit5hResetAt,
    });

    expect(result).toEqual({ allowed: true });
    expect(leaseMocks.getCostLeases).toHaveBeenCalledTimes(1);
    const [entityType, entityId, windows] = leaseMocks.getCostLeases.mock.calls[0] as [
      string,
      number,
      Array<Record<string, unknown>>,
    ];
    expect(entityType).toBe("user");
    expect(entityId).toBe(5);
    expect(windows).toEqual([
      expect.objectContaining({ window: "5h", limitAmount: 10, costResetAt: limit5hResetAt }),
      expect.objectContaining({ window: "monthly", limitAmount: 100, costResetAt: costResetAt }),
    ]);
  });

  it("rejects when any configured window has no remaining budget", async () => {
    leaseMocks.getCostLeases.mockResolvedValue([lease("daily", 3), lease("weekly", 0, 50)]);

    const result = await RateLimitService.checkCostLimitsWithLease(9, "provider", {
      limit_5h_usd: null,
      limit_daily_usd: 20,
      limit_weekly_usd: 50,
      limit_monthly_usd: null,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Provider weekly cost limit reached (usage: 50.0000/50.0000)");
  });

  it("fails open per window when a lease is unavailable", async () => {
    leaseMocks.getCostLeases.mockResolvedValue([null, lease("weekly", 2)]);

    const result = await RateLimitService.checkCostLimitsWithLease(2, "key", {
      limit_5h_usd: 5,
      limit_daily_usd: null,
      limit_weekly_usd: 50,
      limit_monthly_usd: null,
    });

    expect(result).toEqual({ allowed: true });
  });

  it("fails open when lease access throws", async () => {
    leaseMocks.getCostLeases.mockRejectedValue(new Error("unexpected"));

    const result = await RateLimitService.checkCostLimitsWithLease(2, "key", {
      limit_5h_usd: 5,
      limit_daily_usd: null,
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    expect(result).toEqual({ allowed: true, failOpen: true });
  });
});
