import {
  Azure,
  Baichuan,
  Bedrock,
  ChatGLM,
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
import { getModelVendor as getModelVendorRule, type ModelVendorRule } from "./model-vendor-rules";

export interface ModelVendorEntry extends ModelVendorRule {
  icon: React.ComponentType<{ className?: string }>;
}

const MODEL_VENDOR_ICON_BY_KEY: Record<string, React.ComponentType<{ className?: string }>> = {
  anthropic: Claude.Color,
  baichuan: Baichuan.Color,
  cohere: Cohere.Color,
  deepseek: DeepSeek.Color,
  gemma: Gemma.Color,
  hunyuan: Hunyuan.Color,
  internlm: InternLM.Color,
  kimi: Kimi.Color,
  meta: Meta.Color,
  minimax: Minimax.Color,
  mistral: Mistral.Color,
  moonshot: Moonshot,
  nvidia: Nvidia.Color,
  openai: OpenAI,
  perplexity: Perplexity.Color,
  qwen: Qwen.Color,
  sensenova: SenseNova.Color,
  spark: Spark.Color,
  stepfun: Stepfun.Color,
  vertex: Gemini.Color,
  volcengine: Doubao.Color,
  wenxin: Wenxin.Color,
  xai: Grok,
  yi: Yi.Color,
  zhipuai: ChatGLM.Color,
};

export function getModelVendor(modelId: string): ModelVendorEntry | null {
  const rule = getModelVendorRule(modelId);
  if (!rule) {
    return null;
  }

  const icon = MODEL_VENDOR_ICON_BY_KEY[rule.i18nKey];
  if (!icon && process.env.NODE_ENV !== "production") {
    console.warn(`[model-vendor-icons] No icon registered for i18nKey "${rule.i18nKey}"`);
  }

  return {
    ...rule,
    icon: icon ?? OpenAI,
  };
}

export const PRICE_FILTER_VENDORS: Array<{
  i18nKey: string;
  litellmProvider: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { i18nKey: "anthropic", litellmProvider: "anthropic", icon: Claude.Color },
  { i18nKey: "openai", litellmProvider: "openai", icon: OpenAI },
  { i18nKey: "vertex", litellmProvider: "vertex_ai-language-models", icon: Gemini.Color },
  { i18nKey: "deepseek", litellmProvider: "deepseek", icon: DeepSeek.Color },
  { i18nKey: "mistral", litellmProvider: "mistral", icon: Mistral.Color },
  { i18nKey: "meta", litellmProvider: "meta", icon: Meta.Color },
  { i18nKey: "cohere", litellmProvider: "cohere_chat", icon: Cohere.Color },
  { i18nKey: "xai", litellmProvider: "xai", icon: Grok },
  { i18nKey: "groq", litellmProvider: "groq", icon: Groq },
  { i18nKey: "bedrock", litellmProvider: "bedrock", icon: Bedrock.Color },
  { i18nKey: "azure", litellmProvider: "azure", icon: Azure.Color },
  { i18nKey: "together", litellmProvider: "together_ai", icon: Together.Color },
  { i18nKey: "nvidia", litellmProvider: "nvidia_nim", icon: Nvidia.Color },
  { i18nKey: "zhipuai", litellmProvider: "zhipuai", icon: Zhipu.Color },
  { i18nKey: "volcengine", litellmProvider: "volcengine", icon: Doubao.Color },
  { i18nKey: "minimax", litellmProvider: "minimax", icon: Minimax.Color },
  { i18nKey: "qwen", litellmProvider: "qwen", icon: Qwen.Color },
  { i18nKey: "fireworks", litellmProvider: "fireworks_ai", icon: Fireworks.Color },
  { i18nKey: "ollama", litellmProvider: "ollama", icon: Ollama },
  { i18nKey: "openrouter", litellmProvider: "openrouter", icon: OpenRouter },
];
