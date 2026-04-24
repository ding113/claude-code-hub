import { getModelVendor } from "@/lib/model-vendor-icons";
import type { ProviderType } from "@/types/provider";

export const PUBLIC_STATUS_VENDOR_ICON_KEYS = [
  "anthropic",
  "azure",
  "baichuan",
  "bedrock",
  "cohere",
  "deepseek",
  "fireworks",
  "gemini",
  "gemma",
  "generic",
  "groq",
  "hunyuan",
  "internlm",
  "kimi",
  "meta",
  "minimax",
  "mistral",
  "moonshot",
  "nvidia",
  "ollama",
  "openai",
  "openrouter",
  "perplexity",
  "qwen",
  "sensenova",
  "spark",
  "stepfun",
  "together",
  "volcengine",
  "wenxin",
  "xai",
  "yi",
  "zhipuai",
] as const;

export type PublicStatusVendorIconKey = (typeof PUBLIC_STATUS_VENDOR_ICON_KEYS)[number];

const PUBLIC_STATUS_VENDOR_ICON_KEY_SET = new Set<string>(PUBLIC_STATUS_VENDOR_ICON_KEYS);

const PROVIDER_TYPE_ICON_KEYS: Partial<Record<ProviderType, PublicStatusVendorIconKey>> = {
  "claude-auth": "anthropic",
  claude: "anthropic",
  codex: "openai",
  gemini: "gemini",
  "gemini-cli": "gemini",
};

const RAW_PROVIDER_TO_PUBLIC_STATUS_ICON_KEY: Record<string, PublicStatusVendorIconKey> = {
  anthropic: "anthropic",
  azure: "azure",
  bedrock: "bedrock",
  cohere_chat: "cohere",
  deepseek: "deepseek",
  fireworks_ai: "fireworks",
  groq: "groq",
  meta: "meta",
  minimax: "minimax",
  mistral: "mistral",
  nvidia_nim: "nvidia",
  ollama: "ollama",
  openai: "openai",
  openrouter: "openrouter",
  qwen: "qwen",
  together_ai: "together",
  "vertex_ai-language-models": "gemini",
  volcengine: "volcengine",
  xai: "xai",
  zhipuai: "zhipuai",
};

const MODEL_VENDOR_TO_PUBLIC_STATUS_ICON_KEY: Record<string, PublicStatusVendorIconKey> = {
  anthropic: "anthropic",
  azure: "azure",
  baichuan: "baichuan",
  bedrock: "bedrock",
  cohere: "cohere",
  deepseek: "deepseek",
  gemma: "gemma",
  groq: "groq",
  hunyuan: "hunyuan",
  internlm: "internlm",
  kimi: "kimi",
  meta: "meta",
  minimax: "minimax",
  mistral: "mistral",
  moonshot: "moonshot",
  nvidia: "nvidia",
  ollama: "ollama",
  openai: "openai",
  openrouter: "openrouter",
  perplexity: "perplexity",
  qwen: "qwen",
  sensenova: "sensenova",
  spark: "spark",
  stepfun: "stepfun",
  together: "together",
  vertex: "gemini",
  volcengine: "volcengine",
  wenxin: "wenxin",
  xai: "xai",
  yi: "yi",
  zhipuai: "zhipuai",
};

function normalizePublicStatusVendorIconKey(
  vendorIconKey?: string | null
): PublicStatusVendorIconKey | null {
  if (!vendorIconKey) {
    return null;
  }

  const normalized = vendorIconKey.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (Object.hasOwn(RAW_PROVIDER_TO_PUBLIC_STATUS_ICON_KEY, normalized)) {
    return RAW_PROVIDER_TO_PUBLIC_STATUS_ICON_KEY[normalized];
  }

  return PUBLIC_STATUS_VENDOR_ICON_KEY_SET.has(normalized)
    ? (normalized as PublicStatusVendorIconKey)
    : null;
}

export function resolvePublicStatusVendorIconKey(input: {
  modelName: string;
  vendorIconKey?: string | null;
  providerTypeOverride?: ProviderType;
}): PublicStatusVendorIconKey {
  const overrideKey = input.providerTypeOverride
    ? PROVIDER_TYPE_ICON_KEYS[input.providerTypeOverride]
    : undefined;
  if (overrideKey) {
    return overrideKey;
  }

  const explicitKey = normalizePublicStatusVendorIconKey(input.vendorIconKey);
  if (explicitKey && explicitKey !== "generic") {
    return explicitKey;
  }

  const matchedVendor = getModelVendor(input.modelName);
  if (matchedVendor) {
    const normalizedKey = MODEL_VENDOR_TO_PUBLIC_STATUS_ICON_KEY[matchedVendor.i18nKey];
    if (normalizedKey) {
      return normalizedKey;
    }
  }

  return explicitKey ?? "generic";
}
