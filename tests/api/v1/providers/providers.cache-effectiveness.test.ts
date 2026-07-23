import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getWindowsMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/provider-cache-effectiveness", () => ({
  getProviderCacheEffectivenessWindows: getWindowsMock,
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

const userSession = {
  user: { id: 2, role: "user", isEnabled: true },
  key: { id: 2, userId: 2, key: "user-token", canLoginWebUi: true },
} as AuthSession;

function effectivenessWindow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    providerId: 7,
    model: "claude-sonnet-4-5",
    cacheTtlBucket: "5m",
    windowStart: new Date("2026-07-20T00:00:00.000Z"),
    windowEnd: new Date("2026-07-20T01:00:00.000Z"),
    sampleCount: 120,
    eligibleCount: 96,
    theoreticalCacheTokens: 200000,
    observedCacheReadTokens: 150000,
    rawEffectivenessBp: 7500,
    confidenceBp: 8000,
    effectivenessBp: 6000,
    createdAt: new Date("2026-07-20T01:00:05.000Z"),
    ...overrides,
  };
}

describe("v1 provider cache effectiveness endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getWindowsMock.mockResolvedValue({ ok: true, data: [effectivenessWindow()] });
  });

  test("lists cache effectiveness windows with serialized timestamps", async () => {
    const { response, json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/cache-effectiveness",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      items: [
        {
          id: 5,
          providerId: 7,
          model: "claude-sonnet-4-5",
          cacheTtlBucket: "5m",
          windowStart: "2026-07-20T00:00:00.000Z",
          windowEnd: "2026-07-20T01:00:00.000Z",
          sampleCount: 120,
          eligibleCount: 96,
          theoreticalCacheTokens: 200000,
          observedCacheReadTokens: 150000,
          rawEffectivenessBp: 7500,
          confidenceBp: 8000,
          effectivenessBp: 6000,
        },
      ],
    });
    expect(getWindowsMock).toHaveBeenCalledWith({ limit: 50 });
  });

  test("forwards providerId and limit query filters to the action layer", async () => {
    const { response } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/cache-effectiveness?providerId=7&limit=25",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(response.status).toBe(200);
    expect(getWindowsMock).toHaveBeenCalledWith({ providerId: 7, limit: 25 });
  });

  test("rejects invalid query parameters", async () => {
    const overLimit = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/cache-effectiveness?limit=500",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(overLimit.response.status).toBe(400);
    expect(overLimit.json).toMatchObject({ errorCode: "request.validation_failed" });

    const badProvider = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/cache-effectiveness?providerId=abc",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(badProvider.response.status).toBe(400);
    expect(getWindowsMock).not.toHaveBeenCalled();
  });

  test("maps action errors to problem+json", async () => {
    getWindowsMock.mockResolvedValueOnce({
      ok: false,
      error: "Permission denied",
      errorCode: "PERMISSION_DENIED",
    });
    const forbidden = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/cache-effectiveness",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(forbidden.response.status).toBe(403);
    expect(forbidden.json).toMatchObject({ errorCode: "PERMISSION_DENIED" });

    getWindowsMock.mockResolvedValueOnce({
      ok: false,
      error: "Operation failed",
      errorCode: "OPERATION_FAILED",
    });
    const failed = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/cache-effectiveness",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(failed.response.status).toBe(400);
    expect(failed.json).toMatchObject({ errorCode: "OPERATION_FAILED" });
  });

  test("requires admin access", async () => {
    validateAuthTokenMock.mockResolvedValue(userSession);
    const { response } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/cache-effectiveness",
      headers: { Authorization: "Bearer user-token" },
    });
    expect(response.status).toBe(403);
    expect(getWindowsMock).not.toHaveBeenCalled();
  });

  test("documents the cache effectiveness REST path", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };
    expect(doc.paths).toHaveProperty("/api/v1/providers/cache-effectiveness");
  });
});
