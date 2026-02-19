import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ProviderChainItem } from "@/types/message";

const getSessionMock = vi.fn();
const findSessionOriginChainMock = vi.fn();
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
    const result = await getSessionOriginChain("sess-admin");

    expect(result).toEqual({ ok: true, data: chain });
    expect(findSessionOriginChainMock).toHaveBeenCalledWith("sess-admin");
    expect(findKeyListMock).not.toHaveBeenCalled();
    expect(dbSelectMock).not.toHaveBeenCalled();
  });

  test("non-admin happy path: returns provider chain after ownership check", async () => {
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
    const result = await getSessionOriginChain("sess-user");

    expect(result).toEqual({ ok: true, data: chain });
    expect(findKeyListMock).toHaveBeenCalledWith(2);
    expect(dbSelectMock).toHaveBeenCalledTimes(1);
    expect(findSessionOriginChainMock).toHaveBeenCalledWith("sess-user");
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
    findKeyListMock.mockResolvedValue([{ key: "user-key-3" }]);
    dbLimitMock.mockResolvedValue([]);

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
    findSessionOriginChainMock.mockResolvedValue(null);

    const { getSessionOriginChain } = await import("@/actions/session-origin-chain");
    const result = await getSessionOriginChain("sess-not-found");

    expect(result).toEqual({ ok: true, data: null });
    expect(findSessionOriginChainMock).toHaveBeenCalledWith("sess-not-found");
    expect(findKeyListMock).not.toHaveBeenCalled();
    expect(dbSelectMock).not.toHaveBeenCalled();
  });
});
