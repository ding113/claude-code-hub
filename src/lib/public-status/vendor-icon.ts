import {
  Azure,
  Baichuan,
  Bedrock,
  Claude,
  Cohere,
  DeepSeek,
  Doubao,
  Gemini,
  Gemma,
  Grok,
  Groq,
  Hunyuan,
  InternLM,
  Kimi,
  Meta,
  Minimax,
  Mistral,
  Moonshot,
  Nvidia,
  Ollama,
  OpenAI,
  OpenRouter,
  Perplexity,
  Qwen,
  SenseNova,
  Spark,
  Stepfun,
  Together,
  Wenxin,
  Yi,
  Zhipu,
} from "@lobehub/icons";
import { Bot } from "lucide-react";
import type { ComponentType } from "react";
import { getModelVendor } from "@/lib/model-vendor-icons";
import type { ProviderType } from "@/types/provider";

const PUBLIC_STATUS_VENDOR_ICON_REGISTRY = {
  anthropic: Claude.Color,
  azure: Azure,
  baichuan: Baichuan.Color,
  bedrock: Bedrock,
  cohere: Cohere.Color,
  deepseek: DeepSeek.Color,
  gemini: Gemini.Color,
  gemma: Gemma.Color,
  generic: Bot,
  groq: Groq,
  hunyuan: Hunyuan.Color,
  internlm: InternLM.Color,
  kimi: Kimi.Color,
  meta: Meta.Color,
  minimax: Minimax.Color,
  mistral: Mistral.Color,
  moonshot: Moonshot,
  nvidia: Nvidia.Color,
  ollama: Ollama,
  openai: OpenAI,
  openrouter: OpenRouter,
  perplexity: Perplexity.Color,
  qwen: Qwen.Color,
  sensenova: SenseNova.Color,
  spark: Spark.Color,
  stepfun: Stepfun.Color,
  together: Together.Color,
  volcengine: Doubao.Color,
  wenxin: Wenxin.Color,
  xai: Grok,
  yi: Yi.Color,
  zhipuai: Zhipu.Color,
} satisfies Record<string, ComponentType<{ className?: string }>>;

export type PublicStatusVendorIconKey = keyof typeof PUBLIC_STATUS_VENDOR_ICON_REGISTRY;

const PROVIDER_TYPE_ICON_KEYS: Partial<Record<ProviderType, PublicStatusVendorIconKey>> = {
  "claude-auth": "anthropic",
  claude: "anthropic",
  codex: "openai",
  gemini: "gemini",
  "gemini-cli": "gemini",
  "openai-compatible": "openai",
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

  return normalized in PUBLIC_STATUS_VENDOR_ICON_REGISTRY
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

export function getPublicStatusVendorIconComponent(input: {
  modelName: string;
  vendorIconKey?: string | null;
  providerTypeOverride?: ProviderType;
}): {
  iconKey: PublicStatusVendorIconKey;
  Icon: ComponentType<{ className?: string }>;
} {
  const iconKey = resolvePublicStatusVendorIconKey(input);
  return {
    iconKey,
    Icon: PUBLIC_STATUS_VENDOR_ICON_REGISTRY[iconKey] ?? Bot,
  };
}
