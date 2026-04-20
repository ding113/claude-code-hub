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
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resetChainMocks();
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
        .mockImplementationOnce(() => createQuery([fakeRow({ name: "flip", costMultiplier: "1.5000" })]))
        .mockImplementationOnce(() => createQuery([fakeRow({ name: "flip", costMultiplier: "4.0000" })]));

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
        .mockImplementationOnce(() => createQuery([fakeRow({ name: "new-group", costMultiplier: "5.0000" })]));

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

  describe("deleteProviderGroup", () => {
    it("throws when trying to delete the default group", async () => {
      selectMock.mockImplementationOnce(() => createQuery([{ name: "default" }]));

      const { deleteProviderGroup } = await import("@/repository/provider-groups");

      await expect(deleteProviderGroup(1)).rejects.toThrow("Cannot delete the default provider group");
    });

    it("does not throw for a non-default group", async () => {
      selectMock.mockImplementationOnce(() => createQuery([{ name: "premium" }]));

      const { deleteProviderGroup } = await import("@/repository/provider-groups");

      await expect(deleteProviderGroup(2)).resolves.toBeUndefined();
    });
  });
});
