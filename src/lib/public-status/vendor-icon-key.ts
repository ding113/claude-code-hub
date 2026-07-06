import { inferVendorFromModelName, UNKNOWN_VENDOR } from "@/lib/model-vendor/vendor-inference";
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
  // 云端价格表 vendor slug
  google: "gemini",
  "google-vertex": "gemini",
  alibaba: "qwen",
  bytedance: "volcengine",
  moonshotai: "moonshot",
  tencent: "hunyuan",
  baidu: "wenxin",
  iflytek: "spark",
  "01-ai": "yi",
  amazon: "bedrock",
  "amazon-bedrock": "bedrock",
};

// 云端价格表口径的 vendor slug -> 公开状态页 icon key
const MODEL_VENDOR_TO_PUBLIC_STATUS_ICON_KEY: Record<string, PublicStatusVendorIconKey> = {
  anthropic: "anthropic",
  azure: "azure",
  baichuan: "baichuan",
  bedrock: "bedrock",
  amazon: "bedrock",
  cohere: "cohere",
  deepseek: "deepseek",
  google: "gemini",
  groq: "groq",
  tencent: "hunyuan",
  internlm: "internlm",
  meta: "meta",
  minimax: "minimax",
  mistral: "mistral",
  moonshotai: "moonshot",
  nvidia: "nvidia",
  ollama: "ollama",
  openai: "openai",
  openrouter: "openrouter",
  perplexity: "perplexity",
  alibaba: "qwen",
  sensenova: "sensenova",
  iflytek: "spark",
  stepfun: "stepfun",
  together: "together",
  bytedance: "volcengine",
  baidu: "wenxin",
  xai: "xai",
  "01-ai": "yi",
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

  const inferredVendor = inferVendorFromModelName(input.modelName);
  if (inferredVendor !== UNKNOWN_VENDOR) {
    const normalizedKey = MODEL_VENDOR_TO_PUBLIC_STATUS_ICON_KEY[inferredVendor];
    if (normalizedKey) {
      return normalizedKey;
    }
  }

  return explicitKey ?? "generic";
}
