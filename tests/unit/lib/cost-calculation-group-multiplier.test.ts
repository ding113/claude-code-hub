import { describe, expect, test } from "vitest";
import { calculateRequestCost, calculateRequestCostBreakdown } from "@/lib/utils/cost-calculation";
import type { ModelPriceData } from "@/types/model-price";

function makeSimplePriceData(
  inputCostPerToken: number,
  outputCostPerToken: number
): ModelPriceData {
  return {
    input_cost_per_token: inputCostPerToken,
    output_cost_per_token: outputCostPerToken,
  } as ModelPriceData;
}

describe("cost-calculation group multiplier", () => {
  const priceData = makeSimplePriceData(0.000003, 0.000015);
  const usage = { input_tokens: 1000, output_tokens: 500 };

  test("groupMultiplier=1 produces same result as without groupMultiplier", () => {
    const withoutGroup = calculateRequestCost(usage, priceData, {
      multiplier: 1.0,
    });
    const withGroup = calculateRequestCost(usage, priceData, {
      multiplier: 1.0,
      groupMultiplier: 1.0,
    });

    expect(withGroup.toNumber()).toBe(withoutGroup.toNumber());
  });

  test("compound multiplier: providerMultiplier=1.5, groupMultiplier=2.0 => baseCost * 3.0", () => {
    const baseCost = calculateRequestCost(usage, priceData, {
      multiplier: 1.0,
    });
    const compoundCost = calculateRequestCost(usage, priceData, {
      multiplier: 1.5,
      groupMultiplier: 2.0,
    });

    // 1.5 * 2.0 = 3.0
    expect(compoundCost.toNumber()).toBeCloseTo(baseCost.toNumber() * 3.0, 10);
  });

  test("groupMultiplier=undefined defaults to 1.0", () => {
    const withDefault = calculateRequestCost(usage, priceData, {
      multiplier: 2.0,
    });
    const withExplicit = calculateRequestCost(usage, priceData, {
      multiplier: 2.0,
      groupMultiplier: 1.0,
    });

    expect(withDefault.toNumber()).toBe(withExplicit.toNumber());
  });

  test("groupMultiplier applies independently from provider multiplier", () => {
    const baseCost = calculateRequestCost(usage, priceData, {
      multiplier: 1.0,
    });
    const groupOnly = calculateRequestCost(usage, priceData, {
      multiplier: 1.0,
      groupMultiplier: 2.0,
    });

    expect(groupOnly.toNumber()).toBeCloseTo(baseCost.toNumber() * 2.0, 10);
  });

  test("breakdown does not include multipliers (always raw)", () => {
    const breakdown = calculateRequestCostBreakdown(usage, priceData);

    // input: 1000 * 0.000003 = 0.003
    expect(breakdown.input).toBeCloseTo(0.003, 6);
    // output: 500 * 0.000015 = 0.0075
    expect(breakdown.output).toBeCloseTo(0.0075, 6);
    expect(breakdown.total).toBeCloseTo(0.0105, 6);

    // Verify breakdown equals the base cost (multiplier=1, no group multiplier)
    const baseCost = calculateRequestCost(usage, priceData, {
      multiplier: 1.0,
    });
    expect(breakdown.total).toBeCloseTo(baseCost.toNumber(), 10);
  });

  test("groupMultiplier=NaN falls back to 1.0", () => {
    const baseCost = calculateRequestCost(usage, priceData, {
      multiplier: 1.0,
    });
    const withNan = calculateRequestCost(usage, priceData, {
      multiplier: 1.0,
      groupMultiplier: Number.NaN,
    });

    expect(withNan.toNumber()).toBe(baseCost.toNumber());
  });

  test("groupMultiplier=Infinity falls back to 1.0", () => {
    const baseCost = calculateRequestCost(usage, priceData, {
      multiplier: 1.0,
    });
    const withInfinity = calculateRequestCost(usage, priceData, {
      multiplier: 1.0,
      groupMultiplier: Number.POSITIVE_INFINITY,
    });

    expect(withInfinity.toNumber()).toBe(baseCost.toNumber());
  });

  test("groupMultiplier=negative falls back to 1.0", () => {
    const baseCost = calculateRequestCost(usage, priceData, {
      multiplier: 1.0,
    });
    const withNegative = calculateRequestCost(usage, priceData, {
      multiplier: 1.0,
      groupMultiplier: -0.5,
    });

    expect(withNegative.toNumber()).toBe(baseCost.toNumber());
  });

  test("provider multiplier sanitizes NaN/Infinity/negative too", () => {
    const baseCost = calculateRequestCost(usage, priceData, {
      multiplier: 1.0,
    });
    const withBadProvider = calculateRequestCost(usage, priceData, {
      multiplier: Number.NaN,
      groupMultiplier: 2.0,
    });

    // NaN multiplier falls back to 1.0, so result is baseCost * 2.0
    expect(withBadProvider.toNumber()).toBeCloseTo(baseCost.toNumber() * 2.0, 10);
  });

  test("breakdown splits cache_creation into 5m and 1h buckets", () => {
    const priceDataWithCache = {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
      cache_creation_input_token_cost: 0.00000375, // 1.25x input
      cache_creation_input_token_cost_above_1hr: 0.000006, // 2x input
    } as ModelPriceData;

    const cacheUsage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_5m_input_tokens: 1000,
      cache_creation_1h_input_tokens: 500,
    };

    const breakdown = calculateRequestCostBreakdown(cacheUsage, priceDataWithCache);

    // 5m: 1000 * 0.00000375 = 0.00375
    expect(breakdown.cache_creation_5m).toBeCloseTo(0.00375, 8);
    // 1h: 500 * 0.000006 = 0.003
    expect(breakdown.cache_creation_1h).toBeCloseTo(0.003, 8);
    // Aggregate is sum of the two
    expect(breakdown.cache_creation).toBeCloseTo(
      breakdown.cache_creation_5m + breakdown.cache_creation_1h,
      10
    );
  });

  test("mixed TTL breakdown: 5m and 1h are distinct (no double counting)", () => {
    const priceDataWithCache = {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
      cache_creation_input_token_cost: 0.00000375,
      cache_creation_input_token_cost_above_1hr: 0.000006,
    } as ModelPriceData;

    const mixedUsage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_5m_input_tokens: 2000,
      cache_creation_1h_input_tokens: 1000,
      cache_ttl: "mixed" as const,
    };

    const breakdown = calculateRequestCostBreakdown(mixedUsage, priceDataWithCache);

    expect(breakdown.cache_creation_5m).toBeGreaterThan(0);
    expect(breakdown.cache_creation_1h).toBeGreaterThan(0);
    expect(breakdown.cache_creation_5m).not.toBe(breakdown.cache_creation_1h);
    // Aggregate cache_creation equals sum of both
    expect(breakdown.cache_creation).toBeCloseTo(
      breakdown.cache_creation_5m + breakdown.cache_creation_1h,
      10
    );
  });
});
