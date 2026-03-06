import { describe, expect, test } from "vitest";
import { calculateRequestCost } from "@/lib/utils/cost-calculation";
import type { ModelPriceData } from "@/types/model-price";

function makePriceData(overrides: Partial<ModelPriceData> = {}): ModelPriceData {
  return {
    mode: "responses",
    input_cost_per_token: 1,
    output_cost_per_token: 10,
    cache_read_input_token_cost: 0.1,
    input_cost_per_token_priority: 2,
    output_cost_per_token_priority: 20,
    cache_read_input_token_cost_priority: 0.2,
    ...overrides,
  };
}

describe("calculateRequestCost priority service tier", () => {
  test("uses priority pricing fields when priority service tier is applied", () => {
    const cost = calculateRequestCost(
      { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 5 },
      makePriceData(),
      1,
      false,
      true
    );

    expect(Number(cost.toString())).toBe(65);
  });

  test("falls back to regular pricing when priority fields are absent", () => {
    const cost = calculateRequestCost(
      { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 5 },
      makePriceData({
        input_cost_per_token_priority: undefined,
        output_cost_per_token_priority: undefined,
        cache_read_input_token_cost_priority: undefined,
      }),
      1,
      false,
      true
    );

    expect(Number(cost.toString())).toBe(32.5);
  });
});
