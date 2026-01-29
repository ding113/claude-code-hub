import { describe, expect, test } from "vitest";
import {
  dateStringWithClockToTimestamp,
  formatClockFromTimestamp,
  getQuickDateRange,
  inclusiveEndTimestampFromExclusive,
  parseClockString,
} from "@/app/[locale]/dashboard/logs/_utils/time-range";

describe("dashboard logs time range utils", () => {
  test("parseClockString supports HH:MM and defaults seconds to 0", () => {
    expect(parseClockString("01:02")).toEqual({ hours: 1, minutes: 2, seconds: 0 });
  });

  test("parseClockString falls back to 0 for invalid numbers", () => {
    expect(parseClockString("xx:yy:zz")).toEqual({ hours: 0, minutes: 0, seconds: 0 });
    expect(parseClockString("01:02:xx")).toEqual({ hours: 1, minutes: 2, seconds: 0 });
  });

  test("dateStringWithClockToTimestamp combines local date + clock", () => {
    const ts = dateStringWithClockToTimestamp("2026-01-01", "01:02:03");
    const expected = new Date(2026, 0, 1, 1, 2, 3, 0).getTime();
    expect(ts).toBe(expected);
  });

  test("dateStringWithClockToTimestamp returns undefined for invalid date", () => {
    expect(dateStringWithClockToTimestamp("not-a-date", "01:02:03")).toBeUndefined();
    expect(dateStringWithClockToTimestamp("2026-13-40", "01:02:03")).toBeUndefined();
  });

  test("exclusive end time round-trips to inclusive end time (+/-1s)", () => {
    const inclusive = dateStringWithClockToTimestamp("2026-01-02", "04:05:06");
    expect(inclusive).toBeDefined();
    const exclusive = inclusive! + 1000;
    expect(inclusiveEndTimestampFromExclusive(exclusive)).toBe(inclusive);
  });

  test("inclusiveEndTimestampFromExclusive clamps at 0", () => {
    expect(inclusiveEndTimestampFromExclusive(0)).toBe(0);
    expect(inclusiveEndTimestampFromExclusive(500)).toBe(0);
  });

  test("formatClockFromTimestamp uses HH:MM:SS", () => {
    const ts = new Date(2026, 0, 1, 1, 2, 3, 0).getTime();
    expect(formatClockFromTimestamp(ts)).toBe("01:02:03");
  });

  test("getQuickDateRange uses server timezone for today/yesterday", () => {
    const now = new Date("2024-01-02T02:00:00Z");
    const tz = "America/Los_Angeles";

    expect(getQuickDateRange("today", tz, now)).toEqual({
      startDate: "2024-01-01",
      endDate: "2024-01-01",
    });
    expect(getQuickDateRange("yesterday", tz, now)).toEqual({
      startDate: "2023-12-31",
      endDate: "2023-12-31",
    });
  });
});
