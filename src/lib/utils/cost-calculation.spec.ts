import { describe, it, expect } from "vitest";
import { calculateRequestCost } from "./cost-calculation";
import type { ModelPriceData } from "@/types/model-price";

const basePrice: ModelPriceData = {
  model_key: "claude-3",
  model_name: "claude-3",
  effective_at: new Date("2024-01-01T00:00:00Z"),
  provider: "anthropic",
  mode: "chat",
  input_cost_per_token: 0.0000015,
  output_cost_per_token: 0.000002,
  cache_creation_input_token_cost: 0.0000004,
  cache_read_input_token_cost: 0.0000002,
  currency: "USD",
  context_window: 200000,
  input_cache_window: 100000,
  output_cache_window: 100000,
  note: null,
  created_at: new Date("2024-01-01T00:00:00Z"),
};

describe("calculateRequestCost", () => {
  it("returns zero cost when usage is empty", () => {
    const cost = calculateRequestCost({}, basePrice);
    expect(cost.toNumber()).toBe(0);
  });

  it("calculates total cost based on input and output tokens", () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 250,
      cache_read_input_tokens: 100,
    };

    const cost = calculateRequestCost(usage, basePrice);

    const expected =
      1000 * basePrice.input_cost_per_token! +
      500 * basePrice.output_cost_per_token! +
      250 * basePrice.cache_creation_input_token_cost! +
      100 * basePrice.cache_read_input_token_cost!;

    expect(cost.toNumber()).toBeCloseTo(expected, 10);
  });

  it("applies cost multiplier", () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
    };

    const cost = calculateRequestCost(usage, basePrice, 1.5);

    const expected =
      (1000 * basePrice.input_cost_per_token! + 500 * basePrice.output_cost_per_token!) * 1.5;

    expect(cost.toNumber()).toBeCloseTo(expected, 10);
  });
});
