import { describe, expect, test } from "vitest";
import { formatProbability, formatProbabilityCompact } from "./provider-chain-formatter";

describe("formatProbability", () => {
  test("formats 0.5 as 50.0%", () => {
    expect(formatProbability(0.5)).toBe("50.0%");
  });

  test("formats 0 as 0.0%", () => {
    expect(formatProbability(0)).toBe("0.0%");
  });

  test("formats 1 as 100.0%", () => {
    expect(formatProbability(1)).toBe("100.0%");
  });

  test("formats 0.333 as 33.3%", () => {
    expect(formatProbability(0.333)).toBe("33.3%");
  });

  test("normalizes out-of-range value 100 to 100.0% (prevents 10000.0%)", () => {
    expect(formatProbability(100)).toBe("100.0%");
  });

  test("normalizes out-of-range value 50 to 50.0%", () => {
    expect(formatProbability(50)).toBe("50.0%");
  });

  test("caps values greater than 100 at 100.0%", () => {
    expect(formatProbability(150)).toBe("100.0%");
  });

  test("returns null for undefined", () => {
    expect(formatProbability(undefined)).toBeNull();
  });

  test("returns null for null", () => {
    expect(formatProbability(null)).toBeNull();
  });

  test("returns null for NaN", () => {
    expect(formatProbability(Number.NaN)).toBeNull();
  });

  test("returns null for negative values", () => {
    expect(formatProbability(-0.5)).toBeNull();
  });

  test("respects custom decimal places", () => {
    expect(formatProbability(0.5, 0)).toBe("50%");
    expect(formatProbability(0.5, 2)).toBe("50.00%");
  });
});

describe("formatProbabilityCompact", () => {
  test("formats with 0 decimal places", () => {
    expect(formatProbabilityCompact(0.5)).toBe("50%");
  });

  test("returns null for invalid values", () => {
    expect(formatProbabilityCompact(undefined)).toBeNull();
    expect(formatProbabilityCompact(Number.NaN)).toBeNull();
  });
});
