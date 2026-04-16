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
});
