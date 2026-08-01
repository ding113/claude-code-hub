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
      error: "Request source does not belong to this session.",
      errorCode: "SESSION_REQUEST_SOURCE_MISMATCH",
    });
  });

  it("requires the physical source and sequence together for a prefix identity", async () => {
    findSessionRequestLocatorMock.mockResolvedValueOnce({
      sourceSessionId: "physical-latest",
      requestSequence: 8,
      identityKind: "prefix_affinity",
      scopeTag: "scope",
      fingerprint: "fingerprint",
    });
    const { resolveSessionRequestLocator } = await import("@/lib/session-request-locator");

    await expect(resolveSessionRequestLocator("pfx:scope:fingerprint", 7)).resolves.toEqual({
      ok: false,
      error: "Prefix Session requests must specify both the physical source and request sequence.",
      errorCode: "SESSION_REQUEST_SELECTOR_INCOMPLETE",
    });
  });

  it("returns the source-mismatch code when the selected physical request is outside the identity", async () => {
    findSessionRequestLocatorMock
      .mockResolvedValueOnce({
        sourceSessionId: "physical-latest",
        requestSequence: 8,
        identityKind: "prefix_affinity",
        scopeTag: "scope",
        fingerprint: "fingerprint",
      })
      .mockResolvedValueOnce(null);
    const { resolveSessionRequestLocator } = await import("@/lib/session-request-locator");

    await expect(
      resolveSessionRequestLocator("pfx:scope:fingerprint", 7, "physical-selected")
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "SESSION_REQUEST_SOURCE_MISMATCH",
    });
  });
});
