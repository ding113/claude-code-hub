import { describe, expect, test } from "vitest";
import { calculateRequestCost, matchLongContextPricing } from "@/lib/utils/cost-calculation";
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
  test("uses service_tier_pricing.priority before legacy priority fields", () => {
    const cost = calculateRequestCost(
      { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 5 },
      makePriceData({
        service_tier_pricing: {
          priority: {
            input_cost_per_token: 3,
            output_cost_per_token: 30,
            cache_read_input_token_cost: 0.3,
          },
        },
      }),
      1,
      false,
      true
    );

    expect(Number(cost.toString())).toBe(97.5);
  });

  test("keeps service_tier_pricing.priority scoped to priority requests", () => {
    const cost = calculateRequestCost(
      { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 5 },
      makePriceData({
        service_tier_pricing: {
          priority: {
            input_cost_per_token: 3,
            output_cost_per_token: 30,
            cache_read_input_token_cost: 0.3,
          },
        },
      }),
      1,
      false,
      false
    );

    expect(Number(cost.toString())).toBe(32.5);
  });

  test("allows different models to define different priority tier prices", () => {
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1 };
    const gpt55Cost = calculateRequestCost(
      usage,
      makePriceData({
        service_tier_pricing: {
          priority: {
            input_cost_per_token: 0.0000125,
            output_cost_per_token: 0.000075,
            cache_read_input_token_cost: 0.00000125,
          },
        },
      }),
      { priorityServiceTierApplied: true }
    );
    const gpt54Cost = calculateRequestCost(
      usage,
      makePriceData({
        service_tier_pricing: {
          priority: {
            input_cost_per_token: 0.000005,
            output_cost_per_token: 0.00003,
            cache_read_input_token_cost: 0.0000005,
          },
        },
      }),
      { priorityServiceTierApplied: true }
    );

    expect(gpt55Cost.toNumber()).toBe(0.00008875);
    expect(gpt54Cost.toNumber()).toBe(0.0000355);
  });

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

  test("uses priority long-context pricing fields when available", () => {
    const cost = calculateRequestCost(
      {
        input_tokens: 272001,
        output_tokens: 2,
        cache_read_input_tokens: 10,
      },
      makePriceData({
        mode: "responses",
        model_family: "gpt",
        input_cost_per_token_above_272k_tokens: 5,
        output_cost_per_token_above_272k_tokens: 50,
        cache_read_input_token_cost_above_272k_tokens: 0.5,
        input_cost_per_token_above_272k_tokens_priority: 7,
        output_cost_per_token_above_272k_tokens_priority: 70,
        cache_read_input_token_cost_above_272k_tokens_priority: 0.7,
      }),
      1,
      false,
      true
    );

    expect(Number(cost.toString())).toBe(1904154);
  });

  test("falls back to regular long-context pricing when priority long-context fields are absent", () => {
    const cost = calculateRequestCost(
      {
        input_tokens: 272001,
        output_tokens: 2,
        cache_read_input_tokens: 10,
      },
      makePriceData({
        mode: "responses",
        model_family: "gpt",
        input_cost_per_token_above_272k_tokens: 5,
        output_cost_per_token_above_272k_tokens: 50,
        cache_read_input_token_cost_above_272k_tokens: 0.5,
        input_cost_per_token_above_272k_tokens_priority: undefined,
        output_cost_per_token_above_272k_tokens_priority: undefined,
        cache_read_input_token_cost_above_272k_tokens_priority: undefined,
      }),
      1,
      false,
      true
    );

    expect(Number(cost.toString())).toBe(1360110);
  });

  test("uses priority long-context fields by schema, not by model name", () => {
    const cost = calculateRequestCost(
      {
        input_tokens: 272001,
        output_tokens: 2,
      },
      makePriceData({
        mode: "responses",
        model_family: undefined,
        input_cost_per_token_above_272k_tokens: undefined,
        output_cost_per_token_above_272k_tokens: undefined,
        input_cost_per_token_above_272k_tokens_priority: 7,
        output_cost_per_token_above_272k_tokens_priority: 70,
      }),
      1,
      false,
      true
    );

    expect(Number(cost.toString())).toBe(1904147);
  });

  test("uses service_tier_pricing.priority long_context_pricing when matched", () => {
    const usage = {
      input_tokens: 101,
      output_tokens: 2,
    };
    const priceData = makePriceData({
      service_tier_pricing: {
        priority: {
          input_cost_per_token: 4,
          output_cost_per_token: 40,
          long_context_pricing: {
            threshold_tokens: 100,
            input_multiplier: 2,
            output_multiplier: 2,
          },
        },
      },
    });
    const match = matchLongContextPricing(usage, priceData, "priority");
    const cost = calculateRequestCost(usage, priceData, {
      priorityServiceTierApplied: true,
      longContextPricing: match?.pricing ?? null,
    });

    expect(match).not.toBeNull();
    expect(Number(cost.toString())).toBe(968);
  });
});
