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

export interface ModelVendorEntry {
  prefix: string;
  icon: React.ComponentType<{ className?: string }>;
  hasColor: boolean;
  i18nKey: string;
  litellmProvider?: string;
}

// Sorted by prefix length descending to ensure longest-match-first
const MODEL_VENDOR_RULES: ModelVendorEntry[] = [
  {
    prefix: "codestral",
    icon: Mistral.Color,
    hasColor: true,
    i18nKey: "mistral",
    litellmProvider: "mistral",
  },
  { prefix: "sensenova", icon: SenseNova.Color, hasColor: true, i18nKey: "sensenova" },
  { prefix: "internlm", icon: InternLM.Color, hasColor: true, i18nKey: "internlm" },
  { prefix: "moonshot", icon: Moonshot, hasColor: false, i18nKey: "moonshot" },
  {
    prefix: "deepseek",
    icon: DeepSeek.Color,
    hasColor: true,
    i18nKey: "deepseek",
    litellmProvider: "deepseek",
  },
  { prefix: "hunyuan", icon: Hunyuan.Color, hasColor: true, i18nKey: "hunyuan" },
  {
    prefix: "command",
    icon: Cohere.Color,
    hasColor: true,
    i18nKey: "cohere",
    litellmProvider: "cohere_chat",
  },
  {
    prefix: "chatglm",
    icon: ChatGLM.Color,
    hasColor: true,
    i18nKey: "zhipuai",
    litellmProvider: "zhipuai",
  },
  {
    prefix: "chatgpt",
    icon: OpenAI,
    hasColor: false,
    i18nKey: "openai",
    litellmProvider: "openai",
  },
  { prefix: "baichuan", icon: Baichuan.Color, hasColor: true, i18nKey: "baichuan" },
  {
    prefix: "mixtral",
    icon: Mistral.Color,
    hasColor: true,
    i18nKey: "mistral",
    litellmProvider: "mistral",
  },
  {
    prefix: "mistral",
    icon: Mistral.Color,
    hasColor: true,
    i18nKey: "mistral",
    litellmProvider: "mistral",
  },
  { prefix: "minimax", icon: Minimax.Color, hasColor: true, i18nKey: "minimax" },
  {
    prefix: "pixtral",
    icon: Mistral.Color,
    hasColor: true,
    i18nKey: "mistral",
    litellmProvider: "mistral",
  },
  { prefix: "nvidia", icon: Nvidia.Color, hasColor: true, i18nKey: "nvidia" },
  {
    prefix: "claude",
    icon: Claude.Color,
    hasColor: true,
    i18nKey: "anthropic",
    litellmProvider: "anthropic",
  },
  {
    prefix: "gemini",
    icon: Gemini.Color,
    hasColor: true,
    i18nKey: "vertex",
    litellmProvider: "vertex_ai-language-models",
  },
  { prefix: "wenxin", icon: Wenxin.Color, hasColor: true, i18nKey: "wenxin" },
  {
    prefix: "doubao",
    icon: Doubao.Color,
    hasColor: true,
    i18nKey: "volcengine",
    litellmProvider: "volcengine",
  },
  { prefix: "gemma", icon: Gemma.Color, hasColor: true, i18nKey: "gemma" },
  { prefix: "llama", icon: Meta.Color, hasColor: true, i18nKey: "meta" },
  { prefix: "spark", icon: Spark.Color, hasColor: true, i18nKey: "spark" },
  { prefix: "sonar", icon: Perplexity.Color, hasColor: true, i18nKey: "perplexity" },
  { prefix: "ernie", icon: Wenxin.Color, hasColor: true, i18nKey: "wenxin" },
  { prefix: "qwen", icon: Qwen.Color, hasColor: true, i18nKey: "qwen" },
  { prefix: "step", icon: Stepfun.Color, hasColor: true, i18nKey: "stepfun" },
  {
    prefix: "seed",
    icon: Doubao.Color,
    hasColor: true,
    i18nKey: "volcengine",
    litellmProvider: "volcengine",
  },
  { prefix: "pplx", icon: Perplexity.Color, hasColor: true, i18nKey: "perplexity" },
  { prefix: "kimi", icon: Kimi.Color, hasColor: true, i18nKey: "kimi" },
  { prefix: "grok", icon: Grok, hasColor: false, i18nKey: "xai", litellmProvider: "xai" },
  { prefix: "abab", icon: Minimax.Color, hasColor: true, i18nKey: "minimax" },
  {
    prefix: "glm",
    icon: ChatGLM.Color,
    hasColor: true,
    i18nKey: "zhipuai",
    litellmProvider: "zhipuai",
  },
  { prefix: "gpt", icon: OpenAI, hasColor: false, i18nKey: "openai", litellmProvider: "openai" },
  { prefix: "yi", icon: Yi.Color, hasColor: true, i18nKey: "yi" },
  { prefix: "o1", icon: OpenAI, hasColor: false, i18nKey: "openai", litellmProvider: "openai" },
  { prefix: "o3", icon: OpenAI, hasColor: false, i18nKey: "openai", litellmProvider: "openai" },
  { prefix: "o4", icon: OpenAI, hasColor: false, i18nKey: "openai", litellmProvider: "openai" },
];

export function getModelVendor(modelId: string): ModelVendorEntry | null {
  if (!modelId) return null;
  const lower = modelId.toLowerCase();
  for (const rule of MODEL_VENDOR_RULES) {
    if (lower.startsWith(rule.prefix)) {
      return rule;
    }
  }
  return null;
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
