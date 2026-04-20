import { describe, expect, test } from "vitest";
import type { ModelPrice } from "@/types/model-price";
import { resolvePricingForModelRecords } from "@/lib/utils/pricing-resolution";

function makeRecord(
  modelName: string,
  priceData: ModelPrice["priceData"],
  source: ModelPrice["source"] = "litellm"
): ModelPrice {
  const now = new Date("2026-03-06T00:00:00.000Z");
  return {
    id: Math.floor(Math.random() * 100000),
    modelName,
    priceData,
    source,
    createdAt: now,
    updatedAt: now,
  };
}

describe("resolvePricingForModelRecords", () => {
  test("falls back from chatgpt to openai pricing for gpt-5.4 alias models", () => {
    const aliasRecord = makeRecord("gpt-5.4", {
      mode: "responses",
      model_family: "gpt",
      litellm_provider: "chatgpt",
      pricing: {
        openai: {
          input_cost_per_token: 0.0000025,
          output_cost_per_token: 0.000015,
          cache_read_input_token_cost: 2.5e-7,
        },
        openrouter: {
          input_cost_per_token: 0.0000025,
          output_cost_per_token: 0.000015,
          cache_read_input_token_cost: 2.5e-7,
        },
      },
    });

    const resolved = resolvePricingForModelRecords({
      provider: {
        id: 1,
        name: "ChatGPT",
        url: "https://chatgpt.com/backend-api/codex",
      } as never,
      primaryModelName: "gpt-5.4",
      fallbackModelName: null,
      primaryRecord: aliasRecord,
      fallbackRecord: null,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.resolvedPricingProviderKey).toBe("openai");
    expect(resolved?.source).toBe("official_fallback");
    expect(resolved?.priceData.input_cost_per_token).toBe(0.0000025);
  });

  test("falls back from redirected date model to alias model for provider-specific pricing", () => {
    const datedRecord = makeRecord("gpt-5.4-2026-03-05", {
      mode: "responses",
      model_family: "gpt",
      litellm_provider: "openai",
      input_cost_per_token: 0.0000025,
      output_cost_per_token: 0.000015,
      cache_read_input_token_cost: 2.5e-7,
      pricing: {
        openai: {
          input_cost_per_token: 0.0000025,
          output_cost_per_token: 0.000015,
          cache_read_input_token_cost: 2.5e-7,
        },
      },
    });

    const aliasRecord = makeRecord("gpt-5.4", {
      mode: "responses",
      model_family: "gpt",
      litellm_provider: "chatgpt",
      pricing: {
        openrouter: {
          input_cost_per_token: 0.0000025,
          output_cost_per_token: 0.000015,
          cache_read_input_token_cost: 2.5e-7,
        },
      },
    });

    const resolved = resolvePricingForModelRecords({
      provider: {
        id: 2,
        name: "OpenRouter",
        url: "https://openrouter.ai/api/v1",
      } as never,
      primaryModelName: "gpt-5.4-2026-03-05",
      fallbackModelName: "gpt-5.4",
      primaryRecord: datedRecord,
      fallbackRecord: aliasRecord,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.resolvedModelName).toBe("gpt-5.4");
    expect(resolved?.resolvedPricingProviderKey).toBe("openrouter");
    expect(resolved?.source).toBe("cloud_model_fallback");
  });

  test("prefers local manual prices over cloud multi-provider pricing", () => {
    const manualRecord = makeRecord(
      "gpt-5.4",
      {
        mode: "responses",
        input_cost_per_token: 0.0000099,
        output_cost_per_token: 0.0000199,
        selected_pricing_provider: "manual-custom",
      },
      "manual"
    );

    const cloudRecord = makeRecord("gpt-5.4", {
      mode: "responses",
      pricing: {
        openai: {
          input_cost_per_token: 0.0000025,
          output_cost_per_token: 0.000015,
        },
      },
    });

    const resolved = resolvePricingForModelRecords({
      provider: {
        id: 1,
        name: "ChatGPT",
        url: "https://chatgpt.com/backend-api/codex",
      } as never,
      primaryModelName: "gpt-5.4",
      fallbackModelName: null,
      primaryRecord: manualRecord,
      fallbackRecord: cloudRecord,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.source).toBe("local_manual");
    expect(resolved?.priceData.input_cost_per_token).toBe(0.0000099);
    expect(resolved?.resolvedPricingProviderKey).toBe("manual-custom");
  });

  test("official anthropic fallback clears stale long-context fields from unrelated provider top-level data", () => {
    const cloudRecord = makeRecord("claude-sonnet-4-6", {
      mode: "chat",
      model_family: "claude-sonnet",
      litellm_provider: "bedrock_converse",
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
      input_cost_per_token_above_200k_tokens: 0.000006,
      output_cost_per_token_above_200k_tokens: 0.0000225,
      pricing: {
        anthropic: {
          input_cost_per_token: 0.000003,
          output_cost_per_token: 0.000015,
        },
        openrouter: {
          input_cost_per_token: 0.000003,
          output_cost_per_token: 0.000015,
          input_cost_per_token_above_200k_tokens: 0.000006,
          output_cost_per_token_above_200k_tokens: 0.0000225,
        },
      },
    });

    const resolved = resolvePricingForModelRecords({
      provider: null,
      primaryModelName: "claude-sonnet-4-6",
      fallbackModelName: null,
      primaryRecord: cloudRecord,
      fallbackRecord: null,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.source).toBe("official_fallback");
    expect(resolved?.resolvedPricingProviderKey).toBe("anthropic");
    expect(resolved?.priceData.input_cost_per_token).toBe(0.000003);
    expect(resolved?.priceData.input_cost_per_token_above_200k_tokens).toBeUndefined();
    expect(resolved?.priceData.output_cost_per_token_above_200k_tokens).toBeUndefined();
  });

  test("provider merge keeps shared top-level request fees and long_context_pricing", () => {
    const cloudRecord = makeRecord("gpt-5.4", {
      mode: "responses",
      model_family: "gpt",
      litellm_provider: "azure",
      input_cost_per_request: 0.123,
      long_context_pricing: {
        threshold_tokens: 272000,
        input_cost_per_token: 0.000005,
      },
      pricing: {
        openai: {
          input_cost_per_token: 0.0000025,
          output_cost_per_token: 0.000015,
        },
        azure: {
          input_cost_per_token: 0.0000027,
          output_cost_per_token: 0.000016,
        },
      },
    });

    const resolved = resolvePricingForModelRecords({
      provider: {
        id: 4,
        name: "OpenAI",
        url: "https://api.openai.com/v1/responses",
      } as never,
      primaryModelName: "gpt-5.4",
      fallbackModelName: null,
      primaryRecord: cloudRecord,
      fallbackRecord: null,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.resolvedPricingProviderKey).toBe("openai");
    expect(resolved?.priceData.input_cost_per_request).toBe(0.123);
    expect(resolved?.priceData.long_context_pricing).toEqual({
      threshold_tokens: 272000,
      input_cost_per_token: 0.000005,
    });
  });
});
