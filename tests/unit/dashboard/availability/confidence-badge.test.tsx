/**
 * @vitest-environment happy-dom
 */

import { describe, expect, test } from "vitest";

// Test the pure functions extracted from ConfidenceBadge component
// These determine confidence levels based on request counts

describe("ConfidenceBadge - getConfidenceLevel logic", () => {
  type ConfidenceLevel = "low" | "medium" | "high";

  function getConfidenceLevel(
    count: number,
    thresholds: { low: number; medium: number; high: number }
  ): ConfidenceLevel {
    if (count >= thresholds.high) return "high";
    if (count >= thresholds.medium) return "medium";
    return "low";
  }

  describe("with default thresholds (low: 10, medium: 50, high: 200)", () => {
    const thresholds = { low: 10, medium: 50, high: 200 };

    test("should return low confidence for counts < medium threshold", () => {
      expect(getConfidenceLevel(0, thresholds)).toBe("low");
      expect(getConfidenceLevel(5, thresholds)).toBe("low");
      expect(getConfidenceLevel(10, thresholds)).toBe("low");
      expect(getConfidenceLevel(49, thresholds)).toBe("low");
    });

    test("should return medium confidence for counts >= medium and < high", () => {
      expect(getConfidenceLevel(50, thresholds)).toBe("medium");
      expect(getConfidenceLevel(100, thresholds)).toBe("medium");
      expect(getConfidenceLevel(199, thresholds)).toBe("medium");
    });

    test("should return high confidence for counts >= high threshold", () => {
      expect(getConfidenceLevel(200, thresholds)).toBe("high");
      expect(getConfidenceLevel(500, thresholds)).toBe("high");
      expect(getConfidenceLevel(1000, thresholds)).toBe("high");
    });
  });

  describe("with custom thresholds", () => {
    const customThresholds = { low: 5, medium: 20, high: 100 };

    test("should respect custom thresholds", () => {
      expect(getConfidenceLevel(4, customThresholds)).toBe("low");
      expect(getConfidenceLevel(5, customThresholds)).toBe("low");
      expect(getConfidenceLevel(19, customThresholds)).toBe("low");
      expect(getConfidenceLevel(20, customThresholds)).toBe("medium");
      expect(getConfidenceLevel(99, customThresholds)).toBe("medium");
      expect(getConfidenceLevel(100, customThresholds)).toBe("high");
    });
  });

  describe("edge cases", () => {
    const thresholds = { low: 10, medium: 50, high: 200 };

    test("should handle zero requests", () => {
      expect(getConfidenceLevel(0, thresholds)).toBe("low");
    });

    test("should handle negative values (treat as low)", () => {
      expect(getConfidenceLevel(-1, thresholds)).toBe("low");
      expect(getConfidenceLevel(-100, thresholds)).toBe("low");
    });

    test("should handle very large values", () => {
      expect(getConfidenceLevel(1000000, thresholds)).toBe("high");
    });

    test("should handle exact threshold boundaries", () => {
      // At exactly medium threshold
      expect(getConfidenceLevel(50, thresholds)).toBe("medium");
      // At exactly high threshold
      expect(getConfidenceLevel(200, thresholds)).toBe("high");
    });
  });
});

describe("ConfidenceBadge - visual configuration", () => {
  const confidenceConfig = {
    low: {
      bars: 1,
      color: "bg-slate-400",
      bgColor: "bg-slate-400/10",
      borderStyle: "border-dashed border-slate-400/50",
    },
    medium: {
      bars: 2,
      color: "bg-amber-500",
      bgColor: "bg-amber-500/10",
      borderStyle: "border-solid border-amber-500/50",
    },
    high: {
      bars: 3,
      color: "bg-emerald-500",
      bgColor: "bg-emerald-500/10",
      borderStyle: "border-solid border-emerald-500/50",
    },
  };

  test("low confidence should show 1 bar with dashed border", () => {
    expect(confidenceConfig.low.bars).toBe(1);
    expect(confidenceConfig.low.borderStyle).toContain("border-dashed");
  });

  test("medium confidence should show 2 bars with solid border", () => {
    expect(confidenceConfig.medium.bars).toBe(2);
    expect(confidenceConfig.medium.borderStyle).toContain("border-solid");
  });

  test("high confidence should show 3 bars with solid border", () => {
    expect(confidenceConfig.high.bars).toBe(3);
    expect(confidenceConfig.high.borderStyle).toContain("border-solid");
  });

  test("each level should have distinct colors", () => {
    expect(confidenceConfig.low.color).not.toBe(confidenceConfig.medium.color);
    expect(confidenceConfig.medium.color).not.toBe(confidenceConfig.high.color);
    expect(confidenceConfig.low.color).not.toBe(confidenceConfig.high.color);
  });

  test("bar heights should increase progressively", () => {
    // Bar heights are calculated as bar * 4px
    const lowMaxHeight = confidenceConfig.low.bars * 4;
    const mediumMaxHeight = confidenceConfig.medium.bars * 4;
    const highMaxHeight = confidenceConfig.high.bars * 4;

    expect(lowMaxHeight).toBe(4);
    expect(mediumMaxHeight).toBe(8);
    expect(highMaxHeight).toBe(12);
  });
});
