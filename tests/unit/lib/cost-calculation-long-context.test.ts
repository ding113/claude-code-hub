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
});
