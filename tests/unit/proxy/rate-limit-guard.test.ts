import { beforeEach, describe, expect, it, vi } from "vitest";

const generateSessionIdMock = vi.hoisted(() => vi.fn(() => "sess_generated"));

const rateLimitServiceMock = {
  checkTotalCostLimit: vi.fn(),
  checkAndTrackKeyUserSession: vi.fn(),
  checkRpmLimit: vi.fn(),
  checkCostLimitsWithLease: vi.fn(),
  checkUserDailyCost: vi.fn(),
};

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: rateLimitServiceMock,
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    generateSessionId: generateSessionIdMock,
  },
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
      limitConcurrentSessions: number | null;
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
    const session = {
      sessionId: "sess_test",
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
          limitConcurrentSessions: null,
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

    session.setSessionId = (id: string) => {
      session.sessionId = id;
    };

    return session;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    generateSessionIdMock.mockReturnValue("sess_generated");

    rateLimitServiceMock.checkTotalCostLimit.mockResolvedValue({ allowed: true });
    rateLimitServiceMock.checkAndTrackKeyUserSession.mockResolvedValue({
      allowed: true,
      keyCount: 0,
      userCount: 0,
      trackedKey: false,
      trackedUser: false,
    });
    rateLimitServiceMock.checkRpmLimit.mockResolvedValue({ allowed: true });
    rateLimitServiceMock.checkUserDailyCost.mockResolvedValue({ allowed: true });
    rateLimitServiceMock.checkCostLimitsWithLease.mockResolvedValue({ allowed: true });
  });

  it("当用户未设置每日额度时，Key 每日额度已超限也必须拦截", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkCostLimitsWithLease
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({
        allowed: false,
        reason: "Key daily cost limit reached (usage: 20.0000/10.0000)",
      }); // key daily

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

    expect(rateLimitServiceMock.checkCostLimitsWithLease).toHaveBeenCalledWith(2, "key", {
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

    rateLimitServiceMock.checkCostLimitsWithLease
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({
        allowed: false,
        reason: "Key daily cost limit reached (usage: 20.0000/10.0000)",
      }); // key daily

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

    rateLimitServiceMock.checkCostLimitsWithLease
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({ allowed: true }) // key daily (limit null)
      .mockResolvedValueOnce({
        allowed: false,
        reason: "User daily cost limit reached (usage: 20.0000/10.0000)",
      }); // user daily

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

    // User daily 现在使用 checkCostLimitsWithLease 而不是 checkUserDailyCost
    expect(rateLimitServiceMock.checkUserDailyCost).not.toHaveBeenCalled();
    expect(rateLimitServiceMock.checkCostLimitsWithLease).toHaveBeenCalledWith(1, "user", {
      limit_5h_usd: null,
      limit_daily_usd: 10,
      daily_reset_time: "00:00",
      daily_reset_mode: "fixed",
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });
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

    rateLimitServiceMock.checkAndTrackKeyUserSession.mockResolvedValueOnce({
      allowed: false,
      rejectedBy: "key",
      reason: "Key并发 Session 上限已达到（2/1）",
      keyCount: 2,
      userCount: 0,
      trackedKey: false,
      trackedUser: false,
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

  it("User 并发 Session 超限应拦截（concurrent_sessions）", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkAndTrackKeyUserSession.mockResolvedValueOnce({
      allowed: false,
      rejectedBy: "user",
      reason: "User并发 Session 上限已达到（2/1）",
      keyCount: 0,
      userCount: 2,
      trackedKey: false,
      trackedUser: false,
    });

    const session = createSession({
      user: { limitConcurrentSessions: 1 },
      key: { limitConcurrentSessions: 10 },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "concurrent_sessions",
      currentUsage: 2,
      limitValue: 1,
    });
  });

  it("当 Key 并发未设置（0）且 User 并发已设置时，Key 并发检查应继承 User 并发上限", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    const session = createSession({
      user: { limitConcurrentSessions: 15 },
      key: { limitConcurrentSessions: 0 },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).resolves.toBeUndefined();

    expect(rateLimitServiceMock.checkAndTrackKeyUserSession).toHaveBeenCalledWith(
      2,
      1,
      "sess_test",
      15,
      15
    );
  });

  it("User RPM 超限应拦截（rpm）", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkRpmLimit.mockResolvedValueOnce({
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

    rateLimitServiceMock.checkCostLimitsWithLease.mockResolvedValueOnce({
      allowed: false,
      reason: "Key 5h cost limit reached (usage: 20.0000/10.0000)",
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

    rateLimitServiceMock.checkCostLimitsWithLease
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({
        allowed: false,
        reason: "User 5h cost limit reached (usage: 20.0000/10.0000)",
      }); // user 5h

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

    rateLimitServiceMock.checkCostLimitsWithLease
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({ allowed: true }) // key daily
      .mockResolvedValueOnce({ allowed: true }) // user daily (new with lease migration)
      .mockResolvedValueOnce({
        allowed: false,
        reason: "Key weekly cost limit reached (usage: 100.0000/10.0000)",
      }); // key weekly

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

    rateLimitServiceMock.checkCostLimitsWithLease
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({ allowed: true }) // key daily
      .mockResolvedValueOnce({ allowed: true }) // user daily (new with lease migration)
      .mockResolvedValueOnce({ allowed: true }) // key weekly
      .mockResolvedValueOnce({
        allowed: false,
        reason: "User weekly cost limit reached (usage: 100.0000/10.0000)",
      }); // user weekly

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

    rateLimitServiceMock.checkCostLimitsWithLease
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({ allowed: true }) // key daily
      .mockResolvedValueOnce({ allowed: true }) // user daily (new with lease migration)
      .mockResolvedValueOnce({ allowed: true }) // key weekly
      .mockResolvedValueOnce({ allowed: true }) // user weekly
      .mockResolvedValueOnce({
        allowed: false,
        reason: "Key monthly cost limit reached (usage: 200.0000/10.0000)",
      }); // key monthly

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

    rateLimitServiceMock.checkCostLimitsWithLease
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({ allowed: true }) // key daily
      .mockResolvedValueOnce({ allowed: true }) // user daily (new with lease migration)
      .mockResolvedValueOnce({ allowed: true }) // key weekly
      .mockResolvedValueOnce({ allowed: true }) // user weekly
      .mockResolvedValueOnce({ allowed: true }) // key monthly
      .mockResolvedValueOnce({
        allowed: false,
        reason: "User monthly cost limit reached (usage: 200.0000/10.0000)",
      }); // user monthly

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

  it("当 sessionId 缺失时，应兜底生成并继续并发检查", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    const session = createSession() as any;
    session.sessionId = undefined;

    await expect(ProxyRateLimitGuard.ensure(session)).resolves.toBeUndefined();

    expect(generateSessionIdMock).toHaveBeenCalledTimes(1);
    expect(session.sessionId).toBe("sess_generated");
    expect(rateLimitServiceMock.checkAndTrackKeyUserSession).toHaveBeenCalledWith(
      2,
      1,
      "sess_generated",
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("User daily (rolling mode) 超限应使用 checkCostLimitsWithLease", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    rateLimitServiceMock.checkCostLimitsWithLease
      .mockResolvedValueOnce({ allowed: true }) // key 5h
      .mockResolvedValueOnce({ allowed: true }) // user 5h
      .mockResolvedValueOnce({ allowed: true }) // key daily (limit null)
      .mockResolvedValueOnce({
        allowed: false,
        reason: "User daily cost limit reached (usage: 15.0000/10.0000)",
      }); // user daily rolling

    const session = createSession({
      user: { dailyQuota: 10, dailyResetMode: "rolling", dailyResetTime: "12:00" },
      key: { limitDailyUsd: null },
    });

    await expect(ProxyRateLimitGuard.ensure(session)).rejects.toMatchObject({
      name: "RateLimitError",
      limitType: "daily_quota",
      currentUsage: 15,
      limitValue: 10,
      resetTime: null, // rolling 模式没有固定重置时间
    });

    // Verify checkCostLimitsWithLease was called with rolling mode
    expect(rateLimitServiceMock.checkCostLimitsWithLease).toHaveBeenCalledWith(1, "user", {
      limit_5h_usd: null,
      limit_daily_usd: 10,
      daily_reset_time: "12:00",
      daily_reset_mode: "rolling",
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    // checkUserDailyCost should NOT be called (migrated to lease)
    expect(rateLimitServiceMock.checkUserDailyCost).not.toHaveBeenCalled();
  });

  it("User daily 检查顺序：Key daily 先于 User daily", async () => {
    const { ProxyRateLimitGuard } = await import("@/app/v1/_lib/proxy/rate-limit-guard");

    const callOrder: string[] = [];

    rateLimitServiceMock.checkCostLimitsWithLease.mockImplementation(async (_id, type, limits) => {
      if (limits.limit_daily_usd !== null) {
        callOrder.push(`${type}_daily`);
      }
      return { allowed: true };
    });

    const session = createSession({
      user: { dailyQuota: 10 },
      key: { limitDailyUsd: 20 },
    });

    await ProxyRateLimitGuard.ensure(session);

    // Key daily should be checked before User daily
    const keyDailyIdx = callOrder.indexOf("key_daily");
    const userDailyIdx = callOrder.indexOf("user_daily");
    expect(keyDailyIdx).toBeLessThan(userDailyIdx);
  });
});
