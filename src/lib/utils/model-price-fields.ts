import type { ModelPriceData } from "@/types/model-price";

export type ModelPriceFieldKind = "supported" | "unsupported" | "display";
export type ModelPriceFieldSource = "top_level" | "provider_pricing";

export interface ModelPriceFieldEntry {
  key: string;
  label: string;
  path: string;
  value: unknown;
  kind: ModelPriceFieldKind;
  source: ModelPriceFieldSource;
  providerKey?: string;
  isCore: boolean;
}

const SUPPORTED_TOP_LEVEL_BILLING_KEYS = new Set([
  "input_cost_per_token",
  "output_cost_per_token",
  "input_cost_per_request",
  "cache_creation_input_token_cost",
  "cache_creation_input_token_cost_above_1hr",
  "cache_read_input_token_cost",
  "input_cost_per_token_above_200k_tokens",
  "output_cost_per_token_above_200k_tokens",
  "cache_creation_input_token_cost_above_200k_tokens",
  "cache_read_input_token_cost_above_200k_tokens",
  "cache_creation_input_token_cost_above_1hr_above_200k_tokens",
  "input_cost_per_token_above_200k_tokens_priority",
  "output_cost_per_token_above_200k_tokens_priority",
  "cache_read_input_token_cost_above_200k_tokens_priority",
  "input_cost_per_token_above_272k_tokens",
  "output_cost_per_token_above_272k_tokens",
  "cache_creation_input_token_cost_above_272k_tokens",
  "cache_read_input_token_cost_above_272k_tokens",
  "cache_creation_input_token_cost_above_1hr_above_272k_tokens",
  "input_cost_per_token_above_272k_tokens_priority",
  "output_cost_per_token_above_272k_tokens_priority",
  "cache_read_input_token_cost_above_272k_tokens_priority",
  "input_cost_per_token_priority",
  "output_cost_per_token_priority",
  "cache_read_input_token_cost_priority",
  "output_cost_per_image",
  "input_cost_per_image",
  "output_cost_per_image_token",
  "input_cost_per_image_token",
]);

const SUPPORTED_LONG_CONTEXT_KEYS = new Set([
  "input_multiplier",
  "output_multiplier",
  "cache_creation_input_multiplier",
  "cache_creation_input_multiplier_above_1hr",
  "cache_read_input_multiplier",
  "input_cost_per_token",
  "output_cost_per_token",
  "cache_creation_input_token_cost",
  "cache_creation_input_token_cost_above_1hr",
  "cache_read_input_token_cost",
]);

const SUPPORTED_SERVICE_TIER_KEYS = new Set([
  ...SUPPORTED_TOP_LEVEL_BILLING_KEYS,
  "long_context_pricing",
]);

const CORE_TOP_LEVEL_FIELDS = new Set([
  "mode",
  "display_name",
  "litellm_provider",
  "selected_pricing_provider",
  "selected_pricing_source_model",
  "selected_pricing_resolution",
  "max_input_tokens",
  "max_output_tokens",
  "max_tokens",
  "output_vector_size",
  ...SUPPORTED_TOP_LEVEL_BILLING_KEYS,
]);

const NON_EDITABLE_MANAGED_FIELDS = new Set([
  "mode",
  "display_name",
  "litellm_provider",
  "supports_prompt_caching",
  "input_cost_per_token",
  "output_cost_per_token",
  "output_cost_per_image",
  "input_cost_per_request",
  "cache_read_input_token_cost",
  "cache_creation_input_token_cost",
  "cache_creation_input_token_cost_above_1hr",
]);

const LABEL_OVERRIDES: Record<string, string> = {
  display_name: "Display name",
  litellm_provider: "LiteLLM provider",
  selected_pricing_provider: "Selected pricing provider",
  selected_pricing_source_model: "Selected source model",
  selected_pricing_resolution: "Selected resolution",
  max_input_tokens: "Max input tokens",
  max_output_tokens: "Max output tokens",
  max_tokens: "Max tokens",
  output_vector_size: "Output vector size",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function humanizeKey(key: string): string {
  if (LABEL_OVERRIDES[key]) {
    return LABEL_OVERRIDES[key];
  }

  return key.replace(/_/g, " ").replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

export function isPriceLikeFieldKey(key: string): boolean {
  return /(cost|price|rate|multiplier|per_|second|session|query|page|pixel|character|dbu)/i.test(
    key
  );
}

export function isPriceLikeFieldPath(path: string): boolean {
  return path.split(".").some((segment) => isPriceLikeFieldKey(segment));
}

function classifyField(path: string, key: string): ModelPriceFieldKind {
  if (
    SUPPORTED_TOP_LEVEL_BILLING_KEYS.has(key) ||
    (path.startsWith("long_context_pricing.") && SUPPORTED_LONG_CONTEXT_KEYS.has(key)) ||
    (path.startsWith("service_tier_pricing.") && SUPPORTED_SERVICE_TIER_KEYS.has(key))
  ) {
    return "supported";
  }

  if (isPriceLikeFieldPath(path) || isPriceLikeFieldKey(key)) {
    return "unsupported";
  }

  return "display";
}

function isCoreField(
  path: string,
  key: string,
  kind: ModelPriceFieldKind,
  source: ModelPriceFieldSource
) {
  if (source === "provider_pricing") {
    return false;
  }

  if (kind === "supported") {
    return true;
  }

  return (
    CORE_TOP_LEVEL_FIELDS.has(key) ||
    path.startsWith("long_context_pricing.") ||
    path.startsWith("service_tier_pricing.")
  );
}

function pushEntries(
  entries: ModelPriceFieldEntry[],
  node: Record<string, unknown>,
  pathPrefix: string,
  source: ModelPriceFieldSource,
  providerKey?: string
) {
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined) {
      continue;
    }

    const path = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (isPlainObject(value)) {
      pushEntries(entries, value, path, source, providerKey);
      continue;
    }

    entries.push({
      key,
      label: humanizeKey(key),
      path,
      value,
      kind: classifyField(path, key),
      source,
      providerKey,
      isCore: isCoreField(path, key, classifyField(path, key), source),
    });
  }
}

export function collectModelPriceFieldEntries(priceData: ModelPriceData): ModelPriceFieldEntry[] {
  const entries: ModelPriceFieldEntry[] = [];
  const { pricing, ...topLevel } = priceData;

  pushEntries(entries, topLevel, "", "top_level");

  if (isPlainObject(pricing)) {
    for (const [providerKey, providerPricing] of Object.entries(pricing)) {
      if (!isPlainObject(providerPricing)) {
        continue;
      }
      pushEntries(
        entries,
        providerPricing,
        `pricing.${providerKey}`,
        "provider_pricing",
        providerKey
      );
    }
  }

  return entries;
}

function collectDynamicPriceLikeNumbers(node: unknown, path = ""): number[] {
  if (typeof node === "number") {
    if (path && isPriceLikeFieldPath(path) && Number.isFinite(node) && node >= 0) {
      return [node];
    }
    return [];
  }

  if (Array.isArray(node) || !isPlainObject(node)) {
    return [];
  }

  const result: number[] = [];
  for (const [key, value] of Object.entries(node)) {
    const nextPath = path ? `${path}.${key}` : key;
    result.push(...collectDynamicPriceLikeNumbers(value, nextPath));
  }
  return result;
}

export function collectAdditionalPriceLikeNumbers(priceData: ModelPriceData): number[] {
  return collectDynamicPriceLikeNumbers(priceData);
}

export function getEditableExtraPriceData(priceData: ModelPriceData): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(priceData)) {
    if (NON_EDITABLE_MANAGED_FIELDS.has(key) || value === undefined) {
      continue;
    }
    result[key] = value;
  }

  return result;
}
