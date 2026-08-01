import { beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
const aggregateSessionStatsMock = vi.fn();
const aggregateMultipleSessionStatsMock = vi.fn();
const resolveSessionIdentityMock = vi.fn();
const listPhysicalSessionSourcesForIdentityMock = vi.fn();
const terminateSessionMock = vi.fn();
const terminateSessionsBatchMock = vi.fn();
const terminateObservedSessionMock = vi.fn();
const invalidateMock = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));
vi.mock("@/repository/message", () => ({
  aggregateSessionStats: aggregateSessionStatsMock,
  aggregateMultipleSessionStats: aggregateMultipleSessionStatsMock,
  resolveSessionIdentity: resolveSessionIdentityMock,
  listPhysicalSessionSourcesForIdentity: listPhysicalSessionSourcesForIdentityMock,
}));
vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    terminateSession: terminateSessionMock,
    terminateSessionsBatch: terminateSessionsBatchMock,
  },
}));
vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    terminateObservedSession: terminateObservedSessionMock,
  },
}));
vi.mock("@/app/v1/_lib/proxy/affinity/affinity-store", () => ({
  getAffinityStore: () => ({ invalidate: invalidateMock }),
}));
vi.mock("@/lib/cache/session-cache", () => ({
  getActiveSessionsCache: vi.fn(() => null),
  getSessionDetailsCache: vi.fn(() => null),
  setActiveSessionsCache: vi.fn(),
  setSessionDetailsCache: vi.fn(),
  clearActiveSessionsCache: vi.fn(),
  clearSessionDetailsCache: vi.fn(),
  clearAllSessionsQueryCache: vi.fn(),
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

describe("active Session termination identity contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    aggregateSessionStatsMock.mockResolvedValue({
      sessionId: "pfx:scope:tip",
      userId: 1,
    });
    aggregateMultipleSessionStatsMock.mockResolvedValue([]);
    resolveSessionIdentityMock.mockResolvedValue({
      sourceSessionId: "physical-session",
      identityKind: "prefix_affinity",
      scopeTag: "scope",
      fingerprint: "tip",
      fingerprints: ["tip", "parent", "root"],
    });
    invalidateMock.mockResolvedValue(true);
    terminateSessionMock.mockResolvedValue(true);
    terminateSessionsBatchMock.mockResolvedValue(0);
    terminateObservedSessionMock.mockResolvedValue(true);
    listPhysicalSessionSourcesForIdentityMock.mockResolvedValue([
      { sessionId: "physical-session", userId: 1, keyId: 11, providerIds: [41, 42] },
      { sessionId: "physical-session-2", userId: 1, keyId: 12, providerIds: [43] },
    ]);
  });

  test("terminating a prefix identity clears only physical bindings still owned by its key and providers", async () => {
    const { terminateActiveSession } = await import("@/actions/active-sessions");

    await expect(terminateActiveSession("pfx:scope:tip")).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(invalidateMock).toHaveBeenCalledWith("scope", "tip", ["tip", "parent", "root"]);
    expect(listPhysicalSessionSourcesForIdentityMock).toHaveBeenCalledWith("pfx:scope:tip");
    expect(terminateSessionMock).toHaveBeenCalledTimes(2);
    expect(terminateSessionMock).toHaveBeenCalledWith("physical-session", [41, 42], 11);
    expect(terminateSessionMock).toHaveBeenCalledWith("physical-session-2", [43], 12);
    expect(terminateObservedSessionMock).toHaveBeenCalledWith("pfx:scope:tip");
  });

  test("prefix termination fails when affinity invalidation fails", async () => {
    invalidateMock.mockResolvedValue(false);
    terminateObservedSessionMock.mockResolvedValue(true);

    const { terminateActiveSession } = await import("@/actions/active-sessions");
    const result = await terminateActiveSession("pfx:scope:tip");

    expect(result).toEqual({
      ok: false,
      error: "终止 Session 失败（Redis 不可用或 Session 已过期）",
    });
    expect(listPhysicalSessionSourcesForIdentityMock).not.toHaveBeenCalled();
    expect(terminateSessionMock).not.toHaveBeenCalled();
    expect(terminateObservedSessionMock).not.toHaveBeenCalled();
  });

  test("prefix termination succeeds when observed state has already expired", async () => {
    invalidateMock.mockResolvedValue(true);
    terminateObservedSessionMock.mockResolvedValue(false);

    const { terminateActiveSession } = await import("@/actions/active-sessions");

    await expect(terminateActiveSession("pfx:scope:tip")).resolves.toEqual({
      ok: true,
      data: undefined,
    });
  });

  test("prefix termination does not force-delete quota state for an expired or superseded source", async () => {
    terminateSessionMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const { terminateActiveSession } = await import("@/actions/active-sessions");

    await expect(terminateActiveSession("pfx:scope:tip")).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(terminateSessionMock).toHaveBeenCalledWith("physical-session", [41, 42], 11);
    expect(terminateSessionMock).toHaveBeenCalledWith("physical-session-2", [43], 12);
    expect(terminateObservedSessionMock).toHaveBeenCalledWith("pfx:scope:tip");
  });

  test("treats a client-controlled pfx-prefixed physical Session as a physical Session", async () => {
    resolveSessionIdentityMock.mockResolvedValue({
      sourceSessionId: "pfx:foreign-scope:foreign-fingerprint",
      identityKind: "session_id",
      scopeTag: null,
      fingerprint: null,
      fingerprints: [],
    });

    const { terminateActiveSession } = await import("@/actions/active-sessions");
    const result = await terminateActiveSession("pfx:foreign-scope:foreign-fingerprint");

    expect(result).toEqual({ ok: true, data: undefined });
    expect(terminateSessionMock).toHaveBeenCalledWith("pfx:foreign-scope:foreign-fingerprint");
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  test("batch termination applies prefix and physical Session semantics independently", async () => {
    aggregateMultipleSessionStatsMock.mockResolvedValue([
      { sessionId: "pfx:scope:tip", userId: 1 },
      { sessionId: "physical-session", userId: 1 },
    ]);
    resolveSessionIdentityMock.mockImplementation(async (identity: string) =>
      identity.startsWith("pfx:")
        ? {
            sourceSessionId: "physical-source",
            identityKind: "prefix_affinity",
            scopeTag: "scope",
            fingerprint: "tip",
            fingerprints: ["tip", "parent"],
          }
        : {
            sourceSessionId: identity,
            identityKind: "session_id",
            scopeTag: null,
            fingerprint: null,
            fingerprints: [],
          }
    );

    const { terminateActiveSessionsBatch } = await import("@/actions/active-sessions");
    const result = await terminateActiveSessionsBatch([
      "pfx:scope:tip",
      "physical-session",
      "pfx:scope:tip",
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      successCount: 2,
      failedCount: 0,
      requestedCount: 2,
      processedCount: 2,
    });
    expect(invalidateMock).toHaveBeenCalledWith("scope", "tip", ["tip", "parent"]);
    expect(listPhysicalSessionSourcesForIdentityMock).toHaveBeenCalledWith("pfx:scope:tip");
    expect(terminateSessionMock).toHaveBeenCalledTimes(3);
    expect(terminateSessionMock).toHaveBeenCalledWith("physical-session", [41, 42], 11);
    expect(terminateSessionMock).toHaveBeenCalledWith("physical-session-2", [43], 12);
    expect(terminateSessionMock).toHaveBeenCalledWith("physical-session");
    expect(terminateSessionsBatchMock).not.toHaveBeenCalled();
    expect(terminateObservedSessionMock).toHaveBeenCalledWith("pfx:scope:tip");
    expect(terminateObservedSessionMock).toHaveBeenCalledWith("physical-session");
  });

  test("batch counts affinity invalidation failures instead of observed cleanup results", async () => {
    aggregateMultipleSessionStatsMock.mockResolvedValue([
      { sessionId: "pfx:scope:tip", userId: 1 },
      { sessionId: "pfx:scope:parent", userId: 1 },
    ]);
    resolveSessionIdentityMock.mockImplementation(async (identity: string) => ({
      sourceSessionId: "physical-source",
      identityKind: "prefix_affinity",
      scopeTag: "scope",
      fingerprint: identity.endsWith("tip") ? "tip" : "parent",
      fingerprints: [],
    }));
    invalidateMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    terminateObservedSessionMock.mockResolvedValue(true);

    const { terminateActiveSessionsBatch } = await import("@/actions/active-sessions");
    const result = await terminateActiveSessionsBatch(["pfx:scope:tip", "pfx:scope:parent"]);

    expect(result).toEqual({
      ok: true,
      data: {
        successCount: 1,
        failedCount: 1,
        allowedFailedCount: 1,
        unauthorizedCount: 0,
        missingCount: 0,
        unauthorizedSessionIds: [],
        missingSessionIds: [],
        requestedCount: 2,
        processedCount: 2,
      },
    });
  });
});
