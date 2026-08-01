import { beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
const getActiveSessionsCacheMock = vi.fn();
const setActiveSessionsCacheMock = vi.fn();
const getObservedActiveSessionsMock = vi.fn();
const getObservedConcurrentCountBatchMock = vi.fn();
const getAllSessionIdsMock = vi.fn();
const aggregateMultipleSessionStatsMock = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/cache/session-cache", () => ({
  getActiveSessionsCache: getActiveSessionsCacheMock,
  setActiveSessionsCache: setActiveSessionsCacheMock,
  getSessionDetailsCache: vi.fn(() => null),
  setSessionDetailsCache: vi.fn(),
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
vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    getAllSessionIds: getAllSessionIdsMock,
  },
}));
vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    getObservedActiveSessions: getObservedActiveSessionsMock,
    getObservedConcurrentCountBatch: getObservedConcurrentCountBatchMock,
  },
}));
vi.mock("@/repository/message", () => ({
  aggregateMultipleSessionStats: aggregateMultipleSessionStatsMock,
}));

const SESSION_STATS = {
  sessionId: "pfx:scope:fingerprint",
  sessionIdentityKind: "prefix_affinity" as const,
  sessionFingerprint: "fingerprint",
  requestCount: 2,
  totalCostUsd: "0.01",
  totalInputTokens: 10,
  totalOutputTokens: 5,
  totalCacheCreationTokens: 0,
  totalCacheReadTokens: 0,
  totalDurationMs: 100,
  firstRequestAt: new Date("2026-08-02T00:00:00.000Z"),
  lastRequestAt: new Date("2026-08-02T00:01:00.000Z"),
  providers: [],
  models: ["model"],
  userName: "user",
  userId: 1,
  keyName: "key",
  keyId: 1,
  userAgent: "client",
  apiType: "chat",
  cacheTtlApplied: null,
};

describe("getAllSessions monitoring status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    getActiveSessionsCacheMock.mockReturnValue(null);
    getObservedActiveSessionsMock.mockResolvedValue([SESSION_STATS.sessionId]);
    getAllSessionIdsMock.mockResolvedValue([]);
    aggregateMultipleSessionStatsMock.mockResolvedValue([SESSION_STATS]);
    getObservedConcurrentCountBatchMock.mockResolvedValue(new Map([[SESSION_STATS.sessionId, 1]]));
  });

  test("marks an observed prefix session as in progress", async () => {
    const { getAllSessions } = await import("@/actions/active-sessions");

    const result = await getAllSessions(1, 1, 20);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          active: [
            expect.objectContaining({
              sessionId: SESSION_STATS.sessionId,
              status: "in_progress",
              concurrentCount: 1,
            }),
          ],
          totalActive: 1,
        }),
      })
    );
    expect(getObservedConcurrentCountBatchMock).toHaveBeenCalledWith([SESSION_STATS.sessionId]);
  });
});
