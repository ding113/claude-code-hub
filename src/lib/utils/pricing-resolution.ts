import type { ModelPrice, ModelPriceData } from "@/types/model-price";
import type { Provider } from "@/types/provider";
import { hasValidPriceData } from "./price-data";

export type ResolvedPricingSource =
  | "local_manual"
  | "cloud_exact"
  | "cloud_model_fallback"
  | "priority_fallback"
  | "single_provider_top_level"
  | "official_fallback";

export interface ResolvedPricing {
  resolvedModelName: string;
  resolvedPricingProviderKey: string;
  source: ResolvedPricingSource;
  priceData: ModelPriceData;
  pricingNode?: Record<string, unknown> | null;
}

interface ModelRecordCandidate {
  modelName: string | null;
  record: ModelPrice | null;
  isPrimary: boolean;
}

interface PricingKeyCandidate {
  key: string;
  type: "exact" | "official";
}

export interface ResolvePricingForModelRecordsInput {
  provider: Provider | null | undefined;
  primaryModelName: string | null;
  fallbackModelName: string | null;
  primaryRecord: ModelPrice | null;
  fallbackRecord: ModelPrice | null;
}

const DETAIL_FIELDS = [
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
] as const;

const DETAIL_TIE_BREAK_ORDER = [
  "openrouter",
  "opencode",
  "cloudflare-ai-gateway",
  "github-copilot",
  "chatgpt",
] as const;

function pushUnique(
  candidates: PricingKeyCandidate[],
  key: string,
  type: PricingKeyCandidate["type"]
) {
  if (!key || candidates.some((candidate) => candidate.key === key)) {
    return;
  }
  candidates.push({ key, type });
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function extractHost(urlValue: string | null | undefined): string {
  if (!urlValue) return "";
  try {
    return new URL(urlValue).host.toLowerCase();
  } catch {
    return "";
  }
}

function getOfficialProviderKeys(
  modelName: string | null | undefined,
  priceData?: ModelPriceData
): string[] {
  const family = normalizeText(
    typeof priceData?.model_family === "string" ? priceData.model_family : ""
  );
  const normalizedModelName = normalizeText(modelName);

  if (
    family === "gpt" ||
    family === "gpt-pro" ||
    normalizedModelName.startsWith("gpt-") ||
    normalizedModelName.includes("chatgpt")
  ) {
    return ["openai"];
  }

  if (family.startsWith("claude") || normalizedModelName.startsWith("claude")) {
    return ["anthropic"];
  }

  if (family.includes("gemini") || normalizedModelName.startsWith("gemini")) {
    return ["vertex_ai", "vertex", "google"];
  }

  return [];
}

export function resolvePricingKeyCandidates(
  provider: Provider | null | undefined,
  modelName: string | null | undefined,
  priceData?: ModelPriceData
): PricingKeyCandidate[] {
  const candidates: PricingKeyCandidate[] = [];
  const name = normalizeText(provider?.name);
  const url = normalizeText(provider?.url);
  const host = extractHost(provider?.url);

  if (name.includes("openrouter") || host.includes("openrouter")) {
    pushUnique(candidates, "openrouter", "exact");
  }
  if (name.includes("opencode") || host.includes("opencode")) {
    pushUnique(candidates, "opencode", "exact");
  }
  if (
    name.includes("cloudflare") ||
    host.includes("cloudflare") ||
    url.includes("cloudflare-ai-gateway")
  ) {
    pushUnique(candidates, "cloudflare-ai-gateway", "exact");
  }
  if (name.includes("github") || name.includes("copilot") || host.includes("githubcopilot")) {
    pushUnique(candidates, "github-copilot", "exact");
  }
  if (name.includes("chatgpt") || host.includes("chatgpt.com")) {
    pushUnique(candidates, "chatgpt", "exact");
  }
  if (name.includes("openai") || host.includes("openai.com") || host.includes("api.openai.com")) {
    pushUnique(candidates, "openai", "exact");
  }
  if (name.includes("anthropic") || host.includes("anthropic.com")) {
    pushUnique(candidates, "anthropic", "exact");
  }
  if (name.includes("vertex") || host.includes("googleapis.com") || name.includes("google")) {
    pushUnique(candidates, "vertex_ai", "exact");
    pushUnique(candidates, "vertex", "exact");
    pushUnique(candidates, "google", "exact");
  }

  for (const officialKey of getOfficialProviderKeys(modelName, priceData)) {
    pushUnique(candidates, officialKey, "official");
  }

  return candidates;
}

function getPricingMap(record: ModelPrice | null): Record<string, Record<string, unknown>> | null {
  const pricing = record?.priceData?.pricing;
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) {
    return null;
  }
  return pricing;
}

function mergePriceData(
  base: ModelPriceData,
  pricingNode: Record<string, unknown> | null,
  pricingProviderKey: string
): ModelPriceData {
  if (!pricingNode) {
    return typeof base.selected_pricing_provider === "string"
      ? {
          ...base,
          selected_pricing_provider: base.selected_pricing_provider,
        }
      : { ...base };
  }

  return {
    ...base,
    ...pricingNode,
    pricing: base.pricing,
    selected_pricing_provider: pricingProviderKey,
  };
}

function getDetailScore(pricingNode: Record<string, unknown>): number {
  return DETAIL_FIELDS.reduce((score, field) => {
    const value = pricingNode[field];
    return typeof value === "number" && Number.isFinite(value) ? score + 1 : score;
  }, 0);
}

function compareDetailKeys(
  a: string,
  b: string,
  pricingMap: Record<string, Record<string, unknown>>
): number {
  const scoreDiff = getDetailScore(pricingMap[b] ?? {}) - getDetailScore(pricingMap[a] ?? {});
  if (scoreDiff !== 0) return scoreDiff;

  const indexA = DETAIL_TIE_BREAK_ORDER.indexOf(a as (typeof DETAIL_TIE_BREAK_ORDER)[number]);
  const indexB = DETAIL_TIE_BREAK_ORDER.indexOf(b as (typeof DETAIL_TIE_BREAK_ORDER)[number]);

  if (indexA >= 0 || indexB >= 0) {
    if (indexA < 0) return 1;
    if (indexB < 0) return -1;
    return indexA - indexB;
  }

  return a.localeCompare(b);
}

function resolveManualPricing(
  record: ModelPrice,
  modelName: string | null
): ResolvedPricing | null {
  if (!hasValidPriceData(record.priceData)) {
    return null;
  }

  const resolvedPricingProviderKey =
    (typeof record.priceData.selected_pricing_provider === "string" &&
      record.priceData.selected_pricing_provider.trim()) ||
    (typeof record.priceData.litellm_provider === "string" &&
      record.priceData.litellm_provider.trim()) ||
    "manual";

  return {
    resolvedModelName: modelName ?? record.modelName,
    resolvedPricingProviderKey,
    source: "local_manual",
    priceData: mergePriceData(record.priceData, null, resolvedPricingProviderKey),
    pricingNode: null,
  };
}

function resolveFromPricingMap(
  candidate: ModelRecordCandidate,
  keyCandidates: PricingKeyCandidate[],
  type: PricingKeyCandidate["type"]
): ResolvedPricing | null {
  const pricingMap = getPricingMap(candidate.record);
  if (!candidate.record || !pricingMap) {
    return null;
  }

  for (const keyCandidate of keyCandidates) {
    if (keyCandidate.type !== type) continue;
    const pricingNode = pricingMap[keyCandidate.key];
    if (!pricingNode) continue;

    const mergedPriceData = mergePriceData(
      candidate.record.priceData,
      pricingNode,
      keyCandidate.key
    );
    if (!hasValidPriceData(mergedPriceData)) {
      continue;
    }

    const source: ResolvedPricingSource =
      type === "official"
        ? "official_fallback"
        : candidate.isPrimary
          ? "cloud_exact"
          : "cloud_model_fallback";

    return {
      resolvedModelName: candidate.modelName ?? candidate.record.modelName,
      resolvedPricingProviderKey: keyCandidate.key,
      source,
      priceData: mergedPriceData,
      pricingNode,
    };
  }

  return null;
}

function resolveDetailedFallback(candidate: ModelRecordCandidate): ResolvedPricing | null {
  const pricingMap = getPricingMap(candidate.record);
  if (!candidate.record || !pricingMap) {
    return null;
  }

  const keys = Object.keys(pricingMap).sort((a, b) => compareDetailKeys(a, b, pricingMap));
  const selectedKey = keys[0];
  if (!selectedKey) {
    return null;
  }

  const pricingNode = pricingMap[selectedKey];
  const mergedPriceData = mergePriceData(candidate.record.priceData, pricingNode, selectedKey);
  if (!hasValidPriceData(mergedPriceData)) {
    return null;
  }

  return {
    resolvedModelName: candidate.modelName ?? candidate.record.modelName,
    resolvedPricingProviderKey: selectedKey,
    source: "priority_fallback",
    priceData: mergedPriceData,
    pricingNode,
  };
}

function resolveTopLevel(candidate: ModelRecordCandidate): ResolvedPricing | null {
  if (!candidate.record || !hasValidPriceData(candidate.record.priceData)) {
    return null;
  }

  const officialKeys = getOfficialProviderKeys(candidate.modelName, candidate.record.priceData);
  const resolvedPricingProviderKey =
    (typeof candidate.record.priceData.selected_pricing_provider === "string" &&
      candidate.record.priceData.selected_pricing_provider.trim()) ||
    (typeof candidate.record.priceData.litellm_provider === "string" &&
      candidate.record.priceData.litellm_provider.trim()) ||
    officialKeys[0] ||
    candidate.record.modelName;

  return {
    resolvedModelName: candidate.modelName ?? candidate.record.modelName,
    resolvedPricingProviderKey,
    source:
      candidate.record.source === "manual"
        ? "local_manual"
        : candidate.isPrimary
          ? "single_provider_top_level"
          : "cloud_model_fallback",
    priceData: mergePriceData(candidate.record.priceData, null, resolvedPricingProviderKey),
    pricingNode: null,
  };
}

export function resolvePricingForModelRecords(
  input: ResolvePricingForModelRecordsInput
): ResolvedPricing | null {
  const candidates: ModelRecordCandidate[] = [
    {
      modelName: input.primaryModelName,
      record: input.primaryRecord,
      isPrimary: true,
    },
  ];

  if (input.fallbackModelName && input.fallbackModelName !== input.primaryModelName) {
    candidates.push({
      modelName: input.fallbackModelName,
      record: input.fallbackRecord,
      isPrimary: false,
    });
  }

  for (const candidate of candidates) {
    if (candidate.record?.source === "manual") {
      const resolved = resolveManualPricing(candidate.record, candidate.modelName);
      if (resolved) return resolved;
    }
  }

  const keyCandidates = resolvePricingKeyCandidates(
    input.provider,
    input.primaryModelName ?? input.fallbackModelName,
    input.primaryRecord?.priceData ?? input.fallbackRecord?.priceData
  );

  for (const candidate of candidates) {
    const resolved = resolveFromPricingMap(candidate, keyCandidates, "exact");
    if (resolved) return resolved;
  }

  for (const candidate of candidates) {
    const resolved = resolveFromPricingMap(candidate, keyCandidates, "official");
    if (resolved) return resolved;
  }

  for (const candidate of candidates) {
    const resolved = resolveDetailedFallback(candidate);
    if (resolved) return resolved;
  }

  for (const candidate of candidates) {
    const resolved = resolveTopLevel(candidate);
    if (resolved) return resolved;
  }

  return null;
}
