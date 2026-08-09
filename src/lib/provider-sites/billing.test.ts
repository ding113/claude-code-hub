import { describe, expect, it } from "vitest";
import {
  applySiteGroupCompletionRatio,
  classifySiteGroupTag,
  normalizeUpstreamRate,
  resolveRechargeMultiplier,
  resolveSiteBalance,
  resolveSiteBillingMultipliers,
  resolveSiteCost,
} from "./billing";

describe("recharge multiplier", () => {
  it("converts upstream rates and balances into CCH-facing values", () => {
    expect(normalizeUpstreamRate(0.2, 0.4)).toBeCloseTo(0.5, 10);
    expect(resolveSiteBalance("10", "0.4")).toBeCloseTo(25, 10);
  });

  it("converts upstream today cost into real money spent", () => {
    expect(resolveSiteCost("10", "0.4")).toBeCloseTo(25, 10);
    expect(resolveSiteCost(0.4, 0.4)).toBeCloseTo(1, 10);
    expect(resolveSiteCost(null, 0.4)).toBeNull();
    expect(resolveSiteCost(undefined, 0.4)).toBeNull();
    expect(resolveSiteCost("not-a-number", 0.4)).toBeNull();
    expect(resolveSiteCost(5, 0)).toBe(5);
  });

  it("uses 1 for invalid or non-positive multipliers", () => {
    expect(resolveRechargeMultiplier(undefined)).toBe(1);
    expect(resolveRechargeMultiplier(0)).toBe(1);
    expect(resolveRechargeMultiplier(-0.4)).toBe(1);
    expect(resolveRechargeMultiplier("not-a-number")).toBe(1);
    expect(normalizeUpstreamRate(0.2, 0)).toBeCloseTo(0.2, 10);
  });

  it("applies the recharge multiplier to completion/output rates too", () => {
    const resolved = resolveSiteBillingMultipliers({
      billingMode: "site_group_ratio",
      providerCostMultiplier: 0.99,
      siteRechargeMultiplier: 0.4,
      siteGroupName: "Claude Kiro",
      siteGroupRates: [{ groupName: "Claude Kiro", ratio: 0.2, completionRatio: 0.8 }],
    });

    expect(resolved.multiplier).toBeCloseTo(0.5, 10);
    expect(resolved.outputMultiplier).toBeCloseTo(2, 10);
  });
});
describe("classifySiteGroupTag", () => {
  it("classifies only via configured group match rules", () => {
    const groups = [
      {
        name: "claude",
        sortOrder: 10,
        matchRules: [{ matchType: "contains" as const, pattern: "claude" }],
      },
      {
        name: "codex",
        sortOrder: 20,
        matchRules: [{ matchType: "contains" as const, pattern: "plus" }],
      },
    ];
    expect(classifySiteGroupTag("Claude Kiro", groups)).toBe("claude");
    expect(classifySiteGroupTag("ChatGPT-Plus", groups)).toBe("codex");
    expect(classifySiteGroupTag("unknown", groups)).toBe("other");
    expect(classifySiteGroupTag("Claude Kiro")).toBe("other");
  });
});

describe("resolveSiteBillingMultipliers", () => {
  it("keeps catalog estimate multipliers for legacy providers", () => {
    const resolved = resolveSiteBillingMultipliers({
      billingMode: "catalog_estimate",
      providerCostMultiplier: 0.05,
      siteGroupName: "Claude Kiro",
      siteGroupRates: [{ groupName: "Claude Kiro", ratio: 0.15 }],
    });

    expect(resolved).toMatchObject({
      mode: "catalog_estimate",
      multiplier: 0.05,
      outputMultiplier: null,
      source: "provider_cost_multiplier",
    });
  });

  it("uses website group ratio for site_group_ratio billing", () => {
    const resolved = resolveSiteBillingMultipliers({
      billingMode: "site_group_ratio",
      providerCostMultiplier: 0.99,
      siteGroupName: "Claude Kiro",
      siteGroupRates: [
        { groupName: "Claude Max", ratio: 1.2 },
        { groupName: "Claude Kiro", ratio: 0.15, completionRatio: 0 },
      ],
    });

    expect(resolved).toEqual({
      mode: "site_group_ratio",
      multiplier: 0.15,
      outputMultiplier: null,
      groupName: "Claude Kiro",
      source: "site_group_rate",
    });
  });

  it("falls back to provider multiplier when the site group is missing", () => {
    const resolved = resolveSiteBillingMultipliers({
      billingMode: "site_group_ratio",
      providerCostMultiplier: 0.08,
      siteGroupName: "missing",
      siteGroupRates: [{ groupName: "Claude Kiro", ratio: 0.15 }],
    });

    expect(resolved.source).toBe("fallback");
    expect(resolved.multiplier).toBe(0.08);
  });
});

describe("applySiteGroupCompletionRatio", () => {
  it("applies one group ratio to the whole raw catalogue cost when completion is absent", () => {
    const total = applySiteGroupCompletionRatio({
      rawInputCost: 1,
      rawOutputCost: 2,
      rawOtherCost: 0.5,
      multipliers: {
        mode: "site_group_ratio",
        multiplier: 0.1,
        outputMultiplier: null,
        groupName: "Plus",
        source: "site_group_rate",
      },
      groupMultiplier: 1,
    });

    expect(total).toBeCloseTo(0.35, 10);
  });

  it("splits input/output when completion_ratio is provided", () => {
    const total = applySiteGroupCompletionRatio({
      rawInputCost: 1,
      rawOutputCost: 2,
      multipliers: {
        mode: "site_group_ratio",
        multiplier: 0.1,
        outputMultiplier: 0.2,
        groupName: "Pro",
        source: "site_group_rate",
      },
    });

    expect(total).toBeCloseTo(0.5, 10);
  });
});
