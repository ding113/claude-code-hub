import { describe, expect, test, vi } from "vitest";

type SelectRow = Record<string, unknown>;

function createTxMock(selectResults: SelectRow[][]) {
  const queue = [...selectResults];

  const selectLimitMock = vi.fn(async () => queue.shift() ?? []);
  const selectWhereMock = vi.fn(() => ({ limit: selectLimitMock }));
  const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  const updatePayloads: Array<Record<string, unknown>> = [];
  const updateWhereMock = vi.fn(async () => []);
  const updateSetMock = vi.fn((payload: Record<string, unknown>) => {
    updatePayloads.push(payload);
    return { where: updateWhereMock };
  });
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const insertReturningMock = vi.fn(async () => []);
  const insertOnConflictDoNothingMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertValuesMock = vi.fn(() => ({ onConflictDoNothing: insertOnConflictDoNothingMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const tx = {
    select: selectMock,
    update: updateMock,
    insert: insertMock,
  };

  const nestedTransactionMock = vi.fn(
    async (runInTx: (nestedTx: typeof tx) => Promise<unknown>) => {
      return runInTx(tx);
    }
  );

  const txWithSavepoint = {
    ...tx,
    transaction: nestedTransactionMock,
  };

  return {
    tx: txWithSavepoint,
    updatePayloads,
    mocks: {
      updateMock,
      updateWhereMock,
      insertMock,
      insertReturningMock,
      selectLimitMock,
      nestedTransactionMock,
    },
  };
}

async function arrangeSyncTest(selectResults: SelectRow[][]) {
  vi.resetModules();

  const txState = createTxMock(selectResults);
  const transactionMock = vi.fn(async (runInTx: (tx: typeof txState.tx) => Promise<unknown>) => {
    return runInTx(txState.tx);
  });
  const resetEndpointCircuitMock = vi.fn(async () => {});

  vi.doMock("@/drizzle/db", () => ({
    db: {
      transaction: transactionMock,
    },
  }));
  vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
    resetEndpointCircuit: resetEndpointCircuitMock,
  }));

  const { syncProviderEndpointOnProviderEdit } = await import("@/repository/provider-endpoints");

  return {
    syncProviderEndpointOnProviderEdit,
    transactionMock,
    resetEndpointCircuitMock,
    ...txState,
  };
}

describe("syncProviderEndpointOnProviderEdit", () => {
  test("invalid next url should throw instead of silent noop", async () => {
    const { syncProviderEndpointOnProviderEdit, transactionMock, mocks } = await arrangeSyncTest(
      []
    );

    await expect(
      syncProviderEndpointOnProviderEdit({
        providerId: 1,
        vendorId: 11,
        providerType: "claude",
        previousVendorId: 11,
        previousProviderType: "claude",
        previousUrl: "https://old.example.com/v1/messages",
        nextUrl: "not-a-valid-url",
        keepPreviousWhenReferenced: true,
      })
    ).rejects.toThrow("[ProviderEndpointSync] nextUrl must be a valid URL");

    expect(transactionMock).not.toHaveBeenCalled();
    expect(mocks.updateMock).not.toHaveBeenCalled();
    expect(mocks.insertMock).not.toHaveBeenCalled();
  });

  test("website_url only edit should not revive disabled endpoint when identity is unchanged", async () => {
    const endpointUrl = "https://same.example.com/v1/messages";
    const { syncProviderEndpointOnProviderEdit, mocks, resetEndpointCircuitMock } =
      await arrangeSyncTest([[{ id: 101, deletedAt: null, isEnabled: false }]]);

    const result = await syncProviderEndpointOnProviderEdit({
      providerId: 1,
      vendorId: 11,
      providerType: "claude",
      previousVendorId: 11,
      previousProviderType: "claude",
      previousUrl: endpointUrl,
      nextUrl: endpointUrl,
      keepPreviousWhenReferenced: true,
    });

    expect(result).toEqual({ action: "noop" });
    expect(mocks.updateMock).not.toHaveBeenCalled();
    expect(mocks.insertMock).not.toHaveBeenCalled();
    expect(resetEndpointCircuitMock).not.toHaveBeenCalled();
  });

  test("in-place url move should clear stale probe snapshot fields", async () => {
    const oldUrl = "https://old.example.com/v1/messages";
    const newUrl = "https://new.example.com/v1/messages";
    const { syncProviderEndpointOnProviderEdit, updatePayloads, mocks, resetEndpointCircuitMock } =
      await arrangeSyncTest([[{ id: 7, deletedAt: null, isEnabled: true }], [], []]);

    const result = await syncProviderEndpointOnProviderEdit({
      providerId: 1,
      vendorId: 11,
      providerType: "claude",
      previousVendorId: 11,
      previousProviderType: "claude",
      previousUrl: oldUrl,
      nextUrl: newUrl,
      keepPreviousWhenReferenced: true,
    });

    expect(result).toEqual({ action: "updated-previous-in-place" });
    expect(mocks.updateMock).toHaveBeenCalledTimes(1);
    expect(resetEndpointCircuitMock).toHaveBeenCalledTimes(1);
    expect(resetEndpointCircuitMock).toHaveBeenCalledWith(7);
    expect(updatePayloads[0]).toEqual(
      expect.objectContaining({
        url: newUrl,
        lastProbedAt: null,
        lastProbeOk: null,
        lastProbeStatusCode: null,
        lastProbeLatencyMs: null,
        lastProbeErrorType: null,
        lastProbeErrorMessage: null,
      })
    );
  });

  test("in-place url move with external tx should defer circuit reset until caller commits", async () => {
    const oldUrl = "https://old.example.com/v1/messages";
    const newUrl = "https://new.example.com/v1/messages";
    const {
      syncProviderEndpointOnProviderEdit,
      tx,
      transactionMock,
      resetEndpointCircuitMock,
      updatePayloads,
      mocks,
    } = await arrangeSyncTest([[{ id: 7, deletedAt: null, isEnabled: true }], [], []]);

    const result = await syncProviderEndpointOnProviderEdit(
      {
        providerId: 1,
        vendorId: 11,
        providerType: "claude",
        previousVendorId: 11,
        previousProviderType: "claude",
        previousUrl: oldUrl,
        nextUrl: newUrl,
        keepPreviousWhenReferenced: true,
      },
      { tx }
    );

    expect(result).toEqual({
      action: "updated-previous-in-place",
      resetCircuitEndpointId: 7,
    });
    expect(mocks.updateMock).toHaveBeenCalledTimes(1);
    expect(updatePayloads[0]).toEqual(expect.objectContaining({ url: newUrl }));
    expect(transactionMock).not.toHaveBeenCalled();
    expect(resetEndpointCircuitMock).not.toHaveBeenCalled();
  });

  test("concurrent insert conflict should degrade to noop instead of throwing", async () => {
    const oldUrl = "https://old.example.com/v1/messages";
    const newUrl = "https://new.example.com/v1/messages";
    const { syncProviderEndpointOnProviderEdit, mocks, resetEndpointCircuitMock } =
      await arrangeSyncTest([[], [], [], [{ id: 201, deletedAt: null, isEnabled: true }]]);

    const result = await syncProviderEndpointOnProviderEdit({
      providerId: 1,
      vendorId: 11,
      providerType: "claude",
      previousVendorId: 11,
      previousProviderType: "claude",
      previousUrl: oldUrl,
      nextUrl: newUrl,
      keepPreviousWhenReferenced: true,
    });

    expect(result).toEqual({ action: "noop" });
    expect(mocks.insertMock).toHaveBeenCalledTimes(1);
    expect(mocks.updateMock).not.toHaveBeenCalled();
    expect(resetEndpointCircuitMock).not.toHaveBeenCalled();
  });

  test("in-place move unique conflict should fallback to conservative keep-previous behavior", async () => {
    const oldUrl = "https://old.example.com/v1/messages";
    const newUrl = "https://new.example.com/v1/messages";
    const { syncProviderEndpointOnProviderEdit, updatePayloads, mocks, resetEndpointCircuitMock } =
      await arrangeSyncTest([
        [{ id: 7, deletedAt: null, isEnabled: true }],
        [],
        [],
        [],
        [{ id: 9, deletedAt: null, isEnabled: true }],
      ]);

    mocks.updateWhereMock.mockRejectedValueOnce(
      Object.assign(new Error("duplicate key value violates unique constraint"), {
        code: "23505",
      })
    );

    const result = await syncProviderEndpointOnProviderEdit({
      providerId: 1,
      vendorId: 11,
      providerType: "claude",
      previousVendorId: 11,
      previousProviderType: "claude",
      previousUrl: oldUrl,
      nextUrl: newUrl,
      keepPreviousWhenReferenced: true,
    });

    expect(result).toEqual({ action: "kept-previous-and-kept-next" });
    expect(mocks.insertMock).toHaveBeenCalledTimes(1);
    expect(mocks.updateMock).toHaveBeenCalledTimes(1);
    expect(updatePayloads[0]).toEqual(
      expect.objectContaining({
        url: newUrl,
      })
    );
    expect(resetEndpointCircuitMock).not.toHaveBeenCalled();
  });

  test("when next endpoint already exists, should keep previous endpoint under conservative policy", async () => {
    const oldUrl = "https://old.example.com/v1/messages";
    const newUrl = "https://new.example.com/v1/messages";
    const { syncProviderEndpointOnProviderEdit, mocks, resetEndpointCircuitMock } =
      await arrangeSyncTest([
        [{ id: 7, deletedAt: null, isEnabled: true }],
        [{ id: 9, deletedAt: null, isEnabled: true }],
        [{ id: 9, deletedAt: null, isEnabled: true }],
        [],
      ]);

    const result = await syncProviderEndpointOnProviderEdit({
      providerId: 1,
      vendorId: 11,
      providerType: "claude",
      previousVendorId: 11,
      previousProviderType: "claude",
      previousUrl: oldUrl,
      nextUrl: newUrl,
      keepPreviousWhenReferenced: true,
    });

    expect(result).toEqual({ action: "kept-previous-and-kept-next" });
    expect(mocks.updateMock).not.toHaveBeenCalled();
    expect(mocks.insertMock).not.toHaveBeenCalled();
    expect(resetEndpointCircuitMock).not.toHaveBeenCalled();
  });

  test("kept-previous with concurrent noop should return kept-previous-and-kept-next", async () => {
    const oldUrl = "https://old.example.com/v1/messages";
    const newUrl = "https://new.example.com/v1/messages";
    const { syncProviderEndpointOnProviderEdit, mocks, resetEndpointCircuitMock } =
      await arrangeSyncTest([
        [{ id: 7, deletedAt: null, isEnabled: true }],
        [],
        [{ id: 99 }],
        [],
        [{ id: 9, deletedAt: null, isEnabled: true }],
      ]);

    const result = await syncProviderEndpointOnProviderEdit({
      providerId: 1,
      vendorId: 11,
      providerType: "claude",
      previousVendorId: 11,
      previousProviderType: "claude",
      previousUrl: oldUrl,
      nextUrl: newUrl,
      keepPreviousWhenReferenced: true,
    });

    expect(result).toEqual({ action: "kept-previous-and-kept-next" });
    expect(mocks.insertMock).toHaveBeenCalledTimes(1);
    expect(mocks.updateMock).not.toHaveBeenCalled();
    expect(resetEndpointCircuitMock).not.toHaveBeenCalled();
  });
});
