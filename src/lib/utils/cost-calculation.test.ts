/**
 * Unit tests for cost-calculation.ts
 *
 * Test coverage:
 * - Claude format cost calculation (input/output/cache tokens)
 * - OpenAI format cost calculation (prompt/completion tokens)
 * - Cost multiplier application
 * - Cache token cost fallback (10% of base cost)
 * - Edge cases (zero tokens, null prices, undefined values)
 * - Calculation precision (15 decimal places)
 */

import { describe, it, expect } from "vitest";
import { calculateRequestCost } from "./cost-calculation";
import type { ModelPriceData } from "@/types/model-price";
import { Decimal } from "./currency";

describe("calculateRequestCost", () => {
  describe("Claude Format - Basic Token Costs", () => {
    const priceData: ModelPriceData = {
      input_cost_per_token: 0.000003, // $3 per 1M tokens
      output_cost_per_token: 0.000015, // $15 per 1M tokens
    };

    it("should calculate cost with only input tokens", () => {
      const usage = { input_tokens: 1000 };
      const cost = calculateRequestCost(usage, priceData);

      expect(cost.toNumber()).toBe(0.003);
      expect(cost.toFixed(15)).toBe("0.003000000000000");
    });

    it("should calculate cost with only output tokens", () => {
      const usage = { output_tokens: 500 };
      const cost = calculateRequestCost(usage, priceData);

      expect(cost.toNumber()).toBe(0.0075);
      expect(cost.toFixed(15)).toBe("0.007500000000000");
    });

    it("should calculate cost with both input and output tokens", () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
      };
      const cost = calculateRequestCost(usage, priceData);

      // 1000 * 0.000003 + 500 * 0.000015 = 0.003 + 0.0075 = 0.0105
      expect(cost.toNumber()).toBe(0.0105);
      expect(cost.toFixed(15)).toBe("0.010500000000000");
    });

    it("should handle large token counts accurately", () => {
      const usage = {
        input_tokens: 1000000, // 1M tokens
        output_tokens: 500000, // 500K tokens
      };
      const cost = calculateRequestCost(usage, priceData);

      // 1000000 * 0.000003 + 500000 * 0.000015 = 3 + 7.5 = 10.5
      expect(cost.toNumber()).toBe(10.5);
    });
  });

  describe("Cache Token Costs - Explicit Pricing", () => {
    const priceData: ModelPriceData = {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
      cache_creation_input_token_cost: 0.000003, // Explicit cache creation cost
      cache_read_input_token_cost: 0.0000003, // Explicit cache read cost (90% discount)
    };

    it("should use explicit cache_creation_input_token_cost", () => {
      const usage = {
        input_tokens: 1000,
        cache_creation_input_tokens: 5000,
      };
      const cost = calculateRequestCost(usage, priceData);

      // 1000 * 0.000003 + 5000 * 0.000003 = 0.003 + 0.015 = 0.018
      expect(cost.toNumber()).toBe(0.018);
    });

    it("should use explicit cache_read_input_token_cost", () => {
      const usage = {
        input_tokens: 1000,
        cache_read_input_tokens: 10000,
      };
      const cost = calculateRequestCost(usage, priceData);

      // 1000 * 0.000003 + 10000 * 0.0000003 = 0.003 + 0.003 = 0.006
      expect(cost.toNumber()).toBe(0.006);
    });

    it("should calculate all token types together", () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 5000,
      };
      const cost = calculateRequestCost(usage, priceData);

      // 1000 * 0.000003 + 500 * 0.000015 + 2000 * 0.000003 + 5000 * 0.0000003
      // = 0.003 + 0.0075 + 0.006 + 0.0015 = 0.018
      expect(cost.toNumber()).toBe(0.018);
    });
  });

  describe("Cache Token Costs - Fallback (10% of base cost)", () => {
    const priceData: ModelPriceData = {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
      // No explicit cache costs - should fallback to 10% of base
    };

    it("should fallback to 10% of input cost for cache_creation", () => {
      const usage = {
        cache_creation_input_tokens: 1000,
      };
      const cost = calculateRequestCost(usage, priceData);

      // 1000 * (0.000003 * 0.1) = 1000 * 0.0000003 = 0.0003
      expect(cost.toNumber()).toBe(0.0003);
    });

    it("should fallback to 10% of output cost for cache_read", () => {
      const usage = {
        cache_read_input_tokens: 1000,
      };
      const cost = calculateRequestCost(usage, priceData);

      // 1000 * (0.000015 * 0.1) = 1000 * 0.0000015 = 0.0015
      expect(cost.toNumber()).toBe(0.0015);
    });

    it("should mix explicit and fallback cache costs", () => {
      const priceDataMixed: ModelPriceData = {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
        cache_creation_input_token_cost: 0.000004, // Explicit
        // cache_read_input_token_cost undefined - will fallback
      };

      const usage = {
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 1000,
      };
      const cost = calculateRequestCost(usage, priceDataMixed);

      // 1000 * 0.000004 + 1000 * (0.000015 * 0.1)
      // = 0.004 + 0.0015 = 0.0055
      expect(cost.toNumber()).toBe(0.0055);
    });
  });

  describe("Cost Multiplier Application", () => {
    const priceData: ModelPriceData = {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    };

    it("should apply multiplier of 1.0 (default, no change)", () => {
      const usage = { input_tokens: 1000 };
      const cost = calculateRequestCost(usage, priceData, 1.0);

      expect(cost.toNumber()).toBe(0.003);
    });

    it("should apply multiplier of 1.5 (50% markup)", () => {
      const usage = { input_tokens: 1000 };
      const cost = calculateRequestCost(usage, priceData, 1.5);

      // 0.003 * 1.5 = 0.0045
      expect(cost.toNumber()).toBe(0.0045);
    });

    it("should apply multiplier of 2.0 (double the cost)", () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
      };
      const cost = calculateRequestCost(usage, priceData, 2.0);

      // (0.003 + 0.0075) * 2.0 = 0.0105 * 2.0 = 0.021
      expect(cost.toNumber()).toBe(0.021);
    });

    it("should apply multiplier of 0.5 (50% discount)", () => {
      const usage = { input_tokens: 1000 };
      const cost = calculateRequestCost(usage, priceData, 0.5);

      // 0.003 * 0.5 = 0.0015
      expect(cost.toNumber()).toBe(0.0015);
    });

    it("should apply multiplier to all token types", () => {
      const priceDataWithCache: ModelPriceData = {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
        cache_creation_input_token_cost: 0.000003,
        cache_read_input_token_cost: 0.0000003,
      };

      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 5000,
      };
      const cost = calculateRequestCost(usage, priceDataWithCache, 1.2);

      // Base: 0.003 + 0.0075 + 0.006 + 0.0015 = 0.018
      // With multiplier: 0.018 * 1.2 = 0.0216
      expect(cost.toNumber()).toBe(0.0216);
    });
  });

  describe("Edge Cases - Zero Tokens", () => {
    const priceData: ModelPriceData = {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    };

    it("should return zero cost when no tokens used", () => {
      const usage = {};
      const cost = calculateRequestCost(usage, priceData);

      expect(cost.toNumber()).toBe(0);
      expect(cost.toFixed(15)).toBe("0.000000000000000");
    });

    it("should return zero cost when all tokens are zero", () => {
      const usage = {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      const cost = calculateRequestCost(usage, priceData);

      expect(cost.toNumber()).toBe(0);
    });

    it("should handle mix of zero and non-zero tokens", () => {
      const usage = {
        input_tokens: 0,
        output_tokens: 500,
        cache_creation_input_tokens: 0,
      };
      const cost = calculateRequestCost(usage, priceData);

      expect(cost.toNumber()).toBe(0.0075);
    });
  });

  describe("Edge Cases - Null and Undefined Prices", () => {
    it("should return zero cost when price data is empty", () => {
      const priceData: ModelPriceData = {};
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
      };
      const cost = calculateRequestCost(usage, priceData);

      expect(cost.toNumber()).toBe(0);
    });

    it("should handle null input_cost_per_token", () => {
      const priceData: ModelPriceData = {
        input_cost_per_token: undefined,
        output_cost_per_token: 0.000015,
      };
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
      };
      const cost = calculateRequestCost(usage, priceData);

      // Only output cost: 500 * 0.000015 = 0.0075
      expect(cost.toNumber()).toBe(0.0075);
    });

    it("should handle null output_cost_per_token", () => {
      const priceData: ModelPriceData = {
        input_cost_per_token: 0.000003,
        output_cost_per_token: undefined,
      };
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
      };
      const cost = calculateRequestCost(usage, priceData);

      // Only input cost: 1000 * 0.000003 = 0.003
      expect(cost.toNumber()).toBe(0.003);
    });

    it("should handle all null prices", () => {
      const priceData: ModelPriceData = {
        input_cost_per_token: undefined,
        output_cost_per_token: undefined,
        cache_creation_input_token_cost: undefined,
        cache_read_input_token_cost: undefined,
      };
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 5000,
      };
      const cost = calculateRequestCost(usage, priceData);

      expect(cost.toNumber()).toBe(0);
    });

    it("should not fallback cache costs when base price is null", () => {
      const priceData: ModelPriceData = {
        input_cost_per_token: undefined, // null base cost
        output_cost_per_token: undefined, // null base cost
      };
      const usage = {
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 1000,
      };
      const cost = calculateRequestCost(usage, priceData);

      // No base cost means no fallback, should be zero
      expect(cost.toNumber()).toBe(0);
    });
  });

  describe("Edge Cases - Undefined Token Counts", () => {
    const priceData: ModelPriceData = {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    };

    it("should handle undefined input_tokens", () => {
      const usage = {
        input_tokens: undefined,
        output_tokens: 500,
      };
      const cost = calculateRequestCost(usage, priceData);

      expect(cost.toNumber()).toBe(0.0075);
    });

    it("should handle undefined output_tokens", () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: undefined,
      };
      const cost = calculateRequestCost(usage, priceData);

      expect(cost.toNumber()).toBe(0.003);
    });

    it("should handle all undefined token counts", () => {
      const usage = {
        input_tokens: undefined,
        output_tokens: undefined,
        cache_creation_input_tokens: undefined,
        cache_read_input_tokens: undefined,
      };
      const cost = calculateRequestCost(usage, priceData);

      expect(cost.toNumber()).toBe(0);
    });
  });

  describe("Precision and Decimal Handling", () => {
    const priceData: ModelPriceData = {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    };

    it("should maintain 15 decimal places precision in result", () => {
      const usage = { input_tokens: 1 };
      const cost = calculateRequestCost(usage, priceData);

      // 1 * 0.000003 = 0.000003
      // toFixed(15) ensures 15 decimal places are preserved
      expect(cost.toFixed(15)).toBe("0.000003000000000");
      expect(cost.toFixed(15)).toHaveLength(17); // "0." + 15 digits
    });

    it("should handle very small costs accurately", () => {
      const usage = { input_tokens: 1 };
      const cost = calculateRequestCost(usage, priceData);

      expect(cost.toNumber()).toBe(0.000003);
      expect(cost.toFixed(15)).toBe("0.000003000000000");
    });

    it("should handle very large costs accurately", () => {
      const usage = {
        input_tokens: 100000000, // 100M tokens
        output_tokens: 50000000, // 50M tokens
      };
      const cost = calculateRequestCost(usage, priceData);

      // 100000000 * 0.000003 + 50000000 * 0.000015 = 300 + 750 = 1050
      expect(cost.toNumber()).toBe(1050);
      expect(cost.toFixed(15)).toBe("1050.000000000000000");
    });

    it("should return Decimal instance", () => {
      const usage = { input_tokens: 1000 };
      const cost = calculateRequestCost(usage, priceData);

      expect(cost).toBeInstanceOf(Decimal);
    });

    it("should handle fractional token counts (edge case)", () => {
      // Note: In practice, tokens are integers, but the function should handle decimals
      const usage = {
        input_tokens: 1000.5,
        output_tokens: 500.25,
      };
      const cost = calculateRequestCost(usage, priceData);

      // 1000.5 * 0.000003 + 500.25 * 0.000015 = 0.0030015 + 0.00750375 = 0.01050525
      expect(cost.toNumber()).toBeCloseTo(0.01050525, 14);
    });
  });

  describe("Real-World Scenarios", () => {
    it("should calculate cost for Claude Sonnet 4.5 typical request", () => {
      const priceData: ModelPriceData = {
        input_cost_per_token: 0.000003, // $3 per 1M tokens
        output_cost_per_token: 0.000015, // $15 per 1M tokens
        cache_creation_input_token_cost: 0.00000375, // $3.75 per 1M tokens
        cache_read_input_token_cost: 0.0000003, // $0.30 per 1M tokens
      };

      const usage = {
        input_tokens: 5000,
        output_tokens: 2000,
        cache_creation_input_tokens: 10000,
        cache_read_input_tokens: 50000,
      };

      const cost = calculateRequestCost(usage, priceData);

      // 5000 * 0.000003 + 2000 * 0.000015 + 10000 * 0.00000375 + 50000 * 0.0000003
      // = 0.015 + 0.03 + 0.0375 + 0.015 = 0.0975
      expect(cost.toNumber()).toBe(0.0975);
    });

    it("should calculate cost with 1.2x cost multiplier (typical markup)", () => {
      const priceData: ModelPriceData = {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      };

      const usage = {
        input_tokens: 10000,
        output_tokens: 5000,
      };

      const cost = calculateRequestCost(usage, priceData, 1.2);

      // (10000 * 0.000003 + 5000 * 0.000015) * 1.2
      // = (0.03 + 0.075) * 1.2 = 0.105 * 1.2 = 0.126
      expect(cost.toNumber()).toBe(0.126);
    });

    it("should handle zero cost with multiplier", () => {
      const priceData: ModelPriceData = {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      };

      const usage = { input_tokens: 0 };
      const cost = calculateRequestCost(usage, priceData, 2.0);

      expect(cost.toNumber()).toBe(0);
    });
  });

  describe("OpenAI Format Compatibility", () => {
    // Note: The function accepts generic UsageMetrics with optional fields
    // OpenAI format uses prompt_tokens/completion_tokens, but those would need
    // to be mapped to input_tokens/output_tokens before calling this function

    it("should work with renamed OpenAI fields", () => {
      const priceData: ModelPriceData = {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      };

      // Simulating pre-mapped OpenAI format
      const usage = {
        input_tokens: 1000, // mapped from prompt_tokens
        output_tokens: 500, // mapped from completion_tokens
      };

      const cost = calculateRequestCost(usage, priceData);

      expect(cost.toNumber()).toBe(0.0105);
    });
  });

  describe("Negative Values (Invalid Input)", () => {
    const priceData: ModelPriceData = {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    };

    it("should handle negative token counts (result depends on implementation)", () => {
      const usage = {
        input_tokens: -1000,
        output_tokens: 500,
      };
      const cost = calculateRequestCost(usage, priceData);

      // -1000 * 0.000003 + 500 * 0.000015 = -0.003 + 0.0075 = 0.0045
      // Note: Function doesn't validate negative inputs, calculates mathematically
      expect(cost.toNumber()).toBe(0.0045);
    });

    it("should handle negative prices (result depends on implementation)", () => {
      const priceDataNegative: ModelPriceData = {
        input_cost_per_token: -0.000003,
        output_cost_per_token: 0.000015,
      };
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
      };
      const cost = calculateRequestCost(usage, priceDataNegative);

      // 1000 * (-0.000003) + 500 * 0.000015 = -0.003 + 0.0075 = 0.0045
      expect(cost.toNumber()).toBe(0.0045);
    });
  });
});
