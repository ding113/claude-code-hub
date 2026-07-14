import { beforeEach, describe, expect, it, vi } from "vitest";

const transactionMock = vi.fn();
const dbSelectMock = vi.fn();
const dbDeleteMock = vi.fn();
const txInsertMock = vi.fn();
const txSelectMock = vi.fn();
const txUpdateMock = vi.fn();
const txDeleteMock = vi.fn();

vi.mock("@/drizzle/db", () => ({
  db: {
    transaction: transactionMock,
    select: dbSelectMock,
    delete: dbDeleteMock,
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

const fingerprint = "a".repeat(64);

function makeLockedProvider(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Provider-${id}`,
    url: "https://api.example.com/v1",
    key: "sk-test",
    providerVendorId: 1,
    providerType: "codex",
    isEnabled: true,
    groupTag: "approved",
    priority: 1,
    weight: 100,
    costMultiplier: "1.0000",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function makeLedgerResult() {
  return {
    applyResult: {
      operationId: "operation-1",
      appliedAt: "2026-07-14T00:00:00.000Z",
      updatedCount: 1,
      undoToken: "undo-1",
      undoExpiresAt: "2026-07-14T00:10:00.000Z",
    },
    previewProviderIds: [1, 2],
    effectiveProviderIds: [1],
    preimages: [
      {
        providerId: 1,
        providerType: "codex" as const,
        isEnabled: true,
        values: { groupTag: "approved" },
      },
    ],
    undoRestorable: true,
    postCommitEffects: {
      clearLimit5hCostCache: false,
      circuitBreakerChanged: false,
      nextCircuitBreakerFailureThreshold: null,
    },
  };
}

function arrangeDbSelectRows(...rowSets: unknown[][]) {
  for (const rows of rowSets) {
    dbSelectMock.mockImplementationOnce(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => rows) })),
    }));
  }
}

function arrangeClaimInsert(inserted: boolean) {
  const returning = vi.fn(async () => (inserted ? [{ claimKey: "claim-1" }] : []));
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  txInsertMock.mockReturnValue({ values });
  return { values, onConflictDoNothing, returning };
}

function arrangeLockedRows(rows: ReturnType<typeof makeLockedProvider>[]) {
  const forUpdate = vi.fn(async () => rows);
  const orderBy = vi.fn(() => ({ for: forUpdate }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  txSelectMock.mockReturnValueOnce({ from });
  return { where, orderBy, forUpdate };
}

function arrangeLedgerRows(rows: unknown[]) {
  const where = vi.fn(async () => rows);
  const from = vi.fn(() => ({ where }));
  txSelectMock.mockReturnValueOnce({ from });
  return { where };
}

function arrangeUpdates(updatedProviderIds: number[]) {
  const providerReturning = vi.fn(async () => updatedProviderIds.map((id) => ({ id })));
  const providerWhere = vi.fn(() => ({ returning: providerReturning }));
  const providerSet = vi.fn(() => ({ where: providerWhere }));

  const ledgerReturning = vi.fn(async () => [{ claimKey: "claim-1" }]);
  const ledgerWhere = vi.fn(() => ({ returning: ledgerReturning }));
  const ledgerSet = vi.fn(() => ({ where: ledgerWhere }));

  txUpdateMock.mockReturnValueOnce({ set: providerSet }).mockReturnValueOnce({ set: ledgerSet });

  return { providerSet, ledgerSet };
}

function makeApplyInput() {
  return {
    claimKey: "claim-1",
    previewToken: "preview-1",
    payloadFingerprint: fingerprint,
    groups: [{ ids: [1], updates: { groupTag: "next" } }],
    expectedPreimages: [
      {
        providerId: 1,
        providerType: "codex" as const,
        values: { isEnabled: true, groupTag: "approved" },
      },
      {
        providerId: 2,
        providerType: "codex" as const,
        values: { isEnabled: true, groupTag: "approved" },
      },
    ],
    effectiveProviderIds: [1],
    undoPreimage: { 1: { groupTag: "approved" } },
    undoRestorable: true,
    postCommitEffects: {
      clearLimit5hCostCache: false,
      circuitBreakerChanged: false,
      nextCircuitBreakerFailureThreshold: null,
    },
    operationId: "operation-1",
    undoToken: "undo-1",
    undoTtlSeconds: 600,
  };
}

describe("provider repository - durable batch apply ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00.000Z"));
    dbDeleteMock.mockReturnValue({ where: vi.fn(async () => undefined) });
    txDeleteMock.mockReturnValue({ where: vi.fn(async () => undefined) });
    transactionMock.mockImplementation(async (run) =>
      run({
        insert: txInsertMock,
        select: txSelectMock,
        update: txUpdateMock,
        delete: txDeleteMock,
      })
    );
  });

  it("claims, locks the complete preview, updates only effective providers and stores undo data", async () => {
    const rows = [makeLockedProvider(1), makeLockedProvider(2)];
    const claim = arrangeClaimInsert(true);
    const lock = arrangeLockedRows(rows);
    const updates = arrangeUpdates([1]);
    arrangeDbSelectRows([]);

    const { applyProviderBatchOperationIfUnchanged } = await import("@/repository/provider");
    const result = await applyProviderBatchOperationIfUnchanged(makeApplyInput());

    expect(result).toEqual({ status: "applied", result: makeLedgerResult(), undoAvailable: true });
    expect(claim.onConflictDoNothing).toHaveBeenCalledOnce();
    expect(lock.forUpdate).toHaveBeenCalledWith("update");
    expect(updates.providerSet).toHaveBeenCalledWith(
      expect.objectContaining({ groupTag: "next", updatedAt: expect.any(Date) })
    );
    expect(updates.ledgerSet).toHaveBeenCalledWith({
      status: "applied",
      result: makeLedgerResult(),
      undoExpiresAt: new Date("2026-07-14T00:10:00.000Z"),
      updatedAt: expect.any(Date),
    });
  });

  it("rolls back the claim and performs no updates when any preview provider drifted", async () => {
    arrangeClaimInsert(true);
    arrangeLockedRows([makeLockedProvider(1), makeLockedProvider(2, { isEnabled: false })]);

    const { applyProviderBatchOperationIfUnchanged } = await import("@/repository/provider");
    const result = await applyProviderBatchOperationIfUnchanged(makeApplyInput());

    expect(result).toEqual({ status: "stale" });
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("replays the committed result after a same-claim conflict", async () => {
    arrangeClaimInsert(false);
    const storedResult = makeLedgerResult();
    arrangeLedgerRows([
      {
        claimKey: "claim-1",
        previewToken: "preview-1",
        payloadFingerprint: fingerprint,
        status: "applied",
        result: storedResult,
        undoExpiresAt: new Date("2026-07-14T00:10:00.000Z"),
        undoConsumedAt: null,
      },
    ]);
    arrangeDbSelectRows([]);

    const { applyProviderBatchOperationIfUnchanged } = await import("@/repository/provider");
    const result = await applyProviderBatchOperationIfUnchanged(makeApplyInput());

    expect(result).toEqual({ status: "replay", result: storedResult, undoAvailable: true });
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a different claim key that attempts to consume an existing preview", async () => {
    arrangeClaimInsert(false);
    arrangeLedgerRows([
      {
        claimKey: "another-claim",
        previewToken: "preview-1",
        payloadFingerprint: fingerprint,
        status: "applied",
        result: makeLedgerResult(),
      },
    ]);

    const { applyProviderBatchOperationIfUnchanged } = await import("@/repository/provider");
    const result = await applyProviderBatchOperationIfUnchanged(makeApplyInput());

    expect(result).toEqual({ status: "preview_consumed" });
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("detects idempotency-key reuse with another payload", async () => {
    arrangeClaimInsert(false);
    arrangeLedgerRows([
      {
        claimKey: "claim-1",
        previewToken: "preview-1",
        payloadFingerprint: "b".repeat(64),
        status: "applied",
        result: makeLedgerResult(),
      },
    ]);

    const { applyProviderBatchOperationIfUnchanged } = await import("@/repository/provider");
    const result = await applyProviderBatchOperationIfUnchanged(makeApplyInput());

    expect(result).toEqual({ status: "idempotency_conflict" });
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects sensitive URLs before they can enter the durable ledger", async () => {
    const { applyProviderBatchOperationIfUnchanged } = await import("@/repository/provider");
    const input = makeApplyInput();

    await expect(
      applyProviderBatchOperationIfUnchanged({
        ...input,
        undoPreimage: {
          1: {
            groupTag: "approved",
            proxyUrl: "http://user:secret@proxy.example.com:8080",
            mcpPassthroughUrl: "https://token@example.com/mcp",
          },
        },
      })
    ).rejects.toThrow("sensitive field");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("finds a durable replay before the Redis preview is consulted", async () => {
    const storedResult = makeLedgerResult();
    arrangeDbSelectRows(
      [
        {
          claimKey: "claim-1",
          previewToken: "preview-1",
          payloadFingerprint: fingerprint,
          status: "applied",
          result: storedResult,
          undoExpiresAt: new Date("2026-07-14T00:10:00.000Z"),
          undoConsumedAt: null,
        },
      ],
      []
    );

    const { findProviderBatchApplyOperation } = await import("@/repository/provider");
    const result = await findProviderBatchApplyOperation({
      claimKey: "claim-1",
      previewToken: "preview-1",
      payloadFingerprint: fingerprint,
    });

    expect(result).toEqual({ status: "replay", result: storedResult, undoAvailable: true });
    expect(dbSelectMock).toHaveBeenCalledTimes(2);
  });
});
