import { describe, expect, test } from "vitest";
import { calculateRequestCost } from "@/lib/utils/cost-calculation";

describe("calculateRequestCost long-context", () => {
  test("uses long-context output pricing when total input context exceeds threshold", () => {
    const cost = calculateRequestCost(
      {
        input_tokens: 250000,
        output_tokens: 100000,
      },
      {
        mode: "chat",
        model_family: "claude-sonnet",
        input_cost_per_token: 0.000003,
        input_cost_per_token_above_200k_tokens: 0.000006,
        output_cost_per_token: 0.000015,
        output_cost_per_token_above_200k_tokens: 0.0000225,
      },
      1,
      false
    );

    expect(Number(cost.toString())).toBe(3.75);
  });

  test("does not charge 1h cache long-context price when base cache creation price is missing", () => {
    const cost = calculateRequestCost(
      {
        input_tokens: 250000,
        cache_creation_1h_input_tokens: 1000,
      },
      {
        mode: "chat",
        model_family: "gpt",
        input_cost_per_token: 0.0000025,
        output_cost_per_token: 0.000015,
        cache_creation_input_token_cost_above_1hr_above_272k_tokens: 0.5,
      },
      1,
      false,
      false
    );

    expect(Number(cost.toString())).toBe(0.63);
  });

  test("context1mApplied alone does not trigger legacy anthropic premium without explicit long-context price fields", () => {
    const cost = calculateRequestCost(
      {
        input_tokens: 250001,
        output_tokens: 100,
      },
      {
        mode: "chat",
        model_family: "claude-sonnet",
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      },
      1,
      true
    );

    expect(Number(cost.toString())).toBeCloseTo(0.751503, 9);
  });
});
