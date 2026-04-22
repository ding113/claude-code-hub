import {
  Azure,
  Baichuan,
  Bedrock,
  Claude,
  Cohere,
  DeepSeek,
  Doubao,
  Fireworks,
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
import {
  type PublicStatusVendorIconKey,
  resolvePublicStatusVendorIconKey,
} from "./vendor-icon-key";

const PUBLIC_STATUS_VENDOR_ICON_REGISTRY: Record<
  PublicStatusVendorIconKey,
  ComponentType<{ className?: string }>
> = {
  anthropic: Claude.Color,
  azure: Azure,
  baichuan: Baichuan.Color,
  bedrock: Bedrock,
  cohere: Cohere.Color,
  deepseek: DeepSeek.Color,
  fireworks: Fireworks.Color,
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
};

export function getPublicStatusVendorIconComponent(input: {
  modelName: string;
  vendorIconKey?: string | null;
  providerTypeOverride?: import("@/types/provider").ProviderType;
}): {
  iconKey: PublicStatusVendorIconKey;
  Icon: ComponentType<{ className?: string }>;
} {
  const iconKey = resolvePublicStatusVendorIconKey(input);
  return {
    iconKey,
    Icon: PUBLIC_STATUS_VENDOR_ICON_REGISTRY[iconKey],
  };
}
