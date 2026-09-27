import { describe, expect, it } from "vitest";
import type { ProviderModelRedirectRule } from "@/types/provider";
import {
  findMatchingProviderModelRedirectRule,
  getProviderModelRedirectTarget,
  normalizeProviderModelRedirectRules,
  resolveProviderModelRedirectTarget,
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

describe("regex redirect target capture groups", () => {
  it("expands capture group references in regex targets", () => {
    const rules: ProviderModelRedirectRule[] = [
      { matchType: "regex", source: "^gpt-(.+)$", target: "test-$1" },
    ];

    expect(getProviderModelRedirectTarget("gpt-5.5", rules)).toBe("test-5.5");
    expect(getProviderModelRedirectTarget("gpt-5.6", rules)).toBe("test-5.6");
  });

  it("supports $&, named groups and escaped $$", () => {
    expect(
      resolveProviderModelRedirectTarget("gpt-5.5", {
        matchType: "regex",
        source: "^gpt-.+$",
        target: "pre-$&",
      })
    ).toBe("pre-gpt-5.5");

    expect(
      resolveProviderModelRedirectTarget("gpt-5.5", {
        matchType: "regex",
        source: "^(?<version>gpt-.+)$",
        target: "mirror-$<version>",
      })
    ).toBe("mirror-gpt-5.5");

    expect(
      resolveProviderModelRedirectTarget("gpt-5.5", {
        matchType: "regex",
        source: "^gpt-(.+)$",
        target: "cost-$$$1",
      })
    ).toBe("cost-$5.5");
  });

  it("replaces the whole model name even when the regex only matches a substring", () => {
    expect(
      resolveProviderModelRedirectTarget("gpt-5", {
        matchType: "regex",
        source: "-(\\d+)$",
        target: "glm-$1",
      })
    ).toBe("glm-5");

    expect(
      resolveProviderModelRedirectTarget("claude-opus-4-5", {
        matchType: "regex",
        source: "opus",
        target: "glm-4.6",
      })
    ).toBe("glm-4.6");
  });

  it("keeps $ literal for non-regex rules and unmatched models", () => {
    expect(
      resolveProviderModelRedirectTarget("gpt-5.5", {
        matchType: "exact",
        source: "gpt-5.5",
        target: "test-$1",
      })
    ).toBe("test-$1");

    expect(
      resolveProviderModelRedirectTarget("claude-opus", {
        matchType: "regex",
        source: "^gpt-(.+)$",
        target: "test-$1",
      })
    ).toBe("test-$1");
  });
});
