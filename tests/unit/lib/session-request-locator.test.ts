import { beforeEach, describe, expect, it, vi } from "vitest";

const findSessionRequestLocatorMock = vi.hoisted(() => vi.fn());

vi.mock("@/repository/message", () => ({
  findSessionRequestLocator: findSessionRequestLocatorMock,
}));

describe("resolveSessionRequestLocator", () => {
  beforeEach(() => {
    findSessionRequestLocatorMock.mockReset();
  });

  it("returns a stable source-mismatch code when the identity is unavailable", async () => {
    findSessionRequestLocatorMock.mockResolvedValueOnce(null);
    const { resolveSessionRequestLocator } = await import("@/lib/session-request-locator");

    await expect(resolveSessionRequestLocator("pfx:scope:fingerprint")).resolves.toEqual({
      ok: false,
      error: "SESSION_REQUEST_SOURCE_MISMATCH",
      errorCode: "SESSION_REQUEST_SOURCE_MISMATCH",
    });
  });

  it("requires the physical source and sequence together for a prefix identity", async () => {
    findSessionRequestLocatorMock.mockResolvedValueOnce({
      requestId: 108,
      sourceSessionId: "physical-latest",
      requestSequence: 8,
      keyId: 23,
      identityKind: "prefix_affinity",
      scopeTag: "scope",
      fingerprint: "fingerprint",
    });
    const { resolveSessionRequestLocator } = await import("@/lib/session-request-locator");

    await expect(resolveSessionRequestLocator("pfx:scope:fingerprint", 7)).resolves.toEqual({
      ok: false,
      error: "SESSION_REQUEST_SELECTOR_INCOMPLETE",
      errorCode: "SESSION_REQUEST_SELECTOR_INCOMPLETE",
    });
  });

  it("resolves a prefix request by stable request id without the legacy source tuple", async () => {
    findSessionRequestLocatorMock.mockResolvedValueOnce({
      requestId: 107,
      sourceSessionId: "physical-selected",
      requestSequence: 7,
      keyId: 23,
      identityKind: "prefix_affinity",
      scopeTag: "scope",
      fingerprint: "fingerprint",
    });
    const { resolveSessionRequestLocator } = await import("@/lib/session-request-locator");

    await expect(
      resolveSessionRequestLocator("pfx:scope:fingerprint", undefined, undefined, 107)
    ).resolves.toMatchObject({
      ok: true,
      locator: {
        requestId: 107,
        sourceSessionId: "physical-selected",
        requestSequence: 7,
        keyId: 23,
      },
    });
    expect(findSessionRequestLocatorMock).toHaveBeenLastCalledWith(
      "pfx:scope:fingerprint",
      {
        requestId: 107,
        requestSequence: undefined,
        sourceSessionId: undefined,
      },
      undefined
    );
  });

  it("forwards the resolved owner scope to the exact request-id query", async () => {
    findSessionRequestLocatorMock.mockResolvedValueOnce({
      requestId: 107,
      sourceSessionId: "physical-selected",
      requestSequence: 7,
      keyId: 23,
      identityKind: "prefix_affinity",
      scopeTag: "scope",
      fingerprint: "fingerprint",
    });
    const { resolveSessionRequestLocator } = await import("@/lib/session-request-locator");

    await resolveSessionRequestLocator("pfx:scope:fingerprint", undefined, undefined, 107, 23);

    expect(findSessionRequestLocatorMock).toHaveBeenCalledOnce();
    expect(findSessionRequestLocatorMock).toHaveBeenCalledWith(
      "pfx:scope:fingerprint",
      {
        requestId: 107,
        requestSequence: undefined,
        sourceSessionId: undefined,
      },
      23
    );
  });

  it("returns the source-mismatch code when the selected physical request is outside the identity", async () => {
    findSessionRequestLocatorMock.mockResolvedValueOnce(null);
    const { resolveSessionRequestLocator } = await import("@/lib/session-request-locator");

    await expect(
      resolveSessionRequestLocator("pfx:scope:fingerprint", 7, "physical-selected", 107)
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "SESSION_REQUEST_SOURCE_MISMATCH",
    });
    expect(findSessionRequestLocatorMock).toHaveBeenLastCalledWith(
      "pfx:scope:fingerprint",
      {
        requestId: 107,
        requestSequence: 7,
        sourceSessionId: "physical-selected",
      },
      undefined
    );
  });
});
