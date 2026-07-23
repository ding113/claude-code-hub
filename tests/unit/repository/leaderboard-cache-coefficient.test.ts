import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProviderCacheCoefficients,
  resolveLeaderboardWindow,
} from "@/repository/provider-cache-effectiveness";

/**
 * F3b 缓存系数数据源测试：
 * - getProviderCacheCoefficients：按 provider 汇总窗口行后用定点公式重算 effectivenessBp
 * - resolveLeaderboardWindow：把排行榜周期解析成 [start, end]（语义对齐 buildDateCondition）
 */

const dbMocks = vi.hoisted(() => {
  const groupBy = vi.fn();
  const where = vi.fn(() => ({ groupBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select, from, where, groupBy };
});

vi.mock("@/drizzle/db", () => ({
  db: { select: dbMocks.select },
}));

function aggregateRow(
  providerId: number,
  sample: string,
  eligible: string,
  theoretical: string,
  observed: string
) {
  return {
    providerId,
    sampleCount: sample,
    eligibleCount: eligible,
    theoreticalCacheTokens: theoretical,
    observedCacheReadTokens: observed,
  };
}

describe("getProviderCacheCoefficients", () => {
  beforeEach(() => {
    dbMocks.groupBy.mockResolvedValue([]);
  });

  const window = { start: new Date("2026-07-22T00:00:00Z"), end: new Date("2026-07-22T01:00:00Z") };

  it("recomputes the fixed-point formula on aggregated sums", async () => {
    // rawBp = 86000*10000/100000 = 8600; factor(150>=100) = 10000
    // observableBp = 150*10000/200 = 7500; confidenceBp = 7500
    // effectivenessBp = 8600*7500/10000 = 6450
    dbMocks.groupBy.mockResolvedValue([aggregateRow(7, "200", "150", "100000", "86000")]);

    const result = await getProviderCacheCoefficients(window);

    expect(result.get(7)).toEqual({ providerId: 7, coefficientBp: 6450, sampleCount: 200 });
  });

  it("clamps rawBp at 10000 when observed exceeds theoretical", async () => {
    dbMocks.groupBy.mockResolvedValue([aggregateRow(1, "200", "150", "100000", "250000")]);

    const result = await getProviderCacheCoefficients(window);

    // raw clamp 10000 -> effectiveness = confidenceBp = 7500
    expect(result.get(1)?.coefficientBp).toBe(7500);
  });

  it("returns 0 coefficient when theoretical tokens are zero", async () => {
    dbMocks.groupBy.mockResolvedValue([aggregateRow(1, "10", "10", "0", "0")]);

    const result = await getProviderCacheCoefficients(window);

    expect(result.get(1)?.coefficientBp).toBe(0);
  });

  it("applies the sample-size factor tiers on aggregated eligible counts", async () => {
    dbMocks.groupBy.mockResolvedValue([
      // eligible 30 / sample 40: factor 6000, observable 7500, confidence 4500; raw 5000 -> 2250
      aggregateRow(1, "40", "30", "100", "50"),
      // eligible 5 / sample 5: factor 3000, observable 10000, confidence 3000; raw 10000 -> 3000
      aggregateRow(2, "5", "5", "100", "100"),
      // eligible 4 / sample 4: factor 1000, observable 10000, confidence 1000; raw 10000 -> 1000
      aggregateRow(3, "4", "4", "100", "100"),
    ]);

    const result = await getProviderCacheCoefficients(window);

    expect(result.get(1)?.coefficientBp).toBe(2250);
    expect(result.get(2)?.coefficientBp).toBe(3000);
    expect(result.get(3)?.coefficientBp).toBe(1000);
  });

  it("returns an empty map when no windows fall inside the range", async () => {
    const result = await getProviderCacheCoefficients(window);

    expect(result.size).toBe(0);
  });
});

describe("resolveLeaderboardWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves custom ranges as [startDate 00:00, endDate + 1 day 00:00) in the given timezone", () => {
    const utc = resolveLeaderboardWindow("custom", "UTC", {
      startDate: "2026-01-01",
      endDate: "2026-01-15",
    });
    expect(utc.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(utc.end.toISOString()).toBe("2026-01-16T00:00:00.000Z");

    const shanghai = resolveLeaderboardWindow("custom", "Asia/Shanghai", {
      startDate: "2026-01-01",
      endDate: "2026-01-15",
    });
    expect(shanghai.start.toISOString()).toBe("2025-12-31T16:00:00.000Z");
    expect(shanghai.end.toISOString()).toBe("2026-01-15T16:00:00.000Z");
  });

  it("resolves daily to the local calendar day of the system timezone", () => {
    // 2026-07-22T10:00Z 在上海是 22 日 18:00，当地当日为 [21T16:00Z, 22T16:00Z)
    const { start, end } = resolveLeaderboardWindow("daily", "Asia/Shanghai");
    expect(start.toISOString()).toBe("2026-07-21T16:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-22T16:00:00.000Z");
  });

  it("resolves weekly to the ISO week (Monday start)", () => {
    // 2026-07-22 是周三，ISO 周一为 2026-07-20
    const { start, end } = resolveLeaderboardWindow("weekly", "UTC");
    expect(start.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });

  it("resolves monthly to the local calendar month", () => {
    const { start, end } = resolveLeaderboardWindow("monthly", "UTC");
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("resolves allTime from epoch to now and last24h as a rolling day", () => {
    const allTime = resolveLeaderboardWindow("allTime", "UTC");
    expect(allTime.start.getTime()).toBe(0);
    expect(allTime.end.toISOString()).toBe("2026-07-22T10:00:00.000Z");

    const last24h = resolveLeaderboardWindow("last24h", "UTC");
    expect(last24h.start.toISOString()).toBe("2026-07-21T10:00:00.000Z");
    expect(last24h.end.toISOString()).toBe("2026-07-22T10:00:00.000Z");
  });

  it("falls back to the allTime window when custom lacks a dateRange", () => {
    const { start, end } = resolveLeaderboardWindow("custom", "UTC");
    expect(start.getTime()).toBe(0);
    expect(end.toISOString()).toBe("2026-07-22T10:00:00.000Z");
  });
});
