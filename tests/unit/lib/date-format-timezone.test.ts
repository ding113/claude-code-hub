import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/utils/date-format";

describe("formatDate with timezone parameter", () => {
  // Fixed UTC timestamp: 2025-01-15T23:30:00Z
  const utcDate = new Date("2025-01-15T23:30:00Z");

  it("returns formatted date without timezone (original behaviour)", () => {
    const result = formatDate(utcDate, "yyyy-MM-dd", "en");
    // Without timezone, result depends on local TZ - just verify it returns a string
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("formats date in UTC timezone", () => {
    const result = formatDate(utcDate, "yyyy-MM-dd HH:mm", "en", "UTC");
    expect(result).toBe("2025-01-15 23:30");
  });

  it("formats date in Asia/Shanghai timezone (UTC+8)", () => {
    // 2025-01-15T23:30:00Z => 2025-01-16T07:30:00 in Asia/Shanghai
    const result = formatDate(utcDate, "yyyy-MM-dd HH:mm", "en", "Asia/Shanghai");
    expect(result).toBe("2025-01-16 07:30");
  });

  it("formats date in America/New_York timezone (UTC-5 in January)", () => {
    // 2025-01-15T23:30:00Z => 2025-01-15T18:30:00 in America/New_York (EST)
    const result = formatDate(utcDate, "yyyy-MM-dd HH:mm", "en", "America/New_York");
    expect(result).toBe("2025-01-15 18:30");
  });

  it("handles date-only format with timezone that crosses midnight", () => {
    // 2025-01-15T23:30:00Z is already 2025-01-16 in Asia/Shanghai
    const dateOnly = formatDate(utcDate, "yyyy-MM-dd", "en", "Asia/Shanghai");
    expect(dateOnly).toBe("2025-01-16");
  });

  it("preserves locale formatting with timezone", () => {
    const result = formatDate(utcDate, "PPP", "en", "UTC");
    // PPP in en locale: "January 15th, 2025"
    expect(result).toContain("January");
    expect(result).toContain("2025");
  });

  it("works with string date input and timezone", () => {
    const result = formatDate("2025-06-01T12:00:00Z", "yyyy-MM-dd HH:mm", "en", "Asia/Tokyo");
    // UTC 12:00 => JST 21:00
    expect(result).toBe("2025-06-01 21:00");
  });

  it("works with numeric timestamp and timezone", () => {
    const ts = utcDate.getTime();
    const result = formatDate(ts, "yyyy-MM-dd HH:mm", "en", "UTC");
    expect(result).toBe("2025-01-15 23:30");
  });

  it("falls back to local format when timezone is undefined", () => {
    const result = formatDate(utcDate, "yyyy-MM-dd", "en", undefined);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
