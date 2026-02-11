import { describe, expect, test } from "vitest";

import { formatDateToLocalYmd, parseYmdToLocalEndOfDay } from "./date-input";

describe("parseYmdToLocalEndOfDay", () => {
  test("empty/invalid input returns null", () => {
    expect(parseYmdToLocalEndOfDay("")).toBeNull();
    expect(parseYmdToLocalEndOfDay("not-a-date")).toBeNull();
    expect(parseYmdToLocalEndOfDay("2026-13-40")).toBeNull();
  });

  test("parses YYYY-MM-DD as local end-of-day", () => {
    const d = parseYmdToLocalEndOfDay("2026-02-11");
    expect(d).not.toBeNull();
    if (!d) return;

    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(11);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });
});

describe("formatDateToLocalYmd", () => {
  test("formats Date as local YYYY-MM-DD", () => {
    const d = new Date(2026, 1, 11, 12, 0, 0);
    expect(formatDateToLocalYmd(d)).toBe("2026-02-11");
  });

  test("invalid date returns empty string", () => {
    expect(formatDateToLocalYmd(new Date("invalid"))).toBe("");
  });
});
