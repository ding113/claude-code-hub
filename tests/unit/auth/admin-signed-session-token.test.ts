import { describe, expect, it } from "vitest";
import {
  SIGNED_ADMIN_SESSION_TOKEN_PREFIX,
  createSignedAdminSessionToken,
  verifySignedAdminSessionToken,
} from "@/lib/auth-admin-session-token";

describe("signed admin session token", () => {
  const adminToken = "test-admin-token-secret";
  const now = new Date("2026-05-15T08:00:00.000Z").getTime();

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

  it("rejects tokens longer than the current configured TTL ceiling", async () => {
    const token = await createSignedAdminSessionToken({
      adminToken,
      ttlSeconds: 604_800,
      now,
    });

    await expect(
      verifySignedAdminSessionToken(token, {
        adminToken,
        maxTtlSeconds: 300,
        now: now + 1000,
      })
    ).resolves.toBe(false);
  });
});
