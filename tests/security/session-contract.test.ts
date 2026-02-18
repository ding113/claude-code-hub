import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_SESSION_TOKEN_MODE = process.env.SESSION_TOKEN_MODE;

function restoreSessionTokenModeEnv() {
  if (ORIGINAL_SESSION_TOKEN_MODE === undefined) {
    delete process.env.SESSION_TOKEN_MODE;
    return;
  }
  process.env.SESSION_TOKEN_MODE = ORIGINAL_SESSION_TOKEN_MODE;
}

describe("session token contract and migration flags", () => {
  afterEach(() => {
    restoreSessionTokenModeEnv();
    vi.resetModules();
  });

  it("SESSION_TOKEN_MODE defaults to opaque", async () => {
    delete process.env.SESSION_TOKEN_MODE;

    vi.resetModules();
    const { getSessionTokenMode } = await import("../../src/lib/auth");

    expect(getSessionTokenMode()).toBe("opaque");
  });

  it("getSessionTokenMode returns configured mode values", async () => {
    const modes = ["legacy", "dual", "opaque"] as const;

    for (const mode of modes) {
      process.env.SESSION_TOKEN_MODE = mode;

      vi.resetModules();
      const { getSessionTokenMode } = await import("../../src/lib/auth");

      expect(getSessionTokenMode()).toBe(mode);
    }
  });

  it("validates OpaqueSessionContract runtime shape strictly", async () => {
    vi.resetModules();
    const { isOpaqueSessionContract } = await import("../../src/lib/auth");

    const validContract = {
      sessionId: "sid_opaque_session_123",
      keyFingerprint: "sha256:abc123",
      createdAt: 1_700_000_000,
      expiresAt: 1_700_000_300,
      userId: 42,
      userRole: "admin",
    };

    expect(isOpaqueSessionContract(validContract)).toBe(true);
    expect(
      isOpaqueSessionContract({
        ...validContract,
        keyFingerprint: "",
      })
    ).toBe(false);
    expect(
      isOpaqueSessionContract({
        ...validContract,
        expiresAt: validContract.createdAt,
      })
    ).toBe(false);
    expect(
      isOpaqueSessionContract({
        ...validContract,
        userId: 3.14,
      })
    ).toBe(false);
  });

  it("accepts both legacy cookie and opaque session in dual mode", async () => {
    process.env.SESSION_TOKEN_MODE = "dual";

    vi.resetModules();
    const { getSessionTokenMode, getSessionTokenMigrationFlags, isSessionTokenAccepted } =
      await import("../../src/lib/auth");

    const mode = getSessionTokenMode();
    expect(mode).toBe("dual");
    expect(getSessionTokenMigrationFlags(mode)).toEqual({
      dualReadWindowEnabled: true,
      hardCutoverEnabled: false,
      emergencyRollbackEnabled: false,
    });

    expect(isSessionTokenAccepted("sk-legacy-cookie", mode)).toBe(true);
    expect(isSessionTokenAccepted("sid_opaque_session_cookie", mode)).toBe(true);
  });

  it("accepts only legacy cookie in legacy mode", async () => {
    process.env.SESSION_TOKEN_MODE = "legacy";

    vi.resetModules();
    const { getSessionTokenMode, getSessionTokenMigrationFlags, isSessionTokenAccepted } =
      await import("../../src/lib/auth");

    const mode = getSessionTokenMode();
    expect(mode).toBe("legacy");
    expect(getSessionTokenMigrationFlags(mode)).toEqual({
      dualReadWindowEnabled: false,
      hardCutoverEnabled: false,
      emergencyRollbackEnabled: true,
    });

    expect(isSessionTokenAccepted("sk-legacy-cookie", mode)).toBe(true);
    expect(isSessionTokenAccepted("sid_opaque_session_cookie", mode)).toBe(false);
  });
});
