import { beforeEach, describe, expect, it, vi } from "vitest";

const transactionMock = vi.fn();
const selectMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/drizzle/db", () => ({
  db: {
    transaction: transactionMock,
    insert: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeLockedProvider(id: number, groupTag: string | null) {
  return {
    id,
    name: `Provider-${id}`,
    url: "https://api.example.com/v1",
    key: "sk-test",
    providerVendorId: 1,
    providerType: "codex",
    groupTag,
    priority: 1,
    weight: 100,
    costMultiplier: "1.0000",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    deletedAt: null,
  };
}

function arrangeTransaction(
  lockedRows: ReturnType<typeof makeLockedProvider>[],
  updateRows = lockedRows
) {
  const forUpdateMock = vi.fn(async () => lockedRows);
  const orderByMock = vi.fn(() => ({ for: forUpdateMock }));
  const whereSelectMock = vi.fn(() => ({ orderBy: orderByMock }));
  const fromMock = vi.fn(() => ({ where: whereSelectMock }));
  selectMock.mockReturnValue({ from: fromMock });

  const returningMock = vi.fn(async () =>
    updateRows.map((row) => ({
      id: row.id,
      providerVendorId: row.providerVendorId,
      providerType: row.providerType,
      url: row.url,
    }))
  );
  const whereUpdateMock = vi.fn(() => ({ returning: returningMock }));
  const setMock = vi.fn(() => ({ where: whereUpdateMock }));
  updateMock.mockReturnValue({ set: setMock });

  const tx = { select: selectMock, update: updateMock };
  transactionMock.mockImplementation(async (run) => run(tx));

  return { forUpdateMock, setMock };
}

describe("provider repository - batch preimage CAS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("locks rows and applies all updates when the approved preimage still matches", async () => {
    const rows = [makeLockedProvider(1, "approved"), makeLockedProvider(2, "approved")];
    const { forUpdateMock, setMock } = arrangeTransaction(rows);
    const { updateProviderBatchGroupsIfUnchanged } = await import("@/repository/provider");

    const result = await updateProviderBatchGroupsIfUnchanged(
      [{ ids: [1, 2], updates: { groupTag: "next", weight: 80 } }],
      rows.map((row) => ({
        providerId: row.id,
        providerType: "codex",
        values: { groupTag: "approved", weight: 100 },
      }))
    );

    expect(result).toEqual({ status: "updated", updatedCount: 2 });
    expect(forUpdateMock).toHaveBeenCalledWith("update");
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ groupTag: "next", weight: 80, updatedAt: expect.any(Date) })
    );
  });

  it("returns stale without writing when a live value differs from the preview preimage", async () => {
    const rows = [makeLockedProvider(1, "concurrent-change")];
    arrangeTransaction(rows);
    const { updateProviderBatchGroupsIfUnchanged } = await import("@/repository/provider");

    const result = await updateProviderBatchGroupsIfUnchanged(
      [{ ids: [1], updates: { groupTag: "next" } }],
      [
        {
          providerId: 1,
          providerType: "codex",
          values: { groupTag: "approved" },
        },
      ]
    );

    expect(result).toEqual({ status: "stale" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns stale when the provider type changed after preview", async () => {
    const rows = [makeLockedProvider(1, "approved")];
    arrangeTransaction(rows);
    const { updateProviderBatchGroupsIfUnchanged } = await import("@/repository/provider");

    const result = await updateProviderBatchGroupsIfUnchanged(
      [{ ids: [1], updates: { groupTag: "next" } }],
      [
        {
          providerId: 1,
          providerType: "claude",
          values: { groupTag: "approved" },
        },
      ]
    );

    expect(result).toEqual({ status: "stale" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns stale when provider enablement changed after preview", async () => {
    const rows = [makeLockedProvider(1, "approved")];
    arrangeTransaction(rows);
    const { updateProviderBatchGroupsIfUnchanged } = await import("@/repository/provider");

    const result = await updateProviderBatchGroupsIfUnchanged(
      [{ ids: [1], updates: { groupTag: "next" } }],
      [
        {
          providerId: 1,
          providerType: "codex",
          values: { groupTag: "approved", isEnabled: false },
        },
      ]
    );

    expect(result).toEqual({ status: "stale" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
