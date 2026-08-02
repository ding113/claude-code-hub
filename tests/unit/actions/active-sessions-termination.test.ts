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
const clearActiveSessionsCacheMock = vi.fn();
const clearSessionDetailsCacheMock = vi.fn();
const clearAllSessionsQueryCacheMock = vi.fn();

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
  clearActiveSessionsCache: clearActiveSessionsCacheMock,
  clearSessionDetailsCache: clearSessionDetailsCacheMock,
  clearAllSessionsQueryCache: clearAllSessionsQueryCacheMock,
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
    aggregateMultipleSessionStatsMock.mockImplementation(async (sessionIds: string[]) =>
      sessionIds.map((sessionId) => ({ sessionId, requestedSessionIds: [sessionId], userId: 1 }))
    );
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
    listPhysicalSessionSourcesForIdentityMock.mockImplementation(async (identity: string) =>
      identity === "pfx:scope:tip"
        ? [
            { sessionId: "physical-session", userId: 1, keyId: 11, providerIds: [41, 42] },
            { sessionId: "physical-session-2", userId: 1, keyId: 12, providerIds: [43] },
          ]
        : [{ sessionId: identity, userId: 1, keyId: 13, providerIds: [] }]
    );
  });

  test("terminating a prefix identity clears only physical bindings still owned by its key and providers", async () => {
    const { terminateActiveSession } = await import("@/actions/active-sessions");

    await expect(terminateActiveSession("pfx:scope:tip")).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(invalidateMock).toHaveBeenCalledWith("scope", "tip", ["tip", "parent", "root"]);
    expect(listPhysicalSessionSourcesForIdentityMock).toHaveBeenCalledWith("pfx:scope:tip", 1);
    expect(terminateSessionMock).toHaveBeenCalledTimes(2);
    expect(terminateSessionMock).toHaveBeenCalledWith("physical-session", [41, 42], 11);
    expect(terminateSessionMock).toHaveBeenCalledWith("physical-session-2", [43], 12);
    expect(terminateObservedSessionMock).toHaveBeenCalledWith("pfx:scope:tip");
  });

  test("single termination canonicalizes a physical alias before invalidating prefix affinity", async () => {
    aggregateMultipleSessionStatsMock.mockResolvedValueOnce([
      {
        sessionId: "pfx:scope:tip",
        requestedSessionIds: ["physical-session"],
        userId: 1,
      },
    ]);

    const { terminateActiveSession } = await import("@/actions/active-sessions");

    await expect(terminateActiveSession("physical-session")).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(resolveSessionIdentityMock).toHaveBeenCalledWith("pfx:scope:tip", 1);
    expect(invalidateMock).toHaveBeenCalledWith("scope", "tip", ["tip", "parent", "root"]);
    expect(clearSessionDetailsCacheMock).toHaveBeenCalledWith("physical-session");
    expect(clearSessionDetailsCacheMock).toHaveBeenCalledWith("pfx:scope:tip");
    expect(clearSessionDetailsCacheMock).toHaveBeenCalledWith("physical-session-2");
  });

  test("ordinary identity termination clears observed state after physical cleanup", async () => {
    aggregateMultipleSessionStatsMock.mockResolvedValueOnce([
      {
        sessionId: "ordinary-client-session",
        requestedSessionIds: ["ordinary-client-session"],
        userId: 1,
      },
    ]);
    resolveSessionIdentityMock.mockResolvedValueOnce({
      sourceSessionId: "ordinary-client-session",
      identityKind: "session_id",
      scopeTag: null,
      fingerprint: null,
      fingerprints: [],
    });

    const { terminateActiveSession } = await import("@/actions/active-sessions");

    await expect(terminateActiveSession("ordinary-client-session")).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(terminateObservedSessionMock).toHaveBeenCalledWith("ordinary-client-session");
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

  test("prefix termination clears a physical source even when it has no Provider history", async () => {
    listPhysicalSessionSourcesForIdentityMock.mockResolvedValue([
      { sessionId: "physical-session", userId: 1, keyId: 11, providerIds: [] },
    ]);

    const { terminateActiveSession } = await import("@/actions/active-sessions");

    await expect(terminateActiveSession("pfx:scope:tip")).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(terminateSessionMock).toHaveBeenCalledWith("physical-session", undefined, 11);
  });

  test("treats a client-controlled pfx-prefixed physical Session as a physical Session", async () => {
    aggregateMultipleSessionStatsMock.mockResolvedValueOnce([
      {
        sessionId: "sid:key-bound-client-session",
        requestedSessionIds: ["pfx:foreign-scope:foreign-fingerprint"],
        userId: 1,
      },
    ]);
    resolveSessionIdentityMock.mockResolvedValue({
      sourceSessionId: "pfx:foreign-scope:foreign-fingerprint",
      identityKind: "session_id",
      scopeTag: null,
      fingerprint: null,
      fingerprints: [],
    });
    listPhysicalSessionSourcesForIdentityMock.mockResolvedValueOnce([
      {
        sessionId: "pfx:foreign-scope:foreign-fingerprint",
        userId: 1,
        keyId: 21,
        providerIds: [],
      },
    ]);

    const { terminateActiveSession } = await import("@/actions/active-sessions");
    const result = await terminateActiveSession("pfx:foreign-scope:foreign-fingerprint");

    expect(result).toEqual({ ok: true, data: undefined });
    expect(resolveSessionIdentityMock).toHaveBeenCalledWith("sid:key-bound-client-session", 1);
    expect(listPhysicalSessionSourcesForIdentityMock).toHaveBeenCalledWith(
      "sid:key-bound-client-session",
      1
    );
    expect(terminateSessionMock).toHaveBeenCalledWith(
      "pfx:foreign-scope:foreign-fingerprint",
      undefined,
      21
    );
    expect(invalidateMock).not.toHaveBeenCalled();
    expect(terminateObservedSessionMock).toHaveBeenCalledWith("sid:key-bound-client-session");
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
    expect(listPhysicalSessionSourcesForIdentityMock).toHaveBeenCalledWith("pfx:scope:tip", 1);
    expect(terminateSessionMock).toHaveBeenCalledTimes(3);
    expect(terminateSessionMock).toHaveBeenCalledWith("physical-session", [41, 42], 11);
    expect(terminateSessionMock).toHaveBeenCalledWith("physical-session-2", [43], 12);
    expect(terminateSessionMock).toHaveBeenCalledWith("physical-session", undefined, 13);
    expect(terminateSessionsBatchMock).not.toHaveBeenCalled();
    expect(terminateObservedSessionMock).toHaveBeenCalledWith("pfx:scope:tip");
    expect(terminateObservedSessionMock).toHaveBeenCalledWith("physical-session");
  });

  test("batch termination clears physical aliases and canonical detail caches", async () => {
    aggregateMultipleSessionStatsMock.mockResolvedValue([
      {
        sessionId: "pfx:scope:tip",
        requestedSessionIds: ["physical-session"],
        userId: 1,
      },
    ]);

    const { terminateActiveSessionsBatch } = await import("@/actions/active-sessions");
    await expect(terminateActiveSessionsBatch(["physical-session"])).resolves.toMatchObject({
      ok: true,
      data: { successCount: 1 },
    });

    expect(clearSessionDetailsCacheMock).toHaveBeenCalledWith("physical-session");
    expect(clearSessionDetailsCacheMock).toHaveBeenCalledWith("pfx:scope:tip");
    expect(clearSessionDetailsCacheMock).toHaveBeenCalledWith("physical-session-2");
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

  test("batch termination processes identities in chunks of 20", async () => {
    const identities = Array.from({ length: 21 }, (_, index) => `physical-${index + 1}`);
    aggregateMultipleSessionStatsMock.mockResolvedValue(
      identities.map((sessionId) => ({ sessionId, userId: 1 }))
    );
    let activeResolutions = 0;
    let maxActiveResolutions = 0;
    resolveSessionIdentityMock.mockImplementation(async (identity: string) => {
      activeResolutions += 1;
      maxActiveResolutions = Math.max(maxActiveResolutions, activeResolutions);
      await Promise.resolve();
      activeResolutions -= 1;
      return {
        sourceSessionId: identity,
        identityKind: "session_id",
        scopeTag: null,
        fingerprint: null,
        fingerprints: [],
      };
    });

    const { terminateActiveSessionsBatch } = await import("@/actions/active-sessions");
    const result = await terminateActiveSessionsBatch(identities);

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        successCount: 21,
        failedCount: 0,
        processedCount: 21,
      }),
    });
    expect(maxActiveResolutions).toBe(20);
    expect(listPhysicalSessionSourcesForIdentityMock).toHaveBeenCalledTimes(21);
    expect(terminateSessionMock).toHaveBeenCalledTimes(21);
  });

  test("batch termination isolates a rejected identity and still clears caches", async () => {
    aggregateMultipleSessionStatsMock.mockResolvedValue([
      { sessionId: "physical-failed", requestedSessionIds: ["physical-failed"], userId: 1 },
      { sessionId: "physical-success", requestedSessionIds: ["physical-success"], userId: 1 },
    ]);
    resolveSessionIdentityMock.mockImplementation(async (identity: string) => {
      if (identity === "physical-failed") throw new Error("lookup failed");
      return {
        sourceSessionId: identity,
        identityKind: "session_id",
        scopeTag: null,
        fingerprint: null,
        fingerprints: [],
      };
    });

    const { terminateActiveSessionsBatch } = await import("@/actions/active-sessions");
    const result = await terminateActiveSessionsBatch(["physical-failed", "physical-success"]);

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
    expect(terminateSessionMock).toHaveBeenCalledWith("physical-success", undefined, 13);
    expect(clearActiveSessionsCacheMock).toHaveBeenCalledOnce();
    expect(clearAllSessionsQueryCacheMock).toHaveBeenCalledOnce();
    expect(clearSessionDetailsCacheMock).toHaveBeenCalledWith("physical-failed");
    expect(clearSessionDetailsCacheMock).toHaveBeenCalledWith("physical-success");
  });
});
