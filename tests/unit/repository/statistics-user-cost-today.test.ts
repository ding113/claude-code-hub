import { beforeEach, describe, expect, it, vi } from "vitest";

const findUserByIdMock = vi.fn();
const getTimeRangeForPeriodWithModeMock = vi.fn();
const whereMock = vi.fn(async () => [{ total: 12.34 }]);
const fromMock = vi.fn(() => ({
  where: whereMock,
}));
const selectMock = vi.fn(() => ({
  from: fromMock,
  where: vi.fn(async () => [{ total: 0 }]),
}));

vi.mock("@/repository/user", () => ({
  findUserById: (...args: unknown[]) => findUserByIdMock(...args),
}));

vi.mock("@/lib/rate-limit/time-utils", () => ({
  getTimeRangeForPeriodWithMode: (...args: unknown[]) => getTimeRangeForPeriodWithModeMock(...args),
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    select: selectMock,
    execute: vi.fn(async () => []),
  },
}));

describe("sumUserCostToday", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    whereMock.mockResolvedValue([{ total: 12.34 }]);
    findUserByIdMock.mockResolvedValue({
      id: 7,
      dailyResetMode: "rolling",
      dailyResetTime: "09:30",
    });
    getTimeRangeForPeriodWithModeMock.mockResolvedValue({
      startTime: new Date("2026-06-29T01:30:00.000Z"),
      endTime: new Date("2026-06-29T09:30:00.000Z"),
    });
  });

  it("uses the user's daily reset mode/time instead of natural day boundaries", async () => {
    const statistics = await import("@/repository/statistics");

    const total = await statistics.sumUserCostToday(7);

    expect(findUserByIdMock).toHaveBeenCalledWith(7);
    expect(getTimeRangeForPeriodWithModeMock).toHaveBeenCalledWith("daily", "09:30", "rolling");
    expect(selectMock).toHaveBeenCalled();
    expect(fromMock).toHaveBeenCalled();
    expect(whereMock).toHaveBeenCalled();
    expect(total).toBe(12.34);
  });

  it("returns 0 when the user does not exist", async () => {
    findUserByIdMock.mockResolvedValueOnce(null);
    const { sumUserCostToday } = await import("@/repository/statistics");

    await expect(sumUserCostToday(999)).resolves.toBe(0);
    expect(getTimeRangeForPeriodWithModeMock).not.toHaveBeenCalled();
  });
});
