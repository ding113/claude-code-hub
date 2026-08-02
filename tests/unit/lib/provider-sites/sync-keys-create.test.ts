import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const providersTable = {
    id: "providers.id",
    name: "providers.name",
    key: "providers.key",
    url: "providers.url",
    siteId: "providers.siteId",
    siteGroupName: "providers.siteGroupName",
    groupTag: "providers.groupTag",
    isEnabled: "providers.isEnabled",
    providerType: "providers.providerType",
    updatedAt: "providers.updatedAt",
    balanceAutoDisabled: "providers.balanceAutoDisabled",
    deletedAt: "providers.deletedAt",
  };
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  const updateChain = {
    set: vi.fn(),
    where: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  updateChain.set.mockReturnValue(updateChain);
  return {
    providersTable,
    selectChain,
    updateChain,
    db: {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
    },
    createProvider: vi.fn(),
    deleteProvider: vi.fn(),
    createUpstreamApiKey: vi.fn(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  isNull: (column: unknown) => ({ type: "isNull", column }),
}));

vi.mock("@/drizzle/db", () => ({ db: mocks.db }));
vi.mock("@/drizzle/schema", () => ({ providers: mocks.providersTable }));
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("@/lib/provider-sites/billing", () => ({
  classifySiteGroupTag: vi.fn(() => "codex"),
}));
vi.mock("@/lib/provider-sites/upstream-connector", () => ({
  createUpstreamApiKey: mocks.createUpstreamApiKey,
}));
vi.mock("@/repository/provider", () => ({
  createProvider: mocks.createProvider,
  deleteProvider: mocks.deleteProvider,
}));

import { syncSiteKeysForGroups } from "@/lib/provider-sites/sync-keys";

const upstreamKey = {
  id: "key-1",
  name: "cch-test",
  key: "sk-test-1234567890",
  groupName: "GPT Plus",
  status: "active",
};

describe("syncSiteKeysForGroups provider creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectChain.from.mockReturnValue(mocks.selectChain);
    mocks.updateChain.set.mockReturnValue(mocks.updateChain);
    mocks.selectChain.where.mockResolvedValue([]);
    mocks.updateChain.where.mockResolvedValue([]);
    mocks.createProvider.mockResolvedValue({ id: 99 });
  });

  it("updates the exact provider row returned by createProvider", async () => {
    const result = await syncSiteKeysForGroups({
      siteId: 7,
      siteName: "site-a",
      siteUrl: "https://site.example",
      siteType: "sub2api",
      providerVendorId: null,
      upstreamKeys: [upstreamKey],
      groupNames: ["GPT Plus"],
      groups: [
        {
          name: "codex",
          sortOrder: 0,
          matchRules: [],
          sharedSettings: { providerType: "codex" },
        } as never,
      ],
      groupRatios: { "GPT Plus": 0.8 },
    });

    expect(result.providersCreated).toBe(1);
    expect(mocks.createProvider).toHaveBeenCalledOnce();
    expect(mocks.db.update).toHaveBeenCalledOnce();
    expect(mocks.updateChain.where).toHaveBeenCalledWith({
      type: "eq",
      column: mocks.providersTable.id,
      value: 99,
    });
    expect(mocks.updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 7, siteGroupName: "GPT Plus" })
    );
  });
});
