import { beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
const aggregateSessionStatsMock = vi.fn();
const aggregateMultipleSessionStatsMock = vi.fn();
const findRequestsBySessionIdMock = vi.fn();
const findRequestsBySessionIdentityMock = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));
vi.mock("@/repository/message", () => ({
  aggregateSessionStats: aggregateSessionStatsMock,
  aggregateMultipleSessionStats: aggregateMultipleSessionStatsMock,
  findRequestsBySessionId: findRequestsBySessionIdMock,
  findRequestsBySessionIdentity: findRequestsBySessionIdentityMock,
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

describe("getSessionRequests public identity contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    aggregateSessionStatsMock.mockResolvedValue({
      sessionId: "public-session-identity",
      userId: 1,
    });
    aggregateMultipleSessionStatsMock.mockResolvedValue([
      {
        sessionId: "public-session-identity",
        userId: 1,
      },
    ]);
    findRequestsBySessionIdMock.mockResolvedValue({ requests: [], total: 0 });
    findRequestsBySessionIdentityMock.mockResolvedValue({ requests: [], total: 0 });
  });

  test("uses the public Session identity query for ordinary identities", async () => {
    const { getSessionRequests } = await import("@/actions/active-sessions");

    await expect(getSessionRequests("public-session-identity", 2, 5, "desc")).resolves.toEqual({
      ok: true,
      data: { requests: [], total: 0, hasMore: false },
    });
    expect(findRequestsBySessionIdentityMock).toHaveBeenCalledWith("public-session-identity", {
      limit: 5,
      offset: 5,
      order: "desc",
    });
    expect(findRequestsBySessionIdMock).not.toHaveBeenCalled();
  });

  test("defaults request lists to newest first", async () => {
    const { getSessionRequests } = await import("@/actions/active-sessions");

    await expect(getSessionRequests("public-session-identity")).resolves.toEqual({
      ok: true,
      data: { requests: [], total: 0, hasMore: false },
    });
    expect(findRequestsBySessionIdentityMock).toHaveBeenCalledWith("public-session-identity", {
      limit: 20,
      offset: 0,
      order: "desc",
    });
  });
});
