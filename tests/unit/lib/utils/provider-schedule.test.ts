import { describe, expect, it } from "vitest";
import { isProviderActiveNow } from "@/lib/utils/provider-schedule";

describe("isProviderActiveNow", () => {
  // Helper: create a Date at a specific time in a given timezone
  function makeDate(hh: number, mm: number, timezone: string): Date {
    // Build a date string in the target timezone, then convert back to UTC
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();

    // Create a date formatter for the target timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    // Get what the current time is in that timezone
    const parts = formatter.formatToParts(now);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
    const currentHourInTz = parseInt(getPart("hour"), 10);
    const currentMinuteInTz = parseInt(getPart("minute"), 10);

    // Compute the offset in ms we need to shift
    const targetMinutes = hh * 60 + mm;
    const currentMinutes = currentHourInTz * 60 + currentMinuteInTz;
    const diffMs = (targetMinutes - currentMinutes) * 60 * 1000;

    return new Date(now.getTime() + diffMs);
  }

  describe("null/undefined inputs (always active)", () => {
    it("returns true when both start and end are null", () => {
      expect(isProviderActiveNow(null, null, "UTC")).toBe(true);
    });

    it("returns true when start is null and end is non-null", () => {
      expect(isProviderActiveNow(null, "18:00", "UTC")).toBe(true);
    });

    it("returns true when start is non-null and end is null", () => {
      expect(isProviderActiveNow("09:00", null, "UTC")).toBe(true);
    });
  });

  describe("same-day schedule (start < end)", () => {
    const cases = [
      { start: "09:00", end: "17:00", hour: 9, min: 0, expected: true, desc: "at start boundary" },
      { start: "09:00", end: "17:00", hour: 12, min: 30, expected: true, desc: "middle of window" },
      { start: "09:00", end: "17:00", hour: 16, min: 59, expected: true, desc: "just before end" },
      {
        start: "09:00",
        end: "17:00",
        hour: 17,
        min: 0,
        expected: false,
        desc: "at end boundary (exclusive)",
      },
      {
        start: "09:00",
        end: "17:00",
        hour: 8,
        min: 59,
        expected: false,
        desc: "just before start",
      },
      { start: "09:00", end: "17:00", hour: 23, min: 0, expected: false, desc: "well after end" },
      { start: "09:00", end: "17:00", hour: 0, min: 0, expected: false, desc: "midnight" },
      { start: "00:00", end: "23:59", hour: 12, min: 0, expected: true, desc: "nearly full day" },
    ];

    for (const { start, end, hour, min, expected, desc } of cases) {
      it(`${desc}: ${start}-${end} at ${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")} -> ${expected}`, () => {
        const now = makeDate(hour, min, "UTC");
        expect(isProviderActiveNow(start, end, "UTC", now)).toBe(expected);
      });
    }
  });

  describe("cross-day schedule (start > end)", () => {
    const cases = [
      { start: "22:00", end: "08:00", hour: 22, min: 0, expected: true, desc: "at start boundary" },
      { start: "22:00", end: "08:00", hour: 23, min: 30, expected: true, desc: "late night" },
      { start: "22:00", end: "08:00", hour: 0, min: 0, expected: true, desc: "midnight" },
      { start: "22:00", end: "08:00", hour: 3, min: 0, expected: true, desc: "early morning" },
      { start: "22:00", end: "08:00", hour: 7, min: 59, expected: true, desc: "just before end" },
      {
        start: "22:00",
        end: "08:00",
        hour: 8,
        min: 0,
        expected: false,
        desc: "at end boundary (exclusive)",
      },
      { start: "22:00", end: "08:00", hour: 12, min: 0, expected: false, desc: "midday" },
      {
        start: "22:00",
        end: "08:00",
        hour: 21,
        min: 59,
        expected: false,
        desc: "just before start",
      },
    ];

    for (const { start, end, hour, min, expected, desc } of cases) {
      it(`${desc}: ${start}-${end} at ${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")} -> ${expected}`, () => {
        const now = makeDate(hour, min, "UTC");
        expect(isProviderActiveNow(start, end, "UTC", now)).toBe(expected);
      });
    }
  });

  describe("edge cases", () => {
    it("start === end returns false (zero-width window)", () => {
      const now = makeDate(22, 0, "UTC");
      expect(isProviderActiveNow("22:00", "22:00", "UTC", now)).toBe(false);
    });

    it("start === end returns false even at different time", () => {
      const now = makeDate(10, 0, "UTC");
      expect(isProviderActiveNow("22:00", "22:00", "UTC", now)).toBe(false);
    });
  });

  describe("timezone support", () => {
    it("same UTC time yields different results in different timezones", () => {
      // At UTC 06:00, in Asia/Shanghai (UTC+8) it's 14:00
      // Schedule 09:00-17:00 should be active in Shanghai but not in UTC
      const utcDate = makeDate(6, 0, "UTC");

      // In UTC at 06:00 with schedule 09:00-17:00 -> inactive
      expect(isProviderActiveNow("09:00", "17:00", "UTC", utcDate)).toBe(false);

      // In Asia/Shanghai at 14:00 with schedule 09:00-17:00 -> active
      expect(isProviderActiveNow("09:00", "17:00", "Asia/Shanghai", utcDate)).toBe(true);
    });
  });

  describe("malformed input defense", () => {
    it("returns true (fail-open) for malformed start time", () => {
      const now = makeDate(12, 0, "UTC");
      expect(isProviderActiveNow("garbage", "17:00", "UTC", now)).toBe(true);
    });

    it("returns true (fail-open) for malformed end time", () => {
      const now = makeDate(12, 0, "UTC");
      expect(isProviderActiveNow("09:00", "not-a-time", "UTC", now)).toBe(true);
    });

    it("returns true (fail-open) for both times malformed", () => {
      const now = makeDate(12, 0, "UTC");
      expect(isProviderActiveNow("bad", "worse", "UTC", now)).toBe(true);
    });

    it("returns true (fail-open) for out-of-range hour (24:00)", () => {
      const now = makeDate(12, 0, "UTC");
      expect(isProviderActiveNow("24:00", "17:00", "UTC", now)).toBe(true);
    });

    it("returns true (fail-open) for single-digit hour (9:00)", () => {
      const now = makeDate(12, 0, "UTC");
      expect(isProviderActiveNow("9:00", "17:00", "UTC", now)).toBe(true);
    });

    it("returns true (fail-open) for out-of-range minutes (99:99)", () => {
      const now = makeDate(12, 0, "UTC");
      expect(isProviderActiveNow("99:99", "17:00", "UTC", now)).toBe(true);
    });
  });
});
