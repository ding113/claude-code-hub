import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const providersTable = {
    id: "providers.id",
    siteId: "providers.siteId",
    siteGroupName: "providers.siteGroupName",
    deletedAt: "providers.deletedAt",
  };
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  return {
    providersTable,
    selectChain,
    db: { select: vi.fn(() => selectChain) },
    deleteProvider: vi.fn(),
    classifySiteGroupTag: vi.fn(),
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
  },
}));
vi.mock("@/lib/provider-sites/billing", () => ({
  classifySiteGroupTag: mocks.classifySiteGroupTag,
}));
vi.mock("@/lib/provider-sites/upstream-connector", () => ({
  createUpstreamApiKey: vi.fn(),
}));
vi.mock("@/repository/provider", () => ({
  deleteProvider: mocks.deleteProvider,
  createProvider: vi.fn(),
}));

import {
  findUnkeyedOtherSiteGroupNames,
  pruneStaleSiteProvidersForUpstreamGroups,
} from "@/lib/provider-sites/sync-keys";

describe("pruneStaleSiteProvidersForUpstreamGroups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectChain.from.mockReturnValue(mocks.selectChain);
    mocks.selectChain.where.mockResolvedValue([
      { id: 11, siteGroupName: " GPT Plus " },
      { id: 12, siteGroupName: "Removed Group" },
      { id: 13, siteGroupName: null },
    ]);
    mocks.deleteProvider.mockResolvedValue(true);
  });

  it("soft-deletes only providers whose groups disappeared", async () => {
    await expect(pruneStaleSiteProvidersForUpstreamGroups(7, ["gpt plus"])).resolves.toBe(1);

    expect(mocks.deleteProvider).toHaveBeenCalledOnce();
    expect(mocks.deleteProvider).toHaveBeenCalledWith(12);
  });

  it("identifies unkeyed non-routable groups only from a complete key list", () => {
    mocks.classifySiteGroupTag.mockImplementation((groupName: string) =>
      groupName === "test" ? "other" : "codex"
    );

    expect(
      findUnkeyedOtherSiteGroupNames({
        groupNames: ["Current Group", "test"],
        upstreamKeys: [{ groupName: "Current Group" }],
        groups: [],
      })
    ).toEqual(["test"]);

    expect(
      findUnkeyedOtherSiteGroupNames({
        groupNames: ["Current Group", "test"],
        upstreamKeys: [{ groupName: "" }],
        groups: [],
      })
    ).toEqual([]);
  });

  it("counts only successful deletes and never prunes an empty trusted list", async () => {
    mocks.deleteProvider.mockResolvedValue(false);

    await expect(pruneStaleSiteProvidersForUpstreamGroups(7, ["current"])).resolves.toBe(0);
    expect(mocks.deleteProvider).toHaveBeenCalledWith(11);
    expect(mocks.deleteProvider).toHaveBeenCalledWith(12);

    mocks.deleteProvider.mockClear();
    await expect(pruneStaleSiteProvidersForUpstreamGroups(7, [])).resolves.toBe(0);
    expect(mocks.deleteProvider).not.toHaveBeenCalled();
  });
});
