import { describe, expect, it } from "vitest";
import { parseDateInputAsTimezone } from "@/lib/utils/date-input";

describe("parseDateInputAsTimezone", () => {
  describe("date-only input (YYYY-MM-DD)", () => {
    it("should interpret date-only as end-of-day (23:59:59) in given timezone", () => {
      // Input: "2024-12-31" in Asia/Shanghai (UTC+8)
      // Expected: 2024-12-31 23:59:59 in Shanghai = 2024-12-31 15:59:59 UTC
      const result = parseDateInputAsTimezone("2024-12-31", "Asia/Shanghai");

      expect(result.getUTCFullYear()).toBe(2024);
      expect(result.getUTCMonth()).toBe(11); // December = 11
      expect(result.getUTCDate()).toBe(31);
      expect(result.getUTCHours()).toBe(15); // 23:59:59 Shanghai = 15:59:59 UTC
      expect(result.getUTCMinutes()).toBe(59);
      expect(result.getUTCSeconds()).toBe(59);
    });

    it("should handle UTC timezone correctly", () => {
      // Input: "2024-06-15" in UTC
      // Expected: 2024-06-15 23:59:59 UTC
      const result = parseDateInputAsTimezone("2024-06-15", "UTC");

      expect(result.getUTCFullYear()).toBe(2024);
      expect(result.getUTCMonth()).toBe(5); // June = 5
      expect(result.getUTCDate()).toBe(15);
      expect(result.getUTCHours()).toBe(23);
      expect(result.getUTCMinutes()).toBe(59);
      expect(result.getUTCSeconds()).toBe(59);
    });

    it("should handle negative offset timezone (America/New_York)", () => {
      // Input: "2024-07-04" in America/New_York (UTC-4 during DST)
      // Expected: 2024-07-04 23:59:59 in NY = 2024-07-05 03:59:59 UTC
      const result = parseDateInputAsTimezone("2024-07-04", "America/New_York");

      expect(result.getUTCFullYear()).toBe(2024);
      expect(result.getUTCMonth()).toBe(6); // July = 6
      expect(result.getUTCDate()).toBe(5); // Next day in UTC
      expect(result.getUTCHours()).toBe(3); // 23:59:59 NY (UTC-4) = 03:59:59 UTC next day
      expect(result.getUTCMinutes()).toBe(59);
      expect(result.getUTCSeconds()).toBe(59);
    });

    it("should handle date at year boundary", () => {
      // Input: "2024-01-01" in Asia/Tokyo (UTC+9)
      // Expected: 2024-01-01 23:59:59 in Tokyo = 2024-01-01 14:59:59 UTC
      const result = parseDateInputAsTimezone("2024-01-01", "Asia/Tokyo");

      expect(result.getUTCFullYear()).toBe(2024);
      expect(result.getUTCMonth()).toBe(0); // January = 0
      expect(result.getUTCDate()).toBe(1);
      expect(result.getUTCHours()).toBe(14); // 23:59:59 Tokyo (UTC+9) = 14:59:59 UTC
    });
  });

  describe("ISO datetime input", () => {
    it("should handle ISO datetime string", () => {
      // Input: "2024-12-31T10:30:00" in Asia/Shanghai
      // Expected: 2024-12-31 10:30:00 in Shanghai = 2024-12-31 02:30:00 UTC
      const result = parseDateInputAsTimezone("2024-12-31T10:30:00", "Asia/Shanghai");

      expect(result.getUTCFullYear()).toBe(2024);
      expect(result.getUTCMonth()).toBe(11);
      expect(result.getUTCDate()).toBe(31);
      expect(result.getUTCHours()).toBe(2); // 10:30 Shanghai = 02:30 UTC
      expect(result.getUTCMinutes()).toBe(30);
    });

    it("should handle ISO datetime with Z suffix - note: behavior depends on runtime TZ", () => {
      // NOTE: Z-suffixed input is not a typical use case for this function.
      // User input from date pickers typically doesn't include Z suffix.
      // When Z suffix is present, new Date() parses it as UTC, but fromZonedTime
      // reads the LOCAL time components (which depend on runtime timezone).
      //
      // For this reason, we recommend NOT using Z-suffixed input with this function.
      // This test documents the behavior for awareness, not for correctness assertion.
      const result = parseDateInputAsTimezone("2024-12-31T10:30:00Z", "Asia/Shanghai");

      // Just verify it doesn't throw and returns a valid date
      expect(result).toBeInstanceOf(Date);
      expect(Number.isNaN(result.getTime())).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should throw for invalid date string", () => {
      expect(() => parseDateInputAsTimezone("invalid-date", "UTC")).toThrow(
        "Invalid date input: invalid-date"
      );
    });

    it("should throw for empty string", () => {
      expect(() => parseDateInputAsTimezone("", "UTC")).toThrow();
    });
  });

  describe("DST edge cases", () => {
    it("should handle DST transition date in spring (America/New_York)", () => {
      // March 10, 2024 is when DST starts in US (clocks spring forward at 2am)
      // Input: "2024-03-10" in America/New_York
      // Expected: 2024-03-10 23:59:59 in NY (UTC-4 after DST) = 2024-03-11 03:59:59 UTC
      const result = parseDateInputAsTimezone("2024-03-10", "America/New_York");

      expect(result.getUTCFullYear()).toBe(2024);
      expect(result.getUTCMonth()).toBe(2); // March = 2
      expect(result.getUTCDate()).toBe(11); // Next day in UTC
      expect(result.getUTCHours()).toBe(3); // UTC-4 offset after DST
    });

    it("should handle DST transition date in fall (America/New_York)", () => {
      // November 3, 2024 is when DST ends in US (clocks fall back at 2am)
      // Input: "2024-11-03" in America/New_York
      // Expected: 2024-11-03 23:59:59 in NY (UTC-5 after DST ends) = 2024-11-04 04:59:59 UTC
      const result = parseDateInputAsTimezone("2024-11-03", "America/New_York");

      expect(result.getUTCFullYear()).toBe(2024);
      expect(result.getUTCMonth()).toBe(10); // November = 10
      expect(result.getUTCDate()).toBe(4); // Next day in UTC
      expect(result.getUTCHours()).toBe(4); // UTC-5 offset after DST ends
    });
  });
});
