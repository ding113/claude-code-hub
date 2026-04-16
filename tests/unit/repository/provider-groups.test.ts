import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

const selectMock = vi.fn();
const fromMock = vi.fn();
const whereMock = vi.fn();
const limitMock = vi.fn();
const orderByMock = vi.fn();
const insertMock = vi.fn();
const valuesMock = vi.fn();
const returningMock = vi.fn();
const updateMock = vi.fn();
const setMock = vi.fn();
const deleteMock = vi.fn();

function resetChainMocks() {
  selectMock.mockReturnValue({ from: fromMock });
  fromMock.mockReturnValue({ where: whereMock, orderBy: orderByMock });
  whereMock.mockReturnValue({ limit: limitMock, returning: returningMock });
  limitMock.mockResolvedValue([]);
  orderByMock.mockResolvedValue([]);
  insertMock.mockReturnValue({ values: valuesMock });
  valuesMock.mockReturnValue({ returning: returningMock });
  returningMock.mockResolvedValue([]);
  updateMock.mockReturnValue({ set: setMock });
  setMock.mockReturnValue({ where: whereMock });
  deleteMock.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
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
}));

// ---------------------------------------------------------------------------
// Helper: build a fake DB row matching the drizzle select shape
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("provider-groups repository", () => {
  beforeEach(() => {
    vi.resetModules();
    resetChainMocks();
  });

  // -----------------------------------------------------------------------
  // getGroupCostMultiplier
  // -----------------------------------------------------------------------

  describe("getGroupCostMultiplier", () => {
    it("returns 1.0 for an unknown group (no DB row)", async () => {
      limitMock.mockResolvedValue([]);

      const { getGroupCostMultiplier, invalidateGroupMultiplierCache } = await import(
        "@/repository/provider-groups"
      );
      invalidateGroupMultiplierCache();

      const result = await getGroupCostMultiplier("nonexistent");
      expect(result).toBe(1.0);
    });

    it("returns the multiplier from the DB row", async () => {
      limitMock.mockResolvedValue([fakeRow({ name: "premium", costMultiplier: "2.5000" })]);

      const { getGroupCostMultiplier, invalidateGroupMultiplierCache } = await import(
        "@/repository/provider-groups"
      );
      invalidateGroupMultiplierCache();

      const result = await getGroupCostMultiplier("premium");
      expect(result).toBe(2.5);
    });

    it("returns cached value on repeated calls without hitting DB again", async () => {
      limitMock.mockResolvedValue([fakeRow({ name: "cached-group", costMultiplier: "3.0000" })]);

      const { getGroupCostMultiplier, invalidateGroupMultiplierCache } = await import(
        "@/repository/provider-groups"
      );
      invalidateGroupMultiplierCache();

      const first = await getGroupCostMultiplier("cached-group");
      expect(first).toBe(3.0);

      // The first call triggers select -> from -> where -> limit.
      // Record the call count after the first invocation.
      const callsAfterFirst = selectMock.mock.calls.length;

      const second = await getGroupCostMultiplier("cached-group");
      expect(second).toBe(3.0);

      // No additional DB call should have been made.
      expect(selectMock.mock.calls.length).toBe(callsAfterFirst);
    });

    it("cache is invalidated after calling invalidateGroupMultiplierCache", async () => {
      limitMock.mockResolvedValue([fakeRow({ name: "flip", costMultiplier: "1.5000" })]);

      const { getGroupCostMultiplier, invalidateGroupMultiplierCache } = await import(
        "@/repository/provider-groups"
      );
      invalidateGroupMultiplierCache();

      const first = await getGroupCostMultiplier("flip");
      expect(first).toBe(1.5);

      const callsAfterFirst = selectMock.mock.calls.length;

      // Invalidate and change the underlying data
      invalidateGroupMultiplierCache();
      limitMock.mockResolvedValue([fakeRow({ name: "flip", costMultiplier: "4.0000" })]);

      const second = await getGroupCostMultiplier("flip");
      expect(second).toBe(4.0);

      // A new DB call must have been made.
      expect(selectMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });
  });

  // -----------------------------------------------------------------------
  // deleteProviderGroup
  // -----------------------------------------------------------------------

  describe("deleteProviderGroup", () => {
    it("throws when trying to delete the default group", async () => {
      limitMock.mockResolvedValue([{ name: "default" }]);

      const { deleteProviderGroup } = await import("@/repository/provider-groups");

      await expect(deleteProviderGroup(1)).rejects.toThrow(
        "Cannot delete the default provider group"
      );
    });

    it("does not throw for a non-default group", async () => {
      limitMock.mockResolvedValue([{ name: "premium" }]);

      const { deleteProviderGroup } = await import("@/repository/provider-groups");

      // Should not throw
      await expect(deleteProviderGroup(2)).resolves.toBeUndefined();
    });
  });
});
