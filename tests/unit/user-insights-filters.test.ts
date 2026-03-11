import { describe, expect, it } from "vitest";
import { resolveTimePresetDates } from "@/app/[locale]/dashboard/leaderboard/user/[userId]/_components/filters/types";

describe("resolveTimePresetDates", () => {
  it("returns today for 'today' preset", () => {
    const { startDate, endDate } = resolveTimePresetDates("today");

    expect(startDate).toBeDefined();
    expect(endDate).toBeDefined();
    expect(startDate).toBe(endDate);
    // Format check: YYYY-MM-DD
    expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns 7-day range for '7days' preset", () => {
    const { startDate, endDate } = resolveTimePresetDates("7days");

    expect(startDate).toBeDefined();
    expect(endDate).toBeDefined();

    const start = new Date(startDate!);
    const end = new Date(endDate!);
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(6);
  });

  it("returns 30-day range for '30days' preset", () => {
    const { startDate, endDate } = resolveTimePresetDates("30days");

    expect(startDate).toBeDefined();
    expect(endDate).toBeDefined();

    const start = new Date(startDate!);
    const end = new Date(endDate!);
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(29);
  });

  it("returns month start for 'thisMonth' preset", () => {
    const { startDate, endDate } = resolveTimePresetDates("thisMonth");

    expect(startDate).toBeDefined();
    expect(endDate).toBeDefined();
    // startDate should be the 1st of current month
    expect(startDate!.endsWith("-01")).toBe(true);
  });

  it("returns dates in YYYY-MM-DD format for all presets", () => {
    const presets = ["today", "7days", "30days", "thisMonth"] as const;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    for (const preset of presets) {
      const { startDate, endDate } = resolveTimePresetDates(preset);
      expect(startDate).toMatch(dateRegex);
      expect(endDate).toMatch(dateRegex);
    }
  });

  it("startDate is always <= endDate", () => {
    const presets = ["today", "7days", "30days", "thisMonth"] as const;

    for (const preset of presets) {
      const { startDate, endDate } = resolveTimePresetDates(preset);
      expect(new Date(startDate!).getTime()).toBeLessThanOrEqual(new Date(endDate!).getTime());
    }
  });
});
