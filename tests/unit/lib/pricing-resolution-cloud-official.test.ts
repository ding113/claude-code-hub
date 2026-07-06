import { describe, expect, it } from "vitest";
import { resolvePricingForModelRecords } from "@/lib/utils/pricing-resolution";
import type { ModelPrice, ModelPriceData } from "@/types/model-price";

function makeCloudRecord(priceData: Partial<ModelPriceData>, modelName = "test-model"): ModelPrice {
  const now = new Date("2026-07-01T00:00:00.000Z");
  return {
    id: 1,
    modelName,
    priceData: { mode: "chat", ...priceData },
    source: "cloud",
    createdAt: now,
    updatedAt: now,
  };
}

describe("resolvePricingForModelRecords - cloud official", () => {
  it("prefers the data-driven official pricing node over non-official ones", () => {
    const record = makeCloudRecord({
      vendor: "deepseek",
      official_pricing_provider: "deepseek",
      pricing: {
        openrouter: { input_cost_per_token: 0.0000005, output_cost_per_token: 0.0000015 },
        deepseek: {
          official: true,
          input_cost_per_token: 0.00000028,
          output_cost_per_token: 0.00000042,
        },
      },
    });

    const resolved = resolvePricingForModelRecords({
      provider: null,
      primaryModelName: "deepseek-v3.2",
      fallbackModelName: null,
      primaryRecord: record,
      fallbackRecord: null,
    });

    expect(resolved?.source).toBe("cloud_official");
    expect(resolved?.resolvedPricingProviderKey).toBe("deepseek");
    expect(resolved?.priceData.input_cost_per_token).toBeCloseTo(0.00000028, 12);
  });

  it("falls back to any official=true node when declared official key is missing", () => {
    const record = makeCloudRecord({
      vendor: "deepseek",
      official_pricing_provider: null,
      pricing: {
        openrouter: { input_cost_per_token: 0.0000005 },
        deepseek: { official: true, input_cost_per_token: 0.00000028 },
      },
    });

    const resolved = resolvePricingForModelRecords({
      provider: null,
      primaryModelName: "deepseek-v3.2",
      fallbackModelName: null,
      primaryRecord: record,
      fallbackRecord: null,
    });

    expect(resolved?.source).toBe("cloud_official");
    expect(resolved?.resolvedPricingProviderKey).toBe("deepseek");
  });

  it("still prefers exact provider-channel match over cloud official", () => {
    const record = makeCloudRecord({
      vendor: "deepseek",
      official_pricing_provider: "deepseek",
      pricing: {
        openrouter: { input_cost_per_token: 0.0000005 },
        deepseek: { official: true, input_cost_per_token: 0.00000028 },
      },
    });

    const resolved = resolvePricingForModelRecords({
      provider: {
        id: 1,
        name: "OpenRouter Channel",
        url: "https://openrouter.ai/api/v1",
      } as never,
      primaryModelName: "deepseek-v3.2",
      fallbackModelName: null,
      primaryRecord: record,
      fallbackRecord: null,
    });

    expect(resolved?.source).toBe("cloud_exact");
    expect(resolved?.resolvedPricingProviderKey).toBe("openrouter");
  });

  it("local manual price still wins over everything", () => {
    const manual = {
      ...makeCloudRecord({
        input_cost_per_token: 0.000001,
        pricing: {
          deepseek: { official: true, input_cost_per_token: 0.00000028 },
        },
      }),
      source: "manual" as const,
    };

    const resolved = resolvePricingForModelRecords({
      provider: null,
      primaryModelName: "deepseek-v3.2",
      fallbackModelName: null,
      primaryRecord: manual,
      fallbackRecord: null,
    });

    expect(resolved?.source).toBe("local_manual");
  });

  it("uses vendor field to derive official provider keys for name-based fallback", () => {
    const record = makeCloudRecord({
      vendor: "google",
      pricing: {
        "google-vertex": { input_cost_per_token: 0.00000125 },
      },
    });

    const resolved = resolvePricingForModelRecords({
      provider: null,
      primaryModelName: "gemini-2.5-pro",
      fallbackModelName: null,
      primaryRecord: record,
      fallbackRecord: null,
    });

    // google-vertex 属于 google vendor 的官方渠道(OFFICIAL_PROVIDER_EXTRA)
    expect(resolved?.resolvedPricingProviderKey).toBe("google-vertex");
    expect(resolved?.source).toBe("official_fallback");
  });

  it("claims official=true nodes via cloud official even without vendor declarations", () => {
    const record = makeCloudRecord({
      // 无 vendor/官方声明,exact/official 键都不命中,official=true 由 resolveCloudOfficial 兜住
      pricing: {
        aaa: { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
        zzz: {
          official: true,
          input_cost_per_token: 0.0000011,
          output_cost_per_token: 0.0000021,
        },
      },
      official_pricing_provider: undefined,
    });
    const resolved = resolvePricingForModelRecords({
      provider: null,
      primaryModelName: "mystery-model",
      fallbackModelName: null,
      primaryRecord: record,
      fallbackRecord: null,
    });

    expect(resolved?.resolvedPricingProviderKey).toBe("zzz");
    expect(resolved?.source).toBe("cloud_official");
  });

  it("detail fallback skips official nodes without valid price data", () => {
    const record = makeCloudRecord({
      // official 节点无任何有效价格字段:cloud_official 不命中,
      // detail fallback 的官方优先排序也必须继续尝试后续有效节点
      pricing: {
        aaa: { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
        zzz: { official: true, provider_model_id: "zzz-model" },
      },
      official_pricing_provider: undefined,
    });
    const resolved = resolvePricingForModelRecords({
      provider: null,
      primaryModelName: "mystery-model",
      fallbackModelName: null,
      primaryRecord: record,
      fallbackRecord: null,
    });

    expect(resolved?.resolvedPricingProviderKey).toBe("aaa");
    expect(resolved?.source).toBe("priority_fallback");
  });
});
