import { describe, expect, it } from "vitest";
import { getModelVendor, PRICE_FILTER_VENDORS } from "./model-vendor-icons";

describe("getModelVendor", () => {
  const cases: Array<{ modelId: string; expectedKey: string | null }> = [
    // Anthropic
    { modelId: "claude-sonnet-4-5-20250929", expectedKey: "anthropic" },
    { modelId: "claude-3-opus-20240229", expectedKey: "anthropic" },
    // OpenAI - gpt prefix
    { modelId: "gpt-4o-mini", expectedKey: "openai" },
    { modelId: "gpt-5.2-codex", expectedKey: "openai" },
    // OpenAI - chatgpt prefix
    { modelId: "chatgpt-4o-latest", expectedKey: "openai" },
    // OpenAI - o1/o3/o4 prefix
    { modelId: "o1-preview", expectedKey: "openai" },
    { modelId: "o3-mini", expectedKey: "openai" },
    { modelId: "o4-mini", expectedKey: "openai" },
    // Gemini
    { modelId: "gemini-2.5-pro", expectedKey: "vertex" },
    // DeepSeek
    { modelId: "deepseek-chat", expectedKey: "deepseek" },
    { modelId: "deepseek-reasoner", expectedKey: "deepseek" },
    // Mistral family
    { modelId: "mistral-large-latest", expectedKey: "mistral" },
    { modelId: "mixtral-8x7b-instruct", expectedKey: "mistral" },
    { modelId: "codestral-latest", expectedKey: "mistral" },
    { modelId: "pixtral-large", expectedKey: "mistral" },
    // Meta
    { modelId: "llama-3.1-70b", expectedKey: "meta" },
    // Qwen
    { modelId: "qwen-turbo-latest", expectedKey: "qwen" },
    // Cohere
    { modelId: "command-r-plus", expectedKey: "cohere" },
    // Grok (xAI)
    { modelId: "grok-2", expectedKey: "xai" },
    // Perplexity
    { modelId: "pplx-70b-online", expectedKey: "perplexity" },
    { modelId: "sonar-pro", expectedKey: "perplexity" },
    // Doubao / Volcengine
    { modelId: "doubao-pro-32k", expectedKey: "volcengine" },
    { modelId: "seed-1.6-thinking", expectedKey: "volcengine" },
    // Zhipu
    { modelId: "chatglm-4", expectedKey: "zhipuai" },
    { modelId: "glm-4-plus", expectedKey: "zhipuai" },
    // Minimax
    { modelId: "minimax-pro", expectedKey: "minimax" },
    { modelId: "abab-6.5", expectedKey: "minimax" },
    // Kimi
    { modelId: "kimi-k1.5", expectedKey: "kimi" },
    // Moonshot
    { modelId: "moonshot-v1-8k", expectedKey: "moonshot" },
    // Yi
    { modelId: "yi-lightning", expectedKey: "yi" },
    // Stepfun
    { modelId: "step-2-16k", expectedKey: "stepfun" },
    // Baichuan
    { modelId: "baichuan-4", expectedKey: "baichuan" },
    // SenseNova
    { modelId: "sensenova-5.5", expectedKey: "sensenova" },
    // Spark
    { modelId: "spark-4.0-ultra", expectedKey: "spark" },
    // Hunyuan
    { modelId: "hunyuan-pro", expectedKey: "hunyuan" },
    // Wenxin / Ernie
    { modelId: "wenxin-4", expectedKey: "wenxin" },
    { modelId: "ernie-4.0-8k", expectedKey: "wenxin" },
    // Gemma
    { modelId: "gemma-2-27b", expectedKey: "gemma" },
    // Nvidia
    { modelId: "nvidia-nemotron-4-340b", expectedKey: "nvidia" },
    // InternLM
    { modelId: "internlm2-20b", expectedKey: "internlm" },
  ];

  it.each(cases)("matches '$modelId' -> $expectedKey", ({ modelId, expectedKey }) => {
    const result = getModelVendor(modelId);
    if (expectedKey === null) {
      expect(result).toBeNull();
    } else {
      expect(result).not.toBeNull();
      expect(result!.i18nKey).toBe(expectedKey);
    }
  });

  it("is case-insensitive", () => {
    expect(getModelVendor("Claude-Sonnet-4-5")?.i18nKey).toBe("anthropic");
    expect(getModelVendor("GPT-4o")?.i18nKey).toBe("openai");
    expect(getModelVendor("DEEPSEEK-CHAT")?.i18nKey).toBe("deepseek");
  });

  it("returns null for unknown models", () => {
    expect(getModelVendor("unknown-model")).toBeNull();
    expect(getModelVendor("custom-model-v2")).toBeNull();
    expect(getModelVendor("some-random-thing")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getModelVendor("")).toBeNull();
  });

  it("resolves chatglm before glm (longest prefix wins)", () => {
    const chatglm = getModelVendor("chatglm-4");
    const glm = getModelVendor("glm-4-plus");
    expect(chatglm?.prefix).toBe("chatglm");
    expect(glm?.prefix).toBe("glm");
    // Both map to zhipuai
    expect(chatglm?.i18nKey).toBe("zhipuai");
    expect(glm?.i18nKey).toBe("zhipuai");
  });

  it("resolves grok vs gpt correctly", () => {
    expect(getModelVendor("grok-2")?.i18nKey).toBe("xai");
    expect(getModelVendor("gpt-4o")?.i18nKey).toBe("openai");
  });

  it("exact prefix match works", () => {
    // Model ID equals exactly the prefix
    expect(getModelVendor("gpt")?.i18nKey).toBe("openai");
    expect(getModelVendor("o1")?.i18nKey).toBe("openai");
    expect(getModelVendor("yi")?.i18nKey).toBe("yi");
  });
});

describe("PRICE_FILTER_VENDORS", () => {
  it("has unique litellmProvider values", () => {
    const providers = PRICE_FILTER_VENDORS.map((v) => v.litellmProvider);
    expect(new Set(providers).size).toBe(providers.length);
  });

  it("has unique i18nKey values", () => {
    const keys = PRICE_FILTER_VENDORS.map((v) => v.i18nKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes core vendors", () => {
    const keys = PRICE_FILTER_VENDORS.map((v) => v.i18nKey);
    expect(keys).toContain("anthropic");
    expect(keys).toContain("openai");
    expect(keys).toContain("vertex");
    expect(keys).toContain("deepseek");
  });
});
