import { beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
const aggregateMultipleSessionStatsMock = vi.fn();
const findSessionRequestLocatorMock = vi.fn();
const getSessionResponseMock = vi.fn();
const isSessionRequestOwnedByKeyMock = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));
vi.mock("@/repository/message", () => ({
  aggregateMultipleSessionStats: aggregateMultipleSessionStatsMock,
  findSessionRequestLocator: findSessionRequestLocatorMock,
}));
vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    getSessionResponse: getSessionResponseMock,
    isSessionRequestOwnedByKey: isSessionRequestOwnedByKeyMock,
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

describe("getSessionResponse request locator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    aggregateMultipleSessionStatsMock.mockResolvedValue([
      { sessionId: "pfx:scope:fingerprint", userId: 1 },
    ]);
    isSessionRequestOwnedByKeyMock.mockResolvedValue(true);
    findSessionRequestLocatorMock
      .mockResolvedValueOnce({
        requestId: 104,
        sourceSessionId: "physical-latest",
        requestSequence: 4,
        keyId: 1,
        identityKind: "prefix_affinity",
        scopeTag: "scope",
        fingerprint: "fingerprint",
      })
      .mockResolvedValueOnce({
        requestId: 102,
        sourceSessionId: "physical-selected",
        requestSequence: 2,
        keyId: 1,
        identityKind: "prefix_affinity",
        scopeTag: "scope",
        fingerprint: "fingerprint",
      });
    getSessionResponseMock.mockResolvedValue("response-body");
  });

  test("reads the response from the authorized physical request", async () => {
    const { getSessionResponse } = await import("@/actions/session-response");

    await expect(
      getSessionResponse("pfx:scope:fingerprint", 2, "physical-selected")
    ).resolves.toEqual({ ok: true, data: "response-body" });

    expect(findSessionRequestLocatorMock).toHaveBeenNthCalledWith(
      2,
      "pfx:scope:fingerprint",
      {
        requestId: undefined,
        requestSequence: 2,
        sourceSessionId: "physical-selected",
      },
      1
    );
    expect(isSessionRequestOwnedByKeyMock).toHaveBeenCalledWith("physical-selected", 2, 1);
    expect(getSessionResponseMock).toHaveBeenCalledWith("physical-selected", 2);
  });

  test("fails closed before reading Redis when the request owner marker is missing", async () => {
    isSessionRequestOwnedByKeyMock.mockResolvedValueOnce(false);
    const { getSessionResponse } = await import("@/actions/session-response");

    await expect(
      getSessionResponse("pfx:scope:fingerprint", 2, "physical-selected")
    ).resolves.toEqual({
      ok: false,
      error: "响应体已过期（5分钟 TTL）或尚未记录",
    });

    expect(getSessionResponseMock).not.toHaveBeenCalled();
  });
});
