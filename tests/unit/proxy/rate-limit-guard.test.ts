import { beforeEach, describe, expect, it, vi } from "vitest";

const rateLimitServiceMock = {
  checkTotalCostLimit: vi.fn(),
  checkSessionLimit: vi.fn(),
  checkUserRPM: vi.fn(),
  checkCostLimits: vi.fn(),
  checkUserDailyCost: vi.fn(),
};

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: rateLimitServiceMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "zh-CN"),
}));

const getErrorMessageServerMock = vi.fn(async () => "mock rate limit message");

vi.mock("@/lib/utils/error-messages", () => ({
  ERROR_CODES: {
    RATE_LIMIT_TOTAL_EXCEEDED: "RATE_LIMIT_TOTAL_EXCEEDED",
    RATE_LIMIT_CONCURRENT_SESSIONS_EXCEEDED: "RATE_LIMIT_CONCURRENT_SESSIONS_EXCEEDED",
    RATE_LIMIT_RPM_EXCEEDED: "RATE_LIMIT_RPM_EXCEEDED",
    RATE_LIMIT_DAILY_QUOTA_EXCEEDED: "RATE_LIMIT_DAILY_QUOTA_EXCEEDED",
    RATE_LIMIT_5H_EXCEEDED: "RATE_LIMIT_5H_EXCEEDED",
    RATE_LIMIT_WEEKLY_EXCEEDED: "RATE_LIMIT_WEEKLY_EXCEEDED",
    RATE_LIMIT_MONTHLY_EXCEEDED: "RATE_LIMIT_MONTHLY_EXCEEDED",
  },
  getErrorMessageServer: getErrorMessageServerMock,
}));

describe("ProxyRateLimitGuard - key daily limit enforcement", () => {
  const createSession = (overrides?: {
    user?: Partial<{
      id: number;
      rpm: number | null;
      dailyQuota: number | null;
      dailyResetMode: "fixed" | "rolling";
      dailyResetTime: string;
      limit5hUsd: number | null;
      limitWeeklyUsd: number | null;
      limitMonthlyUsd: number | null;
      limitTotalUsd: number | null;
    }>;
    key?: Partial<{
      id: number;
      key: string;
      limit5hUsd: number | null;
      limitDailyUsd: number | null;
      dailyResetMode: "fixed" | "rolling";
      dailyResetTime: string;
      limitWeeklyUsd: number | null;
      limitMonthlyUsd: number | null;
      limitTotalUsd: number | null;
      limitConcurrentSessions: number;
    }>;
  }) => {
    return {
      authState: {
        user: {
          id: 1,
          rpm: null,
          dailyQuota: null,
          dailyResetMode: "fixed",
          dailyResetTime: "00:00",
          limit5hUsd: null,
          limitWeeklyUsd: null,
          limitMonthlyUsd: null,
          limitTotalUsd: null,
          ...overrides?.user,
        },
        key: {
          id: 2,
          key: "k_test",
          limit5hUsd: null,
          limitDailyUsd: null,
          dailyResetMode: "fixed",
          dailyResetTime: "00:00",
          limitWeeklyUsd: null,
          limitMonthlyUsd: null,
          limitTotalUsd: null,
          limitConcurrentSessions: 0,
          ...overrides?.key,
        },
      },
    } as any;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    rateLimitServiceMock.checkTotalCostLimit.mockResolvedValue({ allowed: true });
    rateLimitServiceMock.checkSessionLimit.mockResolvedValue({ allowed: true });
    rateLimitServiceMock.checkUserRPM.mockResolvedValue({ allowed: true });
    rateLimitServiceMock.checkUserDailyCost.mockResolvedValue({ allowed: true });
    rateLimitServiceMock.checkCostLimits.mockResolvedValue({ allowed: true });
  });

  it("当用户未设置每日额度时，Key 每日额度已超限也必须拦截", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkCostLimits
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({ allowed: false, reason: "Key 每日消费上限已达到（20.0000/10）" }); // key daily

    const session = createSession({
      user: { dailyQuota: null },
      key: { limitDailyUsd: 10 },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "daily_quota",
      currentUsage: 20,
      limitValue: 10,
    });

    expect(rateLimitServiceMock.checkUserDailyCost).not.toHaveBeenCalled();

    expect(rateLimitServiceMock.checkCostLimits).toHaveBeenCalledWith(2, "key", {
      limit_5h_usd: null,
      limit_daily_usd: 10,
      daily_reset_mode: "fixed",
      daily_reset_time: "00:00",
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });
  });

  it("当 Key 每日额度超限时，应在用户每日检查之前直接拦截（Key 优先）", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkCostLimits
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({ allowed: false, reason: "Key 每日消费上限已达到（20.0000/10）" }); // key daily

    const session = createSession({
      user: { dailyQuota: 999 },
      key: { limitDailyUsd: 10 },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "daily_quota",
    });

    expect(rateLimitServiceMock.checkUserDailyCost).not.toHaveBeenCalled();
  });

  it("当 Key 未设置每日额度且用户每日额度已超限时，仍应拦截用户每日额度", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkUserDailyCost.mockResolvedValue({
      allowed: false,
      current: 20,
      reason: "用户每日消费上限已达到（$20.0000/$10）",
    });

    rateLimitServiceMock.checkCostLimits
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({ allowed: true }); // key daily (limit null)

    const session = createSession({
      user: { dailyQuota: 10 },
      key: { limitDailyUsd: null },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "daily_quota",
      currentUsage: 20,
      limitValue: 10,
    });

    expect(rateLimitServiceMock.checkUserDailyCost).toHaveBeenCalledTimes(1);
    expect(getErrorMessageServerMock).toHaveBeenCalledTimes(1);
  });

  it("Key 总限额超限应拦截（usd_total）", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkTotalCostLimit.mockResolvedValueOnce({
      allowed: false,
      current: 20,
      reason: "Key total limit exceeded",
    });

    const session = createSession({
      key: { limitTotalUsd: 10 },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "usd_total",
      currentUsage: 20,
      limitValue: 10,
    });
  });

  it("User 总限额超限应拦截（usd_total）", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkTotalCostLimit
      .mockResolvedValueOnce({ allowed: true }) // key total
      .mockResolvedValueOnce({ allowed: false, current: 20, reason: "User total limit exceeded" }); // user total

    const session = createSession({
      user: { limitTotalUsd: 10 },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "usd_total",
      currentUsage: 20,
      limitValue: 10,
    });
  });

  it("Key 并发 Session 超限应拦截（concurrent_sessions）", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkSessionLimit.mockResolvedValueOnce({
      allowed: false,
      reason: "Key并发 Session 上限已达到（2/1）",
    });

    const session = createSession({
      key: { limitConcurrentSessions: 1 },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "concurrent_sessions",
      currentUsage: 2,
      limitValue: 1,
    });
  });

  it("User RPM 超限应拦截（rpm）", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkUserRPM.mockResolvedValueOnce({
      allowed: false,
      current: 10,
      reason: "用户每分钟请求数上限已达到（10/5）",
    });

    const session = createSession({
      user: { rpm: 5 },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "rpm",
      currentUsage: 10,
      limitValue: 5,
    });
  });

  it("Key 5h 超限应拦截（usd_5h）", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkCostLimits.mockResolvedValueOnce({
      allowed: false,
      reason: "Key 5小时消费上限已达到（20.0000/10）",
    });

    const session = createSession({
      key: { limit5hUsd: 10 },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "usd_5h",
      currentUsage: 20,
      limitValue: 10,
    });
  });

  it("User 5h 超限应拦截（usd_5h）", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkCostLimits
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: false, reason: "User 5小时消费上限已达到（20.0000/10）" }); // user 5h

    const session = createSession({
      user: { limit5hUsd: 10 },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "usd_5h",
      currentUsage: 20,
      limitValue: 10,
    });
  });

  it("Key 周限额超限应拦截（usd_weekly）", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkCostLimits
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({ allowed: true }) // key daily
      .mockResolvedValueOnce({ allowed: false, reason: "Key 周消费上限已达到（100.0000/10）" }); // key weekly

    const session = createSession({
      key: { limitWeeklyUsd: 10 },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "usd_weekly",
      currentUsage: 100,
      limitValue: 10,
    });
  });

  it("User 周限额超限应拦截（usd_weekly）", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkCostLimits
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({ allowed: true }) // key daily
      .mockResolvedValueOnce({ allowed: true }) // key weekly
      .mockResolvedValueOnce({ allowed: false, reason: "User 周消费上限已达到（100.0000/10）" }); // user weekly

    const session = createSession({
      user: { limitWeeklyUsd: 10 },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "usd_weekly",
      currentUsage: 100,
      limitValue: 10,
    });
  });

  it("Key 月限额超限应拦截（usd_monthly）", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkCostLimits
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({ allowed: true }) // key daily
      .mockResolvedValueOnce({ allowed: true }) // key weekly
      .mockResolvedValueOnce({ allowed: true }) // user weekly
      .mockResolvedValueOnce({ allowed: false, reason: "Key 月消费上限已达到（200.0000/10）" }); // key monthly

    const session = createSession({
      key: { limitMonthlyUsd: 10 },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "usd_monthly",
      currentUsage: 200,
      limitValue: 10,
    });
  });

  it("User 月限额超限应拦截（usd_monthly）", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkCostLimits
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({ allowed: true }) // key daily
      .mockResolvedValueOnce({ allowed: true }) // key weekly
      .mockResolvedValueOnce({ allowed: true }) // user weekly
      .mockResolvedValueOnce({ allowed: true }) // key monthly
      .mockResolvedValueOnce({ allowed: false, reason: "User 月消费上限已达到（200.0000/10）" }); // user monthly

    const session = createSession({
      user: { limitMonthlyUsd: 10 },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "usd_monthly",
      currentUsage: 200,
      limitValue: 10,
    });
  });

  it("所有限额均未触发时应放行", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    const session = createSession();
    await expect(ProxyRateLimitGuard.ensure(session)).resolves.toBeUndefined();
  });
});
