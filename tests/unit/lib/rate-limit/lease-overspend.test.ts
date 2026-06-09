import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const leaseServiceMock = {
  getCostLease: vi.fn(),
};

vi.mock("@/lib/rate-limit/lease-service", () => ({
  LeaseService: leaseServiceMock,
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => ({ status: "ready" }),
}));

describe("checkCostLimitsWithLease — bug04 estimatedCost gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows the request when remainingBudget is positive and estimatedCost is not supplied (legacy)", async () => {
    leaseServiceMock.getCostLease.mockResolvedValue({
      remainingBudget: 0.0001,
      currentUsage: 99.9999,
    });

    const { RateLimitService } = await import("@/lib/rate-limit");
    const result = await RateLimitService.checkCostLimitsWithLease(1, "user", {
      limit_5h_usd: null,
      limit_daily_usd: 100,
      daily_reset_time: "00:00",
      daily_reset_mode: "rolling",
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    expect(result.allowed).toBe(true);
  });

  it("denies the request when remainingBudget < estimatedCost (pessimistic gate)", async () => {
    leaseServiceMock.getCostLease.mockResolvedValue({
      remainingBudget: 4,
      currentUsage: 96,
    });

    const { RateLimitService } = await import("@/lib/rate-limit");
    const result = await RateLimitService.checkCostLimitsWithLease(
      1,
      "user",
      {
        limit_5h_usd: null,
        limit_daily_usd: 100,
        daily_reset_time: "00:00",
        daily_reset_mode: "rolling",
        limit_weekly_usd: null,
        limit_monthly_usd: null,
      },
      { estimatedCost: 6 }
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/cost limit reached|insufficient/i);
  });

  it("allows when remainingBudget covers estimatedCost", async () => {
    leaseServiceMock.getCostLease.mockResolvedValue({
      remainingBudget: 10,
      currentUsage: 90,
    });

    const { RateLimitService } = await import("@/lib/rate-limit");
    const result = await RateLimitService.checkCostLimitsWithLease(
      1,
      "user",
      {
        limit_5h_usd: null,
        limit_daily_usd: 100,
        daily_reset_time: "00:00",
        daily_reset_mode: "rolling",
        limit_weekly_usd: null,
        limit_monthly_usd: null,
      },
      { estimatedCost: 6 }
    );

    expect(result.allowed).toBe(true);
  });

  it("preserves the legacy <= 0 contract when estimatedCost is 0", async () => {
    leaseServiceMock.getCostLease.mockResolvedValue({
      remainingBudget: 0,
      currentUsage: 100,
    });

    const { RateLimitService } = await import("@/lib/rate-limit");
    const result = await RateLimitService.checkCostLimitsWithLease(
      1,
      "user",
      {
        limit_5h_usd: null,
        limit_daily_usd: 100,
        daily_reset_time: "00:00",
        daily_reset_mode: "rolling",
        limit_weekly_usd: null,
        limit_monthly_usd: null,
      },
      { estimatedCost: 0 }
    );

    expect(result.allowed).toBe(false);
  });
});
