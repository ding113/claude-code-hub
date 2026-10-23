import { describe, expect, test } from "vitest";
import { convertCptModelEntry } from "@/lib/price-sync/cpt-convert";
import type { CptModelEntry, CptTrack } from "@/lib/price-sync/cpt-schema";
import {
  calculateRequestCost,
  calculateRequestCostBreakdown,
  calculateRequestCostBreakdownDetail,
  matchLongContextPricing,
} from "@/lib/utils/cost-calculation";
import type { ModelPriceData } from "@/types/model-price";

// 与云端价格表 (cchp.pricing-table/v1, version 11da1efb0c944248) 中 gpt-6.1-sol 官方报价一致的轨道
const OPENAI_GPT6_TRACKS: CptTrack[] = [
  {
    label: "Priority AND Context >272K",
    factor: "1",
    charge_factors: { prompt: "4", completion: "3", cache_read: "4", cache_write: "4" },
    triggers: [
      { kind: "body_matches", field: "service_tier", pattern: "^priority$" },
      { kind: "input_tokens_above", threshold: 272000, inclusive: false },
    ],
  },
  {
    label: "Priority",
    factor: "1",
    charge_factors: { prompt: "2", completion: "2", cache_read: "2", cache_write: "2" },
    triggers: [{ kind: "body_matches", field: "service_tier", pattern: "^priority$" }],
  },
  {
    label: "Context >272K",
    factor: "1",
    charge_factors: { prompt: "2", completion: "1.5", cache_read: "2", cache_write: "2" },
    triggers: [{ kind: "input_tokens_above", threshold: 272000, inclusive: false }],
  },
  { label: "Base pricing", factor: "1", triggers: [] },
];

function cloudGpt6PriceData(prices: {
  prompt: string;
  completion: string;
  cacheRead: string;
  cacheWrite: string;
}): ModelPriceData {
  const entry: CptModelEntry = {
    slug: "openai/gpt-6.1-sol",
    model_name: "gpt-6.1-sol",
    vendor: "openai",
    display_name: "GPT-6.1 Sol",
    pricing: [
      {
        provider: "openai",
        official: true,
        source: "test",
        charges: {
          prompt: { unit: "per_M_tokens", price: prices.prompt },
          completion: { unit: "per_M_tokens", price: prices.completion },
          cache_read: { unit: "per_M_tokens", price: prices.cacheRead },
          cache_write: { unit: "per_M_tokens", price: prices.cacheWrite },
        },
        tracks: OPENAI_GPT6_TRACKS,
      },
    ],
  };
  const converted = convertCptModelEntry(entry, {});
  if (!converted) throw new Error("conversion returned null");
  return converted;
}

const GPT_61_SOL = cloudGpt6PriceData({
  prompt: "2",
  completion: "10",
  cacheRead: "0.1",
  cacheWrite: "2.5",
});
const GPT_6_ASTRA = cloudGpt6PriceData({
  prompt: "10",
  completion: "50",
  cacheRead: "1",
  cacheWrite: "12.5",
});

describe("cloud GPT-6 long-context tier conversion", () => {
  test("stores 2x input/cache and 1.5x output for >272K, including the priority combination", () => {
    expect(GPT_61_SOL.input_cost_per_token_above_272k_tokens).toBe(0.000004);
    expect(GPT_61_SOL.output_cost_per_token_above_272k_tokens).toBe(0.000015);
    expect(GPT_61_SOL.cache_read_input_token_cost_above_272k_tokens).toBe(0.0000002);
    expect(GPT_61_SOL.cache_creation_input_token_cost_above_272k_tokens).toBe(0.000005);
    expect(GPT_61_SOL.input_cost_per_token_above_272k_tokens_priority).toBe(0.000008);
    expect(GPT_61_SOL.output_cost_per_token_above_272k_tokens_priority).toBe(0.00003);
    expect(GPT_61_SOL.cache_read_input_token_cost_above_272k_tokens_priority).toBe(0.0000004);
  });
});

describe("long-context tier applies to the whole request", () => {
  test("exactly 272000 input tokens stays on base pricing", () => {
    const usage = { input_tokens: 272000, output_tokens: 2000 };
    const detail = calculateRequestCostBreakdownDetail(usage, GPT_61_SOL);

    expect(calculateRequestCost(usage, GPT_61_SOL).toString()).toBe("0.564");
    expect(detail.longContextTier).toBeNull();
  });

  test("272001 input tokens bills every token at the tier price, not only the excess", () => {
    const usage = { input_tokens: 272001, output_tokens: 2000 };
    const detail = calculateRequestCostBreakdownDetail(usage, GPT_61_SOL);

    // 272001 x $4/M + 2000 x $15/M；只对超出部分加价则约为 $0.564
    expect(calculateRequestCost(usage, GPT_61_SOL).toString()).toBe("1.118004");
    expect(detail.breakdown.input).toBe(1.088004);
    expect(detail.breakdown.output).toBe(0.03);
    expect(detail.longContextTier).toEqual({
      thresholdTokens: 272000,
      observedInputTokens: 272001,
      inputMultiplier: 2,
      outputMultiplier: 1.5,
      cacheCreationMultiplier: 2,
      cacheCreation1hMultiplier: 1.25,
      cacheReadMultiplier: 2,
    });
  });

  test("cached tokens count toward the threshold even when uncached input is below it", () => {
    // OpenAI usage: input_tokens=400000 含 cached_tokens=300000，CCH 计费前已扣除缓存部分
    const usage = { input_tokens: 100000, cache_read_input_tokens: 300000, output_tokens: 5000 };
    const detail = calculateRequestCostBreakdownDetail(usage, GPT_6_ASTRA);

    expect(calculateRequestCost(usage, GPT_6_ASTRA).toString()).toBe("2.975");
    expect(detail.breakdown).toMatchObject({ input: 2, output: 0.375, cache_read: 0.6 });
    expect(detail.longContextTier?.observedInputTokens).toBe(400000);
    expect(detail.longContextTier?.cacheReadMultiplier).toBe(2);
  });

  test("priority service tier above 272K reports multipliers relative to the priority base", () => {
    const usage = { input_tokens: 300000, output_tokens: 2000 };
    const options = { priorityServiceTierApplied: true };
    const detail = calculateRequestCostBreakdownDetail(usage, GPT_61_SOL, options);

    expect(calculateRequestCost(usage, GPT_61_SOL, options).toString()).toBe("2.46");
    expect(detail.longContextTier).toMatchObject({
      inputMultiplier: 2,
      outputMultiplier: 1.5,
      cacheReadMultiplier: 2,
    });
  });

  test("breakdown and total stay consistent with calculateRequestCost", () => {
    const usage = {
      input_tokens: 150000,
      cache_read_input_tokens: 200000,
      cache_creation_input_tokens: 10000,
      output_tokens: 3000,
    };
    const breakdown = calculateRequestCostBreakdown(usage, GPT_61_SOL);
    const detail = calculateRequestCostBreakdownDetail(usage, GPT_61_SOL);

    expect(detail.breakdown).toEqual(breakdown);
    expect(breakdown.total).toBe(Number(calculateRequestCost(usage, GPT_61_SOL).toString()));
    expect(detail.longContextTier?.observedInputTokens).toBe(360000);
  });

  test("explicit long_context_pricing reports its own threshold and multipliers", () => {
    const priceData: ModelPriceData = {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
      cache_read_input_token_cost: 0.0000003,
      long_context_pricing: {
        threshold_tokens: 200000,
        input_multiplier: 2,
        output_multiplier: 1.5,
      },
    };
    const usage = { input_tokens: 250000, output_tokens: 1000 };
    const longContextPricing = matchLongContextPricing(usage, priceData)?.pricing ?? null;
    const detail = calculateRequestCostBreakdownDetail(usage, priceData, { longContextPricing });

    expect(detail.longContextTier).toMatchObject({
      thresholdTokens: 200000,
      observedInputTokens: 250000,
      inputMultiplier: 2,
      outputMultiplier: 1.5,
      cacheReadMultiplier: 2,
    });
  });

  test("models without tier prices never report a tier", () => {
    const priceData: ModelPriceData = {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    };
    const detail = calculateRequestCostBreakdownDetail(
      { input_tokens: 900000, output_tokens: 1000 },
      priceData
    );

    expect(detail.longContextTier).toBeNull();
  });
});
