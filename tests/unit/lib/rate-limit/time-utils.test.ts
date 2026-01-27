import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock getEnvConfig before importing time-utils
vi.mock("@/lib/config", () => ({
  getEnvConfig: vi.fn(() => ({ TZ: "Asia/Shanghai" })),
}));

import { getEnvConfig } from "@/lib/config";
import {
  getDailyResetTime,
  getResetInfo,
  getResetInfoWithMode,
  getSecondsUntilMidnight,
  getTimeRangeForPeriod,
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

/**
 * Timezone Consistency Tests
 *
 * Verify that all time calculations use getEnvConfig().TZ consistently
 * and produce correct results across different timezone configurations.
 */
describe("timezone consistency", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should use TZ from getEnvConfig for daily fixed calculations", async () => {
    // Set time to 2024-01-15 02:00:00 UTC
    // In Asia/Shanghai (+8), this is 2024-01-15 10:00:00
    const utcTime = new Date("2024-01-15T02:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    // Reset time 08:00 Shanghai = 00:00 UTC
    // At Shanghai 10:00, we've passed 08:00, so window starts at today's 08:00 Shanghai = 00:00 UTC
    const { startTime } = getTimeRangeForPeriod("daily", "08:00");

    // Verify getEnvConfig was called
    expect(getEnvConfig).toHaveBeenCalled();

    // Start should be 2024-01-15 00:00:00 UTC (08:00 Shanghai)
    expect(startTime.toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });

  it("should calculate daily fixed window correctly for Asia/Shanghai", async () => {
    // 2024-01-15 00:00:00 UTC = 2024-01-15 08:00:00 Shanghai
    // Reset at 08:00 Shanghai, we're exactly at reset time
    const utcTime = new Date("2024-01-15T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const { startTime, endTime } = getTimeRangeForPeriod("daily", "08:00");

    // At exactly 08:00 Shanghai, window starts at 08:00 Shanghai today = 00:00 UTC
    expect(startTime.toISOString()).toBe("2024-01-15T00:00:00.000Z");
    expect(endTime.toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });

  it("should calculate daily fixed window correctly before reset time", async () => {
    // 2024-01-14 23:00:00 UTC = 2024-01-15 07:00:00 Shanghai
    // Reset at 08:00 Shanghai, we haven't reached it yet
    const utcTime = new Date("2024-01-14T23:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const { startTime } = getTimeRangeForPeriod("daily", "08:00");

    // Before 08:00 Shanghai, window starts at yesterday's 08:00 Shanghai = 2024-01-14 00:00 UTC
    expect(startTime.toISOString()).toBe("2024-01-14T00:00:00.000Z");
  });

  it("should calculate daily fixed window correctly for America/New_York", async () => {
    // 2024-01-15 14:00:00 UTC = 2024-01-15 09:00:00 New York (EST, -5)
    // Reset at 08:00 New York, we've passed it
    const utcTime = new Date("2024-01-15T14:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "America/New_York" } as ReturnType<
      typeof getEnvConfig
    >);

    const { startTime } = getTimeRangeForPeriod("daily", "08:00");

    // 08:00 New York = 13:00 UTC
    expect(startTime.toISOString()).toBe("2024-01-15T13:00:00.000Z");
  });

  it("should calculate weekly window start in configured timezone", async () => {
    // 2024-01-17 00:00:00 UTC = Wednesday
    // In Asia/Shanghai (+8), this is 2024-01-17 08:00:00 (still Wednesday)
    // Week starts Monday 00:00 Shanghai = 2024-01-15 00:00 Shanghai = 2024-01-14 16:00 UTC
    const utcTime = new Date("2024-01-17T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const { startTime } = getTimeRangeForPeriod("weekly");

    // Monday 00:00 Shanghai = Sunday 16:00 UTC
    expect(startTime.toISOString()).toBe("2024-01-14T16:00:00.000Z");
  });

  it("should calculate monthly window start in configured timezone", async () => {
    // 2024-01-15 00:00:00 UTC = 2024-01-15 08:00:00 Shanghai
    // Month starts Jan 1 00:00 Shanghai = Dec 31 16:00 UTC
    const utcTime = new Date("2024-01-15T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const { startTime } = getTimeRangeForPeriod("monthly");

    // Jan 1 00:00 Shanghai = Dec 31 16:00 UTC
    expect(startTime.toISOString()).toBe("2023-12-31T16:00:00.000Z");
  });

  it("should handle day boundary crossing between UTC and local TZ", async () => {
    // Edge case: 2024-01-15 23:30:00 UTC = 2024-01-16 07:30:00 Shanghai
    // Reset at 08:00 Shanghai - we're in Shanghai's "tomorrow" but before reset
    const utcTime = new Date("2024-01-15T23:30:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const { startTime } = getTimeRangeForPeriod("daily", "08:00");

    // In Shanghai it's Jan 16 07:30, before 08:00 reset
    // So window starts at Jan 15 08:00 Shanghai = Jan 15 00:00 UTC
    expect(startTime.toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });

  it("should use rolling mode regardless of timezone for daily rolling", async () => {
    const utcTime = new Date("2024-01-15T12:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "America/New_York" } as ReturnType<
      typeof getEnvConfig
    >);

    const { startTime, endTime } = getTimeRangeForPeriodWithMode("daily", "08:00", "rolling");

    // Rolling mode: always 24 hours back, timezone doesn't matter
    expect(endTime.toISOString()).toBe("2024-01-15T12:00:00.000Z");
    expect(startTime.toISOString()).toBe("2024-01-14T12:00:00.000Z");
  });

  it("should use 5h rolling window regardless of timezone", async () => {
    const utcTime = new Date("2024-01-15T12:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Europe/London" } as ReturnType<
      typeof getEnvConfig
    >);

    const { startTime, endTime } = getTimeRangeForPeriod("5h");

    // 5h rolling: always 5 hours back
    expect(endTime.toISOString()).toBe("2024-01-15T12:00:00.000Z");
    expect(startTime.toISOString()).toBe("2024-01-15T07:00:00.000Z");
  });
});

/**
 * TTL Calculation Timezone Tests
 *
 * Verify that TTL calculations use server timezone consistently
 */
describe("TTL timezone consistency", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should calculate daily fixed TTL based on configured timezone", () => {
    // 2024-01-15 02:00:00 UTC = 2024-01-15 10:00:00 Shanghai
    // Reset at 08:00 Shanghai, next reset is tomorrow 08:00 Shanghai = 2024-01-16 00:00 UTC
    // TTL = 22 hours = 79200 seconds
    const utcTime = new Date("2024-01-15T02:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const ttl = getTTLForPeriod("daily", "08:00");

    // From 10:00 Shanghai to next 08:00 Shanghai = 22 hours
    expect(ttl).toBe(22 * 3600);
  });

  it("should calculate daily fixed TTL correctly when close to reset time", () => {
    // 2024-01-14 23:30:00 UTC = 2024-01-15 07:30:00 Shanghai
    // Reset at 08:00 Shanghai, next reset is in 30 minutes
    const utcTime = new Date("2024-01-14T23:30:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const ttl = getTTLForPeriod("daily", "08:00");

    // 30 minutes = 1800 seconds
    expect(ttl).toBe(30 * 60);
  });

  it("should calculate weekly TTL based on configured timezone", () => {
    // 2024-01-17 00:00:00 UTC = Wednesday 08:00 Shanghai
    // Next Monday 00:00 Shanghai = 2024-01-22 00:00 Shanghai = 2024-01-21 16:00 UTC
    const utcTime = new Date("2024-01-17T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const ttl = getTTLForPeriod("weekly");

    // From Wed 08:00 to Mon 00:00 = 4 days + 16 hours = 112 hours
    expect(ttl).toBe(112 * 3600);
  });

  it("should calculate monthly TTL based on configured timezone", () => {
    // 2024-01-30 00:00:00 UTC = 2024-01-30 08:00:00 Shanghai
    // Next month Feb 1 00:00 Shanghai = 2024-01-31 16:00 UTC
    const utcTime = new Date("2024-01-30T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const ttl = getTTLForPeriod("monthly");

    // From Jan 30 08:00 to Feb 1 00:00 Shanghai = 1 day + 16 hours = 40 hours
    expect(ttl).toBe(40 * 3600);
  });

  it("should return 24h TTL for daily rolling regardless of timezone", () => {
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Pacific/Auckland" } as ReturnType<
      typeof getEnvConfig
    >);

    const ttl = getTTLForPeriodWithMode("daily", "08:00", "rolling");

    expect(ttl).toBe(24 * 3600);
  });

  it("should return 5h TTL for 5h period regardless of timezone", () => {
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "America/Los_Angeles" } as ReturnType<
      typeof getEnvConfig
    >);

    const ttl = getTTLForPeriod("5h");

    expect(ttl).toBe(5 * 3600);
  });
});

/**
 * ResetInfo Timezone Tests
 *
 * Verify that reset info calculations use server timezone consistently
 */
describe("ResetInfo timezone consistency", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return next reset time in configured timezone for daily", () => {
    // 2024-01-15 02:00:00 UTC = 2024-01-15 10:00:00 Shanghai
    // Next reset at 08:00 Shanghai = 2024-01-16 00:00:00 UTC
    const utcTime = new Date("2024-01-15T02:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const info = getResetInfo("daily", "08:00");

    expect(info.type).toBe("custom");
    expect(info.resetAt?.toISOString()).toBe("2024-01-16T00:00:00.000Z");
  });

  it("should return next Monday for weekly in configured timezone", () => {
    // 2024-01-17 00:00:00 UTC = Wednesday 08:00 Shanghai
    // Next Monday 00:00 Shanghai = 2024-01-21 16:00 UTC
    const utcTime = new Date("2024-01-17T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const info = getResetInfo("weekly");

    expect(info.type).toBe("natural");
    expect(info.resetAt?.toISOString()).toBe("2024-01-21T16:00:00.000Z");
  });

  it("should return next month start for monthly in configured timezone", () => {
    // 2024-01-15 00:00:00 UTC = 2024-01-15 08:00 Shanghai
    // Feb 1 00:00 Shanghai = 2024-01-31 16:00 UTC
    const utcTime = new Date("2024-01-15T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const info = getResetInfo("monthly");

    expect(info.type).toBe("natural");
    expect(info.resetAt?.toISOString()).toBe("2024-01-31T16:00:00.000Z");
  });

  it("should return rolling type for 5h period", () => {
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const info = getResetInfo("5h");

    expect(info.type).toBe("rolling");
    expect(info.period).toBe("5 小时");
    expect(info.resetAt).toBeUndefined();
  });

  it("should return rolling type for daily rolling mode", () => {
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const info = getResetInfoWithMode("daily", "08:00", "rolling");

    expect(info.type).toBe("rolling");
    expect(info.period).toBe("24 小时");
  });
});

/**
 * Edge Cases and Boundary Tests
 */
describe("timezone edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should handle midnight reset time (00:00)", () => {
    // 2024-01-15 18:00:00 UTC = 2024-01-16 02:00:00 Shanghai
    // Reset at 00:00 Shanghai, window starts at 2024-01-16 00:00 Shanghai = 2024-01-15 16:00 UTC
    const utcTime = new Date("2024-01-15T18:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const { startTime } = getTimeRangeForPeriod("daily", "00:00");

    expect(startTime.toISOString()).toBe("2024-01-15T16:00:00.000Z");
  });

  it("should handle late night reset time (23:59)", () => {
    // 2024-01-15 16:30:00 UTC = 2024-01-16 00:30:00 Shanghai
    // Reset at 23:59 Shanghai, we're past it (just after midnight)
    // Window starts at 2024-01-15 23:59 Shanghai = 2024-01-15 15:59 UTC
    const utcTime = new Date("2024-01-15T16:30:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const { startTime } = getTimeRangeForPeriod("daily", "23:59");

    expect(startTime.toISOString()).toBe("2024-01-15T15:59:00.000Z");
  });

  it("should handle year boundary for monthly window", () => {
    // 2024-01-05 00:00:00 UTC = 2024-01-05 08:00:00 Shanghai
    // Month starts Jan 1 00:00 Shanghai = 2023-12-31 16:00 UTC
    const utcTime = new Date("2024-01-05T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const { startTime } = getTimeRangeForPeriod("monthly");

    expect(startTime.toISOString()).toBe("2023-12-31T16:00:00.000Z");
  });

  it("should handle week boundary crossing year", () => {
    // 2024-01-03 00:00:00 UTC = Wednesday = 2024-01-03 08:00 Shanghai
    // Week started Monday 2024-01-01 00:00 Shanghai = 2023-12-31 16:00 UTC
    const utcTime = new Date("2024-01-03T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const { startTime } = getTimeRangeForPeriod("weekly");

    expect(startTime.toISOString()).toBe("2023-12-31T16:00:00.000Z");
  });

  it("should handle negative UTC offset timezone (America/New_York)", () => {
    // 2024-01-15 03:00:00 UTC = 2024-01-14 22:00:00 New York (EST -5)
    // Reset at 08:00 New York, we're before it (still previous day in NY)
    // Window starts at 2024-01-14 08:00 NY = 2024-01-14 13:00 UTC
    const utcTime = new Date("2024-01-15T03:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "America/New_York" } as ReturnType<
      typeof getEnvConfig
    >);

    const { startTime } = getTimeRangeForPeriod("daily", "08:00");

    expect(startTime.toISOString()).toBe("2024-01-14T13:00:00.000Z");
  });

  it("should handle UTC timezone", () => {
    // 2024-01-15 10:00:00 UTC
    // Reset at 08:00 UTC, we've passed it
    // Window starts at 2024-01-15 08:00 UTC
    const utcTime = new Date("2024-01-15T10:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "UTC" } as ReturnType<typeof getEnvConfig>);

    const { startTime } = getTimeRangeForPeriod("daily", "08:00");

    expect(startTime.toISOString()).toBe("2024-01-15T08:00:00.000Z");
  });

  it("should handle large positive UTC offset (Pacific/Auckland +13)", () => {
    // 2024-01-15 10:00:00 UTC = 2024-01-15 23:00:00 Auckland
    // Reset at 08:00 Auckland, we've passed it
    // Window starts at 2024-01-15 08:00 Auckland = 2024-01-14 19:00 UTC
    const utcTime = new Date("2024-01-15T10:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Pacific/Auckland" } as ReturnType<
      typeof getEnvConfig
    >);

    const { startTime } = getTimeRangeForPeriod("daily", "08:00");

    expect(startTime.toISOString()).toBe("2024-01-14T19:00:00.000Z");
  });

  it("should calculate correct TTL at exact reset moment", () => {
    // 2024-01-15 00:00:00 UTC = 2024-01-15 08:00:00 Shanghai (exactly at reset)
    // Next reset is 2024-01-16 08:00 Shanghai = 2024-01-16 00:00 UTC
    // TTL = 24 hours
    const utcTime = new Date("2024-01-15T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    const ttl = getTTLForPeriod("daily", "08:00");

    expect(ttl).toBe(24 * 3600);
  });

  it("should handle different reset times consistently", () => {
    // Test multiple reset times to ensure consistency
    const utcTime = new Date("2024-01-15T12:00:00.000Z"); // 20:00 Shanghai
    vi.setSystemTime(utcTime);
    vi.mocked(getEnvConfig).mockReturnValue({ TZ: "Asia/Shanghai" } as ReturnType<
      typeof getEnvConfig
    >);

    // 06:00 Shanghai = passed, window starts today 06:00 = 2024-01-14 22:00 UTC
    const range06 = getTimeRangeForPeriod("daily", "06:00");
    expect(range06.startTime.toISOString()).toBe("2024-01-14T22:00:00.000Z");

    // 18:00 Shanghai = passed, window starts today 18:00 = 2024-01-15 10:00 UTC
    const range18 = getTimeRangeForPeriod("daily", "18:00");
    expect(range18.startTime.toISOString()).toBe("2024-01-15T10:00:00.000Z");

    // 21:00 Shanghai = not yet, window starts yesterday 21:00 = 2024-01-14 13:00 UTC
    const range21 = getTimeRangeForPeriod("daily", "21:00");
    expect(range21.startTime.toISOString()).toBe("2024-01-14T13:00:00.000Z");
  });
});
