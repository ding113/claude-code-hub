import { describe, expect, test } from "vitest";
import { normalizeDecimalForSpreadsheet, toFiniteNumber } from "@/lib/usage-logs/export/numeric";

describe("toFiniteNumber", () => {
  test("parses numeric strings", () => {
    expect(toFiniteNumber("1.5")).toBe(1.5);
    expect(toFiniteNumber("0")).toBe(0);
    expect(toFiniteNumber(42)).toBe(42);
  });

  test("returns null for empty / nullish / non-numeric", () => {
    expect(toFiniteNumber("")).toBeNull();
    expect(toFiniteNumber("   ")).toBeNull();
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber("abc")).toBeNull();
    expect(toFiniteNumber(Number.NaN)).toBeNull();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("normalizeDecimalForSpreadsheet", () => {
  test("strips trailing zeros so Excel parses the value as a number", () => {
    // numeric(21,15) always pads to 15 decimals -> Excel sees 16 significant
    // digits and falls back to text. Trimming makes it a clean number again.
    expect(normalizeDecimalForSpreadsheet("1.500000000000000")).toBe("1.5");
    expect(normalizeDecimalForSpreadsheet("0.001000000000000")).toBe("0.001");
  });

  test("caps to 15 significant digits (Excel's precision ceiling)", () => {
    expect(normalizeDecimalForSpreadsheet("1.234567890123456")).toBe("1.23456789012346");
    expect(normalizeDecimalForSpreadsheet("12.3456789012345678")).toBe("12.3456789012346");
  });

  test("preserves small values whose leading digit is 0", () => {
    expect(normalizeDecimalForSpreadsheet("0.000123456789012345")).toBe("0.000123456789012345");
  });

  test("never emits scientific notation", () => {
    expect(normalizeDecimalForSpreadsheet(1e-12)).toBe("0.000000000001");
    expect(normalizeDecimalForSpreadsheet("0.000000000123456")).toBe("0.000000000123456");
    expect(normalizeDecimalForSpreadsheet(1e-12)).not.toContain("e");
  });

  test("nullish / empty / non-finite collapse to 0", () => {
    expect(normalizeDecimalForSpreadsheet(null)).toBe("0");
    expect(normalizeDecimalForSpreadsheet(undefined)).toBe("0");
    expect(normalizeDecimalForSpreadsheet("")).toBe("0");
    expect(normalizeDecimalForSpreadsheet("not-a-number")).toBe("0");
    expect(normalizeDecimalForSpreadsheet("0")).toBe("0");
    expect(normalizeDecimalForSpreadsheet(0)).toBe("0");
  });

  test("passes through plain integers and decimals unchanged", () => {
    expect(normalizeDecimalForSpreadsheet("123456.789")).toBe("123456.789");
    expect(normalizeDecimalForSpreadsheet("42")).toBe("42");
  });
});
