import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findUserByIdMock = vi.fn();
const getTimeRangeForPeriodMock = vi.fn();
const getTimeRangeForPeriodWithModeMock = vi.fn();
const sumUserCostInTimeRangeMock = vi.fn();
const sumUserTotalCostMock = vi.fn();
const rateLimitGetCurrentCostMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("@/repository/user", () => ({
  findUserById: (...args: unknown[]) => findUserByIdMock(...args),
}));

vi.mock("@/lib/rate-limit/time-utils", () => ({
  getTimeRangeForPeriod: (...args: unknown[]) => getTimeRangeForPeriodMock(...args),
  getTimeRangeForPeriodWithMode: (...args: unknown[]) => getTimeRangeForPeriodWithModeMock(...args),
}));

vi.mock("@/repository/statistics", () => ({
  sumUserCostInTimeRange: (...args: unknown[]) => sumUserCostInTimeRangeMock(...args),
  sumUserTotalCost: (...args: unknown[]) => sumUserTotalCostMock(...args),
}));

vi.mock("@/lib/rate-limit/service", () => ({
  RateLimitService: {
    getCurrentCost: (...args: unknown[]) => rateLimitGetCurrentCostMock(...args),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(() => async (key: string) => key),
  getLocale: vi.fn(() => "en"),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("user 5h reset boundary", () => {
  const now = new Date("2026-04-22T01:00:00.000Z");
  const windowStart = new Date("2026-04-21T20:00:00.000Z");
  const costResetAt = new Date("2026-04-21T21:00:00.000Z");
  const limit5hCostResetAt = new Date("2026-04-21T23:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    getSessionMock.mockResolvedValue({
      user: { id: 1, role: "admin" },
      key: { id: 1 },
    });

    getTimeRangeForPeriodMock.mockImplementation(async (period: string) => {
      switch (period) {
        case "5h":
          return { startTime: windowStart, endTime: now };
        case "weekly":
          return {
            startTime: new Date("2026-04-20T00:00:00.000Z"),
            endTime: now,
          };
        case "monthly":
          return {
            startTime: new Date("2026-04-01T00:00:00.000Z"),
            endTime: now,
          };
        default:
          return { startTime: windowStart, endTime: now };
      }
    });

    getTimeRangeForPeriodWithModeMock.mockResolvedValue({
      startTime: new Date("2026-04-22T00:00:00.000Z"),
      endTime: now,
    });

    sumUserCostInTimeRangeMock.mockResolvedValue(1);
    sumUserTotalCostMock.mockResolvedValue(10);
    rateLimitGetCurrentCostMock.mockResolvedValue(2);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rolling 5h uses later of full reset and 5h reset markers", async () => {
    findUserByIdMock.mockResolvedValue({
      id: 1,
      name: "Test User",
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limit5hUsd: 5,
      limit5hResetMode: "rolling",
      limitWeeklyUsd: 20,
      limitMonthlyUsd: 100,
      limitTotalUsd: 500,
      costResetAt,
      limit5hCostResetAt,
    });

    const { getUserAllLimitUsage } = await import("@/actions/users");
    const result = await getUserAllLimitUsage(1);

    expect(result.ok).toBe(true);
    expect(sumUserCostInTimeRangeMock).toHaveBeenCalledWith(1, limit5hCostResetAt, now);
  });

  it("rolling 5h falls back to the full reset marker when it is newer than the 5h marker", async () => {
    const newerFullResetAt = new Date("2026-04-22T00:30:00.000Z");
    findUserByIdMock.mockResolvedValue({
      id: 1,
      name: "Test User",
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limit5hUsd: 5,
      limit5hResetMode: "rolling",
      limitWeeklyUsd: 20,
      limitMonthlyUsd: 100,
      limitTotalUsd: 500,
      costResetAt: newerFullResetAt,
      limit5hCostResetAt,
    });

    const { getUserAllLimitUsage } = await import("@/actions/users");
    const result = await getUserAllLimitUsage(1);

    expect(result.ok).toBe(true);
    expect(sumUserCostInTimeRangeMock).toHaveBeenCalledWith(1, newerFullResetAt, now);
  });

  it("fixed 5h remains redis authoritative", async () => {
    findUserByIdMock.mockResolvedValue({
      id: 1,
      name: "Test User",
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limit5hUsd: 5,
      limit5hResetMode: "fixed",
      limitWeeklyUsd: 20,
      limitMonthlyUsd: 100,
      limitTotalUsd: 500,
      costResetAt,
      limit5hCostResetAt,
    });

    const { getUserAllLimitUsage } = await import("@/actions/users");
    const result = await getUserAllLimitUsage(1);

    expect(result.ok).toBe(true);
    expect(rateLimitGetCurrentCostMock).toHaveBeenCalledWith(1, "user", "5h", "00:00", "fixed");
    expect(sumUserCostInTimeRangeMock).not.toHaveBeenCalledWith(1, limit5hCostResetAt, now);
  });

  it("5h only reset leaves daily weekly monthly total intact", async () => {
    findUserByIdMock.mockResolvedValue({
      id: 1,
      name: "Test User",
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      dailyQuota: 8,
      limit5hUsd: 5,
      limit5hResetMode: "rolling",
      limitWeeklyUsd: 20,
      limitMonthlyUsd: 100,
      limitTotalUsd: 500,
      costResetAt,
      limit5hCostResetAt,
    });

    const { getUserAllLimitUsage } = await import("@/actions/users");
    const result = await getUserAllLimitUsage(1);

    expect(result.ok).toBe(true);
    expect(sumUserCostInTimeRangeMock).toHaveBeenNthCalledWith(
      2,
      1,
      new Date("2026-04-22T00:00:00.000Z"),
      now
    );
    expect(sumUserCostInTimeRangeMock).toHaveBeenNthCalledWith(3, 1, costResetAt, now);
    expect(sumUserCostInTimeRangeMock).toHaveBeenNthCalledWith(4, 1, costResetAt, now);
    expect(sumUserTotalCostMock).toHaveBeenCalledWith(1, Infinity, costResetAt);
  });
});
