import { describe, expect, test } from "vitest";
import { calculateRequestCostBreakdown } from "@/lib/utils/cost-calculation";
import type { ModelPriceData } from "@/types/model-price";

function makePriceData(overrides: Partial<ModelPriceData> = {}): ModelPriceData {
  return {
    input_cost_per_token: 0.000003, // $3/MTok
    output_cost_per_token: 0.000015, // $15/MTok
    cache_creation_input_token_cost: 0.00000375, // 1.25x input (5m rate)
    cache_read_input_token_cost: 0.0000003, // 0.1x input
    cache_creation_input_token_cost_above_1hr: 0.000006, // 2x input (1h rate)
    ...overrides,
  };
}

describe("swap cache TTL billing", () => {
  // Simulates the swap logic from response-handler.ts:
  // When provider.swapCacheTtlBilling is true, bucket values AND cache_ttl
  // are swapped at data entry so all downstream sees inverted values.
  function applySwap(
    usage: {
      cache_creation_5m_input_tokens?: number;
      cache_creation_1h_input_tokens?: number;
      cache_ttl?: "5m" | "1h";
    },
    swap: boolean
  ) {
    if (!swap) {
      return {
        cache_creation_5m_input_tokens: usage.cache_creation_5m_input_tokens,
        cache_creation_1h_input_tokens: usage.cache_creation_1h_input_tokens,
        cache_ttl: usage.cache_ttl,
      };
    }
    let swappedTtl = usage.cache_ttl;
    if (swappedTtl === "5m") swappedTtl = "1h";
    else if (swappedTtl === "1h") swappedTtl = "5m";
    return {
      cache_creation_5m_input_tokens: usage.cache_creation_1h_input_tokens,
      cache_creation_1h_input_tokens: usage.cache_creation_5m_input_tokens,
      cache_ttl: swappedTtl,
    };
  }

  test("swap=false: normal billing (5m tokens at 5m rate, 1h tokens at 1h rate)", () => {
    const tokens = { cache_creation_5m_input_tokens: 1000, cache_creation_1h_input_tokens: 0 };
    const swapped = applySwap(tokens, false);

    const result = calculateRequestCostBreakdown(
      { input_tokens: 0, output_tokens: 0, ...swapped },
      makePriceData()
    );

    // 1000 * 0.00000375 (5m rate)
    expect(result.cache_creation).toBeCloseTo(0.00375, 6);
  });

  test("swap=true: 1h tokens billed at 5m rate (cheaper)", () => {
    // Provider reports 1h, but actually bills at 5m rate
    const tokens = { cache_creation_5m_input_tokens: 0, cache_creation_1h_input_tokens: 1000 };
    const swapped = applySwap(tokens, true);

    const result = calculateRequestCostBreakdown(
      { input_tokens: 0, output_tokens: 0, ...swapped },
      makePriceData()
    );

    // After swap: 1h tokens (1000) moved to 5m bucket -> 1000 * 0.00000375
    expect(result.cache_creation).toBeCloseTo(0.00375, 6);
  });

  test("swap=true: 5m tokens billed at 1h rate (more expensive)", () => {
    // Provider reports 5m, but actually bills at 1h rate
    const tokens = { cache_creation_5m_input_tokens: 1000, cache_creation_1h_input_tokens: 0 };
    const swapped = applySwap(tokens, true);

    const result = calculateRequestCostBreakdown(
      { input_tokens: 0, output_tokens: 0, ...swapped },
      makePriceData()
    );

    // After swap: 5m tokens (1000) moved to 1h bucket -> 1000 * 0.000006
    expect(result.cache_creation).toBeCloseTo(0.006, 6);
  });

  test("swap inverts both buckets when both have tokens", () => {
    const tokens = { cache_creation_5m_input_tokens: 200, cache_creation_1h_input_tokens: 800 };

    const normalResult = calculateRequestCostBreakdown(
      { input_tokens: 0, output_tokens: 0, ...applySwap(tokens, false) },
      makePriceData()
    );

    const swappedResult = calculateRequestCostBreakdown(
      { input_tokens: 0, output_tokens: 0, ...applySwap(tokens, true) },
      makePriceData()
    );

    // Normal: 200 * 0.00000375 + 800 * 0.000006 = 0.00075 + 0.0048 = 0.00555
    expect(normalResult.cache_creation).toBeCloseTo(0.00555, 6);

    // Swapped: 800 * 0.00000375 + 200 * 0.000006 = 0.003 + 0.0012 = 0.0042
    expect(swappedResult.cache_creation).toBeCloseTo(0.0042, 6);

    // Swapped is cheaper because more tokens went to the cheaper 5m rate
    expect(swappedResult.cache_creation).toBeLessThan(normalResult.cache_creation);
  });

  test("swap exchanges buckets when only one bucket has tokens", () => {
    const tokens5mOnly = { cache_creation_5m_input_tokens: 500, cache_creation_1h_input_tokens: 0 };

    const normal5m = applySwap(tokens5mOnly, false);
    const swapped5m = applySwap(tokens5mOnly, true);

    // Normal: 500 at 5m rate
    expect(normal5m.cache_creation_5m_input_tokens).toBe(500);
    expect(normal5m.cache_creation_1h_input_tokens).toBe(0);

    // Swapped: 500 moved to 1h bucket, 0 moved to 5m bucket
    expect(swapped5m.cache_creation_5m_input_tokens).toBe(0);
    expect(swapped5m.cache_creation_1h_input_tokens).toBe(500);
  });

  test("swap with undefined tokens treats them as undefined (no crash)", () => {
    const tokens = { cache_creation_5m_input_tokens: undefined, cache_creation_1h_input_tokens: 1000 };
    const swapped = applySwap(tokens, true);

    expect(swapped.cache_creation_5m_input_tokens).toBe(1000);
    expect(swapped.cache_creation_1h_input_tokens).toBeUndefined();

    // Should not crash when passed to cost calculation
    const result = calculateRequestCostBreakdown(
      { input_tokens: 0, output_tokens: 0, ...swapped },
      makePriceData()
    );
    // 1000 at 5m rate
    expect(result.cache_creation).toBeCloseTo(0.00375, 6);
  });

  test("swap also inverts cache_ttl value", () => {
    const usage5m = { cache_creation_5m_input_tokens: 100, cache_creation_1h_input_tokens: 0, cache_ttl: "5m" as const };
    const usage1h = { cache_creation_5m_input_tokens: 0, cache_creation_1h_input_tokens: 100, cache_ttl: "1h" as const };

    const swapped5m = applySwap(usage5m, true);
    const swapped1h = applySwap(usage1h, true);

    expect(swapped5m.cache_ttl).toBe("1h");
    expect(swapped1h.cache_ttl).toBe("5m");
  });

  test("swap with only cache_creation_input_tokens (total) and cache_ttl=1h routes total to 5m bucket", () => {
    // Upstream sends total without explicit buckets + cache_ttl: "1h"
    // After swap: cache_ttl becomes "5m", so total should go to 5m bucket (not 1h)
    const usage = { cache_ttl: "1h" as const };
    const swapped = applySwap(usage, true);

    // cache_ttl should be inverted
    expect(swapped.cache_ttl).toBe("5m");

    // Simulate how response-handler resolves buckets after swap:
    // resolvedCacheTtl = "5m" (swapped), cache_creation_input_tokens = 1000 (total)
    const resolvedCacheTtl = swapped.cache_ttl;
    const totalTokens = 1000;
    const cache5m = resolvedCacheTtl === "1h" ? undefined : totalTokens;
    const cache1h = resolvedCacheTtl === "1h" ? totalTokens : undefined;

    // Total should land in 5m bucket (cheaper), not 1h
    expect(cache5m).toBe(1000);
    expect(cache1h).toBeUndefined();

    const result = calculateRequestCostBreakdown(
      { input_tokens: 0, output_tokens: 0, cache_creation_5m_input_tokens: cache5m, cache_creation_1h_input_tokens: cache1h },
      makePriceData()
    );
    // 1000 * 0.00000375 (5m rate)
    expect(result.cache_creation).toBeCloseTo(0.00375, 6);
  });
});
