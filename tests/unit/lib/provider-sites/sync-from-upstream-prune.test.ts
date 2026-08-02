import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findProviderSiteAuthRow: vi.fn(),
  updateProviderSite: vi.fn(),
  upsertProviderSiteGroupRate: vi.fn(),
  deleteProviderSiteGroupRatesNotIn: vi.fn(),
  findUnkeyedOtherSiteGroupNames: vi.fn(),
  pruneStaleSiteProvidersForUpstreamGroups: vi.fn(),
  syncSiteKeysForGroups: vi.fn(),
  syncSiteProviderBalanceState: vi.fn(),
  findEnabledProviderSiteAuthRows: vi.fn(),
  loginUpstreamSite: vi.fn(),
  fetchUpstreamGroupRates: vi.fn(),
  fetchUpstreamBalance: vi.fn(),
  fetchUpstreamApiKeys: vi.fn(),
  isUpstreamUnauthorizedError: vi.fn(),
  findAllProviderGroups: vi.fn(),
  publishProviderCacheInvalidation: vi.fn(),
  decryptSecret: vi.fn(),
  encryptSecret: vi.fn(),
  resolveSystemTimezone: vi.fn(),
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: mocks.publishProviderCacheInvalidation,
}));
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("@/lib/provider-sites/secret-box", () => ({
  decryptSecret: mocks.decryptSecret,
  encryptSecret: mocks.encryptSecret,
}));
vi.mock("@/lib/provider-sites/sync-keys", () => ({
  findUnkeyedOtherSiteGroupNames: mocks.findUnkeyedOtherSiteGroupNames,
  pruneStaleSiteProvidersForUpstreamGroups: mocks.pruneStaleSiteProvidersForUpstreamGroups,
  syncSiteKeysForGroups: mocks.syncSiteKeysForGroups,
  syncSiteProviderBalanceState: mocks.syncSiteProviderBalanceState,
}));
vi.mock("@/lib/provider-sites/upstream-connector", () => ({
  fetchUpstreamApiKeys: mocks.fetchUpstreamApiKeys,
  fetchUpstreamBalance: mocks.fetchUpstreamBalance,
  fetchUpstreamGroupRates: mocks.fetchUpstreamGroupRates,
  isUpstreamUnauthorizedError: mocks.isUpstreamUnauthorizedError,
  loginUpstreamSite: mocks.loginUpstreamSite,
}));
vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: mocks.resolveSystemTimezone,
}));
vi.mock("@/repository/provider-groups", () => ({
  findAllProviderGroups: mocks.findAllProviderGroups,
}));
vi.mock("@/repository/provider-sites", () => ({
  deleteProviderSiteGroupRatesNotIn: mocks.deleteProviderSiteGroupRatesNotIn,
  findEnabledProviderSiteAuthRows: mocks.findEnabledProviderSiteAuthRows,
  findProviderSiteAuthRow: mocks.findProviderSiteAuthRow,
  updateProviderSite: mocks.updateProviderSite,
  upsertProviderSiteGroupRate: mocks.upsertProviderSiteGroupRate,
}));

import { syncProviderSiteFromUpstream } from "@/lib/provider-sites/sync-from-upstream";

const siteRow = {
  id: 7,
  name: "site-a",
  siteUrl: "https://site.example",
  siteType: "sub2api",
  providerVendorId: 2,
  username: "user@example.com",
  passwordCipher: "ciphertext",
  captchaProvider: "none",
  captchaApiKeyCipher: null,
  captchaEndpoint: null,
  turnstileEnabled: false,
  sessionAccessTokenCipher: null,
  sessionCookieCipher: null,
  sessionUserId: null,
  sessionExpiresAt: null,
};

describe("syncProviderSiteFromUpstream pruning order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProviderSiteAuthRow.mockResolvedValue(siteRow);
    mocks.decryptSecret.mockReturnValue("secret");
    mocks.encryptSecret.mockImplementation((value: string) => `encrypted:${value}`);
    mocks.loginUpstreamSite.mockResolvedValue({ accessToken: "token", expiresAt: new Date() });
    mocks.fetchUpstreamGroupRates.mockResolvedValue([
      { groupName: "Current Group", description: null, ratio: 1, completionRatio: 0 },
    ]);
    mocks.resolveSystemTimezone.mockResolvedValue("UTC");
    mocks.fetchUpstreamBalance.mockResolvedValue({ balance: 1, todayCost: 0, totalCost: 0 });
    mocks.upsertProviderSiteGroupRate.mockResolvedValue({});
    mocks.deleteProviderSiteGroupRatesNotIn.mockResolvedValue([]);
    mocks.findAllProviderGroups.mockResolvedValue([]);
    mocks.findUnkeyedOtherSiteGroupNames.mockReturnValue([]);
    mocks.pruneStaleSiteProvidersForUpstreamGroups.mockResolvedValue(1);
    mocks.syncSiteKeysForGroups.mockResolvedValue({
      groupsEligible: 1,
      groupsSkipped: 0,
      skippedGroupNames: [],
      keysSeen: 1,
      providersCreated: 0,
      providersDeleted: 0,
      providersReused: 1,
      providersReactivated: 0,
      keysAutoCreated: 0,
    });
    mocks.fetchUpstreamApiKeys.mockRejectedValue(new Error("keys endpoint unavailable"));
    mocks.isUpstreamUnauthorizedError.mockReturnValue(false);
    mocks.syncSiteProviderBalanceState.mockResolvedValue({ enabled: true, changed: 0 });
    mocks.updateProviderSite.mockResolvedValue({});
    mocks.publishProviderCacheInvalidation.mockResolvedValue(undefined);
  });

  it("prunes from the trusted group list before a key-list failure", async () => {
    const result = await syncProviderSiteFromUpstream(7);

    expect(result.ok).toBe(true);
    expect(mocks.pruneStaleSiteProvidersForUpstreamGroups).toHaveBeenCalledWith(7, [
      "Current Group",
    ]);
    expect(mocks.fetchUpstreamApiKeys).toHaveBeenCalledOnce();
    expect(mocks.pruneStaleSiteProvidersForUpstreamGroups.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fetchUpstreamApiKeys.mock.invocationCallOrder[0]
    );
    expect(mocks.updateProviderSite).toHaveBeenCalled();
  });

  it("prunes unkeyed other groups after a complete key-list response", async () => {
    mocks.fetchUpstreamGroupRates.mockResolvedValue([
      { groupName: "Current Group", description: null, ratio: 1, completionRatio: 0 },
      { groupName: "test", description: null, ratio: 1, completionRatio: 0 },
    ]);
    mocks.fetchUpstreamApiKeys.mockResolvedValue([
      {
        id: "key-1",
        key: "sk-current-group-usable",
        name: "current",
        groupName: "Current Group",
        status: "enabled",
      },
    ]);
    mocks.findAllProviderGroups.mockResolvedValue([
      {
        name: "Current Pool",
        sortOrder: 1,
        matchRules: [{ matchType: "contains", pattern: "current" }],
      },
    ]);
    mocks.findUnkeyedOtherSiteGroupNames.mockReturnValue(["test"]);
    mocks.deleteProviderSiteGroupRatesNotIn
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["test"]);
    mocks.pruneStaleSiteProvidersForUpstreamGroups
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    const result = await syncProviderSiteFromUpstream(7);

    expect(result.ok).toBe(true);
    expect(mocks.deleteProviderSiteGroupRatesNotIn).toHaveBeenNthCalledWith(2, 7, [
      "Current Group",
    ]);
    expect(mocks.pruneStaleSiteProvidersForUpstreamGroups).toHaveBeenNthCalledWith(2, 7, [
      "Current Group",
    ]);
    expect(result.keysSynced?.deleted).toBe(1);
  });
});
