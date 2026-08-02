import { describe, expect, it } from "vitest";
import { classifySiteGroupTag, resolveSiteBillingMultipliers } from "@/lib/provider-sites/billing";

describe("provider site group rates presentation helpers", () => {
  it("classifies via configured match rules only", () => {
    const groups = [
      {
        name: "claude",
        sortOrder: 1,
        matchRules: [{ matchType: "contains" as const, pattern: "claude" }],
      },
      {
        name: "codex",
        sortOrder: 2,
        matchRules: [{ matchType: "contains" as const, pattern: "codex" }],
      },
    ];
    expect(classifySiteGroupTag("Claude Kiro", groups)).toBe("claude");
    expect(classifySiteGroupTag("codex-Plus", groups)).toBe("codex");
    expect(classifySiteGroupTag("Grok Super", groups)).toBe("other");
  });

  it("prefers site group ratio when billing mode is site_group_ratio", () => {
    const resolved = resolveSiteBillingMultipliers({
      billingMode: "site_group_ratio",
      providerCostMultiplier: 0.5,
      siteGroupName: "Claude Kiro",
      siteGroupRates: [
        { groupName: "Claude Kiro", ratio: 0.12, completionRatio: 0 },
        { groupName: "codex-Plus", ratio: 0.08 },
      ],
    });

    expect(resolved).toMatchObject({
      mode: "site_group_ratio",
      multiplier: 0.12,
      source: "site_group_rate",
      groupName: "Claude Kiro",
    });
  });

  it("falls back to provider multiplier when site group is missing", () => {
    const resolved = resolveSiteBillingMultipliers({
      billingMode: "site_group_ratio",
      providerCostMultiplier: 0.07,
      siteGroupName: "missing-group",
      siteGroupRates: [{ groupName: "Claude Kiro", ratio: 0.12 }],
    });
    expect(resolved.multiplier).toBe(0.07);
    expect(resolved.source).toBe("fallback");
  });
});
