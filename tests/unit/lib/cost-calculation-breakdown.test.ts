import { describe, expect, test } from "vitest";
import { calculateRequestCostBreakdown, type CostBreakdown } from "@/lib/utils/cost-calculation";
import type { ModelPriceData } from "@/types/model-price";

function makePriceData(overrides: Partial<ModelPriceData> = {}): ModelPriceData {
  return {
    input_cost_per_token: 0.000003, // $3/MTok
    output_cost_per_token: 0.000015, // $15/MTok
    cache_creation_input_token_cost: 0.00000375, // 1.25x input
    cache_read_input_token_cost: 0.0000003, // 0.1x input
    ...overrides,
  };
}

describe("calculateRequestCostBreakdown", () => {
  test("basic input + output tokens", () => {
    const result = calculateRequestCostBreakdown(
      { input_tokens: 1000, output_tokens: 500 },
      makePriceData()
    );

    expect(result.input).toBeCloseTo(0.003, 6); // 1000 * 0.000003
    expect(result.output).toBeCloseTo(0.0075, 6); // 500 * 0.000015
    expect(result.cache_creation).toBe(0);
    expect(result.cache_read).toBe(0);
    expect(result.total).toBeCloseTo(0.0105, 6);
  });

  test("cache creation (5m + 1h) + cache read", () => {
    const result = calculateRequestCostBreakdown(
      {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_5m_input_tokens: 200,
        cache_creation_1h_input_tokens: 300,
        cache_read_input_tokens: 1000,
      },
      makePriceData({
        cache_creation_input_token_cost_above_1hr: 0.000006, // 2x input
      })
    );

    // cache_creation = 200 * 0.00000375 + 300 * 0.000006
    expect(result.cache_creation).toBeCloseTo(0.00255, 6);
    // cache_read = 1000 * 0.0000003
    expect(result.cache_read).toBeCloseTo(0.0003, 6);
    expect(result.total).toBeCloseTo(
      result.input + result.output + result.cache_creation + result.cache_read,
      10
    );
  });

  test("image tokens go to input/output buckets", () => {
    const result = calculateRequestCostBreakdown(
      {
        input_tokens: 100,
        output_tokens: 50,
        input_image_tokens: 500,
        output_image_tokens: 200,
      },
      makePriceData({
        input_cost_per_image_token: 0.00001,
        output_cost_per_image_token: 0.00005,
      })
    );

    // input = 100 * 0.000003 + 500 * 0.00001
    expect(result.input).toBeCloseTo(0.0053, 6);
    // output = 50 * 0.000015 + 200 * 0.00005
    expect(result.output).toBeCloseTo(0.01075, 6);
  });

  test("tiered pricing with context1mApplied", () => {
    const result = calculateRequestCostBreakdown(
      {
        input_tokens: 300000, // crosses 200k threshold
        output_tokens: 100,
      },
      makePriceData(),
      true // context1mApplied
    );

    // input: 200000 * 0.000003 + 100000 * 0.000003 * 2.0 = 0.6 + 0.6 = 1.2
    expect(result.input).toBeCloseTo(1.2, 4);
    // output: 100 tokens, below 200k threshold
    expect(result.output).toBeCloseTo(0.0015, 6);
  });

  test("200k tier pricing (Gemini style)", () => {
    const result = calculateRequestCostBreakdown(
      {
        input_tokens: 300000, // crosses 200k threshold
        output_tokens: 100,
      },
      makePriceData({
        input_cost_per_token_above_200k_tokens: 0.000006, // 2x base for >200k
      })
    );

    // input: 200000 * 0.000003 + 100000 * 0.000006 = 0.6 + 0.6 = 1.2
    expect(result.input).toBeCloseTo(1.2, 4);
  });

  test("categories sum to total", () => {
    const result = calculateRequestCostBreakdown(
      {
        input_tokens: 5000,
        output_tokens: 2000,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 3000,
      },
      makePriceData()
    );

    const sum = result.input + result.output + result.cache_creation + result.cache_read;
    expect(result.total).toBeCloseTo(sum, 10);
  });

  test("zero usage returns all zeros", () => {
    const result = calculateRequestCostBreakdown({}, makePriceData());

    expect(result).toEqual({
      input: 0,
      output: 0,
      cache_creation: 0,
      cache_read: 0,
      total: 0,
    });
  });

  test("per-request cost goes to input bucket", () => {
    const result = calculateRequestCostBreakdown(
      { input_tokens: 0 },
      makePriceData({ input_cost_per_request: 0.01 })
    );

    expect(result.input).toBeCloseTo(0.01, 6);
    expect(result.total).toBeCloseTo(0.01, 6);
  });

  test("cache_creation_input_tokens distributed by cache_ttl", () => {
    // When only cache_creation_input_tokens is set (no 5m/1h split),
    // it should be assigned based on cache_ttl
    const result = calculateRequestCostBreakdown(
      {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1000,
        cache_ttl: "1h",
      },
      makePriceData({
        cache_creation_input_token_cost_above_1hr: 0.000006,
      })
    );

    // 1000 tokens should go to 1h tier at 0.000006
    expect(result.cache_creation).toBeCloseTo(0.006, 6);
  });
});
