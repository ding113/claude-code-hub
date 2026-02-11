import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

const getTranslationsMock = vi.fn(async () => (key: string) => key);
vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
}));

const getSystemSettingsMock = vi.fn(async () => ({ currencyDisplay: "USD" }));
vi.mock("@/repository/system-config", () => ({
  getSystemSettings: getSystemSettingsMock,
}));

const getTotalUsageForKeyMock = vi.fn(async () => 0);
vi.mock("@/repository/usage-logs", () => ({
  getTotalUsageForKey: getTotalUsageForKeyMock,
}));

const getKeySessionCountMock = vi.fn(async () => 2);
vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    getKeySessionCount: getKeySessionCountMock,
  },
}));

const getTimeRangeForPeriodWithModeMock = vi.fn(async () => ({
  startTime: new Date("2026-02-11T00:00:00.000Z"),
  endTime: new Date("2026-02-12T00:00:00.000Z"),
}));
const getTimeRangeForPeriodMock = vi.fn(async () => ({
  startTime: new Date("2026-02-11T00:00:00.000Z"),
  endTime: new Date("2026-02-12T00:00:00.000Z"),
}));
vi.mock("@/lib/rate-limit/time-utils", () => ({
  getTimeRangeForPeriodWithMode: getTimeRangeForPeriodWithModeMock,
  getTimeRangeForPeriod: getTimeRangeForPeriodMock,
}));

const sumKeyCostInTimeRangeMock = vi.fn(async () => 0);
vi.mock("@/repository/statistics", () => ({
  sumKeyCostInTimeRange: sumKeyCostInTimeRangeMock,
}));

const limitMock = vi.fn();
const whereMock = vi.fn(() => ({ limit: limitMock }));
const leftJoinMock = vi.fn(() => ({ where: whereMock }));
const fromMock = vi.fn(() => ({ leftJoin: leftJoinMock }));
const selectMock = vi.fn(() => ({ from: fromMock }));

vi.mock("@/drizzle/db", () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("getKeyQuotaUsage - concurrent limit inheritance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
  });

  it("Key 并发为 0 时应回退到 User 并发上限", async () => {
    limitMock.mockResolvedValueOnce([
      {
        key: {
          id: 1,
          userId: 10,
          key: "sk-test",
          name: "k",
          deletedAt: null,
          limit5hUsd: null,
          limitDailyUsd: null,
          limitWeeklyUsd: null,
          limitMonthlyUsd: null,
          limitTotalUsd: null,
          dailyResetTime: "00:00",
          dailyResetMode: "fixed",
          limitConcurrentSessions: 0,
        },
        userLimitConcurrentSessions: 15,
      },
    ]);

    const { getKeyQuotaUsage } = await import("@/actions/key-quota");
    const result = await getKeyQuotaUsage(1);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const item = result.data.items.find((i) => i.type === "limitSessions");
      expect(item).toMatchObject({ current: 2, limit: 15 });
    }
  });
});
