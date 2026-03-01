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

// Strictly sorted by prefix length descending to ensure longest-match-first.
// Within same length, sorted alphabetically.
const MODEL_VENDOR_RULES: ModelVendorEntry[] = [
  // 9 chars
  {
    prefix: "codestral",
    icon: Mistral.Color,
    hasColor: true,
    i18nKey: "mistral",
    litellmProvider: "mistral",
  },
  { prefix: "sensenova", icon: SenseNova.Color, hasColor: true, i18nKey: "sensenova" },
  // 8 chars
  { prefix: "baichuan", icon: Baichuan.Color, hasColor: true, i18nKey: "baichuan" },
  {
    prefix: "deepseek",
    icon: DeepSeek.Color,
    hasColor: true,
    i18nKey: "deepseek",
    litellmProvider: "deepseek",
  },
  { prefix: "internlm", icon: InternLM.Color, hasColor: true, i18nKey: "internlm" },
  { prefix: "moonshot", icon: Moonshot, hasColor: false, i18nKey: "moonshot" },
  // 7 chars
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
  {
    prefix: "command",
    icon: Cohere.Color,
    hasColor: true,
    i18nKey: "cohere",
    litellmProvider: "cohere_chat",
  },
  { prefix: "hunyuan", icon: Hunyuan.Color, hasColor: true, i18nKey: "hunyuan" },
  { prefix: "minimax", icon: Minimax.Color, hasColor: true, i18nKey: "minimax" },
  {
    prefix: "mistral",
    icon: Mistral.Color,
    hasColor: true,
    i18nKey: "mistral",
    litellmProvider: "mistral",
  },
  {
    prefix: "mixtral",
    icon: Mistral.Color,
    hasColor: true,
    i18nKey: "mistral",
    litellmProvider: "mistral",
  },
  {
    prefix: "pixtral",
    icon: Mistral.Color,
    hasColor: true,
    i18nKey: "mistral",
    litellmProvider: "mistral",
  },
  // 6 chars
  {
    prefix: "claude",
    icon: Claude.Color,
    hasColor: true,
    i18nKey: "anthropic",
    litellmProvider: "anthropic",
  },
  {
    prefix: "doubao",
    icon: Doubao.Color,
    hasColor: true,
    i18nKey: "volcengine",
    litellmProvider: "volcengine",
  },
  {
    prefix: "gemini",
    icon: Gemini.Color,
    hasColor: true,
    i18nKey: "vertex",
    litellmProvider: "vertex_ai-language-models",
  },
  { prefix: "nvidia", icon: Nvidia.Color, hasColor: true, i18nKey: "nvidia" },
  { prefix: "wenxin", icon: Wenxin.Color, hasColor: true, i18nKey: "wenxin" },
  // 5 chars
  { prefix: "ernie", icon: Wenxin.Color, hasColor: true, i18nKey: "wenxin" },
  { prefix: "gemma", icon: Gemma.Color, hasColor: true, i18nKey: "gemma" },
  { prefix: "llama", icon: Meta.Color, hasColor: true, i18nKey: "meta" },
  { prefix: "sonar", icon: Perplexity.Color, hasColor: true, i18nKey: "perplexity" },
  { prefix: "spark", icon: Spark.Color, hasColor: true, i18nKey: "spark" },
  // 4 chars
  { prefix: "abab", icon: Minimax.Color, hasColor: true, i18nKey: "minimax" },
  { prefix: "grok", icon: Grok, hasColor: false, i18nKey: "xai", litellmProvider: "xai" },
  { prefix: "kimi", icon: Kimi.Color, hasColor: true, i18nKey: "kimi" },
  { prefix: "pplx", icon: Perplexity.Color, hasColor: true, i18nKey: "perplexity" },
  { prefix: "qwen", icon: Qwen.Color, hasColor: true, i18nKey: "qwen" },
  {
    prefix: "seed",
    icon: Doubao.Color,
    hasColor: true,
    i18nKey: "volcengine",
    litellmProvider: "volcengine",
  },
  { prefix: "step", icon: Stepfun.Color, hasColor: true, i18nKey: "stepfun" },
  // 3 chars
  {
    prefix: "glm",
    icon: ChatGLM.Color,
    hasColor: true,
    i18nKey: "zhipuai",
    litellmProvider: "zhipuai",
  },
  { prefix: "gpt", icon: OpenAI, hasColor: false, i18nKey: "openai", litellmProvider: "openai" },
  // 2 chars
  { prefix: "o1", icon: OpenAI, hasColor: false, i18nKey: "openai", litellmProvider: "openai" },
  { prefix: "o3", icon: OpenAI, hasColor: false, i18nKey: "openai", litellmProvider: "openai" },
  { prefix: "o4", icon: OpenAI, hasColor: false, i18nKey: "openai", litellmProvider: "openai" },
  { prefix: "yi", icon: Yi.Color, hasColor: true, i18nKey: "yi" },
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
