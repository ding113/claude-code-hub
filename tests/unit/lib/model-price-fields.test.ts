import { describe, expect, test } from "vitest";
import {
  collectModelPriceFieldEntries,
  getEditableExtraPriceData,
  isPriceLikeFieldKey,
} from "@/lib/utils/model-price-fields";

describe("model-price-fields", () => {
  test("detects generic price-like keys", () => {
    expect(isPriceLikeFieldKey("input_cost_per_second")).toBe(true);
    expect(isPriceLikeFieldKey("file_search_cost_per_1k_calls")).toBe(true);
    expect(isPriceLikeFieldKey("display_name")).toBe(false);
  });

  test("collects supported, unsupported, and provider pricing entries", () => {
    const entries = collectModelPriceFieldEntries({
      mode: "chat",
      display_name: "Demo",
      input_cost_per_request: 0.25,
      input_cost_per_second: 0.5,
      supports_reasoning: true,
      long_context_pricing: {
        threshold_tokens: 128000,
        input_cost_per_token: 0.000005,
      },
      service_tier_pricing: {
        priority: {
          input_cost_per_token: 0.0000125,
          output_cost_per_token: 0.000075,
          cache_read_input_token_cost: 0.00000125,
        },
      },
      pricing: {
        openai: {
          input_cost_per_token: 0.0000025,
          output_cost_per_token: 0.000015,
          file_search_cost_per_1k_calls: 2,
        },
      },
    });

    expect(entries.find((entry) => entry.path === "input_cost_per_request")?.kind).toBe(
      "supported"
    );
    expect(entries.find((entry) => entry.path === "input_cost_per_second")?.kind).toBe(
      "unsupported"
    );
    expect(entries.find((entry) => entry.path === "supports_reasoning")?.kind).toBe("display");
    expect(
      entries.find((entry) => entry.path === "pricing.openai.file_search_cost_per_1k_calls")?.kind
    ).toBe("unsupported");
    expect(
      entries.find((entry) => entry.path === "long_context_pricing.input_cost_per_token")?.kind
    ).toBe("supported");
    expect(
      entries.find((entry) => entry.path === "service_tier_pricing.priority.input_cost_per_token")
        ?.kind
    ).toBe("supported");
  });

  test("extracts editable extra price data by excluding managed fields", () => {
    const extra = getEditableExtraPriceData({
      mode: "chat",
      display_name: "Demo",
      input_cost_per_token: 0.000001,
      input_cost_per_request: 0.1,
      supports_reasoning: true,
      input_cost_per_second: 0.5,
      output_vector_size: 1024,
    });

    expect(extra).toEqual({
      supports_reasoning: true,
      input_cost_per_second: 0.5,
      output_vector_size: 1024,
    });
  });
});
