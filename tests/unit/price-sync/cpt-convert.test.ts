import { describe, expect, it } from "vitest";
import {
  convertCptModelEntry,
  convertCptTable,
  convertCptVariant,
} from "@/lib/price-sync/cpt-convert";
import type {
  CptModelEntry,
  CptPricingVariant,
  CptProviderInfo,
  CptTable,
} from "@/lib/price-sync/cpt-schema";

const PROVIDERS: Record<string, CptProviderInfo> = {
  anthropic: { name: "Anthropic", icon: "anthropic.svg", icon_mono: true },
  openai: { name: "OpenAI", icon: "openai.svg", icon_mono: true },
  google: { name: "Google", icon: "google-color.svg" },
  openrouter: { name: "OpenRouter", icon: "openrouter.svg", icon_mono: true },
};

function claudeVariant(overrides?: Partial<CptPricingVariant>): CptPricingVariant {
  return {
    provider: "anthropic",
    official: true,
    source: "test",
    provider_model_id: "claude-sonnet-4-5-20250929",
    charges: {
      prompt: { unit: "per_M_tokens", price: "3" },
      completion: { unit: "per_M_tokens", price: "15" },
      cache_read: { unit: "per_M_tokens", price: "0.3" },
      cache_write: { unit: "per_M_tokens", price: "3.75" },
      cache_write_1h: { unit: "per_M_tokens", price: "6" },
      web_search: { unit: "per_k_calls", price: "10" },
    },
    tracks: [
      {
        label: ">200K context (1M beta)",
        factor: "1",
        charge_factors: {
          prompt: "2",
          completion: "1.5",
          cache_read: "2",
          cache_write: "2",
          cache_write_1h: "2",
        },
        triggers: [
          {
            kind: "header_matches",
            header: "anthropic-beta",
            pattern: "context-1m-\\d{4}-\\d{2}-\\d{2}",
          },
          { kind: "input_tokens_above", threshold: 200000, inclusive: false },
        ],
      },
      { label: "standard", factor: "1", triggers: [] },
    ],
    ...overrides,
  };
}

describe("convertCptVariant", () => {
  it("converts per_M_tokens charges into per-token fields", () => {
    const node = convertCptVariant(claudeVariant());
    expect(node).not.toBeNull();
    expect(node?.input_cost_per_token).toBeCloseTo(0.000003, 12);
    expect(node?.output_cost_per_token).toBeCloseTo(0.000015, 12);
    expect(node?.cache_read_input_token_cost).toBeCloseTo(3e-7, 12);
    expect(node?.cache_creation_input_token_cost).toBeCloseTo(0.00000375, 12);
    expect(node?.cache_creation_input_token_cost_above_1hr).toBeCloseTo(0.000006, 12);
  });

  it("maps >200K tier tracks to above_200k fields using base price x factor", () => {
    const node = convertCptVariant(claudeVariant());
    expect(node?.input_cost_per_token_above_200k_tokens).toBeCloseTo(0.000006, 12);
    expect(node?.output_cost_per_token_above_200k_tokens).toBeCloseTo(0.0000225, 12);
    expect(node?.cache_read_input_token_cost_above_200k_tokens).toBeCloseTo(6e-7, 12);
    expect(node?.cache_creation_input_token_cost_above_200k_tokens).toBeCloseTo(0.0000075, 12);
    expect(node?.cache_creation_input_token_cost_above_1hr_above_200k_tokens).toBeCloseTo(
      0.000012,
      12
    );
  });

  it("maps web_search per_k_calls to search_context_cost_per_query", () => {
    const node = convertCptVariant(claudeVariant());
    expect(node?.search_context_cost_per_query).toEqual({
      search_context_size_low: 0.01,
      search_context_size_medium: 0.01,
      search_context_size_high: 0.01,
    });
  });

  it("maps >272K tier tracks to above_272k fields", () => {
    const node = convertCptVariant({
      provider: "openai",
      official: true,
      source: "test",
      charges: {
        prompt: { unit: "per_M_tokens", price: "1.25" },
        completion: { unit: "per_M_tokens", price: "10" },
      },
      tracks: [
        {
          label: ">272K context",
          factor: "1",
          charge_factors: { prompt: "2", completion: "2" },
          triggers: [{ kind: "input_tokens_above", threshold: 272000 }],
        },
        { label: "standard", factor: "1", triggers: [] },
      ],
    });
    expect(node?.input_cost_per_token_above_272k_tokens).toBeCloseTo(0.0000025, 12);
    expect(node?.output_cost_per_token_above_272k_tokens).toBeCloseTo(0.00002, 12);
  });

  it("does not derive tier fields from non-USD or negative base charges", () => {
    const node = convertCptVariant({
      provider: "alibaba-cn",
      official: true,
      source: "test",
      charges: {
        prompt: { unit: "per_M_tokens", price: "10", currency: "CNY" },
        cache_read: { unit: "per_M_tokens", price: "-1" },
        completion: { unit: "per_M_tokens", price: "40" },
      },
      tracks: [
        {
          label: ">200K context",
          factor: "1",
          charge_factors: { prompt: "2", completion: "1.5", cache_read: "2" },
          triggers: [{ kind: "input_tokens_above", threshold: 200000 }],
        },
        { label: "standard", factor: "1", triggers: [] },
      ],
    });

    // 基础价与分层价同口径:CNY / 负数维度均不产生计费字段
    expect(node?.input_cost_per_token).toBeUndefined();
    expect(node?.input_cost_per_token_above_200k_tokens).toBeUndefined();
    expect(node?.cache_read_input_token_cost_above_200k_tokens).toBeUndefined();
    expect(node?.output_cost_per_token_above_200k_tokens).toBeCloseTo(0.00006, 12);
  });

  it("maps priority service tier tracks to priority fields", () => {
    const node = convertCptVariant({
      provider: "openai",
      official: true,
      source: "test",
      charges: {
        prompt: { unit: "per_M_tokens", price: "2" },
        completion: { unit: "per_M_tokens", price: "8" },
        cache_read: { unit: "per_M_tokens", price: "0.5" },
      },
      tracks: [
        {
          label: "priority",
          factor: "2",
          triggers: [{ kind: "body_matches", field: "service_tier", pattern: "^priority$" }],
        },
        { label: "standard", factor: "1", triggers: [] },
      ],
    });
    expect(node?.input_cost_per_token_priority).toBeCloseTo(0.000004, 12);
    expect(node?.output_cost_per_token_priority).toBeCloseTo(0.000016, 12);
    expect(node?.cache_read_input_token_cost_priority).toBeCloseTo(0.000001, 12);
  });

  it("skips unsupported tracks (batch/flex) without failing", () => {
    const node = convertCptVariant({
      provider: "google",
      official: true,
      source: "test",
      charges: { prompt: { unit: "per_M_tokens", price: "1.25" } },
      tracks: [
        {
          label: "batch",
          factor: "0.5",
          triggers: [{ kind: "endpoint_matches", pattern: "^batch\\." }],
        },
        {
          label: "flex",
          factor: "0.5",
          triggers: [{ kind: "body_matches", field: "service_tier", pattern: "^flex$" }],
        },
        { label: "standard", factor: "1", triggers: [] },
      ],
    });
    expect(node?.input_cost_per_token).toBeCloseTo(0.00000125, 12);
    expect(node?.input_cost_per_token_priority).toBeUndefined();
  });

  it("ignores bogus giant thresholds", () => {
    const node = convertCptVariant({
      provider: "google",
      official: true,
      source: "test",
      charges: { prompt: { unit: "per_M_tokens", price: "1.25" } },
      tracks: [
        {
          label: ">200000000K context",
          factor: "1",
          charge_factors: { prompt: "2" },
          triggers: [{ kind: "input_tokens_above", threshold: 200000000000, inclusive: true }],
        },
        { label: "standard", factor: "1", triggers: [] },
      ],
    });
    expect(node?.input_cost_per_token_above_200k_tokens).toBeUndefined();
  });

  it("applies default-track factor to base prices", () => {
    const node = convertCptVariant({
      provider: "openai",
      official: false,
      source: "test",
      charges: { prompt: { unit: "per_M_tokens", price: "10" } },
      tracks: [{ label: "standard", factor: "0.5", triggers: [] }],
    });
    expect(node?.input_cost_per_token).toBeCloseTo(0.000005, 12);
  });

  it("converts per_image and per_request charges", () => {
    const node = convertCptVariant({
      provider: "openai",
      official: true,
      source: "test",
      charges: {
        image_output: { unit: "per_image", price: "0.04" },
        image_input: { unit: "per_M_tokens", price: "5" },
        request: { unit: "per_request", price: "0.002" },
      },
      tracks: null,
    });
    expect(node?.output_cost_per_image).toBeCloseTo(0.04, 12);
    expect(node?.input_cost_per_image_token).toBeCloseTo(0.000005, 12);
    expect(node?.input_cost_per_request).toBeCloseTo(0.002, 12);
  });

  it("skips non-USD currency charges", () => {
    const node = convertCptVariant({
      provider: "alibaba-cn",
      official: true,
      source: "test",
      charges: {
        prompt: { unit: "per_M_tokens", price: "2", currency: "CNY" },
      },
      tracks: null,
    });
    expect(node).toBeNull();
  });

  it("returns null when no billable charge exists", () => {
    const node = convertCptVariant({
      provider: "x",
      official: false,
      source: "test",
      charges: { cache_storage: { unit: "per_M_tokens_per_hour", price: "4.5" } },
      tracks: null,
    });
    expect(node).toBeNull();
  });
});

function claudeEntry(overrides?: Partial<CptModelEntry>): CptModelEntry {
  return {
    slug: "anthropic/claude-sonnet-4-5",
    model_name: "claude-sonnet-4-5",
    vendor: "anthropic",
    display_name: "Claude Sonnet 4.5",
    aliases: ["claude-sonnet-4-5-20250929", "anthropic/claude-sonnet-4-5"],
    family: "claude-sonnet",
    model_type: "chat",
    max_input_tokens: 200000,
    max_output_tokens: 64000,
    capabilities: {
      function_calling: true,
      prompt_caching: true,
      vision: true,
      reasoning: true,
      structured_output: true,
    },
    pricing: [
      claudeVariant(),
      {
        provider: "openrouter",
        official: false,
        source: "test",
        charges: {
          prompt: { unit: "per_M_tokens", price: "3.3" },
          completion: { unit: "per_M_tokens", price: "16.5" },
        },
        tracks: null,
      },
    ],
    ...overrides,
  };
}

describe("convertCptModelEntry", () => {
  it("uses the first official variant for top-level fields", () => {
    const priceData = convertCptModelEntry(claudeEntry(), PROVIDERS);
    expect(priceData).not.toBeNull();
    expect(priceData?.input_cost_per_token).toBeCloseTo(0.000003, 12);
    expect(priceData?.official_pricing_provider).toBe("anthropic");
    expect(priceData?.mode).toBe("chat");
    expect(priceData?.display_name).toBe("Claude Sonnet 4.5");
  });

  it("keeps per-provider pricing map with official flags", () => {
    const priceData = convertCptModelEntry(claudeEntry(), PROVIDERS);
    expect(Object.keys(priceData?.pricing ?? {})).toEqual(["anthropic", "openrouter"]);
    expect(priceData?.pricing?.anthropic.official).toBe(true);
    expect(priceData?.pricing?.openrouter.official).toBeUndefined();
    expect(priceData?.pricing?.openrouter.input_cost_per_token).toBeCloseTo(0.0000033, 12);
    expect(priceData?.providers).toEqual(["anthropic", "openrouter"]);
  });

  it("carries cloud metadata: vendor, slug, aliases, icon, capabilities, limits", () => {
    const priceData = convertCptModelEntry(claudeEntry(), PROVIDERS);
    expect(priceData?.vendor).toBe("anthropic");
    expect(priceData?.slug).toBe("anthropic/claude-sonnet-4-5");
    expect(priceData?.aliases).toContain("claude-sonnet-4-5-20250929");
    expect(priceData?.vendor_icon).toBe("anthropic.svg");
    expect(priceData?.vendor_icon_mono).toBe(true);
    expect(priceData?.supports_function_calling).toBe(true);
    expect(priceData?.supports_tool_choice).toBe(true);
    expect(priceData?.supports_prompt_caching).toBe(true);
    expect(priceData?.supports_vision).toBe(true);
    expect(priceData?.supports_response_schema).toBe(true);
    expect(priceData?.max_input_tokens).toBe(200000);
    expect(priceData?.max_output_tokens).toBe(64000);
    expect(priceData?.model_family).toBe("claude-sonnet");
  });

  it("falls back to the first variant when no official variant exists", () => {
    const entry = claudeEntry({
      pricing: [
        {
          provider: "openrouter",
          official: false,
          source: "test",
          charges: { prompt: { unit: "per_M_tokens", price: "5" } },
          tracks: null,
        },
      ],
    });
    const priceData = convertCptModelEntry(entry, PROVIDERS);
    expect(priceData?.input_cost_per_token).toBeCloseTo(0.000005, 12);
    expect(priceData?.official_pricing_provider).toBeNull();
  });

  it("maps model_type null to chat and image to image_generation", () => {
    expect(convertCptModelEntry(claudeEntry({ model_type: null }), PROVIDERS)?.mode).toBe("chat");
    expect(convertCptModelEntry(claudeEntry({ model_type: "image" }), PROVIDERS)?.mode).toBe(
      "image_generation"
    );
    expect(convertCptModelEntry(claudeEntry({ model_type: "embedding" }), PROVIDERS)?.mode).toBe(
      "embedding"
    );
  });

  it("returns null when every variant is unbillable", () => {
    const entry = claudeEntry({
      pricing: [
        {
          provider: "x",
          official: true,
          source: "test",
          charges: {},
          tracks: null,
        },
      ],
    });
    expect(convertCptModelEntry(entry, PROVIDERS)).toBeNull();
  });

  it("keys regional variants separately", () => {
    const entry = claudeEntry({
      pricing: [
        claudeVariant(),
        claudeVariant({ provider: "amazon-bedrock", official: false, region: "us-east-1" }),
      ],
    });
    const priceData = convertCptModelEntry(entry, PROVIDERS);
    expect(Object.keys(priceData?.pricing ?? {})).toContain("amazon-bedrock@us-east-1");
  });
});

describe("convertCptTable", () => {
  function table(models: CptModelEntry[]): CptTable {
    return {
      schema: "cchp.pricing-table/v1",
      version: "v1",
      currency: "USD",
      refreshed_at: "2026-07-01T00:00:00.000Z",
      models,
      providers: PROVIDERS,
    };
  }

  it("keys models by bare model_name and aggregates vendors", () => {
    const converted = convertCptTable(
      table([
        claudeEntry(),
        claudeEntry({
          slug: "openai/gpt-5.5",
          model_name: "gpt-5.5",
          vendor: "openai",
          display_name: "GPT-5.5",
          pricing: [
            {
              provider: "openai",
              official: true,
              source: "test",
              charges: { prompt: { unit: "per_M_tokens", price: "1.25" } },
              tracks: null,
            },
          ],
        }),
      ])
    );

    expect(Object.keys(converted.models).sort()).toEqual(["claude-sonnet-4-5", "gpt-5.5"]);
    expect(converted.version).toBe("v1");
    expect(converted.vendors.map((v) => v.vendor).sort()).toEqual(["anthropic", "openai"]);
    const anthropicVendor = converted.vendors.find((v) => v.vendor === "anthropic");
    expect(anthropicVendor?.name).toBe("Anthropic");
    expect(anthropicVendor?.icon).toBe("anthropic.svg");
    expect(anthropicVendor?.modelCount).toBe(1);
  });

  it("resolves bare-name collisions preferring official pricing over 'other' vendor", () => {
    const officialEntry = claudeEntry({
      slug: "mistral/mistral-7b-instruct",
      model_name: "mistral-7b-instruct",
      vendor: "mistral",
      display_name: "Mistral 7B",
      pricing: [
        {
          provider: "mistral",
          official: true,
          source: "test",
          charges: { prompt: { unit: "per_M_tokens", price: "0.25" } },
          tracks: null,
        },
      ],
    });
    const otherEntry = claudeEntry({
      slug: "other/mistral-7b-instruct",
      model_name: "mistral-7b-instruct",
      vendor: "other",
      display_name: "Mistral 7B (community)",
      pricing: [
        {
          provider: "openrouter",
          official: false,
          source: "test",
          charges: { prompt: { unit: "per_M_tokens", price: "0.3" } },
          tracks: null,
        },
      ],
    });

    const converted = convertCptTable(table([otherEntry, officialEntry]));
    expect(Object.keys(converted.models)).toEqual(["mistral-7b-instruct"]);
    expect(converted.models["mistral-7b-instruct"].vendor).toBe("mistral");
  });

  it("skips dangerous model names", () => {
    const converted = convertCptTable(
      table([claudeEntry({ slug: "x/__proto__", model_name: "__proto__", vendor: "other" })])
    );
    expect(Object.keys(converted.models)).toEqual([]);
  });
});
