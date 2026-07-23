import { format } from "date-fns";
import { describe, expect, test } from "vitest";
import {
  dateStringWithClockToTimestamp,
  formatClockFromTimestamp,
  getQuickDateRange,
  inclusiveEndTimestampFromExclusive,
  parseClockString,
  type QuickPeriod,
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

  test("getQuickDateRange keeps the first hours of the server day in that day", () => {
    const now = new Date("2024-01-02T08:30:00Z");
    const tz = "America/Los_Angeles";

    expect(getQuickDateRange("today", tz, now)).toEqual({
      startDate: "2024-01-02",
      endDate: "2024-01-02",
    });
  });

  test("formatClockFromTimestamp renders the clock in the given timezone", () => {
    const ts = Date.UTC(2024, 0, 1, 12, 34, 56);
    expect(formatClockFromTimestamp(ts, "UTC")).toBe("12:34:56");
    expect(formatClockFromTimestamp(ts, "Asia/Shanghai")).toBe("20:34:56");
  });

  test("dateStringWithClockToTimestamp interprets date + clock in the given timezone", () => {
    const ts = dateStringWithClockToTimestamp("2024-01-01", "08:00:00", "Asia/Shanghai");
    expect(ts).toBe(Date.UTC(2024, 0, 1, 0, 0, 0));
  });

  test("dateStringWithClockToTimestamp rejects month/day overflow", () => {
    expect(dateStringWithClockToTimestamp("2024-02-30", "00:00:00")).toBeUndefined();
    expect(dateStringWithClockToTimestamp("2024-01-01", "24:00:00")).toBeUndefined();
  });

  test("getQuickDateRange computes last7days/last30days windows", () => {
    const now = new Date("2024-01-31T12:00:00Z");
    const tz = "UTC";

    expect(getQuickDateRange("last7days", tz, now)).toEqual({
      startDate: "2024-01-25",
      endDate: "2024-01-31",
    });
    expect(getQuickDateRange("last30days", tz, now)).toEqual({
      startDate: "2024-01-02",
      endDate: "2024-01-31",
    });
  });

  test("getQuickDateRange falls back to today for unknown periods without timezone", () => {
    const now = new Date(2024, 0, 15, 12, 0, 0);
    const range = getQuickDateRange("unknown" as unknown as QuickPeriod, undefined, now);
    expect(range).toEqual({ startDate: "2024-01-15", endDate: "2024-01-15" });
  });

  test("getQuickDateRange defaults to the current time", () => {
    const before = format(new Date(), "yyyy-MM-dd");
    const range = getQuickDateRange("today");
    const after = format(new Date(), "yyyy-MM-dd");

    expect([before, after]).toContain(range.startDate);
    expect(range.endDate).toBe(range.startDate);
  });
});
