import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ProviderChainItem } from "@/types/message";

const getSessionMock = vi.fn();
const findSessionOriginChainMock = vi.fn();
const findSessionRequestLocatorMock = vi.fn();
const aggregateMultipleSessionStatsMock = vi.fn();
const findKeyListMock = vi.fn();

const dbSelectMock = vi.fn();
const dbFromMock = vi.fn();
const dbWhereMock = vi.fn();
const dbLimitMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/message", () => ({
  findSessionOriginChain: findSessionOriginChainMock,
  findSessionRequestLocator: findSessionRequestLocatorMock,
  aggregateMultipleSessionStats: aggregateMultipleSessionStatsMock,
}));

vi.mock("@/repository/key", () => ({
  findKeyList: findKeyListMock,
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    select: dbSelectMock,
  },
}));

describe("getSessionOriginChain", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dbSelectMock.mockReturnValue({ from: dbFromMock });
    dbFromMock.mockReturnValue({ where: dbWhereMock });
    dbWhereMock.mockReturnValue({ limit: dbLimitMock });
    dbLimitMock.mockResolvedValue([{ id: 1 }]);

    findKeyListMock.mockResolvedValue([{ key: "user-key-1" }]);
    aggregateMultipleSessionStatsMock.mockResolvedValue([
      { sessionId: "pfx:scope:fingerprint", userId: 2 },
    ]);
    findSessionRequestLocatorMock.mockReset();
    findSessionRequestLocatorMock.mockImplementation(
      async (
        identity: string,
        selector: { sourceSessionId?: string; requestSequence?: number } = {}
      ) => ({
        requestId: 101,
        sourceSessionId: selector.sourceSessionId ?? identity,
        requestSequence: selector.requestSequence ?? 1,
        keyId: 1,
        identityKind: identity.startsWith("pfx:") ? "prefix_affinity" : "session_id",
        scopeTag: identity.startsWith("pfx:") ? "scope" : null,
        fingerprint: identity.startsWith("pfx:") ? "fingerprint" : null,
      })
    );
  });

  test("admin happy path: returns provider chain", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    const chain: ProviderChainItem[] = [
      {
        id: 11,
        name: "provider-a",
        reason: "initial_selection",
      },
    ];
    findSessionOriginChainMock.mockResolvedValue(chain);

    const { getSessionOriginChain } = await import("@/actions/session-origin-chain");
    const result = await getSessionOriginChain("pfx:scope:fingerprint", 2, "physical-selected");

    expect(result).toEqual({ ok: true, data: chain });
    expect(findSessionOriginChainMock).toHaveBeenCalledWith(101, 1, 2);
    expect(findKeyListMock).not.toHaveBeenCalled();
    expect(dbSelectMock).not.toHaveBeenCalled();
  });

  test("non-admin happy path: authorizes the aggregate identity before reading its physical source", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 2, role: "user" } });

    const chain: ProviderChainItem[] = [
      {
        id: 22,
        name: "provider-b",
        reason: "session_reuse",
      },
    ];
    findSessionOriginChainMock.mockResolvedValue(chain);

    const { getSessionOriginChain } = await import("@/actions/session-origin-chain");
    const result = await getSessionOriginChain("pfx:scope:fingerprint", 2, "physical-selected");

    expect(result).toEqual({ ok: true, data: chain });
    expect(aggregateMultipleSessionStatsMock).toHaveBeenCalledWith(["pfx:scope:fingerprint"], 2);
    expect(findSessionOriginChainMock).toHaveBeenCalledWith(101, 1, 2);
  });

  test("unauthenticated: returns not logged in", async () => {
    getSessionMock.mockResolvedValue(null);

    const { getSessionOriginChain } = await import("@/actions/session-origin-chain");
    const result = await getSessionOriginChain("sess-no-auth");

    expect(result).toEqual({ ok: false, error: "未登录" });
    expect(findSessionOriginChainMock).not.toHaveBeenCalled();
    expect(findKeyListMock).not.toHaveBeenCalled();
    expect(dbSelectMock).not.toHaveBeenCalled();
  });

  test("non-admin without access: returns unauthorized error", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 3, role: "user" } });
    aggregateMultipleSessionStatsMock.mockResolvedValue([
      { sessionId: "sess-other-user", userId: 4 },
    ]);

    const { getSessionOriginChain } = await import("@/actions/session-origin-chain");
    const result = await getSessionOriginChain("sess-other-user");

    expect(result).toEqual({ ok: false, error: "无权访问该 Session" });
    expect(findSessionOriginChainMock).not.toHaveBeenCalled();
  });

  test("exception path: returns error on unexpected throw", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findSessionOriginChainMock.mockRejectedValue(new Error("db error"));

    const { getSessionOriginChain } = await import("@/actions/session-origin-chain");
    const result = await getSessionOriginChain("sess-throws");

    expect(result).toEqual({ ok: false, error: "获取会话来源链失败" });
  });

  test("not found: returns ok with null data", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    aggregateMultipleSessionStatsMock.mockResolvedValue([
      { sessionId: "sess-not-found", userId: 1 },
    ]);
    findSessionOriginChainMock.mockResolvedValue(null);

    const { getSessionOriginChain } = await import("@/actions/session-origin-chain");
    const result = await getSessionOriginChain("sess-not-found");

    expect(result).toEqual({ ok: true, data: null });
    expect(findSessionOriginChainMock).toHaveBeenCalledWith(101, 1, 1);
    expect(findKeyListMock).not.toHaveBeenCalled();
    expect(dbSelectMock).not.toHaveBeenCalled();
  });
});
