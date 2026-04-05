import { describe, expect, it } from "vitest";
import {
  findMatchingAllowedModelRule,
  isAllowedModelRule,
  matchesAllowedModelRules,
  normalizeAllowedModelRules,
} from "@/lib/allowed-model-rules";
import type { AllowedModelRule } from "@/types/provider";

describe("allowed-model-rules", () => {
  it("normalizes legacy string arrays into exact-match rules", () => {
    expect(normalizeAllowedModelRules(["claude-opus", "gpt-4o"])).toEqual([
      { matchType: "exact", pattern: "claude-opus" },
      { matchType: "exact", pattern: "gpt-4o" },
    ]);
  });

  it("preserves rule objects and trims mixed inputs", () => {
    const input = [
      " claude-sonnet ",
      { matchType: "prefix", pattern: " claude-opus-" },
    ] satisfies Array<string | AllowedModelRule>;

    expect(normalizeAllowedModelRules(input)).toEqual([
      { matchType: "exact", pattern: "claude-sonnet" },
      { matchType: "prefix", pattern: "claude-opus-" },
    ]);
  });

  it("treats null and empty rules as allow-all", () => {
    expect(matchesAllowedModelRules("claude-opus", null)).toBe(true);
    expect(matchesAllowedModelRules("claude-opus", [])).toBe(true);
    expect(findMatchingAllowedModelRule("claude-opus", null)).toBeNull();
    expect(findMatchingAllowedModelRule("claude-opus", [])).toBeNull();
  });

  it("matches advanced rule types in order and returns the first hit", () => {
    const rules: AllowedModelRule[] = [
      { matchType: "contains", pattern: "opus" },
      { matchType: "prefix", pattern: "claude-opus-" },
      { matchType: "regex", pattern: "^claude-opus-4" },
    ];

    expect(matchesAllowedModelRules("claude-opus-4-1", rules)).toBe(true);
    expect(findMatchingAllowedModelRule("claude-opus-4-1", rules)).toEqual(rules[0]);
  });

  it("returns false when no rule matches or regex is invalid", () => {
    expect(
      matchesAllowedModelRules("claude-opus-4-1", [{ matchType: "regex", pattern: "[" }])
    ).toBe(false);
    expect(
      matchesAllowedModelRules("claude-opus-4-1", [{ matchType: "suffix", pattern: "-haiku" }])
    ).toBe(false);
  });

  it("detects allowed model rule objects safely", () => {
    expect(isAllowedModelRule({ matchType: "prefix", pattern: "claude-" })).toBe(true);
    expect(isAllowedModelRule({ matchType: "prefix", source: "claude-" })).toBe(false);
    expect(isAllowedModelRule("claude-opus")).toBe(false);
  });
});
