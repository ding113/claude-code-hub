import { describe, expect, it } from "vitest";
import { matchesPattern } from "@/lib/model-pattern-matcher";
import type { ProviderModelRedirectMatchType } from "@/types/provider";

describe("matchesPattern", () => {
  it.each<[ProviderModelRedirectMatchType, string, string, boolean]>([
    ["exact", "claude-opus-4-1", "claude-opus-4-1", true],
    ["exact", "claude-opus-4-1", "claude-opus-4-2", false],
    ["prefix", "claude-opus", "claude-opus-4-1", true],
    ["prefix", "gpt", "claude-opus-4-1", false],
    ["suffix", "20251001", "claude-opus-4-1-20251001", true],
    ["suffix", "20251002", "claude-opus-4-1-20251001", false],
    ["contains", "opus", "claude-opus-4-1", true],
    ["contains", "sonnet", "claude-opus-4-1", false],
    ["regex", "^claude-(opus|sonnet)-4", "claude-opus-4-1", true],
    ["regex", "^gpt-", "claude-opus-4-1", false],
  ])("supports %s matching", (matchType, pattern, model, expected) => {
    expect(matchesPattern(model, matchType, pattern)).toBe(expected);
  });

  it("returns false for invalid regex patterns instead of throwing", () => {
    expect(matchesPattern("claude-opus-4-1", "regex", "[")).toBe(false);
  });
});
