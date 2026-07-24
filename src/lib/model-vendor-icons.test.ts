import { describe, expect, it } from "vitest";
import { getModelVendor, getVendorEntry, getVendorIconComponent } from "./model-vendor-icons";

describe("getModelVendor", () => {
  const cases: Array<{ modelId: string; expectedVendor: string | null }> = [
    { modelId: "claude-sonnet-4-5-20250929", expectedVendor: "anthropic" },
    { modelId: "gpt-4o-mini", expectedVendor: "openai" },
    { modelId: "chatgpt-4o-latest", expectedVendor: "openai" },
    { modelId: "o1-preview", expectedVendor: "openai" },
    { modelId: "gemini-2.5-pro", expectedVendor: "google" },
    { modelId: "deepseek-chat", expectedVendor: "deepseek" },
    { modelId: "mistral-large-latest", expectedVendor: "mistral" },
    { modelId: "mixtral-8x7b-instruct", expectedVendor: "mistral" },
    { modelId: "llama-3.1-70b", expectedVendor: "meta" },
    { modelId: "qwen-turbo-latest", expectedVendor: "alibaba" },
    { modelId: "command-r-plus", expectedVendor: "cohere" },
    { modelId: "grok-2", expectedVendor: "xai" },
    { modelId: "sonar-pro", expectedVendor: "perplexity" },
    { modelId: "doubao-pro-32k", expectedVendor: "bytedance" },
    { modelId: "glm-4-plus", expectedVendor: "zhipuai" },
    { modelId: "kimi-k2", expectedVendor: "moonshotai" },
    { modelId: "MiniMax-M3", expectedVendor: "minimax" },
    { modelId: "MiniMax-M2.7", expectedVendor: "minimax" },
    { modelId: "yi-lightning", expectedVendor: "01-ai" },
    { modelId: "hunyuan-pro", expectedVendor: "tencent" },
    { modelId: "ernie-4.0-8k", expectedVendor: "baidu" },
    { modelId: "spark-max-32k", expectedVendor: "iflytek" },
    { modelId: "anthropic/claude-sonnet-4-5", expectedVendor: "anthropic" },
    { modelId: "openrouter/deepseek/deepseek-chat", expectedVendor: "deepseek" },
    { modelId: "unknown-model-xyz", expectedVendor: null },
    { modelId: "", expectedVendor: null },
  ];

  it.each(cases)("matches '$modelId' -> $expectedVendor", ({ modelId, expectedVendor }) => {
    const result = getModelVendor(modelId);
    if (expectedVendor === null) {
      expect(result).toBeNull();
    } else {
      expect(result).not.toBeNull();
      expect(result?.vendor).toBe(expectedVendor);
      expect(result?.displayName.length).toBeGreaterThan(0);
    }
  });

  it("provides a bundled icon component for major vendors", () => {
    for (const modelId of ["claude-3", "gpt-4o", "gemini-2.5-pro", "deepseek-chat"]) {
      expect(getModelVendor(modelId)?.icon).toBeTruthy();
    }
  });

  it("provides icon files aligned with the cloud icon map", () => {
    expect(getModelVendor("claude-3")?.iconFile?.file).toBe("anthropic.svg");
    expect(getModelVendor("claude-3")?.iconFile?.mono).toBe(true);
    expect(getModelVendor("deepseek-chat")?.iconFile?.file).toBe("deepseek-color.svg");
  });
});

describe("getVendorIconComponent", () => {
  it("resolves exact vendor slugs", () => {
    expect(getVendorIconComponent("anthropic")).toBeTruthy();
    expect(getVendorIconComponent("openai")).toBeTruthy();
    expect(getVendorIconComponent("amazon-bedrock")).toBeTruthy();
  });

  it("falls back by longest dash-prefix family", () => {
    // alibaba-coding-plan-cn -> alibaba
    expect(getVendorIconComponent("alibaba-coding-plan-cn")).toBe(
      getVendorIconComponent("alibaba")
    );
  });

  it("returns null for unknown slugs", () => {
    expect(getVendorIconComponent("definitely-unknown-vendor")).toBeNull();
    expect(getVendorIconComponent("")).toBeNull();
  });
});

describe("getVendorEntry", () => {
  it("resolves display name for registered vendors", () => {
    const entry = getVendorEntry("reka");
    expect(entry.vendor).toBe("reka");
    expect(entry.displayName).toBe("Reka");
  });

  it("keeps the slug as display name for unregistered vendors", () => {
    const entry = getVendorEntry("definitely-unknown-vendor");
    expect(entry.vendor).toBe("definitely-unknown-vendor");
    expect(entry.displayName).toBe("definitely-unknown-vendor");
  });
});
