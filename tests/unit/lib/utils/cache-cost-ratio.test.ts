import { describe, expect, test } from "vitest";
import { formatCacheCostRatio, resolveCacheCostRatios } from "@/lib/utils/cache-cost-ratio";
import type { StoredCostBreakdown } from "@/types/cost-breakdown";

function breakdown(overrides: Partial<StoredCostBreakdown>): StoredCostBreakdown {
  return {
    input: "0",
    output: "0",
    cache_creation: "0",
    cache_read: "0",
    base_total: "0",
    provider_multiplier: 1,
    group_multiplier: 1,
    total: "0",
    ...overrides,
  };
}

describe("resolveCacheCostRatios", () => {
  test("derives xAI cache read ratio (0.25x) from stored costs", () => {
    // Real grok-4.7 row: $2/M input, $0.5/M cache read
    const ratios = resolveCacheCostRatios({
      costBreakdown: breakdown({ input: "0.002488", cache_read: "0.04128" }),
      inputTokens: 1244,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 82560,
    });
    expect(formatCacheCostRatio(ratios.cacheRead)).toBe("0.25x");
    expect(ratios.cacheWrite5m).toBeNull();
    expect(ratios.cacheWrite1h).toBeNull();
  });

  test("derives Anthropic ratios from per-TTL cache creation costs", () => {
    const ratios = resolveCacheCostRatios({
      costBreakdown: breakdown({
        input: "0.003",
        cache_creation: "0.01125",
        cache_creation_5m: "0.00375",
        cache_creation_1h: "0.0075",
        cache_read: "0.0003",
      }),
      inputTokens: 1000,
      cacheWrite5mTokens: 1000,
      cacheWrite1hTokens: 1250,
      cacheReadTokens: 1000,
    });
    expect(formatCacheCostRatio(ratios.cacheWrite5m)).toBe("1.25x");
    expect(formatCacheCostRatio(ratios.cacheWrite1h)).toBe("2x");
    expect(formatCacheCostRatio(ratios.cacheRead)).toBe("0.1x");
  });

  test("treats a missing per-TTL field as zero cost when the other one exists", () => {
    const ratios = resolveCacheCostRatios({
      costBreakdown: breakdown({ input: "0.001", cache_creation_5m: "0.00125" }),
      inputTokens: 1000,
      cacheWrite5mTokens: 1000,
      cacheWrite1hTokens: 500,
      cacheReadTokens: 0,
    });
    expect(formatCacheCostRatio(ratios.cacheWrite5m)).toBe("1.25x");
    expect(formatCacheCostRatio(ratios.cacheWrite1h)).toBe("0x");
  });

  test("uses aggregate cache_creation for legacy rows with a single TTL", () => {
    const ratios = resolveCacheCostRatios({
      costBreakdown: breakdown({ input: "0.001", cache_creation: "0.002" }),
      inputTokens: 1000,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 1000,
      cacheReadTokens: 0,
    });
    expect(ratios.cacheWrite5m).toBeNull();
    expect(formatCacheCostRatio(ratios.cacheWrite1h)).toBe("2x");
  });

  test("returns null cache write ratios for legacy rows with mixed TTLs", () => {
    const ratios = resolveCacheCostRatios({
      costBreakdown: breakdown({ input: "0.001", cache_creation: "0.004" }),
      inputTokens: 1000,
      cacheWrite5mTokens: 1000,
      cacheWrite1hTokens: 1000,
      cacheReadTokens: 0,
    });
    expect(ratios.cacheWrite5m).toBeNull();
    expect(ratios.cacheWrite1h).toBeNull();
  });

  test("returns all nulls without a breakdown", () => {
    expect(
      resolveCacheCostRatios({
        costBreakdown: null,
        inputTokens: 1000,
        cacheWrite5mTokens: 100,
        cacheWrite1hTokens: 100,
        cacheReadTokens: 100,
      })
    ).toEqual({ cacheWrite5m: null, cacheWrite1h: null, cacheRead: null });
  });

  test("returns all nulls when the input rate cannot be derived", () => {
    const empty = { cacheWrite5m: null, cacheWrite1h: null, cacheRead: null };
    const base = {
      cacheWrite5mTokens: 100,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 100,
    };
    expect(
      resolveCacheCostRatios({
        ...base,
        costBreakdown: breakdown({ input: "0.001", cache_read: "0.0001" }),
        inputTokens: 0,
      })
    ).toEqual(empty);
    expect(
      resolveCacheCostRatios({
        ...base,
        costBreakdown: breakdown({ input: "0", cache_read: "0.0001" }),
        inputTokens: 1000,
      })
    ).toEqual(empty);
    expect(
      resolveCacheCostRatios({
        ...base,
        costBreakdown: breakdown({ input: "not-a-number", cache_read: "0.0001" }),
        inputTokens: null,
      })
    ).toEqual(empty);
  });

  test("returns null for an unparseable cache read cost", () => {
    const ratios = resolveCacheCostRatios({
      costBreakdown: breakdown({ input: "0.001", cache_read: "-1" }),
      inputTokens: 1000,
      cacheWrite5mTokens: undefined,
      cacheWrite1hTokens: undefined,
      cacheReadTokens: 1000,
    });
    expect(ratios.cacheRead).toBeNull();
  });
});

describe("formatCacheCostRatio", () => {
  test("formats with at most two decimals and trims trailing zeros", () => {
    expect(formatCacheCostRatio(0.25)).toBe("0.25x");
    expect(formatCacheCostRatio(2)).toBe("2x");
    expect(formatCacheCostRatio(0.1000001)).toBe("0.1x");
    expect(formatCacheCostRatio(1 / 3)).toBe("0.33x");
  });

  test("returns null for unknown ratios", () => {
    expect(formatCacheCostRatio(null)).toBeNull();
    expect(formatCacheCostRatio(Number.NaN)).toBeNull();
    expect(formatCacheCostRatio(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
