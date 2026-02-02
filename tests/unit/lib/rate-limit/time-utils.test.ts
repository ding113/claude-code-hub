import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock resolveSystemTimezone before importing time-utils
vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn(async () => "Asia/Shanghai"),
}));

import { resolveSystemTimezone } from "@/lib/utils/timezone";
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

  it("normalizeResetTime: illegal time should fallback to safe default", () => {
    expect(normalizeResetTime("abc")).toBe("00:00");
    expect(normalizeResetTime("99:10")).toBe("00:10");
    expect(normalizeResetTime("12:70")).toBe("12:00");
  });

  it("getTimeRangeForPeriodWithMode: daily rolling should return past 24h window", async () => {
    const { startTime, endTime } = await getTimeRangeForPeriodWithMode("daily", "00:00", "rolling");

    expect(endTime.getTime()).toBe(nowMs);
    expect(startTime.getTime()).toBe(nowMs - 24 * 60 * 60 * 1000);
  });

  it("getResetInfoWithMode: daily rolling should return rolling semantics", async () => {
    const info = await getResetInfoWithMode("daily", "00:00", "rolling");
    expect(info.type).toBe("rolling");
    expect(info.period).toBe("24 小时");
  });

  it("getTTLForPeriodWithMode: daily rolling TTL should be 24h", async () => {
    expect(await getTTLForPeriodWithMode("daily", "00:00", "rolling")).toBe(24 * 3600);
  });

  it("getTTLForPeriod: 5h TTL should be 5h", async () => {
    expect(await getTTLForPeriod("5h")).toBe(5 * 3600);
  });

  it("getSecondsUntilMidnight/getDailyResetTime: should compute reasonable daily reset time", async () => {
    const seconds = await getSecondsUntilMidnight();
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(24 * 3600);

    const resetAt = await getDailyResetTime();
    expect(resetAt.getTime()).toBeGreaterThan(nowMs);
  });
});

/**
 * Timezone Consistency Tests
 *
 * Verify that all time calculations use resolveSystemTimezone() consistently
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

  it("should use timezone from resolveSystemTimezone for daily fixed calculations", async () => {
    // Set time to 2024-01-15 02:00:00 UTC
    // In Asia/Shanghai (+8), this is 2024-01-15 10:00:00
    const utcTime = new Date("2024-01-15T02:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    // Reset time 08:00 Shanghai = 00:00 UTC
    // At Shanghai 10:00, we've passed 08:00, so window starts at today's 08:00 Shanghai = 00:00 UTC
    const { startTime } = await getTimeRangeForPeriod("daily", "08:00");

    // Verify resolveSystemTimezone was called
    expect(resolveSystemTimezone).toHaveBeenCalled();

    // Start should be 2024-01-15 00:00:00 UTC (08:00 Shanghai)
    expect(startTime.toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });

  it("should calculate daily fixed window correctly for Asia/Shanghai", async () => {
    // 2024-01-15 00:00:00 UTC = 2024-01-15 08:00:00 Shanghai
    // Reset at 08:00 Shanghai, we're exactly at reset time
    const utcTime = new Date("2024-01-15T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime, endTime } = await getTimeRangeForPeriod("daily", "08:00");

    // At exactly 08:00 Shanghai, window starts at 08:00 Shanghai today = 00:00 UTC
    expect(startTime.toISOString()).toBe("2024-01-15T00:00:00.000Z");
    expect(endTime.toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });

  it("should calculate daily fixed window correctly before reset time", async () => {
    // 2024-01-14 23:00:00 UTC = 2024-01-15 07:00:00 Shanghai
    // Reset at 08:00 Shanghai, we haven't reached it yet
    const utcTime = new Date("2024-01-14T23:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime } = await getTimeRangeForPeriod("daily", "08:00");

    // Before 08:00 Shanghai, window starts at yesterday's 08:00 Shanghai = 2024-01-14 00:00 UTC
    expect(startTime.toISOString()).toBe("2024-01-14T00:00:00.000Z");
  });

  it("should calculate daily fixed window correctly for America/New_York", async () => {
    // 2024-01-15 14:00:00 UTC = 2024-01-15 09:00:00 New York (EST, -5)
    // Reset at 08:00 New York, we've passed it
    const utcTime = new Date("2024-01-15T14:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("America/New_York");

    const { startTime } = await getTimeRangeForPeriod("daily", "08:00");

    // 08:00 New York = 13:00 UTC
    expect(startTime.toISOString()).toBe("2024-01-15T13:00:00.000Z");
  });

  it("should calculate weekly window start in configured timezone", async () => {
    // 2024-01-17 00:00:00 UTC = Wednesday
    // In Asia/Shanghai (+8), this is 2024-01-17 08:00:00 (still Wednesday)
    // Week starts Monday 00:00 Shanghai = 2024-01-15 00:00 Shanghai = 2024-01-14 16:00 UTC
    const utcTime = new Date("2024-01-17T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime } = await getTimeRangeForPeriod("weekly");

    // Monday 00:00 Shanghai = Sunday 16:00 UTC
    expect(startTime.toISOString()).toBe("2024-01-14T16:00:00.000Z");
  });

  it("should calculate monthly window start in configured timezone", async () => {
    // 2024-01-15 00:00:00 UTC = 2024-01-15 08:00:00 Shanghai
    // Month starts Jan 1 00:00 Shanghai = Dec 31 16:00 UTC
    const utcTime = new Date("2024-01-15T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime } = await getTimeRangeForPeriod("monthly");

    // Jan 1 00:00 Shanghai = Dec 31 16:00 UTC
    expect(startTime.toISOString()).toBe("2023-12-31T16:00:00.000Z");
  });

  it("should handle day boundary crossing between UTC and local TZ", async () => {
    // Edge case: 2024-01-15 23:30:00 UTC = 2024-01-16 07:30:00 Shanghai
    // Reset at 08:00 Shanghai - we're in Shanghai's "tomorrow" but before reset
    const utcTime = new Date("2024-01-15T23:30:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime } = await getTimeRangeForPeriod("daily", "08:00");

    // In Shanghai it's Jan 16 07:30, before 08:00 reset
    // So window starts at Jan 15 08:00 Shanghai = Jan 15 00:00 UTC
    expect(startTime.toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });

  it("should use rolling mode regardless of timezone for daily rolling", async () => {
    const utcTime = new Date("2024-01-15T12:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("America/New_York");

    const { startTime, endTime } = await getTimeRangeForPeriodWithMode("daily", "08:00", "rolling");

    // Rolling mode: always 24 hours back, timezone doesn't matter
    expect(endTime.toISOString()).toBe("2024-01-15T12:00:00.000Z");
    expect(startTime.toISOString()).toBe("2024-01-14T12:00:00.000Z");
  });

  it("should use 5h rolling window regardless of timezone", async () => {
    const utcTime = new Date("2024-01-15T12:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Europe/London");

    const { startTime, endTime } = await getTimeRangeForPeriod("5h");

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

  it("should calculate daily fixed TTL based on configured timezone", async () => {
    // 2024-01-15 02:00:00 UTC = 2024-01-15 10:00:00 Shanghai
    // Reset at 08:00 Shanghai, next reset is tomorrow 08:00 Shanghai = 2024-01-16 00:00 UTC
    // TTL = 22 hours = 79200 seconds
    const utcTime = new Date("2024-01-15T02:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const ttl = await getTTLForPeriod("daily", "08:00");

    // From 10:00 Shanghai to next 08:00 Shanghai = 22 hours
    expect(ttl).toBe(22 * 3600);
  });

  it("should calculate daily fixed TTL correctly when close to reset time", async () => {
    // 2024-01-14 23:30:00 UTC = 2024-01-15 07:30:00 Shanghai
    // Reset at 08:00 Shanghai, next reset is in 30 minutes
    const utcTime = new Date("2024-01-14T23:30:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const ttl = await getTTLForPeriod("daily", "08:00");

    // 30 minutes = 1800 seconds
    expect(ttl).toBe(30 * 60);
  });

  it("should calculate weekly TTL based on configured timezone", async () => {
    // 2024-01-17 00:00:00 UTC = Wednesday 08:00 Shanghai
    // Next Monday 00:00 Shanghai = 2024-01-22 00:00 Shanghai = 2024-01-21 16:00 UTC
    const utcTime = new Date("2024-01-17T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const ttl = await getTTLForPeriod("weekly");

    // From Wed 08:00 to Mon 00:00 = 4 days + 16 hours = 112 hours
    expect(ttl).toBe(112 * 3600);
  });

  it("should calculate monthly TTL based on configured timezone", async () => {
    // 2024-01-30 00:00:00 UTC = 2024-01-30 08:00:00 Shanghai
    // Next month Feb 1 00:00 Shanghai = 2024-01-31 16:00 UTC
    const utcTime = new Date("2024-01-30T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const ttl = await getTTLForPeriod("monthly");

    // From Jan 30 08:00 to Feb 1 00:00 Shanghai = 1 day + 16 hours = 40 hours
    expect(ttl).toBe(40 * 3600);
  });

  it("should return 24h TTL for daily rolling regardless of timezone", async () => {
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Pacific/Auckland");

    const ttl = await getTTLForPeriodWithMode("daily", "08:00", "rolling");

    expect(ttl).toBe(24 * 3600);
  });

  it("should return 5h TTL for 5h period regardless of timezone", async () => {
    vi.mocked(resolveSystemTimezone).mockResolvedValue("America/Los_Angeles");

    const ttl = await getTTLForPeriod("5h");

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

  it("should return next reset time in configured timezone for daily", async () => {
    // 2024-01-15 02:00:00 UTC = 2024-01-15 10:00:00 Shanghai
    // Next reset at 08:00 Shanghai = 2024-01-16 00:00:00 UTC
    const utcTime = new Date("2024-01-15T02:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const info = await getResetInfo("daily", "08:00");

    expect(info.type).toBe("custom");
    expect(info.resetAt?.toISOString()).toBe("2024-01-16T00:00:00.000Z");
  });

  it("should return next Monday for weekly in configured timezone", async () => {
    // 2024-01-17 00:00:00 UTC = Wednesday 08:00 Shanghai
    // Next Monday 00:00 Shanghai = 2024-01-21 16:00 UTC
    const utcTime = new Date("2024-01-17T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const info = await getResetInfo("weekly");

    expect(info.type).toBe("natural");
    expect(info.resetAt?.toISOString()).toBe("2024-01-21T16:00:00.000Z");
  });

  it("should return next month start for monthly in configured timezone", async () => {
    // 2024-01-15 00:00:00 UTC = 2024-01-15 08:00 Shanghai
    // Feb 1 00:00 Shanghai = 2024-01-31 16:00 UTC
    const utcTime = new Date("2024-01-15T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const info = await getResetInfo("monthly");

    expect(info.type).toBe("natural");
    expect(info.resetAt?.toISOString()).toBe("2024-01-31T16:00:00.000Z");
  });

  it("should return rolling type for 5h period", async () => {
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const info = await getResetInfo("5h");

    expect(info.type).toBe("rolling");
    expect(info.period).toBe("5 小时");
    expect(info.resetAt).toBeUndefined();
  });

  it("should return rolling type for daily rolling mode", async () => {
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const info = await getResetInfoWithMode("daily", "08:00", "rolling");

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

  it("should handle midnight reset time (00:00)", async () => {
    // 2024-01-15 18:00:00 UTC = 2024-01-16 02:00:00 Shanghai
    // Reset at 00:00 Shanghai, window starts at 2024-01-16 00:00 Shanghai = 2024-01-15 16:00 UTC
    const utcTime = new Date("2024-01-15T18:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime } = await getTimeRangeForPeriod("daily", "00:00");

    expect(startTime.toISOString()).toBe("2024-01-15T16:00:00.000Z");
  });

  it("should handle late night reset time (23:59)", async () => {
    // 2024-01-15 16:30:00 UTC = 2024-01-16 00:30:00 Shanghai
    // Reset at 23:59 Shanghai, we're past it (just after midnight)
    // Window starts at 2024-01-15 23:59 Shanghai = 2024-01-15 15:59 UTC
    const utcTime = new Date("2024-01-15T16:30:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime } = await getTimeRangeForPeriod("daily", "23:59");

    expect(startTime.toISOString()).toBe("2024-01-15T15:59:00.000Z");
  });

  it("should handle year boundary for monthly window", async () => {
    // 2024-01-05 00:00:00 UTC = 2024-01-05 08:00:00 Shanghai
    // Month starts Jan 1 00:00 Shanghai = 2023-12-31 16:00 UTC
    const utcTime = new Date("2024-01-05T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime } = await getTimeRangeForPeriod("monthly");

    expect(startTime.toISOString()).toBe("2023-12-31T16:00:00.000Z");
  });

  it("should handle week boundary crossing year", async () => {
    // 2024-01-03 00:00:00 UTC = Wednesday = 2024-01-03 08:00 Shanghai
    // Week started Monday 2024-01-01 00:00 Shanghai = 2023-12-31 16:00 UTC
    const utcTime = new Date("2024-01-03T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime } = await getTimeRangeForPeriod("weekly");

    expect(startTime.toISOString()).toBe("2023-12-31T16:00:00.000Z");
  });

  it("should handle negative UTC offset timezone (America/New_York)", async () => {
    // 2024-01-15 03:00:00 UTC = 2024-01-14 22:00:00 New York (EST -5)
    // Reset at 08:00 New York, we're before it (still previous day in NY)
    // Window starts at 2024-01-14 08:00 NY = 2024-01-14 13:00 UTC
    const utcTime = new Date("2024-01-15T03:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("America/New_York");

    const { startTime } = await getTimeRangeForPeriod("daily", "08:00");

    expect(startTime.toISOString()).toBe("2024-01-14T13:00:00.000Z");
  });

  it("should handle UTC timezone", async () => {
    // 2024-01-15 10:00:00 UTC
    // Reset at 08:00 UTC, we've passed it
    // Window starts at 2024-01-15 08:00 UTC
    const utcTime = new Date("2024-01-15T10:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("UTC");

    const { startTime } = await getTimeRangeForPeriod("daily", "08:00");

    expect(startTime.toISOString()).toBe("2024-01-15T08:00:00.000Z");
  });

  it("should handle large positive UTC offset (Pacific/Auckland +13)", async () => {
    // 2024-01-15 10:00:00 UTC = 2024-01-15 23:00:00 Auckland
    // Reset at 08:00 Auckland, we've passed it
    // Window starts at 2024-01-15 08:00 Auckland = 2024-01-14 19:00 UTC
    const utcTime = new Date("2024-01-15T10:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Pacific/Auckland");

    const { startTime } = await getTimeRangeForPeriod("daily", "08:00");

    expect(startTime.toISOString()).toBe("2024-01-14T19:00:00.000Z");
  });

  it("should calculate correct TTL at exact reset moment", async () => {
    // 2024-01-15 00:00:00 UTC = 2024-01-15 08:00:00 Shanghai (exactly at reset)
    // Next reset is 2024-01-16 08:00 Shanghai = 2024-01-16 00:00 UTC
    // TTL = 24 hours
    const utcTime = new Date("2024-01-15T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const ttl = await getTTLForPeriod("daily", "08:00");

    expect(ttl).toBe(24 * 3600);
  });

  it("should handle different reset times consistently", async () => {
    // Test multiple reset times to ensure consistency
    const utcTime = new Date("2024-01-15T12:00:00.000Z"); // 20:00 Shanghai
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    // 06:00 Shanghai = passed, window starts today 06:00 = 2024-01-14 22:00 UTC
    const range06 = await getTimeRangeForPeriod("daily", "06:00");
    expect(range06.startTime.toISOString()).toBe("2024-01-14T22:00:00.000Z");

    // 18:00 Shanghai = passed, window starts today 18:00 = 2024-01-15 10:00 UTC
    const range18 = await getTimeRangeForPeriod("daily", "18:00");
    expect(range18.startTime.toISOString()).toBe("2024-01-15T10:00:00.000Z");

    // 21:00 Shanghai = not yet, window starts yesterday 21:00 = 2024-01-14 13:00 UTC
    const range21 = await getTimeRangeForPeriod("daily", "21:00");
    expect(range21.startTime.toISOString()).toBe("2024-01-14T13:00:00.000Z");
  });
});

/**
 * Configurable Weekly Reset Tests
 *
 * Verify that weekly reset can be configured with custom day (0-6) and time (HH:mm)
 * instead of hardcoded Monday 00:00.
 */
describe("configurable weekly reset", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should calculate weekly window with custom reset day (Friday)", async () => {
    // 2024-01-17 00:00:00 UTC = Wednesday 08:00 Shanghai
    // Custom reset: Friday (day=5) at 00:00 Shanghai
    // Last Friday was 2024-01-12 00:00 Shanghai = 2024-01-11 16:00 UTC
    const utcTime = new Date("2024-01-17T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime } = await getTimeRangeForPeriod("weekly", "00:00", 5, "00:00");

    // Friday 00:00 Shanghai = Thursday 16:00 UTC
    expect(startTime.toISOString()).toBe("2024-01-11T16:00:00.000Z");
  });

  it("should calculate weekly window with custom reset day (Sunday)", async () => {
    // 2024-01-17 00:00:00 UTC = Wednesday 08:00 Shanghai
    // Custom reset: Sunday (day=0) at 00:00 Shanghai
    // Last Sunday was 2024-01-14 00:00 Shanghai = 2024-01-13 16:00 UTC
    const utcTime = new Date("2024-01-17T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime } = await getTimeRangeForPeriod("weekly", "00:00", 0, "00:00");

    expect(startTime.toISOString()).toBe("2024-01-13T16:00:00.000Z");
  });

  it("should calculate weekly window with custom reset time (18:00)", async () => {
    // 2024-01-17 12:00:00 UTC = Wednesday 20:00 Shanghai
    // Custom reset: Monday (day=1) at 18:00 Shanghai
    // Last Monday 18:00 Shanghai was 2024-01-15 18:00 = 2024-01-15 10:00 UTC
    const utcTime = new Date("2024-01-17T12:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime } = await getTimeRangeForPeriod("weekly", "00:00", 1, "18:00");

    expect(startTime.toISOString()).toBe("2024-01-15T10:00:00.000Z");
  });

  it("should calculate weekly TTL with custom reset day and time", async () => {
    // 2024-01-17 00:00:00 UTC = Wednesday 08:00 Shanghai
    // Custom reset: Friday (day=5) at 18:00 Shanghai
    // Next Friday 18:00 Shanghai = 2024-01-19 18:00 = 2024-01-19 10:00 UTC
    // TTL = from Wed 08:00 to Fri 18:00 = 2 days + 10 hours = 58 hours
    const utcTime = new Date("2024-01-17T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const ttl = await getTTLForPeriod("weekly", "00:00", 5, "18:00");

    expect(ttl).toBe(58 * 3600);
  });

  it("should use default Monday 00:00 when weekly reset params not provided", async () => {
    // 2024-01-17 00:00:00 UTC = Wednesday 08:00 Shanghai
    // Default: Monday (day=1) at 00:00 Shanghai
    // Last Monday 00:00 Shanghai = 2024-01-15 00:00 = 2024-01-14 16:00 UTC
    const utcTime = new Date("2024-01-17T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime } = await getTimeRangeForPeriod("weekly");

    expect(startTime.toISOString()).toBe("2024-01-14T16:00:00.000Z");
  });

  it("should calculate weekly reset info with custom day and time", async () => {
    // 2024-01-17 00:00:00 UTC = Wednesday 08:00 Shanghai
    // Custom reset: Friday (day=5) at 18:00 Shanghai
    // Next reset: 2024-01-19 18:00 Shanghai = 2024-01-19 10:00 UTC
    const utcTime = new Date("2024-01-17T00:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const info = await getResetInfo("weekly", "00:00", 5, "18:00");

    expect(info.type).toBe("natural");
    expect(info.resetAt?.toISOString()).toBe("2024-01-19T10:00:00.000Z");
  });

  it("should handle weekly window when current time is before reset time on reset day", async () => {
    // 2024-01-19 08:00:00 UTC = Friday 16:00 Shanghai
    // Custom reset: Friday (day=5) at 18:00 Shanghai
    // We're on Friday but before 18:00, so window is from last Friday 18:00
    // Last Friday 18:00 Shanghai = 2024-01-12 18:00 = 2024-01-12 10:00 UTC
    const utcTime = new Date("2024-01-19T08:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime } = await getTimeRangeForPeriod("weekly", "00:00", 5, "18:00");

    expect(startTime.toISOString()).toBe("2024-01-12T10:00:00.000Z");
  });

  it("should handle weekly window when current time is after reset time on reset day", async () => {
    // 2024-01-19 12:00:00 UTC = Friday 20:00 Shanghai
    // Custom reset: Friday (day=5) at 18:00 Shanghai
    // We're on Friday after 18:00, so window is from this Friday 18:00
    // This Friday 18:00 Shanghai = 2024-01-19 18:00 = 2024-01-19 10:00 UTC
    const utcTime = new Date("2024-01-19T12:00:00.000Z");
    vi.setSystemTime(utcTime);
    vi.mocked(resolveSystemTimezone).mockResolvedValue("Asia/Shanghai");

    const { startTime } = await getTimeRangeForPeriod("weekly", "00:00", 5, "18:00");

    expect(startTime.toISOString()).toBe("2024-01-19T10:00:00.000Z");
  });
});
