import { describe, expect, it } from "vitest";
import {
  findUnboundUpstreamApiKeys,
  findStaleSiteProviderIds,
  isSiteProviderGroupStale,
  resolveSiteProviderBalanceEnabled,
  shouldReactivateSiteProvider,
  shouldReactivateSiteProviderForBalance,
} from "@/lib/provider-sites/sync-keys";

function upstreamKey(key: string) {
  return { id: "1", name: "cch-test", key, groupName: "GPT Plus", status: "active" };
}

describe("shouldReactivateSiteProvider", () => {
  it("reactivates a disabled provider when the upstream returns a full key", () => {
    expect(shouldReactivateSiteProvider(false, [upstreamKey("sk-test-key-1234567890")])).toBe(true);
  });

  it("does not change an already enabled provider", () => {
    expect(shouldReactivateSiteProvider(true, [upstreamKey("sk-test-key-1234567890")])).toBe(false);
  });

  it.each(["", "sk-********", "sk-short"])(
    "does not reactivate when the upstream key is not usable: %s",
    (key) => {
      expect(shouldReactivateSiteProvider(false, [upstreamKey(key)])).toBe(false);
    }
  );
});

describe("isSiteProviderGroupStale", () => {
  it("keeps an upstream group despite whitespace and case differences", () => {
    expect(isSiteProviderGroupStale("  GPT  Plus ", ["gpt plus"])).toBe(false);
  });

  it("marks a local provider group missing from upstream as stale", () => {
    expect(isSiteProviderGroupStale("Removed Group", ["Current Group"])).toBe(true);
  });

  it("does not treat an unbound provider as a stale group", () => {
    expect(isSiteProviderGroupStale(null, ["Current Group"])).toBe(false);
    expect(isSiteProviderGroupStale("", [])).toBe(false);
  });
});

describe("findStaleSiteProviderIds", () => {
  const rows = [
    { id: 11, siteGroupName: "  GPT Plus " },
    { id: 12, siteGroupName: "Removed Group" },
    { id: 13, siteGroupName: null },
  ];

  it("returns only local providers whose groups disappeared upstream", () => {
    expect(findStaleSiteProviderIds(rows, ["gpt plus", "New Group"])).toEqual([12]);
  });

  it("does not prune when the upstream response has no trustworthy group names", () => {
    expect(findStaleSiteProviderIds(rows, [])).toEqual([]);
    expect(findStaleSiteProviderIds(rows, ["", "  "])).toEqual([]);
  });

  it("normalizes duplicate upstream names without changing the keep decision", () => {
    expect(findStaleSiteProviderIds(rows, [" GPT  PLUS ", "gpt plus"])).toEqual([12]);
  });
});

describe("findUnboundUpstreamApiKeys", () => {
  it("returns unassigned/orphaned keys but preserves unknown group IDs", () => {
    expect(
      findUnboundUpstreamApiKeys([
        { ...upstreamKey("orphan-secret"), id: "orphan", groupName: "", groupBinding: "unbound" },
        {
          ...upstreamKey("orphaned-secret"),
          id: "orphaned",
          groupName: "",
          groupBinding: "orphaned",
        },
        { ...upstreamKey("bound-secret"), id: "bound", groupName: "GPT Plus", groupBinding: "bound" },
        { ...upstreamKey("unknown-secret"), id: "unknown", groupName: "", groupBinding: "unknown" },
      ]).map((key) => key.id)
    ).toEqual(["orphan", "orphaned"]);
  });
});

describe("resolveSiteProviderBalanceEnabled", () => {
  it.each([
    [0, false],
    [0.009999, false],
    [0.01, true],
    [1, true],
  ])("applies the 0.01 balance threshold: %s", (balance, expected) => {
    expect(resolveSiteProviderBalanceEnabled(balance)).toBe(expected);
  });

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "does not toggle when the balance is not trustworthy: %s",
    (balance) => {
      expect(resolveSiteProviderBalanceEnabled(balance)).toBeNull();
    }
  );
});

describe("shouldReactivateSiteProviderForBalance", () => {
  it("reactivates only a provider previously disabled by the balance policy", () => {
    expect(
      shouldReactivateSiteProviderForBalance(false, true, 0.02, [
        upstreamKey("sk-test-key-1234567890"),
      ])
    ).toBe(true);
  });

  it("does not override a manual disable when the balance recovers", () => {
    expect(
      shouldReactivateSiteProviderForBalance(false, false, 0.02, [
        upstreamKey("sk-test-key-1234567890"),
      ])
    ).toBe(false);
  });

  it("does not reactivate below the threshold", () => {
    expect(
      shouldReactivateSiteProviderForBalance(false, true, 0.009, [
        upstreamKey("sk-test-key-1234567890"),
      ])
    ).toBe(false);
  });
});
