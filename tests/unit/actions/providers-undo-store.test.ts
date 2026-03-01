import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setexMock = vi.fn();
const getMock = vi.fn();
const delMock = vi.fn();
const evalMock = vi.fn();

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: () => ({
    status: "ready",
    setex: setexMock,
    get: getMock,
    del: delMock,
    eval: evalMock,
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));

function buildSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    operationId: "op-1",
    operationType: "batch_edit" as const,
    preimage: { before: "state" },
    providerIds: [1, 2],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("providers undo store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-18T00:00:00.000Z"));
    vi.resetModules();
    vi.clearAllMocks();
    setexMock.mockResolvedValue("OK");
    delMock.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("stores snapshot and consumes token within TTL", async () => {
    const token = "11111111-1111-1111-1111-111111111111";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(token);

    const snapshot = buildSnapshot();
    evalMock.mockResolvedValue(JSON.stringify(snapshot));

    const { storeUndoSnapshot, consumeUndoToken } = await import("@/lib/providers/undo-store");

    const storeResult = await storeUndoSnapshot(snapshot);

    expect(storeResult).toEqual({
      undoAvailable: true,
      undoToken: token,
      expiresAt: "2026-02-18T00:00:30.000Z",
    });
    expect(setexMock).toHaveBeenCalledWith(`cch:prov:undo:${token}`, 30, JSON.stringify(snapshot));

    const consumeResult = await consumeUndoToken(token);
    expect(consumeResult).toEqual({
      ok: true,
      snapshot,
    });
    expect(evalMock).toHaveBeenCalledWith(expect.any(String), 1, `cch:prov:undo:${token}`);
  });

  it("returns UNDO_EXPIRED when Redis returns null (TTL passed)", async () => {
    const token = "22222222-2222-2222-2222-222222222222";
    evalMock.mockResolvedValue(null);

    const { consumeUndoToken } = await import("@/lib/providers/undo-store");

    const consumeResult = await consumeUndoToken(token);
    expect(consumeResult).toEqual({
      ok: false,
      code: "UNDO_EXPIRED",
    });
  });

  it("consumes a token only once (getAndDelete)", async () => {
    const token = "33333333-3333-3333-3333-333333333333";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(token);

    const snapshot = buildSnapshot({ operationId: "op-3" });

    const { storeUndoSnapshot, consumeUndoToken } = await import("@/lib/providers/undo-store");

    await storeUndoSnapshot(snapshot);

    evalMock.mockResolvedValueOnce(JSON.stringify(snapshot)).mockResolvedValueOnce(null);

    const first = await consumeUndoToken(token);
    const second = await consumeUndoToken(token);

    expect(first).toEqual({ ok: true, snapshot });
    expect(second).toEqual({ ok: false, code: "UNDO_EXPIRED" });
  });

  it("returns UNDO_EXPIRED for unknown token", async () => {
    evalMock.mockResolvedValue(null);

    const { consumeUndoToken } = await import("@/lib/providers/undo-store");
    const result = await consumeUndoToken("undo-token-missing");

    expect(result).toEqual({
      ok: false,
      code: "UNDO_EXPIRED",
    });
  });

  it("stores multiple snapshots with independent tokens", async () => {
    const tokenA = "44444444-4444-4444-4444-444444444444";
    const tokenB = "55555555-5555-5555-5555-555555555555";
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(tokenA).mockReturnValueOnce(tokenB);

    const { storeUndoSnapshot, consumeUndoToken } = await import("@/lib/providers/undo-store");

    const snapshotA = buildSnapshot({ operationId: "op-4", providerIds: [11] });
    const snapshotB = buildSnapshot({
      operationId: "op-5",
      operationType: "single_edit",
      providerIds: [22, 23],
    });

    const storeA = await storeUndoSnapshot(snapshotA);
    const storeB = await storeUndoSnapshot(snapshotB);

    expect(storeA.undoToken).toBe(tokenA);
    expect(storeB.undoToken).toBe(tokenB);

    evalMock
      .mockResolvedValueOnce(JSON.stringify(snapshotA))
      .mockResolvedValueOnce(JSON.stringify(snapshotB));

    await expect(consumeUndoToken(tokenA)).resolves.toEqual({
      ok: true,
      snapshot: snapshotA,
    });
    await expect(consumeUndoToken(tokenB)).resolves.toEqual({
      ok: true,
      snapshot: snapshotB,
    });
  });

  it("fails open when storage backend throws", async () => {
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("uuid failed");
    });

    const { storeUndoSnapshot } = await import("@/lib/providers/undo-store");
    const result = await storeUndoSnapshot(buildSnapshot({ operationId: "op-6" }));

    expect(result).toEqual({ undoAvailable: false });
  });

  it("returns undoAvailable false when Redis set fails", async () => {
    const token = "66666666-6666-6666-6666-666666666666";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(token);
    setexMock.mockRejectedValue(new Error("Redis write error"));

    const { storeUndoSnapshot } = await import("@/lib/providers/undo-store");
    const result = await storeUndoSnapshot(buildSnapshot({ operationId: "op-7" }));

    expect(result).toEqual({ undoAvailable: false });
  });
});
