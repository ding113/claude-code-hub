/**
 * Unit tests for token.ts
 *
 * Test coverage:
 * - Token amount formatting with K/M suffixes
 * - Null/undefined handling
 * - Negative values
 * - Edge cases (boundaries, decimal precision)
 * - Locale-based number formatting
 */

import { describe, it, expect } from "vitest";
import { formatTokenAmount } from "./token";

describe("Token Utility Functions", () => {
  describe("formatTokenAmount - Null/Undefined Handling", () => {
    it("should return '-' for null value", () => {
      const result = formatTokenAmount(null);
      expect(result).toBe("-");
    });

    it("should return '-' for undefined value", () => {
      const result = formatTokenAmount(undefined);
      expect(result).toBe("-");
    });
  });

  describe("formatTokenAmount - Small Numbers (< 1000)", () => {
    it("should format zero as '0'", () => {
      const result = formatTokenAmount(0);
      expect(result).toBe("0");
    });

    it("should format single digit numbers without suffix", () => {
      const result = formatTokenAmount(5);
      expect(result).toBe("5");
    });

    it("should format two digit numbers without suffix", () => {
      const result = formatTokenAmount(42);
      expect(result).toBe("42");
    });

    it("should format three digit numbers without suffix", () => {
      const result = formatTokenAmount(999);
      expect(result).toBe("999");
    });

    it("should format decimal numbers with up to 2 decimal places", () => {
      const result = formatTokenAmount(123.456);
      expect(result).toBe("123.46"); // Rounded to 2 decimals
    });

    it("should format decimal numbers with 1 decimal place", () => {
      const result = formatTokenAmount(99.5);
      expect(result).toBe("99.5");
    });

    it("should not show trailing zeros for whole numbers", () => {
      const result = formatTokenAmount(100.0);
      expect(result).toBe("100");
    });
  });

  describe("formatTokenAmount - K Suffix (1000 <= value < 1000000)", () => {
    it("should format exactly 1000 as '1K'", () => {
      const result = formatTokenAmount(1000);
      expect(result).toBe("1K");
    });

    it("should format 1500 as '1.5K'", () => {
      const result = formatTokenAmount(1500);
      expect(result).toBe("1.5K");
    });

    it("should format 12345 with K suffix", () => {
      const result = formatTokenAmount(12345);
      expect(result).toBe("12.35K"); // Rounded to 2 decimals
    });

    it("should format 999000 as '999K'", () => {
      const result = formatTokenAmount(999000);
      expect(result).toBe("999K");
    });

    it("should format 999999 with K suffix (boundary)", () => {
      const result = formatTokenAmount(999999);
      expect(result).toBe("1,000K"); // Locale-formatted with comma
    });

    it("should round K values to 2 decimal places", () => {
      const result = formatTokenAmount(1234.567);
      expect(result).toBe("1.23K"); // 1234.567 / 1000 = 1.234567 -> 1.23
    });

    it("should not show trailing zeros in K format", () => {
      const result = formatTokenAmount(5000);
      expect(result).toBe("5K");
    });
  });

  describe("formatTokenAmount - M Suffix (>= 1000000)", () => {
    it("should format exactly 1000000 as '1M'", () => {
      const result = formatTokenAmount(1000000);
      expect(result).toBe("1M");
    });

    it("should format 1500000 as '1.5M'", () => {
      const result = formatTokenAmount(1500000);
      expect(result).toBe("1.5M");
    });

    it("should format 12345678 with M suffix", () => {
      const result = formatTokenAmount(12345678);
      expect(result).toBe("12.35M"); // Rounded to 2 decimals
    });

    it("should format 999999999 with M suffix", () => {
      const result = formatTokenAmount(999999999);
      expect(result).toBe("1,000M"); // Locale-formatted
    });

    it("should round M values to 2 decimal places", () => {
      const result = formatTokenAmount(1234567.89);
      expect(result).toBe("1.23M"); // 1234567.89 / 1000000 = 1.23456789 -> 1.23
    });

    it("should not show trailing zeros in M format", () => {
      const result = formatTokenAmount(5000000);
      expect(result).toBe("5M");
    });

    it("should handle very large numbers", () => {
      const result = formatTokenAmount(1234567890123);
      expect(result).toBe("1,234,567.89M");
    });
  });

  describe("formatTokenAmount - Negative Values", () => {
    it("should format negative small numbers without suffix", () => {
      const result = formatTokenAmount(-123);
      expect(result).toBe("-123");
    });

    it("should format negative values with K suffix", () => {
      const result = formatTokenAmount(-1500);
      expect(result).toBe("-1.5K");
    });

    it("should format negative values with M suffix", () => {
      const result = formatTokenAmount(-1500000);
      expect(result).toBe("-1.5M");
    });

    it("should use absolute value for suffix determination", () => {
      // -999 should not have K suffix (absolute < 1000)
      const result1 = formatTokenAmount(-999);
      expect(result1).toBe("-999");

      // -1000 should have K suffix (absolute >= 1000)
      const result2 = formatTokenAmount(-1000);
      expect(result2).toBe("-1K");
    });

    it("should format negative zero as '-0' (JavaScript behavior)", () => {
      const result = formatTokenAmount(-0);
      expect(result).toBe("-0");
    });
  });

  describe("formatTokenAmount - Boundary Values", () => {
    it("should handle boundary at 999 (no K suffix)", () => {
      const result = formatTokenAmount(999);
      expect(result).toBe("999");
    });

    it("should handle boundary at 1000 (K suffix starts)", () => {
      const result = formatTokenAmount(1000);
      expect(result).toBe("1K");
    });

    it("should handle boundary at 999999 (still K suffix)", () => {
      const result = formatTokenAmount(999999);
      expect(result).toBe("1,000K");
    });

    it("should handle boundary at 1000000 (M suffix starts)", () => {
      const result = formatTokenAmount(1000000);
      expect(result).toBe("1M");
    });

    it("should handle value just below K threshold", () => {
      const result = formatTokenAmount(999.99);
      expect(result).toBe("999.99"); // Stays under 1000, no rounding to K
    });

    it("should handle value just above K threshold", () => {
      const result = formatTokenAmount(1000.01);
      expect(result).toBe("1K");
    });

    it("should handle value just below M threshold", () => {
      const result = formatTokenAmount(999999.99);
      expect(result).toBe("1,000K"); // Rounded up
    });

    it("should handle value just above M threshold", () => {
      const result = formatTokenAmount(1000000.01);
      expect(result).toBe("1M");
    });
  });

  describe("formatTokenAmount - Decimal Precision", () => {
    it("should show up to 2 decimal places for non-zero decimals", () => {
      const result = formatTokenAmount(1234.56);
      expect(result).toBe("1.23K");
    });

    it("should not show trailing zeros after decimal point", () => {
      const result = formatTokenAmount(1200);
      expect(result).toBe("1.2K");
    });

    it("should round to 2 decimal places when needed", () => {
      const result = formatTokenAmount(1236); // 1.236K
      expect(result).toBe("1.24K"); // Rounded up
    });

    it("should handle rounding down", () => {
      const result = formatTokenAmount(1234); // 1.234K
      expect(result).toBe("1.23K"); // Rounded down
    });

    it("should handle very small decimal in K range", () => {
      const result = formatTokenAmount(1000.001);
      expect(result).toBe("1K"); // 1.000001K -> 1K
    });

    it("should handle very small decimal in M range", () => {
      const result = formatTokenAmount(1000000.001);
      expect(result).toBe("1M"); // 1.000000001M -> 1M
    });
  });

  describe("formatTokenAmount - Locale Formatting", () => {
    it("should format K values with decimal places (not base numbers)", () => {
      const result = formatTokenAmount(12345.67);
      expect(result).toBe("12.35K"); // Above 1000, uses K suffix
    });

    it("should use comma separators in K format for large K values", () => {
      const result = formatTokenAmount(999999);
      expect(result).toMatch(/1.*000K/); // Locale-dependent separators
    });

    it("should use comma separators in M format for large M values", () => {
      const result = formatTokenAmount(1234567890);
      expect(result).toBe("1,234.57M"); // Specific locale formatting
    });
  });

  describe("formatTokenAmount - Edge Cases", () => {
    it("should handle Number.MAX_SAFE_INTEGER", () => {
      const result = formatTokenAmount(Number.MAX_SAFE_INTEGER);
      expect(result).toContain("M");
      expect(result).not.toBe("-");
    });

    it("should handle Number.MIN_SAFE_INTEGER", () => {
      const result = formatTokenAmount(Number.MIN_SAFE_INTEGER);
      expect(result).toContain("M");
      expect(result).toMatch(/^-/);
    });

    it("should handle very small positive number", () => {
      const result = formatTokenAmount(0.0001);
      expect(result).toBe("0");
    });

    it("should handle very small negative number", () => {
      const result = formatTokenAmount(-0.0001);
      expect(result).toBe("-0"); // Rounds to -0 in JavaScript
    });

    it("should handle Number.EPSILON", () => {
      const result = formatTokenAmount(Number.EPSILON);
      expect(result).toBe("0");
    });

    it("should handle NaN by returning a string with M suffix", () => {
      // Note: TypeScript types prevent NaN, but runtime JavaScript allows it
      const result = formatTokenAmount(NaN as number);
      // NaN falls through to M suffix case (absolute value check fails)
      expect(result).toBe("NaNM");
    });

    it("should handle Infinity", () => {
      // Note: TypeScript types prevent Infinity, but runtime JavaScript allows it
      const result = formatTokenAmount(Infinity as number);
      // Infinity is >= 1M threshold, will append "M"
      expect(result).toContain("M");
    });

    it("should handle -Infinity", () => {
      const result = formatTokenAmount(-Infinity as number);
      expect(result).toContain("M");
      expect(result).toMatch(/^-/);
    });
  });

  describe("formatTokenAmount - Real-world Use Cases", () => {
    it("should format typical Claude input tokens (small)", () => {
      const result = formatTokenAmount(450);
      expect(result).toBe("450");
    });

    it("should format typical Claude output tokens (small)", () => {
      const result = formatTokenAmount(120);
      expect(result).toBe("120");
    });

    it("should format large conversation token count", () => {
      const result = formatTokenAmount(15000);
      expect(result).toBe("15K");
    });

    it("should format cache hit tokens", () => {
      const result = formatTokenAmount(50000);
      expect(result).toBe("50K");
    });

    it("should format monthly token usage", () => {
      const result = formatTokenAmount(2500000);
      expect(result).toBe("2.5M");
    });

    it("should format token pricing calculations (fractional)", () => {
      // Price per million tokens: 3.00 USD -> 3000000 tokens per USD
      const result = formatTokenAmount(3000000);
      expect(result).toBe("3M");
    });

    it("should format zero usage", () => {
      const result = formatTokenAmount(0);
      expect(result).toBe("0");
    });

    it("should format missing data", () => {
      const result = formatTokenAmount(null);
      expect(result).toBe("-");
    });
  });
});
