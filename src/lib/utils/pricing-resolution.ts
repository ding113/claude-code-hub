import type { ModelPrice, ModelPriceData } from "@/types/model-price";
import type { Provider } from "@/types/provider";
import { hasValidPriceData } from "./price-data";

export type ResolvedPricingSource =
  | "local_manual"
  | "cloud_exact"
  | "cloud_model_fallback"
  | "cloud_official"
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

const PROVIDER_DETAIL_FIELDS = [
  "input_cost_per_token",
  "output_cost_per_token",
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
] as const;

const DETAIL_SCORE_OBJECT_FIELDS = ["long_context_pricing"] as const;

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

/**
 * vendor -> 视为"官方价"的 provider key 集合。
 * 与云端价格表生成侧的 OFFICIAL_PROVIDER_EXTRA 对齐:与 vendor 同名的 provider 即官方,
 * 此表登记额外的官方渠道(如 Google 的 gemini API 与 Vertex 都是第一方价)。
 */
const OFFICIAL_PROVIDER_EXTRA: Record<string, string[]> = {
  google: ["google-vertex"],
  amazon: ["amazon-bedrock"],
  alibaba: ["qwen"],
  zhipuai: ["z-ai"],
  bytedance: ["volcengine"],
  meta: ["llama"],
};

function getOfficialProviderKeys(
  modelName: string | null | undefined,
  priceData?: ModelPriceData
): string[] {
  // 云端价格表带 vendor 字段时,官方 provider 由数据侧决定
  const vendor = normalizeText(typeof priceData?.vendor === "string" ? priceData.vendor : "");
  if (vendor) {
    return [vendor, ...(OFFICIAL_PROVIDER_EXTRA[vendor] ?? [])];
  }

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
    return ["google", "google-vertex", "vertex_ai", "vertex"];
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
    pushUnique(candidates, "google", "exact");
    pushUnique(candidates, "google-vertex", "exact");
    pushUnique(candidates, "vertex_ai", "exact");
    pushUnique(candidates, "vertex", "exact");
  }
  if (name.includes("bedrock") || host.includes("amazonaws.com")) {
    pushUnique(candidates, "amazon-bedrock", "exact");
    pushUnique(candidates, "bedrock", "exact");
  }
  if (name.includes("deepseek") || host.includes("deepseek.com")) {
    pushUnique(candidates, "deepseek", "exact");
  }
  if (name.includes("moonshot") || name.includes("kimi") || host.includes("moonshot")) {
    pushUnique(candidates, "moonshotai", "exact");
  }
  if (name.includes("siliconflow") || host.includes("siliconflow")) {
    pushUnique(candidates, "siliconflow", "exact");
  }
  if (name.includes("volcengine") || name.includes("doubao") || host.includes("volces.com")) {
    pushUnique(candidates, "volcengine", "exact");
  }
  if (name.includes("dashscope") || host.includes("dashscope") || host.includes("aliyun")) {
    pushUnique(candidates, "alibaba", "exact");
    pushUnique(candidates, "alibaba-cn", "exact");
  }
  if (name.includes("groq") || host.includes("groq.com")) {
    pushUnique(candidates, "groq", "exact");
  }
  if (name.includes("xai") || name.includes("grok") || host.includes("x.ai")) {
    pushUnique(candidates, "xai", "exact");
  }
  if (name.includes("mistral") || host.includes("mistral.ai")) {
    pushUnique(candidates, "mistral", "exact");
  }
  if (name.includes("zhipu") || name.includes("bigmodel") || host.includes("bigmodel.cn")) {
    pushUnique(candidates, "zhipuai", "exact");
    pushUnique(candidates, "z-ai", "exact");
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

  // 价格节点切换时，先清空上一 provider 遗留的明细价格字段，
  // 再叠加当前 provider 的 pricing 节点，避免把别家 above_200k/272k
  // 等字段残留到当前解析结果里。
  const clearedBase: ModelPriceData = { ...base };
  for (const field of PROVIDER_DETAIL_FIELDS) {
    delete clearedBase[field];
  }

  return {
    ...clearedBase,
    ...pricingNode,
    pricing: base.pricing,
    selected_pricing_provider: pricingProviderKey,
  };
}

function getDetailScore(pricingNode: Record<string, unknown>): number {
  const numericScore = PROVIDER_DETAIL_FIELDS.reduce((score, field) => {
    const value = pricingNode[field];
    return typeof value === "number" && Number.isFinite(value) ? score + 1 : score;
  }, 0);

  const objectScore = DETAIL_SCORE_OBJECT_FIELDS.reduce((score, field) => {
    const value = pricingNode[field];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return score;
    }
    return Object.keys(value).length > 0 ? score + 1 : score;
  }, 0);

  return numericScore + objectScore;
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

/**
 * 云端价格表数据驱动的官方价选择:
 * 优先 official_pricing_provider 指名的节点,其次任意 official=true 的节点。
 */
function resolveCloudOfficial(candidate: ModelRecordCandidate): ResolvedPricing | null {
  const pricingMap = getPricingMap(candidate.record);
  if (!candidate.record || !pricingMap) {
    return null;
  }

  const declaredKey = candidate.record.priceData.official_pricing_provider;
  const officialKeys: string[] = [];
  if (typeof declaredKey === "string" && declaredKey && pricingMap[declaredKey]) {
    officialKeys.push(declaredKey);
  }
  for (const [key, node] of Object.entries(pricingMap)) {
    if (node?.official === true && !officialKeys.includes(key)) {
      officialKeys.push(key);
    }
  }

  for (const key of officialKeys) {
    const pricingNode = pricingMap[key];
    // 校验节点自身价格:merge 后的整表校验会被 pricing 映射里其他节点"带过",
    // 选中无价格节点会让顶层计费字段为空
    if (!pricingNode || !hasValidPriceData(pricingNode as ModelPriceData)) continue;
    const mergedPriceData = mergePriceData(candidate.record.priceData, pricingNode, key);
    if (!hasValidPriceData(mergedPriceData)) continue;

    return {
      resolvedModelName: candidate.modelName ?? candidate.record.modelName,
      resolvedPricingProviderKey: key,
      source: "cloud_official",
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

  // 官方节点优先,再按明细字段数排序;首选节点数据无效时继续尝试后续节点
  const keys = Object.keys(pricingMap).sort((a, b) => {
    const officialA = pricingMap[a]?.official === true ? 0 : 1;
    const officialB = pricingMap[b]?.official === true ? 0 : 1;
    if (officialA !== officialB) return officialA - officialB;
    return compareDetailKeys(a, b, pricingMap);
  });

  for (const selectedKey of keys) {
    const pricingNode = pricingMap[selectedKey];
    // 同 resolveCloudOfficial:节点自身必须携带有效价格,否则继续尝试后续节点
    if (!pricingNode || !hasValidPriceData(pricingNode as ModelPriceData)) {
      continue;
    }
    const mergedPriceData = mergePriceData(candidate.record.priceData, pricingNode, selectedKey);
    if (!hasValidPriceData(mergedPriceData)) {
      continue;
    }

    return {
      resolvedModelName: candidate.modelName ?? candidate.record.modelName,
      resolvedPricingProviderKey: selectedKey,
      source: "priority_fallback",
      priceData: mergedPriceData,
      pricingNode,
    };
  }

  return null;
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
    (typeof candidate.record.priceData.official_pricing_provider === "string" &&
      candidate.record.priceData.official_pricing_provider.trim()) ||
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

  // 云端价格表标注的官方报价(数据驱动)优先于按模型名推断的官方回退
  for (const candidate of candidates) {
    const resolved = resolveCloudOfficial(candidate);
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
