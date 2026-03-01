import { describe, expect, test, vi } from "vitest";

type SelectRow = Record<string, unknown>;

function createRestoreDbHarness(options: {
  selectQueue: SelectRow[][];
  updateReturningQueue?: SelectRow[][];
}) {
  const selectQueue = [...options.selectQueue];
  const updateReturningQueue = [...(options.updateReturningQueue ?? [])];

  const selectLimitMock = vi.fn(async () => selectQueue.shift() ?? []);
  const selectOrderByMock = vi.fn(() => ({ limit: selectLimitMock }));
  const selectWhereMock = vi.fn(() => ({ limit: selectLimitMock, orderBy: selectOrderByMock }));
  const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  const updateReturningMock = vi.fn(async () => updateReturningQueue.shift() ?? []);
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const tx = {
    select: selectMock,
    update: updateMock,
  };

  const transactionMock = vi.fn(async (runInTx: (trx: typeof tx) => Promise<unknown>) => {
    return runInTx(tx);
  });

  return {
    db: {
      transaction: transactionMock,
      select: selectMock,
      update: updateMock,
    },
    mocks: {
      transactionMock,
      selectLimitMock,
      updateMock,
      updateSetMock,
    },
  };
}

async function setupProviderRepository(options: {
  selectQueue: SelectRow[][];
  updateReturningQueue?: SelectRow[][];
}) {
  vi.resetModules();

  const harness = createRestoreDbHarness(options);

  vi.doMock("@/drizzle/db", () => ({
    db: harness.db,
  }));

  vi.doMock("@/repository/provider-endpoints", () => ({
    ensureProviderEndpointExistsForUrl: vi.fn(),
    getOrCreateProviderVendorIdFromUrls: vi.fn(),
    syncProviderEndpointOnProviderEdit: vi.fn(),
    tryDeleteProviderVendorIfEmpty: vi.fn(),
  }));

  const repository = await import("../../../src/repository/provider");

  return {
    ...repository,
    harness,
  };
}

describe("provider repository restore", () => {
  test("restoreProvider restores recent soft-deleted provider and clears deletedAt", async () => {
    const deletedAt = new Date(Date.now() - 15_000);
    const { restoreProvider, harness } = await setupProviderRepository({
      selectQueue: [
        [
          {
            id: 1,
            providerVendorId: null,
            providerType: "claude",
            url: "https://api.example.com/v1",
            deletedAt,
          },
        ],
      ],
      updateReturningQueue: [[{ id: 1 }]],
    });

    const restored = await restoreProvider(1);

    expect(restored).toBe(true);
    expect(harness.mocks.transactionMock).toHaveBeenCalledTimes(1);
    expect(harness.mocks.updateMock).toHaveBeenCalledTimes(1);
    expect(harness.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: null,
        updatedAt: expect.any(Date),
      })
    );
  });

  test("restoreProvider returns false when provider row is already restored concurrently", async () => {
    const deletedAt = new Date(Date.now() - 5_000);
    const { restoreProvider, harness } = await setupProviderRepository({
      selectQueue: [
        [
          {
            id: 31,
            providerVendorId: null,
            providerType: "claude",
            url: "https://api.example.com/v1",
            deletedAt,
          },
        ],
      ],
      updateReturningQueue: [[]],
    });

    const restored = await restoreProvider(31);

    expect(restored).toBe(false);
    expect(harness.mocks.updateMock).toHaveBeenCalledTimes(1);
    expect(harness.mocks.selectLimitMock).toHaveBeenCalledTimes(1);
  });

  test("restoreProvider rejects provider deleted more than 60 seconds ago", async () => {
    const deletedAt = new Date(Date.now() - 61_000);
    const { restoreProvider, harness } = await setupProviderRepository({
      selectQueue: [
        [
          {
            id: 2,
            providerVendorId: null,
            providerType: "claude",
            url: "https://api.example.com/v1",
            deletedAt,
          },
        ],
      ],
      updateReturningQueue: [[{ id: 2 }]],
    });

    const restored = await restoreProvider(2);

    expect(restored).toBe(false);
    expect(harness.mocks.updateMock).not.toHaveBeenCalled();
  });

  test("restoreProvidersBatch restores multiple providers in a single transaction", async () => {
    const recent = new Date(Date.now() - 10_000);
    const { restoreProvidersBatch, harness } = await setupProviderRepository({
      selectQueue: [
        [
          {
            id: 11,
            providerVendorId: null,
            providerType: "claude",
            url: "https://api.example.com/v1",
            deletedAt: recent,
          },
        ],
        [
          {
            id: 12,
            providerVendorId: null,
            providerType: "claude",
            url: "https://api.example.com/v1",
            deletedAt: recent,
          },
        ],
        [],
      ],
      updateReturningQueue: [[{ id: 11 }], [{ id: 12 }]],
    });

    const restoredCount = await restoreProvidersBatch([11, 12, 11, 13]);

    expect(restoredCount).toBe(2);
    expect(harness.mocks.transactionMock).toHaveBeenCalledTimes(1);
    expect(harness.mocks.selectLimitMock).toHaveBeenCalledTimes(3);
    expect(harness.mocks.updateMock).toHaveBeenCalledTimes(2);
  });

  test("restoreProvidersBatch should short-circuit for empty id list", async () => {
    const { restoreProvidersBatch, harness } = await setupProviderRepository({
      selectQueue: [],
      updateReturningQueue: [],
    });

    const restoredCount = await restoreProvidersBatch([]);

    expect(restoredCount).toBe(0);
    expect(harness.mocks.transactionMock).not.toHaveBeenCalled();
  });

  test("restoreProvider skips endpoint restoration when provider url is blank", async () => {
    const deletedAt = new Date(Date.now() - 8_000);
    const { restoreProvider, harness } = await setupProviderRepository({
      selectQueue: [
        [
          {
            id: 55,
            providerVendorId: 5,
            providerType: "claude",
            url: "   ",
            deletedAt,
          },
        ],
      ],
      updateReturningQueue: [[{ id: 55 }]],
    });

    const restored = await restoreProvider(55);

    expect(restored).toBe(true);
    expect(harness.mocks.selectLimitMock).toHaveBeenCalledTimes(1);
    expect(harness.mocks.updateMock).toHaveBeenCalledTimes(1);
  });

  test("restoreProvider skips endpoint restoration when active provider reference exists", async () => {
    const deletedAt = new Date(Date.now() - 8_000);
    const { restoreProvider, harness } = await setupProviderRepository({
      selectQueue: [
        [
          {
            id: 66,
            providerVendorId: 8,
            providerType: "claude",
            url: "https://api.example.com/v1/messages",
            deletedAt,
          },
        ],
        [{ id: 999 }],
      ],
      updateReturningQueue: [[{ id: 66 }]],
    });

    const restored = await restoreProvider(66);

    expect(restored).toBe(true);
    expect(harness.mocks.selectLimitMock).toHaveBeenCalledTimes(2);
    expect(harness.mocks.updateMock).toHaveBeenCalledTimes(1);
  });

  test("restoreProvider skips endpoint restoration when no deleted endpoint can be matched", async () => {
    const deletedAt = new Date(Date.now() - 8_000);
    const { restoreProvider, harness } = await setupProviderRepository({
      selectQueue: [
        [
          {
            id: 67,
            providerVendorId: 8,
            providerType: "claude",
            url: "https://api.example.com/v1/messages",
            deletedAt,
          },
        ],
        [],
        [],
        [],
      ],
      updateReturningQueue: [[{ id: 67 }]],
    });

    const restored = await restoreProvider(67);

    expect(restored).toBe(true);
    expect(harness.mocks.selectLimitMock).toHaveBeenCalledTimes(4);
    expect(harness.mocks.updateMock).toHaveBeenCalledTimes(1);
  });

  test("restoreProvider skips endpoint restoration when active endpoint already exists", async () => {
    const deletedAt = new Date(Date.now() - 10_000);
    const { restoreProvider, harness } = await setupProviderRepository({
      selectQueue: [
        [
          {
            id: 77,
            providerVendorId: 9,
            providerType: "claude",
            url: "https://api.example.com/v1/messages",
            deletedAt,
          },
        ],
        [],
        [{ id: 9001 }],
      ],
      updateReturningQueue: [[{ id: 77 }]],
    });

    const restored = await restoreProvider(77);

    expect(restored).toBe(true);
    expect(harness.mocks.selectLimitMock).toHaveBeenCalledTimes(3);
    expect(harness.mocks.updateMock).toHaveBeenCalledTimes(1);
  });
});
