export interface ModelVendorRule {
  prefix: string;
  hasColor: boolean;
  i18nKey: string;
  litellmProvider?: string;
}

// Strictly sorted by prefix length descending to ensure longest-match-first.
// Within same length, sorted alphabetically.
export const MODEL_VENDOR_RULES: ModelVendorRule[] = [
  {
    prefix: "codestral",
    hasColor: true,
    i18nKey: "mistral",
    litellmProvider: "mistral",
  },
  { prefix: "sensenova", hasColor: true, i18nKey: "sensenova" },
  { prefix: "baichuan", hasColor: true, i18nKey: "baichuan" },
  {
    prefix: "deepseek",
    hasColor: true,
    i18nKey: "deepseek",
    litellmProvider: "deepseek",
  },
  { prefix: "internlm", hasColor: true, i18nKey: "internlm" },
  { prefix: "moonshot", hasColor: false, i18nKey: "moonshot" },
  {
    prefix: "chatglm",
    hasColor: true,
    i18nKey: "zhipuai",
    litellmProvider: "zhipuai",
  },
  {
    prefix: "chatgpt",
    hasColor: false,
    i18nKey: "openai",
    litellmProvider: "openai",
  },
  {
    prefix: "command",
    hasColor: true,
    i18nKey: "cohere",
    litellmProvider: "cohere_chat",
  },
  { prefix: "hunyuan", hasColor: true, i18nKey: "hunyuan" },
  { prefix: "minimax", hasColor: true, i18nKey: "minimax" },
  {
    prefix: "mistral",
    hasColor: true,
    i18nKey: "mistral",
    litellmProvider: "mistral",
  },
  {
    prefix: "mixtral",
    hasColor: true,
    i18nKey: "mistral",
    litellmProvider: "mistral",
  },
  {
    prefix: "pixtral",
    hasColor: true,
    i18nKey: "mistral",
    litellmProvider: "mistral",
  },
  {
    prefix: "claude",
    hasColor: true,
    i18nKey: "anthropic",
    litellmProvider: "anthropic",
  },
  {
    prefix: "doubao",
    hasColor: true,
    i18nKey: "volcengine",
    litellmProvider: "volcengine",
  },
  {
    prefix: "gemini",
    hasColor: true,
    i18nKey: "vertex",
    litellmProvider: "vertex_ai-language-models",
  },
  { prefix: "nvidia", hasColor: true, i18nKey: "nvidia" },
  { prefix: "wenxin", hasColor: true, i18nKey: "wenxin" },
  { prefix: "ernie", hasColor: true, i18nKey: "wenxin" },
  { prefix: "gemma", hasColor: true, i18nKey: "gemma" },
  { prefix: "llama", hasColor: true, i18nKey: "meta" },
  { prefix: "sonar", hasColor: true, i18nKey: "perplexity" },
  { prefix: "spark", hasColor: true, i18nKey: "spark" },
  { prefix: "abab", hasColor: true, i18nKey: "minimax" },
  { prefix: "grok", hasColor: false, i18nKey: "xai", litellmProvider: "xai" },
  { prefix: "kimi", hasColor: true, i18nKey: "kimi" },
  { prefix: "pplx", hasColor: true, i18nKey: "perplexity" },
  { prefix: "qwen", hasColor: true, i18nKey: "qwen" },
  {
    prefix: "seed",
    hasColor: true,
    i18nKey: "volcengine",
    litellmProvider: "volcengine",
  },
  { prefix: "step", hasColor: true, i18nKey: "stepfun" },
  {
    prefix: "glm",
    hasColor: true,
    i18nKey: "zhipuai",
    litellmProvider: "zhipuai",
  },
  { prefix: "gpt", hasColor: false, i18nKey: "openai", litellmProvider: "openai" },
  { prefix: "o1", hasColor: false, i18nKey: "openai", litellmProvider: "openai" },
  { prefix: "o3", hasColor: false, i18nKey: "openai", litellmProvider: "openai" },
  { prefix: "o4", hasColor: false, i18nKey: "openai", litellmProvider: "openai" },
  { prefix: "yi", hasColor: true, i18nKey: "yi" },
];

export function getModelVendor(modelId: string): ModelVendorRule | null {
  if (!modelId) return null;
  const lower = modelId.toLowerCase();
  for (const rule of MODEL_VENDOR_RULES) {
    if (lower.startsWith(rule.prefix)) {
      return rule;
    }
  }
  return null;
}
