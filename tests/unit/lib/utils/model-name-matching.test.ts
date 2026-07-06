import { describe, expect, it } from "vitest";
import { buildModelNameFallbackCandidates } from "@/lib/utils/model-name-matching";

describe("buildModelNameFallbackCandidates", () => {
  it("returns empty for blank input", () => {
    expect(buildModelNameFallbackCandidates("")).toEqual([]);
    expect(buildModelNameFallbackCandidates("   ")).toEqual([]);
  });

  it("does not include the original name", () => {
    const candidates = buildModelNameFallbackCandidates("claude-sonnet-4-5");
    expect(candidates).not.toContain("claude-sonnet-4-5");
  });

  it("produces the bare segment for vendor-prefixed names", () => {
    const candidates = buildModelNameFallbackCandidates("anthropic/claude-sonnet-4-5");
    expect(candidates).toContain("claude-sonnet-4-5");
  });

  it("strips host prefixes and keeps org/model remainder", () => {
    const candidates = buildModelNameFallbackCandidates("openrouter/deepseek/deepseek-v3.2");
    expect(candidates).toContain("deepseek/deepseek-v3.2");
    expect(candidates).toContain("deepseek-v3.2");
  });

  it("strips gateway call suffixes", () => {
    const candidates = buildModelNameFallbackCandidates("deepseek/deepseek-v3.2:thinking");
    expect(candidates).toContain("deepseek/deepseek-v3.2");
    expect(candidates).toContain("deepseek-v3.2");
  });

  it("strips bedrock region prefixes", () => {
    const candidates = buildModelNameFallbackCandidates(
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
    );
    expect(candidates).toContain("anthropic.claude-sonnet-4-5-20250929-v1:0");
  });

  it("adds lowercase variants for mixed-case names", () => {
    const candidates = buildModelNameFallbackCandidates("Pro/deepseek-ai/DeepSeek-V3.2");
    expect(candidates).toContain("pro/deepseek-ai/deepseek-v3.2");
    expect(candidates).toContain("deepseek-v3.2");
    expect(candidates).toContain("DeepSeek-V3.2");
  });

  it("does not strip non-host org prefixes", () => {
    // "Pro" 不是托管商,去 org 的中间形态不应成为候选
    const candidates = buildModelNameFallbackCandidates("Pro/deepseek-ai/DeepSeek-V3.2");
    expect(candidates).not.toContain("deepseek-ai/DeepSeek-V3.2");
    expect(candidates).not.toContain("deepseek-ai/deepseek-v3.2");
  });

  it("deduplicates candidates", () => {
    const candidates = buildModelNameFallbackCandidates("openai/gpt-5.5");
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
