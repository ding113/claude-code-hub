import { describe, expect, it } from "vitest";
import {
  inferVendorFromModelName,
  isHostPrefix,
  keywordScan,
  stripRegionPrefix,
  UNKNOWN_VENDOR,
  vendorDisplayName,
  vendorOfPrefix,
} from "./vendor-inference";

describe("inferVendorFromModelName", () => {
  const cases: Array<{ modelId: string; expected: string }> = [
    // 主力厂商裸名
    { modelId: "claude-sonnet-4-5-20250929", expected: "anthropic" },
    { modelId: "claude-3-opus-20240229", expected: "anthropic" },
    { modelId: "gpt-4o-mini", expected: "openai" },
    { modelId: "gpt-5.5", expected: "openai" },
    { modelId: "chatgpt-4o-latest", expected: "openai" },
    { modelId: "o1-preview", expected: "openai" },
    { modelId: "o3-mini", expected: "openai" },
    { modelId: "dall-e-3", expected: "openai" },
    { modelId: "gemini-2.5-pro", expected: "google" },
    { modelId: "gemma-2-27b", expected: "google" },
    { modelId: "imagen-3.0-generate-002", expected: "google" },
    { modelId: "deepseek-chat", expected: "deepseek" },
    { modelId: "deepseek-reasoner", expected: "deepseek" },
    { modelId: "mistral-large-latest", expected: "mistral" },
    { modelId: "mixtral-8x7b-instruct", expected: "mistral" },
    { modelId: "codestral-latest", expected: "mistral" },
    { modelId: "pixtral-large", expected: "mistral" },
    { modelId: "ministral-8b", expected: "mistral" },
    { modelId: "llama-3.1-70b", expected: "meta" },
    { modelId: "codellama-34b", expected: "meta" },
    { modelId: "qwen-turbo-latest", expected: "alibaba" },
    { modelId: "qwq-32b", expected: "alibaba" },
    { modelId: "command-r-plus", expected: "cohere" },
    { modelId: "grok-2", expected: "xai" },
    { modelId: "pplx-70b-online", expected: "perplexity" },
    { modelId: "sonar-pro", expected: "perplexity" },
    { modelId: "doubao-pro-32k", expected: "bytedance" },
    { modelId: "seed-1.6-thinking", expected: "bytedance" },
    { modelId: "seedance-1-0-pro", expected: "bytedance" },
    { modelId: "chatglm-4", expected: "zhipuai" },
    { modelId: "glm-4-plus", expected: "zhipuai" },
    { modelId: "minimax-pro", expected: "minimax" },
    { modelId: "abab-6.5", expected: "minimax" },
    { modelId: "MiniMax-M3", expected: "minimax" },
    { modelId: "MiniMax-M2.7", expected: "minimax" },
    { modelId: "kimi-k2", expected: "moonshotai" },
    { modelId: "moonshot-v1-8k", expected: "moonshotai" },
    { modelId: "yi-lightning", expected: "01-ai" },
    { modelId: "step-2-16k", expected: "stepfun" },
    { modelId: "baichuan-4", expected: "baichuan" },
    { modelId: "sensenova-5.5", expected: "sensenova" },
    { modelId: "spark-max-32k", expected: "iflytek" },
    { modelId: "hunyuan-pro", expected: "tencent" },
    { modelId: "wenxin-4", expected: "baidu" },
    { modelId: "ernie-4.0-8k", expected: "baidu" },
    { modelId: "nvidia-nemotron-4-340b", expected: "nvidia" },
    { modelId: "internlm2-20b", expected: "internlm" },
    { modelId: "granite-3.1-8b", expected: "ibm" },
    { modelId: "jamba-1.5-large", expected: "ai21" },
    { modelId: "phi-4", expected: "microsoft" },
    { modelId: "falcon-180b", expected: "tii" },
    { modelId: "flux-pro-1.1", expected: "bfl" },
    { modelId: "360gpt2-pro", expected: "360" },
    // 蒸馏/衍生名归发布方
    { modelId: "deepseek-r1-distill-qwen-32b", expected: "deepseek" },
    { modelId: "llama-3.1-nemotron-70b", expected: "nvidia" },
    // 带 vendor 前缀的斜杠调用名
    { modelId: "anthropic/claude-sonnet-4-5", expected: "anthropic" },
    { modelId: "openai/gpt-5.5", expected: "openai" },
    { modelId: "deepseek-ai/DeepSeek-V3.2", expected: "deepseek" },
    { modelId: "meta-llama/llama-3.3-70b-instruct", expected: "meta" },
    { modelId: "x-ai/grok-4", expected: "xai" },
    { modelId: "z-ai/glm-4.7", expected: "zhipuai" },
    // 托管商前缀跳过 org、按模型段识别
    { modelId: "openrouter/deepseek/deepseek-chat", expected: "deepseek" },
    { modelId: "together/meta-llama/Llama-3-70b", expected: "meta" },
    { modelId: "hf/deepseek-ai/DeepSeek-V3.2", expected: "deepseek" },
    { modelId: "novita/qwen/qwen3-32b", expected: "alibaba" },
    // Cloudflare Workers AI
    { modelId: "@cf/meta/llama-3-8b-instruct", expected: "meta" },
    { modelId: "@cf/facebook/bart-large-cnn", expected: "meta" },
    // bedrock 区域/点前缀
    { modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0", expected: "anthropic" },
    { modelId: "eu.amazon.nova-pro-v1:0", expected: "amazon" },
    // 托管商前缀污染的扁平名
    { modelId: "coding-glm-4.7", expected: "zhipuai" },
    // LobeHub 品牌兜底
    { modelId: "hailuo-video-01", expected: "minimax" },
    { modelId: "stability-sd3.5-large", expected: "stability" },
    { modelId: "suno-v4", expected: "suno" },
  ];

  it.each(cases)("infers '$modelId' -> $expected", ({ modelId, expected }) => {
    expect(inferVendorFromModelName(modelId)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(inferVendorFromModelName("Claude-Sonnet-4-5")).toBe("anthropic");
    expect(inferVendorFromModelName("GPT-4o")).toBe("openai");
    expect(inferVendorFromModelName("DEEPSEEK-CHAT")).toBe("deepseek");
  });

  it("returns 'other' for unknown models", () => {
    expect(inferVendorFromModelName("custom-model-v2")).toBe(UNKNOWN_VENDOR);
    expect(inferVendorFromModelName("some-random-thing")).toBe(UNKNOWN_VENDOR);
    expect(inferVendorFromModelName("")).toBe(UNKNOWN_VENDOR);
  });

  it("prefers publisher keyword over host org", () => {
    // fireworks 是托管商,应识别到 qwen -> alibaba
    expect(inferVendorFromModelName("fireworks/models/qwen2p5-14b-instruct")).toBe("alibaba");
  });
});

describe("stripRegionPrefix", () => {
  it("strips bedrock region prefixes iteratively", () => {
    expect(stripRegionPrefix("us.anthropic.claude-3")).toBe("anthropic.claude-3");
    expect(stripRegionPrefix("us-gov.anthropic.claude-3")).toBe("anthropic.claude-3");
    expect(stripRegionPrefix("claude-3")).toBe("claude-3");
  });
});

describe("vendorOfPrefix", () => {
  it("normalizes known prefixes", () => {
    expect(vendorOfPrefix("qwen")).toBe("alibaba");
    expect(vendorOfPrefix("volcengine")).toBe("bytedance");
    expect(vendorOfPrefix("moonshot")).toBe("moonshotai");
    expect(vendorOfPrefix("unknown-org")).toBeUndefined();
    expect(vendorOfPrefix(undefined)).toBeUndefined();
  });
});

describe("keywordScan", () => {
  it("applies first-match ordering (deepseek before qwen)", () => {
    expect(keywordScan("deepseek-r1-distill-qwen-32b")).toBe("deepseek");
  });
});

describe("isHostPrefix", () => {
  it("recognizes hosting orgs", () => {
    expect(isHostPrefix("openrouter")).toBe(true);
    expect(isHostPrefix("HF")).toBe(true);
    expect(isHostPrefix("anthropic")).toBe(false);
  });
});

describe("vendorDisplayName", () => {
  it("resolves known display names and falls back to slug", () => {
    expect(vendorDisplayName("bfl")).toBe("Black Forest Labs");
    expect(vendorDisplayName("anthropic")).toBe("Anthropic");
    expect(vendorDisplayName("unregistered-vendor")).toBe("unregistered-vendor");
  });
});
