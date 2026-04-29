import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createCsrfToken,
  getCsrfBucket,
  getCsrfSecret,
  isMutationMethod,
  verifyCsrfToken,
} from "@/lib/api/v1/_shared/csrf";

describe("v1 csrf helper", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("creates and verifies tokens for current and previous buckets", () => {
    const now = 1_800_000;
    const token = createCsrfToken({
      authToken: "auth-token",
      userId: 123,
      now,
      secret: "server-secret",
    });

    expect(token).toContain(`${getCsrfBucket(now)}.`);
    expect(
      verifyCsrfToken({
        token,
        authToken: "auth-token",
        userId: 123,
        now,
        secret: "server-secret",
      })
    ).toBe(true);
    expect(
      verifyCsrfToken({
        token,
        authToken: "auth-token",
        userId: 123,
        now: now + 30 * 60 * 1000,
        secret: "server-secret",
      })
    ).toBe(true);
  });

  test("rejects wrong token components and non-mutation methods are identifiable", () => {
    const token = createCsrfToken({
      authToken: "auth-token",
      userId: 123,
      now: 1_800_000,
      secret: "server-secret",
    });

    expect(
      verifyCsrfToken({
        token,
        authToken: "other-token",
        userId: 123,
        now: 1_800_000,
        secret: "server-secret",
      })
    ).toBe(false);
    expect(verifyCsrfToken({ token: "bad", authToken: "auth-token", userId: 123 })).toBe(false);
    expect(isMutationMethod("POST")).toBe(true);
    expect(isMutationMethod("GET")).toBe(false);
  });

  test("uses CSRF_SECRET without requiring ADMIN_TOKEN", async () => {
    vi.resetModules();
    vi.stubEnv("ADMIN_TOKEN", undefined);
    vi.stubEnv("CSRF_SECRET", "dedicated-csrf-secret");

    const csrf = await import("@/lib/api/v1/_shared/csrf");
    const token = csrf.createCsrfToken({
      authToken: "auth-token",
      userId: 123,
      now: 1_800_000,
    });

    expect(csrf.getCsrfSecret()).toBe("dedicated-csrf-secret");
    expect(token).toEqual(expect.any(String));
    expect(
      csrf.verifyCsrfToken({
        token,
        authToken: "auth-token",
        userId: 123,
        now: 1_800_000,
      })
    ).toBe(true);
  });

  test("prefers CSRF_SECRET over ADMIN_TOKEN and keeps ADMIN_TOKEN fallback", async () => {
    vi.resetModules();
    vi.stubEnv("ADMIN_TOKEN", "admin-token-secret");
    vi.stubEnv("CSRF_SECRET", "dedicated-csrf-secret");

    const withDedicatedSecret = await import("@/lib/api/v1/_shared/csrf");
    expect(withDedicatedSecret.getCsrfSecret()).toBe("dedicated-csrf-secret");

    vi.resetModules();
    vi.stubEnv("CSRF_SECRET", undefined);
    const withAdminFallback = await import("@/lib/api/v1/_shared/csrf");
    expect(withAdminFallback.getCsrfSecret()).toBe("admin-token-secret");
  });

  test("falls back to a process secret instead of returning null", () => {
    expect(getCsrfSecret()).toEqual(expect.any(String));
    expect(
      createCsrfToken({
        authToken: "auth-token",
        userId: 123,
        now: 1_800_000,
      })
    ).toEqual(expect.any(String));
  });
});
