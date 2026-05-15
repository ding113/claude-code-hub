import { describe, expect, it } from "vitest";
import {
  SIGNED_ADMIN_SESSION_TOKEN_PREFIX,
  createSignedAdminSessionToken,
  verifySignedAdminSessionToken,
} from "@/lib/auth-admin-session-token";

describe("signed admin session token", () => {
  const adminToken = "test-admin-token-secret";
  const now = new Date("2026-05-15T08:00:00.000Z").getTime();

  function decodePayload(token: string): Record<string, unknown> {
    const separatorIndex = token.lastIndexOf(".");
    const payloadPart = token.slice(SIGNED_ADMIN_SESSION_TOKEN_PREFIX.length, separatorIndex);
    const paddedLength = Math.ceil(payloadPart.length / 4) * 4;
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/").padEnd(paddedLength, "=");
    return JSON.parse(globalThis.atob(base64)) as Record<string, unknown>;
  }

  it("creates and verifies a signed admin session token", async () => {
    const token = await createSignedAdminSessionToken({
      adminToken,
      ttlSeconds: 604_800,
      now,
    });

    expect(token.startsWith(SIGNED_ADMIN_SESSION_TOKEN_PREFIX)).toBe(true);
    await expect(
      verifySignedAdminSessionToken(token, {
        adminToken,
        maxTtlSeconds: 604_800,
        now: now + 1000,
      })
    ).resolves.toBe(true);
  });

  it("does not expose an ADMIN_TOKEN fingerprint in the client-visible payload", async () => {
    const token = await createSignedAdminSessionToken({
      adminToken,
      ttlSeconds: 604_800,
      now,
    });

    const payload = decodePayload(token);
    expect(payload).not.toHaveProperty("fp");
    expect(JSON.stringify(payload)).not.toContain(adminToken);
    expect(JSON.stringify(payload)).not.toContain("sha256:");
  });

  it("rejects a tampered token", async () => {
    const token = await createSignedAdminSessionToken({
      adminToken,
      ttlSeconds: 604_800,
      now,
    });
    const tamperedToken = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    await expect(
      verifySignedAdminSessionToken(tamperedToken, {
        adminToken,
        maxTtlSeconds: 604_800,
        now: now + 1000,
      })
    ).resolves.toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await createSignedAdminSessionToken({
      adminToken,
      ttlSeconds: 60,
      now,
    });

    await expect(
      verifySignedAdminSessionToken(token, {
        adminToken,
        maxTtlSeconds: 60,
        now: now + 60_001,
      })
    ).resolves.toBe(false);
  });

  it("rejects a token issued too far in the future", async () => {
    const token = await createSignedAdminSessionToken({
      adminToken,
      ttlSeconds: 604_800,
      now,
    });

    await expect(
      verifySignedAdminSessionToken(token, {
        adminToken,
        maxTtlSeconds: 604_800,
        now: now - 10 * 60 * 1000,
      })
    ).resolves.toBe(false);
  });

  it("rejects tokens after ADMIN_TOKEN rotation", async () => {
    const token = await createSignedAdminSessionToken({
      adminToken,
      ttlSeconds: 604_800,
      now,
    });

    await expect(
      verifySignedAdminSessionToken(token, {
        adminToken: "rotated-admin-token-secret",
        maxTtlSeconds: 604_800,
        now: now + 1000,
      })
    ).resolves.toBe(false);
  });

  it("caps existing tokens by the current configured TTL from their issue time", async () => {
    const token = await createSignedAdminSessionToken({
      adminToken,
      ttlSeconds: 604_800,
      now,
    });

    await expect(
      verifySignedAdminSessionToken(token, {
        adminToken,
        maxTtlSeconds: 300,
        now: now + 299_000,
      })
    ).resolves.toBe(true);

    await expect(
      verifySignedAdminSessionToken(token, {
        adminToken,
        maxTtlSeconds: 300,
        now: now + 300_001,
      })
    ).resolves.toBe(false);
  });

  it("rejects malformed token formats", async () => {
    const token = await createSignedAdminSessionToken({
      adminToken,
      ttlSeconds: 604_800,
      now,
    });
    const separatorIndex = token.lastIndexOf(".");
    const payloadPart = token.slice(SIGNED_ADMIN_SESSION_TOKEN_PREFIX.length, separatorIndex);
    const signature = token.slice(separatorIndex + 1);
    const candidates = [
      token.slice(SIGNED_ADMIN_SESSION_TOKEN_PREFIX.length),
      `${SIGNED_ADMIN_SESSION_TOKEN_PREFIX}${payloadPart}${signature}`,
      `${token}.extra`,
      `${SIGNED_ADMIN_SESSION_TOKEN_PREFIX}.${signature}`,
      `${SIGNED_ADMIN_SESSION_TOKEN_PREFIX}${payloadPart}.`,
      SIGNED_ADMIN_SESSION_TOKEN_PREFIX,
    ];

    for (const candidate of candidates) {
      await expect(
        verifySignedAdminSessionToken(candidate, {
          adminToken,
          maxTtlSeconds: 604_800,
          now: now + 1000,
        })
      ).resolves.toBe(false);
    }
  });

  it("returns false instead of throwing when adminToken is empty", async () => {
    const token = await createSignedAdminSessionToken({
      adminToken,
      ttlSeconds: 604_800,
      now,
    });

    await expect(
      verifySignedAdminSessionToken(token, {
        adminToken: "",
        maxTtlSeconds: 604_800,
        now: now + 1000,
      })
    ).resolves.toBe(false);
  });
});
