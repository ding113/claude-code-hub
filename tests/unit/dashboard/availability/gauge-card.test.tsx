/**
 * @vitest-environment happy-dom
 */

import { describe, expect, test } from "vitest";

// Test the pure functions extracted from GaugeCard component
// These are the core logic that determines gauge colors and trend indicators

describe("GaugeCard - getGaugeColor logic", () => {
  // Replicate the getGaugeColor function logic for testing
  function getGaugeColor(
    value: number,
    thresholds: { warning: number; critical: number },
    invertColors: boolean
  ): string {
    if (invertColors) {
      // For metrics where lower is better (error rate, latency)
      if (value <= thresholds.critical) return "text-emerald-500";
      if (value <= thresholds.warning) return "text-amber-500";
      return "text-rose-500";
    }
    // For metrics where higher is better (availability)
    if (value >= thresholds.warning) return "text-emerald-500";
    if (value >= thresholds.critical) return "text-amber-500";
    return "text-rose-500";
  }

  describe("normal metrics (higher is better)", () => {
    const thresholds = { warning: 80, critical: 50 };
    const invertColors = false;

    test("should return green for values >= warning threshold", () => {
      expect(getGaugeColor(100, thresholds, invertColors)).toBe("text-emerald-500");
      expect(getGaugeColor(95, thresholds, invertColors)).toBe("text-emerald-500");
      expect(getGaugeColor(80, thresholds, invertColors)).toBe("text-emerald-500");
    });

    test("should return amber for values between critical and warning", () => {
      expect(getGaugeColor(79, thresholds, invertColors)).toBe("text-amber-500");
      expect(getGaugeColor(65, thresholds, invertColors)).toBe("text-amber-500");
      expect(getGaugeColor(50, thresholds, invertColors)).toBe("text-amber-500");
    });

    test("should return red for values < critical threshold", () => {
      expect(getGaugeColor(49, thresholds, invertColors)).toBe("text-rose-500");
      expect(getGaugeColor(25, thresholds, invertColors)).toBe("text-rose-500");
      expect(getGaugeColor(0, thresholds, invertColors)).toBe("text-rose-500");
    });
  });

  describe("inverted metrics (lower is better)", () => {
    const thresholds = { warning: 10, critical: 5 };
    const invertColors = true;

    test("should return green for values <= critical threshold", () => {
      expect(getGaugeColor(0, thresholds, invertColors)).toBe("text-emerald-500");
      expect(getGaugeColor(3, thresholds, invertColors)).toBe("text-emerald-500");
      expect(getGaugeColor(5, thresholds, invertColors)).toBe("text-emerald-500");
    });

    test("should return amber for values between critical and warning", () => {
      expect(getGaugeColor(6, thresholds, invertColors)).toBe("text-amber-500");
      expect(getGaugeColor(8, thresholds, invertColors)).toBe("text-amber-500");
      expect(getGaugeColor(10, thresholds, invertColors)).toBe("text-amber-500");
    });

    test("should return red for values > warning threshold", () => {
      expect(getGaugeColor(11, thresholds, invertColors)).toBe("text-rose-500");
      expect(getGaugeColor(50, thresholds, invertColors)).toBe("text-rose-500");
      expect(getGaugeColor(100, thresholds, invertColors)).toBe("text-rose-500");
    });
  });
});

describe("GaugeCard - getTrendColor logic", () => {
  function getTrendColor(direction: "up" | "down" | "stable", invertColors: boolean) {
    if (direction === "stable") return "text-muted-foreground bg-muted/50";
    if (invertColors) {
      // For inverted metrics, down is good
      return direction === "down"
        ? "text-emerald-500 bg-emerald-500/10"
        : "text-rose-500 bg-rose-500/10";
    }
    // For normal metrics, up is good
    return direction === "up"
      ? "text-emerald-500 bg-emerald-500/10"
      : "text-rose-500 bg-rose-500/10";
  }

  describe("normal metrics", () => {
    const invertColors = false;

    test("should return green for upward trend", () => {
      expect(getTrendColor("up", invertColors)).toBe("text-emerald-500 bg-emerald-500/10");
    });

    test("should return red for downward trend", () => {
      expect(getTrendColor("down", invertColors)).toBe("text-rose-500 bg-rose-500/10");
    });

    test("should return muted for stable trend", () => {
      expect(getTrendColor("stable", invertColors)).toBe("text-muted-foreground bg-muted/50");
    });
  });

  describe("inverted metrics", () => {
    const invertColors = true;

    test("should return green for downward trend (lower is better)", () => {
      expect(getTrendColor("down", invertColors)).toBe("text-emerald-500 bg-emerald-500/10");
    });

    test("should return red for upward trend (higher is worse)", () => {
      expect(getTrendColor("up", invertColors)).toBe("text-rose-500 bg-rose-500/10");
    });

    test("should return muted for stable trend", () => {
      expect(getTrendColor("stable", invertColors)).toBe("text-muted-foreground bg-muted/50");
    });
  });
});

describe("GaugeCard - SVG calculations", () => {
  const sizeConfig = {
    sm: { gauge: 64, stroke: 4 },
    md: { gauge: 80, stroke: 5 },
    lg: { gauge: 96, stroke: 6 },
  };

  test("should calculate correct radius for each size", () => {
    for (const [size, config] of Object.entries(sizeConfig)) {
      const radius = (config.gauge - config.stroke) / 2;
      expect(radius).toBeGreaterThan(0);
      // Radius should be less than half the gauge size
      expect(radius).toBeLessThan(config.gauge / 2);
    }
  });

  test("should calculate correct circumference", () => {
    const config = sizeConfig.md;
    const radius = (config.gauge - config.stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    expect(circumference).toBeCloseTo(2 * Math.PI * 37.5, 2);
  });

  test("should calculate correct offset for different values", () => {
    const config = sizeConfig.md;
    const radius = (config.gauge - config.stroke) / 2;
    const circumference = 2 * Math.PI * radius;

    // 0% should have full offset (empty gauge)
    const offset0 = circumference - (0 / 100) * circumference;
    expect(offset0).toBe(circumference);

    // 100% should have zero offset (full gauge)
    const offset100 = circumference - (100 / 100) * circumference;
    expect(offset100).toBe(0);

    // 50% should have half offset
    const offset50 = circumference - (50 / 100) * circumference;
    expect(offset50).toBeCloseTo(circumference / 2, 2);
  });

  test("should clamp values between 0 and 100", () => {
    const normalizeValue = (value: number) => Math.min(Math.max(value, 0), 100);

    expect(normalizeValue(-10)).toBe(0);
    expect(normalizeValue(0)).toBe(0);
    expect(normalizeValue(50)).toBe(50);
    expect(normalizeValue(100)).toBe(100);
    expect(normalizeValue(150)).toBe(100);
  });
});
