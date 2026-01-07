import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDailyResetTime,
  getResetInfoWithMode,
  getSecondsUntilMidnight,
  getTimeRangeForPeriodWithMode,
  getTTLForPeriod,
  getTTLForPeriodWithMode,
  normalizeResetTime,
} from "@/lib/rate-limit/time-utils";

describe("rate-limit time-utils", () => {
  const nowMs = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizeResetTime：非法时间应回退到安全默认值", () => {
    expect(normalizeResetTime("abc")).toBe("00:00");
    expect(normalizeResetTime("99:10")).toBe("00:10");
    expect(normalizeResetTime("12:70")).toBe("12:00");
  });

  it("getTimeRangeForPeriodWithMode：daily rolling 应返回过去 24 小时窗口", () => {
    const { startTime, endTime } = getTimeRangeForPeriodWithMode("daily", "00:00", "rolling");

    expect(endTime.getTime()).toBe(nowMs);
    expect(startTime.getTime()).toBe(nowMs - 24 * 60 * 60 * 1000);
  });

  it("getResetInfoWithMode：daily rolling 应返回 rolling 语义", () => {
    const info = getResetInfoWithMode("daily", "00:00", "rolling");
    expect(info.type).toBe("rolling");
    expect(info.period).toBe("24 小时");
  });

  it("getTTLForPeriodWithMode：daily rolling TTL 应为 24 小时", () => {
    expect(getTTLForPeriodWithMode("daily", "00:00", "rolling")).toBe(24 * 3600);
  });

  it("getTTLForPeriod：5h TTL 应为 5 小时", () => {
    expect(getTTLForPeriod("5h")).toBe(5 * 3600);
  });

  it("getSecondsUntilMidnight/getDailyResetTime：应能计算出合理的每日重置时间", () => {
    const seconds = getSecondsUntilMidnight();
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(24 * 3600);

    const resetAt = getDailyResetTime();
    expect(resetAt.getTime()).toBeGreaterThan(nowMs);
  });
});
