import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

const getTimeRangeForPeriodWithModeMock = vi.fn(async () => ({
  startTime: new Date("2026-04-22T00:00:00.000Z"),
  endTime: new Date("2026-04-22T01:00:00.000Z"),
}));
const getTimeRangeForPeriodMock = vi.fn(async (period: string) => {
  if (period === "5h") {
    return {
      startTime: new Date("2026-04-21T20:00:00.000Z"),
      endTime: new Date("2026-04-22T01:00:00.000Z"),
    };
  }
  return {
    startTime: new Date("2026-04-21T00:00:00.000Z"),
    endTime: new Date("2026-04-22T01:00:00.000Z"),
  };
});
vi.mock("@/lib/rate-limit/time-utils", () => ({
  getTimeRangeForPeriodWithMode: getTimeRangeForPeriodWithModeMock,
  getTimeRangeForPeriod: getTimeRangeForPeriodMock,
}));

const sumUserQuotaCostsMock = vi.fn(async () => ({
  cost5h: 0,
  costDaily: 9,
  costWeekly: 9,
  costMonthly: 9,
  costTotal: 9,
}));
const sumKeyQuotaCostsByIdMock = vi.fn(async () => ({
  cost5h: 0,
  costDaily: 0,
  costWeekly: 0,
  costMonthly: 0,
  costTotal: 0,
}));
vi.mock("@/repository/statistics", () => ({
  sumUserQuotaCosts: (...args: unknown[]) => sumUserQuotaCostsMock(...args),
  sumKeyQuotaCostsById: (...args: unknown[]) => sumKeyQuotaCostsByIdMock(...args),
  sumUserCostInTimeRange: vi.fn(async () => 0),
  sumUserTotalCost: vi.fn(async () => 0),
}));

const getCurrentCostMock = vi.fn(async () => 2);
vi.mock("@/lib/rate-limit/service", () => ({
  RateLimitService: {
    getCurrentCost: (...args: unknown[]) => getCurrentCostMock(...args),
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    getKeySessionCount: vi.fn(async () => 0),
  },
}));

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
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("getMyQuota - user 5h reset boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      key: {
        id: 11,
        key: "sk-test",
        name: "key",
        dailyResetTime: "00:00",
        dailyResetMode: "fixed",
        limit5hUsd: null,
        limit5hResetMode: "rolling",
        limitDailyUsd: null,
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: 0,
        providerGroup: null,
        isEnabled: true,
        expiresAt: null,
        costResetAt: null,
      },
      user: {
        id: 22,
        name: "user",
        dailyResetTime: "00:00",
        dailyResetMode: "fixed",
        limit5hUsd: 10,
        limit5hResetMode: "rolling",
        dailyQuota: 50,
        limitWeeklyUsd: 100,
        limitMonthlyUsd: 200,
        limitTotalUsd: 300,
        limitConcurrentSessions: 0,
        rpm: null,
        providerGroup: null,
        isEnabled: true,
        expiresAt: null,
        allowedModels: [],
        allowedClients: [],
        blockedClients: [],
        costResetAt: new Date("2026-04-21T21:00:00.000Z"),
        limit5hCostResetAt: new Date("2026-04-21T23:00:00.000Z"),
      },
    });
  });

  it("passes limit5hCostResetAt into user 5h current-cost and quota range calculations", async () => {
    const { getMyQuota } = await import("@/actions/my-usage");
    const result = await getMyQuota();

    expect(result.ok).toBe(true);
    expect(getCurrentCostMock).toHaveBeenCalledWith(
      22,
      "user",
      "5h",
      "00:00",
      "rolling",
      expect.objectContaining({
        costResetAt: new Date("2026-04-21T21:00:00.000Z"),
        limit5hCostResetAt: new Date("2026-04-21T23:00:00.000Z"),
      })
    );
    expect(sumUserQuotaCostsMock).toHaveBeenCalledWith(
      22,
      expect.objectContaining({
        range5h: expect.objectContaining({
          startTime: new Date("2026-04-21T23:00:00.000Z"),
        }),
        rangeDaily: expect.objectContaining({
          startTime: new Date("2026-04-22T00:00:00.000Z"),
        }),
        rangeWeekly: expect.objectContaining({
          startTime: new Date("2026-04-21T21:00:00.000Z"),
        }),
        rangeMonthly: expect.objectContaining({
          startTime: new Date("2026-04-21T21:00:00.000Z"),
        }),
      }),
      Infinity,
      new Date("2026-04-21T21:00:00.000Z")
    );
  });
});
