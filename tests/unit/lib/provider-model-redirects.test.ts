import { describe, expect, it } from "vitest";
import type { ProviderModelRedirectRule } from "@/types/provider";
import {
  findMatchingProviderModelRedirectRule,
  normalizeProviderModelRedirectRules,
} from "@/lib/provider-model-redirects";

describe("provider model redirect rules", () => {
  it("supports prefix suffix contains and regex matching in rule order", () => {
    const rules: ProviderModelRedirectRule[] = [
      {
        matchType: "contains",
        source: "opus",
        target: "contains-opus",
      },
      {
        matchType: "prefix",
        source: "claude-opus",
        target: "prefix-opus",
      },
      {
        matchType: "suffix",
        source: "20251001",
        target: "suffix-version",
      },
      {
        matchType: "regex",
        source: "^claude-opus-4-.*$",
        target: "regex-opus",
      },
    ];

    expect(findMatchingProviderModelRedirectRule("claude-opus-4-5-20251001", rules)?.target).toBe(
      "contains-opus"
    );
    expect(findMatchingProviderModelRedirectRule("claude-opus-4-5", rules)?.target).toBe(
      "contains-opus"
    );
    expect(findMatchingProviderModelRedirectRule("foo-20251001", rules)?.target).toBe(
      "suffix-version"
    );
    expect(findMatchingProviderModelRedirectRule("claude-opus-4-6", rules)?.target).toBe(
      "contains-opus"
    );
  });

  it("returns null when no rule matches", () => {
    const rules: ProviderModelRedirectRule[] = [
      {
        matchType: "prefix",
        source: "claude-opus",
        target: "glm-4.6",
      },
    ];

    expect(findMatchingProviderModelRedirectRule("claude-sonnet-4-5", rules)).toBeNull();
  });

  it("normalizes legacy exact redirect maps into exact-match rules", () => {
    const normalized = normalizeProviderModelRedirectRules({
      "claude-opus-4-5": "glm-4.6",
      "gpt-4": "gpt-4o",
    });

    expect(normalized).toHaveLength(2);
    expect(normalized).toEqual(
      expect.arrayContaining([
        {
          matchType: "exact",
          source: "claude-opus-4-5",
          target: "glm-4.6",
        },
        {
          matchType: "exact",
          source: "gpt-4",
          target: "gpt-4o",
        },
      ])
    );
  });
});
