import { beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
const aggregateSessionStatsMock = vi.fn();
const findSessionRequestLocatorMock = vi.fn();
const getSessionResponseMock = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));
vi.mock("@/repository/message", () => ({
  aggregateSessionStats: aggregateSessionStatsMock,
  findSessionRequestLocator: findSessionRequestLocatorMock,
}));
vi.mock("@/lib/session-manager", () => ({
  SessionManager: { getSessionResponse: getSessionResponseMock },
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

describe("getSessionResponse request locator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    aggregateSessionStatsMock.mockResolvedValue({ userId: 1 });
    findSessionRequestLocatorMock
      .mockResolvedValueOnce({
        sourceSessionId: "physical-latest",
        requestSequence: 4,
        identityKind: "prefix_affinity",
        scopeTag: "scope",
        fingerprint: "fingerprint",
      })
      .mockResolvedValueOnce({
        sourceSessionId: "physical-selected",
        requestSequence: 2,
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

    expect(findSessionRequestLocatorMock).toHaveBeenNthCalledWith(2, "pfx:scope:fingerprint", {
      requestSequence: 2,
      sourceSessionId: "physical-selected",
    });
    expect(getSessionResponseMock).toHaveBeenCalledWith("physical-selected", 2);
  });
});
