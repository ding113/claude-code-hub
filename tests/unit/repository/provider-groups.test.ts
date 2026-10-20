import { beforeEach, describe, expect, it, vi } from "vitest";

function sqlToString(sqlObj: unknown): string {
  const visited = new Set<unknown>();

  const walk = (node: unknown): string => {
    if (!node || visited.has(node)) return "";
    visited.add(node);

    if (typeof node === "string") return node;

    if (typeof node === "object") {
      const anyNode = node as Record<string, unknown>;
      if (Array.isArray(anyNode)) {
        return anyNode.map(walk).join("");
      }

      if (Array.isArray(anyNode.value)) {
        return anyNode.value.map(String).join("");
      }

      if (typeof anyNode.value === "string") {
        return anyNode.value;
      }

      if ("queryChunks" in anyNode) {
        return walk(anyNode.queryChunks);
      }
    }

    return "";
  };

  return walk(sqlObj);
}

const selectMock = vi.fn();
const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();
const valuesMock = vi.fn();
const returningMock = vi.fn();
const onConflictDoNothingMock = vi.fn();
const setMock = vi.fn();
const deleteWhereMock = vi.fn();
const pubsubHarness = vi.hoisted(() => ({
  callback: null as ((message: string) => void) | null,
  cleanup: vi.fn(),
  publish: vi.fn(),
  subscribe: vi.fn(),
}));

function createQuery<T>(result: T, whereArgs?: unknown[]) {
  const query: any = Promise.resolve(result);

  query.from = vi.fn(() => query);
  query.where = vi.fn((arg: unknown) => {
    whereArgs?.push(arg);
    return query;
  });
  query.limit = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.returning = vi.fn(() => query);

  return query;
}

function resetChainMocks() {
  selectMock.mockImplementation(() => createQuery([]));
  insertMock.mockReturnValue({ values: valuesMock });
  valuesMock.mockReturnValue({
    returning: returningMock,
    onConflictDoNothing: onConflictDoNothingMock,
  });
  returningMock.mockResolvedValue([]);
  onConflictDoNothingMock.mockResolvedValue(undefined);

  updateMock.mockReturnValue({ set: setMock });
  setMock.mockImplementation(() => createQuery([]));

  deleteWhereMock.mockResolvedValue(undefined);
  deleteMock.mockReturnValue({ where: deleteWhereMock });
}

vi.mock("@/drizzle/db", () => ({
  db: {
    select: selectMock,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  },
}));

vi.mock("@/drizzle/schema", () => ({
  providerGroups: {
    id: "id",
    name: "name",
    costMultiplier: "cost_multiplier",
    description: "description",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  providers: {
    groupTag: "group_tag",
    deletedAt: "deleted_at",
  },
}));

vi.mock("@/lib/redis/pubsub", () => ({
  CHANNEL_PROVIDER_GROUPS_UPDATED: "cch:cache:provider_groups:updated",
  publishCacheInvalidation: pubsubHarness.publish,
  subscribeCacheInvalidation: pubsubHarness.subscribe,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function fakeRow(
  overrides: Partial<{
    id: number;
    name: string;
    costMultiplier: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> = {}
) {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? "default",
    costMultiplier: overrides.costMultiplier ?? "1.0000",
    description: overrides.description ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-01-01T00:00:00Z"),
  };
}

describe("provider-groups repository", () => {
  beforeEach(async () => {
    const { disposeGroupMultiplierCache } = await import(
      "@/lib/cache/provider-group-multiplier-cache"
    );
    disposeGroupMultiplierCache();
    vi.resetModules();
    vi.clearAllMocks();
    resetChainMocks();
    pubsubHarness.callback = null;
    pubsubHarness.publish.mockResolvedValue(undefined);
    pubsubHarness.subscribe.mockImplementation(
      async (_channel: string, callback: (message: string) => void) => {
        pubsubHarness.callback = callback;
        return pubsubHarness.cleanup;
      }
    );
  });

  describe("getGroupCostMultiplier", () => {
    it("returns 1.0 for an unknown group (no DB row)", async () => {
      selectMock.mockImplementationOnce(() => createQuery([]));

      const { getGroupCostMultiplier, invalidateGroupMultiplierCache } = await import(
        "@/repository/provider-groups"
      );
      invalidateGroupMultiplierCache();

      const result = await getGroupCostMultiplier("nonexistent");
      expect(result).toBe(1.0);
    });

    it("returns the multiplier from the DB row", async () => {
      selectMock.mockImplementationOnce(() =>
        createQuery([fakeRow({ name: "premium", costMultiplier: "2.5000" })])
      );

      const { getGroupCostMultiplier, invalidateGroupMultiplierCache } = await import(
        "@/repository/provider-groups"
      );
      invalidateGroupMultiplierCache();

      const result = await getGroupCostMultiplier("premium");
      expect(result).toBe(2.5);
    });

    it("returns cached value on repeated calls without hitting DB again", async () => {
      selectMock.mockImplementationOnce(() =>
        createQuery([fakeRow({ name: "cached-group", costMultiplier: "3.0000" })])
      );

      const { getGroupCostMultiplier, invalidateGroupMultiplierCache } = await import(
        "@/repository/provider-groups"
      );
      invalidateGroupMultiplierCache();

      const first = await getGroupCostMultiplier("cached-group");
      expect(first).toBe(3.0);

      const callsAfterFirst = selectMock.mock.calls.length;

      const second = await getGroupCostMultiplier("cached-group");
      expect(second).toBe(3.0);
      expect(selectMock.mock.calls.length).toBe(callsAfterFirst);
    });

    it("cache is invalidated after calling invalidateGroupMultiplierCache", async () => {
      selectMock
        .mockImplementationOnce(() =>
          createQuery([fakeRow({ name: "flip", costMultiplier: "1.5000" })])
        )
        .mockImplementationOnce(() =>
          createQuery([fakeRow({ name: "flip", costMultiplier: "4.0000" })])
        );

      const { getGroupCostMultiplier, invalidateGroupMultiplierCache } = await import(
        "@/repository/provider-groups"
      );
      invalidateGroupMultiplierCache();

      const first = await getGroupCostMultiplier("flip");
      expect(first).toBe(1.5);

      const callsAfterFirst = selectMock.mock.calls.length;

      invalidateGroupMultiplierCache();
      const second = await getGroupCostMultiplier("flip");
      expect(second).toBe(4.0);
      expect(selectMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });

    it("invalidates a cached multiplier when another process publishes an update", async () => {
      selectMock
        .mockImplementationOnce(() =>
          createQuery([fakeRow({ name: "remote", costMultiplier: "1.5000" })])
        )
        .mockImplementationOnce(() =>
          createQuery([fakeRow({ name: "remote", costMultiplier: "4.0000" })])
        );

      const { getGroupCostMultiplier, invalidateGroupMultiplierCache } = await import(
        "@/repository/provider-groups"
      );
      const { ensureGroupMultiplierCacheSubscription } = await import(
        "@/lib/cache/provider-group-multiplier-cache"
      );
      invalidateGroupMultiplierCache();
      await ensureGroupMultiplierCacheSubscription();

      expect(await getGroupCostMultiplier("remote")).toBe(1.5);
      expect(await getGroupCostMultiplier("remote")).toBe(1.5);
      expect(selectMock).toHaveBeenCalledTimes(1);

      pubsubHarness.callback?.("updated");
      expect(await getGroupCostMultiplier("remote")).toBe(4);
      expect(selectMock).toHaveBeenCalledTimes(2);
    });

    it("does not re-cache an old in-flight query after an invalidation event", async () => {
      let resolveOldQuery: ((rows: ReturnType<typeof fakeRow>[]) => void) | undefined;
      const oldQuery: any = new Promise<ReturnType<typeof fakeRow>[]>((resolve) => {
        resolveOldQuery = resolve;
      });
      oldQuery.from = vi.fn(() => oldQuery);
      oldQuery.where = vi.fn(() => oldQuery);

      selectMock
        .mockImplementationOnce(() => oldQuery)
        .mockImplementationOnce(() =>
          createQuery([fakeRow({ name: "racing", costMultiplier: "4.0000" })])
        );

      const { getGroupCostMultiplier, invalidateGroupMultiplierCache } = await import(
        "@/repository/provider-groups"
      );
      const { ensureGroupMultiplierCacheSubscription } = await import(
        "@/lib/cache/provider-group-multiplier-cache"
      );
      invalidateGroupMultiplierCache();
      await ensureGroupMultiplierCacheSubscription();

      const oldResult = getGroupCostMultiplier("racing");
      expect(selectMock).toHaveBeenCalledTimes(1);
      pubsubHarness.callback?.("updated");
      resolveOldQuery?.([fakeRow({ name: "racing", costMultiplier: "1.5000" })]);
      expect(await oldResult).toBe(1.5);

      expect(await getGroupCostMultiplier("racing")).toBe(4);
      expect(selectMock).toHaveBeenCalledTimes(2);
    });

    it("bounds the per-process multiplier cache entry count", async () => {
      const {
        GROUP_MULTIPLIER_CACHE_MAX_ENTRIES,
        getGroupMultiplierCacheVersion,
        invalidateGroupMultiplierCache,
        readCachedGroupMultiplier,
        writeCachedGroupMultiplier,
      } = await import("@/lib/cache/provider-group-multiplier-cache");
      invalidateGroupMultiplierCache();
      const version = getGroupMultiplierCacheVersion();

      for (let index = 0; index <= GROUP_MULTIPLIER_CACHE_MAX_ENTRIES; index++) {
        writeCachedGroupMultiplier(`group-${index}`, index, version);
      }

      expect(readCachedGroupMultiplier("group-0")).toBeUndefined();
      expect(readCachedGroupMultiplier(`group-${GROUP_MULTIPLIER_CACHE_MAX_ENTRIES}`)).toBe(
        GROUP_MULTIPLIER_CACHE_MAX_ENTRIES
      );
    });

    it("expires entries and rejects writes from an invalidated query version", async () => {
      const {
        getGroupMultiplierCacheVersion,
        invalidateGroupMultiplierCache,
        readCachedGroupMultiplier,
        writeCachedGroupMultiplier,
      } = await import("@/lib/cache/provider-group-multiplier-cache");
      const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
      invalidateGroupMultiplierCache();
      const oldVersion = getGroupMultiplierCacheVersion();

      expect(writeCachedGroupMultiplier("expiring", 2, oldVersion)).toBe(true);
      now.mockReturnValue(61_001);
      expect(readCachedGroupMultiplier("expiring")).toBeUndefined();

      invalidateGroupMultiplierCache();
      expect(writeCachedGroupMultiplier("stale", 3, oldVersion)).toBe(false);
      expect(readCachedGroupMultiplier("stale")).toBeUndefined();
      now.mockRestore();
    });

    it("backs off subscription retries after a connection failure", async () => {
      pubsubHarness.subscribe.mockRejectedValueOnce(new Error("subscriber unavailable"));
      const { ensureGroupMultiplierCacheSubscription } = await import(
        "@/lib/cache/provider-group-multiplier-cache"
      );

      expect(await ensureGroupMultiplierCacheSubscription()).toBe(false);
      expect(await ensureGroupMultiplierCacheSubscription()).toBe(false);
      expect(pubsubHarness.subscribe).toHaveBeenCalledTimes(1);
    });

    it("backs off when Redis subscription is unavailable without throwing", async () => {
      pubsubHarness.subscribe.mockResolvedValueOnce(null);
      const { ensureGroupMultiplierCacheSubscription } = await import(
        "@/lib/cache/provider-group-multiplier-cache"
      );

      expect(await ensureGroupMultiplierCacheSubscription()).toBe(false);
      expect(await ensureGroupMultiplierCacheSubscription()).toBe(false);
      expect(pubsubHarness.subscribe).toHaveBeenCalledTimes(1);
    });

    it("resolves comma-separated groups by taking the first matching parsed group from a single query", async () => {
      selectMock.mockImplementationOnce(() =>
        createQuery([fakeRow({ name: "enterprise", costMultiplier: "2.0000" })])
      );

      const { getGroupCostMultiplier, invalidateGroupMultiplierCache } = await import(
        "@/repository/provider-groups"
      );
      invalidateGroupMultiplierCache();

      const result = await getGroupCostMultiplier("premium,enterprise");
      expect(result).toBe(2.0);
      expect(selectMock).toHaveBeenCalledTimes(1);
    });

    it("first matching parsed group wins even if the query returns multiple rows", async () => {
      selectMock.mockImplementationOnce(() =>
        createQuery([
          fakeRow({ name: "enterprise", costMultiplier: "2.0000" }),
          fakeRow({ name: "premium", costMultiplier: "1.5000" }),
        ])
      );

      const { getGroupCostMultiplier, invalidateGroupMultiplierCache } = await import(
        "@/repository/provider-groups"
      );
      invalidateGroupMultiplierCache();

      const result = await getGroupCostMultiplier("premium,enterprise");
      expect(result).toBe(1.5);
    });

    it("falls back to 1.0 when no group in the list matches", async () => {
      selectMock.mockImplementationOnce(() => createQuery([]));

      const { getGroupCostMultiplier, invalidateGroupMultiplierCache } = await import(
        "@/repository/provider-groups"
      );
      invalidateGroupMultiplierCache();

      const result = await getGroupCostMultiplier("ghost,unknown");
      expect(result).toBe(1.0);
    });

    it("does not cache misses (fallback 1.0 is not persisted)", async () => {
      selectMock
        .mockImplementationOnce(() => createQuery([]))
        .mockImplementationOnce(() =>
          createQuery([fakeRow({ name: "new-group", costMultiplier: "5.0000" })])
        );

      const { getGroupCostMultiplier, invalidateGroupMultiplierCache } = await import(
        "@/repository/provider-groups"
      );
      invalidateGroupMultiplierCache();

      const first = await getGroupCostMultiplier("new-group");
      expect(first).toBe(1.0);

      const callsAfterFirst = selectMock.mock.calls.length;

      const second = await getGroupCostMultiplier("new-group");
      expect(second).toBe(5.0);
      expect(selectMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });
  });

  describe("countProvidersUsingGroup", () => {
    it("ignores soft-deleted providers when checking references", async () => {
      const whereArgs: unknown[] = [];
      selectMock.mockImplementationOnce(() => createQuery([{ groupTag: "premium" }], whereArgs));

      const { countProvidersUsingGroup } = await import("@/repository/provider-groups");
      const count = await countProvidersUsingGroup("premium");

      expect(count).toBe(1);
      expect(whereArgs).toHaveLength(1);
      expect(sqlToString(whereArgs[0]).toLowerCase()).toContain("deleted");
    });
  });

  describe("ensureProviderGroupsExist", () => {
    it("publishes group creation invalidation after the insert completes", async () => {
      let finishInsert: (() => void) | undefined;
      onConflictDoNothingMock.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishInsert = resolve;
          })
      );

      const { ensureProviderGroupsExist } = await import("@/repository/provider-groups");
      const operation = ensureProviderGroupsExist(["new-group"]);
      expect(pubsubHarness.publish).not.toHaveBeenCalled();

      finishInsert?.();
      await operation;
      expect(pubsubHarness.publish).toHaveBeenCalledWith("cch:cache:provider_groups:updated");
    });
  });

  describe("deleteProviderGroup", () => {
    it("throws when trying to delete the default group", async () => {
      selectMock.mockImplementationOnce(() => createQuery([{ name: "default" }]));

      const { deleteProviderGroup } = await import("@/repository/provider-groups");

      await expect(deleteProviderGroup(1)).rejects.toThrow(
        "Cannot delete the default provider group"
      );
    });

    it("does not throw for a non-default group", async () => {
      selectMock.mockImplementationOnce(() => createQuery([{ name: "premium" }]));

      const { deleteProviderGroup } = await import("@/repository/provider-groups");

      await expect(deleteProviderGroup(2)).resolves.toBeUndefined();
    });
  });
});
