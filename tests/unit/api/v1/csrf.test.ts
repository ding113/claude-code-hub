import { describe, expect, test } from "vitest";
import {
  createCsrfToken,
  getCsrfBucket,
  isMutationMethod,
  verifyCsrfToken,
} from "@/lib/api/v1/_shared/csrf";

describe("v1 csrf helper", () => {
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
});
