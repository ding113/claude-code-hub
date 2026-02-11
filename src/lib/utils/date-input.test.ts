import { describe, expect, test } from "vitest";

import { parseYmdToLocalEndOfDay } from "./date-input";

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
