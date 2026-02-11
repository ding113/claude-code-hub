import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
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

const statisticsMock = {
  sumUserCostInTimeRange: vi.fn(async () => 0),
  sumUserTotalCost: vi.fn(async () => 0),
  sumKeyCostInTimeRange: vi.fn(async () => 0),
  sumKeyTotalCostById: vi.fn(async () => 0),
};
vi.mock("@/repository/statistics", () => statisticsMock);

const whereMock = vi.fn(async () => [{ id: 1 }]);
const fromMock = vi.fn(() => ({ where: whereMock }));
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

describe("getMyQuota - concurrent limit inheritance", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({
      key: {
        id: 1,
        key: "sk-test",
        name: "k",
        dailyResetTime: "00:00",
        dailyResetMode: "fixed",
        limit5hUsd: null,
        limitDailyUsd: null,
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: 0,
        providerGroup: null,
        isEnabled: true,
        expiresAt: null,
      },
      user: {
        id: 10,
        name: "u",
        dailyResetTime: "00:00",
        dailyResetMode: "fixed",
        limit5hUsd: null,
        dailyQuota: null,
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: 15,
        rpm: null,
        providerGroup: null,
        isEnabled: true,
        expiresAt: null,
        allowedModels: [],
        allowedClients: [],
      },
    });
  });

  it("Key 并发为 0 时应回退到 User 并发上限", async () => {
    const { getMyQuota } = await import("@/actions/my-usage");
    const result = await getMyQuota();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.keyLimitConcurrentSessions).toBe(15);
    }
  });
});
