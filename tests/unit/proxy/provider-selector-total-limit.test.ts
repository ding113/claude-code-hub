import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

const circuitBreakerMocks = vi.hoisted(() => ({
  isCircuitOpen: vi.fn(async () => false),
  getCircuitState: vi.fn(() => "closed"),
}));

vi.mock("@/lib/circuit-breaker", () => circuitBreakerMocks);

const sessionManagerMocks = vi.hoisted(() => ({
  SessionManager: {
    getSessionProvider: vi.fn(async () => null as number | null),
  },
}));

vi.mock("@/lib/session-manager", () => sessionManagerMocks);

const providerRepositoryMocks = vi.hoisted(() => ({
  findProviderById: vi.fn(async () => null as Provider | null),
  findAllProviders: vi.fn(async () => [] as Provider[]),
}));

vi.mock("@/repository/provider", () => providerRepositoryMocks);

const rateLimitMocks = vi.hoisted(() => ({
  RateLimitService: {
    checkCostLimits: vi.fn(async () => ({ allowed: true })),
    checkTotalCostLimit: vi.fn(async () => ({ allowed: true, current: 0 })),
  },
}));

vi.mock("@/lib/rate-limit", () => rateLimitMocks);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ProxyProviderResolver.filterByLimits - provider total limit", () => {
  test("当供应商达到总消费上限时应被过滤掉", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const resetAt = new Date("2026-01-04T00:00:00.000Z");

    const providers: Provider[] = [
      {
        id: 1,
        name: "p1",
        isEnabled: true,
        providerType: "claude",
        groupTag: null,
        weight: 1,
        priority: 0,
        costMultiplier: 1,
        // rate limit fields
        limit5hUsd: null,
        limitDailyUsd: null,
        dailyResetMode: "fixed",
        dailyResetTime: "00:00",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: 10,
        totalCostResetAt: resetAt,
        limitConcurrentSessions: 0,
      } as unknown as Provider,
      {
        id: 2,
        name: "p2",
        isEnabled: true,
        providerType: "claude",
        groupTag: null,
        weight: 1,
        priority: 0,
        costMultiplier: 1,
        limit5hUsd: null,
        limitDailyUsd: null,
        dailyResetMode: "fixed",
        dailyResetTime: "00:00",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        totalCostResetAt: null,
        limitConcurrentSessions: 0,
      } as unknown as Provider,
    ];

    rateLimitMocks.RateLimitService.checkTotalCostLimit.mockImplementation(async (id: number) => {
      if (id === 1) return { allowed: false, current: 10, reason: "limit reached" };
      return { allowed: true, current: 0 };
    });

    const filtered = await (ProxyProviderResolver as any).filterByLimits(providers);
    expect(filtered.map((p: Provider) => p.id)).toEqual([2]);

    expect(rateLimitMocks.RateLimitService.checkTotalCostLimit).toHaveBeenCalledWith(
      1,
      "provider",
      10,
      { resetAt }
    );
  });
});

describe("ProxyProviderResolver.findReusable - provider total limit", () => {
  test("当会话复用的供应商达到总限额时应拒绝复用", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const resetAt = new Date("2026-01-04T00:00:00.000Z");

    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(1);
    providerRepositoryMocks.findProviderById.mockResolvedValueOnce({
      id: 1,
      name: "p1",
      isEnabled: true,
      providerType: "claude",
      groupTag: null,
      weight: 1,
      priority: 0,
      costMultiplier: 1,
      limit5hUsd: null,
      limitDailyUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: 10,
      totalCostResetAt: resetAt,
      limitConcurrentSessions: 0,
    } as unknown as Provider);

    rateLimitMocks.RateLimitService.checkTotalCostLimit.mockResolvedValueOnce({
      allowed: false,
      current: 10,
      reason: "limit reached",
    });

    const session = {
      sessionId: "s1",
      shouldReuseProvider: () => true,
      authState: null,
      getCurrentModel: () => null,
      getOriginalModel: () => null,
    } as any;

    const reused = await (ProxyProviderResolver as any).findReusable(session);
    expect(reused).toBeNull();

    expect(rateLimitMocks.RateLimitService.checkCostLimits).toHaveBeenCalledWith(1, "provider", {
      limit_5h_usd: null,
      limit_daily_usd: null,
      daily_reset_mode: "fixed",
      daily_reset_time: "00:00",
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    expect(rateLimitMocks.RateLimitService.checkTotalCostLimit).toHaveBeenCalledWith(
      1,
      "provider",
      10,
      { resetAt }
    );
  });
});
