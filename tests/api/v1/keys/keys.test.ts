import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const getKeysMock = vi.hoisted(() => vi.fn());
const getKeysWithStatisticsMock = vi.hoisted(() => vi.fn());
const addKeyMock = vi.hoisted(() => vi.fn());
const editKeyMock = vi.hoisted(() => vi.fn());
const removeKeyMock = vi.hoisted(() => vi.fn());
const getKeyLimitUsageMock = vi.hoisted(() => vi.fn());
const getKeyQuotaUsageMock = vi.hoisted(() => vi.fn());
const resetKeyLimitsOnlyMock = vi.hoisted(() => vi.fn());
const toggleKeyEnabledMock = vi.hoisted(() => vi.fn());
const renewKeyExpiresAtMock = vi.hoisted(() => vi.fn());
const patchKeyLimitMock = vi.hoisted(() => vi.fn());
const batchUpdateKeysMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

vi.mock("@/actions/keys", () => ({
  getKeys: getKeysMock,
  getKeysWithStatistics: getKeysWithStatisticsMock,
  addKey: addKeyMock,
  editKey: editKeyMock,
  removeKey: removeKeyMock,
  getKeyLimitUsage: getKeyLimitUsageMock,
  resetKeyLimitsOnly: resetKeyLimitsOnlyMock,
  toggleKeyEnabled: toggleKeyEnabledMock,
  renewKeyExpiresAt: renewKeyExpiresAtMock,
  patchKeyLimit: patchKeyLimitMock,
  batchUpdateKeys: batchUpdateKeysMock,
}));

vi.mock("@/actions/key-quota", () => ({
  getKeyQuotaUsage: getKeyQuotaUsageMock,
}));

const { callV1Route } = await import("../test-utils");
const { resolveAuth } = await import("@/lib/api/v1/_shared/auth-middleware");
const { createCsrfToken } = await import("@/lib/api/v1/_shared/csrf");
const { CSRF_HEADER } = await import("@/lib/api/v1/_shared/constants");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

const userSession = {
  user: { id: 2, role: "user", isEnabled: true },
  key: { id: 2, userId: 2, key: "user-token", canLoginWebUi: true },
} as AuthSession;

const headers = { Authorization: "Bearer admin-token" };

describe("v1 key endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getKeysMock.mockResolvedValue({
      ok: true,
      data: [{ id: 10, name: "default", key: "sk-default-secret" }],
    });
    getKeysWithStatisticsMock.mockResolvedValue({
      ok: true,
      data: [{ id: 10, todayCallCount: 1 }],
    });
    addKeyMock.mockResolvedValue({ ok: true, data: { generatedKey: "sk-new", name: "default" } });
    editKeyMock.mockResolvedValue({ ok: true });
    removeKeyMock.mockResolvedValue({ ok: true });
    getKeyLimitUsageMock.mockResolvedValue({
      ok: true,
      data: { costDaily: { current: 1, limit: 10 } },
    });
    getKeyQuotaUsageMock.mockResolvedValue({ ok: true, data: { buckets: [] } });
    resetKeyLimitsOnlyMock.mockResolvedValue({ ok: true });
    toggleKeyEnabledMock.mockResolvedValue({ ok: true });
    renewKeyExpiresAtMock.mockResolvedValue({ ok: true });
    patchKeyLimitMock.mockResolvedValue({ ok: true });
    batchUpdateKeysMock.mockResolvedValue({
      ok: true,
      data: { requestedCount: 1, updatedCount: 1, updatedIds: [10] },
    });
  });

  test("lists and creates user keys", async () => {
    const list = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users/1/keys",
      headers,
    });
    expect(list.response.status).toBe(200);
    expect(list.json).toEqual({
      items: [{ id: 10, name: "default", maskedKey: expect.any(String) }],
    });
    expect(JSON.stringify(list.json)).not.toContain("sk-default-secret");
    expect(getKeysMock).toHaveBeenCalledWith(1);

    const listWithStats = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users/1/keys?include=statistics",
      headers,
    });
    expect(listWithStats.response.status).toBe(200);
    expect(getKeysWithStatisticsMock).toHaveBeenCalledWith(1);

    const created = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users/1/keys",
      headers,
      body: { name: "default", providerGroup: "default" },
    });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("Cache-Control")).toContain("no-store");
    expect(created.response.headers.get("Pragma")).toBe("no-cache");
    expect(addKeyMock).toHaveBeenCalledWith({
      userId: 1,
      name: "default",
      providerGroup: "default",
    });
  });

  test("rejects user API keys for key management when API key admin access is disabled", async () => {
    validateAuthTokenMock.mockResolvedValueOnce(adminSession);

    const response = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users/1/keys",
      headers: { Authorization: "Bearer user-api-key" },
      body: { name: "blocked" },
    });

    expect(response.response.status).toBe(403);
    expect(response.json).toMatchObject({ errorCode: "auth.api_key_admin_disabled" });
    expect(addKeyMock).not.toHaveBeenCalled();
  });

  test("does not accept raw user API keys presented through auth cookies for admin mutations", async () => {
    validateAuthTokenMock.mockResolvedValueOnce(adminSession);

    const response = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users/1/keys",
      headers: {
        Cookie: "auth-token=user-api-key",
        [CSRF_HEADER]: createCsrfToken({ authToken: "user-api-key", userId: 1 }),
      },
      body: { name: "blocked" },
    });

    expect(response.response.status).toBe(401);
    expect(response.json).toMatchObject({ errorCode: "auth.missing" });
    expect(addKeyMock).not.toHaveBeenCalled();
  });

  test("rejects non-admin sessions for key management", async () => {
    validateAuthTokenMock.mockResolvedValueOnce(userSession);

    const response = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users/1/keys",
      headers: { Authorization: "Bearer user-session-token" },
    });

    expect(response.response.status).toBe(403);
    expect(response.json).toMatchObject({ errorCode: "auth.forbidden" });
    expect(getKeysMock).not.toHaveBeenCalled();
  });

  test("issues CSRF tokens with no-store headers", async () => {
    const csrf = await callV1Route({
      method: "GET",
      pathname: "/api/v1/auth/csrf",
      headers,
    });

    expect(csrf.response.status).toBe(200);
    expect(csrf.response.headers.get("Cache-Control")).toContain("no-store");
    expect(csrf.response.headers.get("Pragma")).toBe("no-cache");
    expect(csrf.json).toMatchObject({ csrfToken: expect.any(String) });
  });

  test("requires CSRF for cookie-authenticated key mutations", async () => {
    const missingCsrfResponse = await resolveAuth(
      createCookieAuthContext({ Cookie: "auth-token=admin-token" }),
      "admin"
    );
    expect(missingCsrfResponse).toBeInstanceOf(Response);
    const missingCsrf = await (missingCsrfResponse as Response).json();

    expect(missingCsrf).toMatchObject({ errorCode: "auth.csrf_invalid" });
    expect((missingCsrfResponse as Response).status).toBe(403);

    const csrfToken = createCsrfToken({ authToken: "admin-token", userId: 1 });
    const created = await resolveAuth(
      createCookieAuthContext({
        Cookie: "auth-token=admin-token",
        [CSRF_HEADER]: csrfToken,
      }),
      "admin"
    );

    expect(created).not.toBeInstanceOf(Response);
  });

  test("updates deletes enables and renews keys", async () => {
    const detail = await callV1Route({
      method: "GET",
      pathname: "/api/v1/keys/10",
      headers,
    });
    expect(detail.response.status).toBe(200);
    expect(getKeyLimitUsageMock).toHaveBeenCalledWith(10);

    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/keys/10",
      headers,
      body: { name: "default-2" },
    });
    expect(updated.response.status).toBe(200);
    expect(editKeyMock).toHaveBeenCalledWith(10, { name: "default-2" });

    const enabled = await callV1Route({
      method: "POST",
      pathname: "/api/v1/keys/10:enable",
      headers,
      body: { enabled: false },
    });
    expect(enabled.response.status).toBe(200);
    expect(toggleKeyEnabledMock).toHaveBeenCalledWith(10, false);

    const renewed = await callV1Route({
      method: "POST",
      pathname: "/api/v1/keys/10:renew",
      headers,
      body: { expiresAt: "2027-01-01T00:00:00.000Z", enableKey: true },
    });
    expect(renewed.response.status).toBe(200);
    expect(renewKeyExpiresAtMock).toHaveBeenCalledWith(10, {
      expiresAt: "2027-01-01T00:00:00.000Z",
      enableKey: true,
    });

    const deleted = await callV1Route({ method: "DELETE", pathname: "/api/v1/keys/10", headers });
    expect(deleted.response.status).toBe(204);
    expect(removeKeyMock).toHaveBeenCalledWith(10);
  });

  test("reads and mutates key limit quota endpoints", async () => {
    const limitUsage = await callV1Route({
      method: "GET",
      pathname: "/api/v1/keys/10/limit-usage",
      headers,
    });
    expect(limitUsage.response.status).toBe(200);
    expect(getKeyLimitUsageMock).toHaveBeenCalledWith(10);

    const quota = await callV1Route({
      method: "GET",
      pathname: "/api/v1/keys/10/quota",
      headers,
    });
    expect(quota.response.status).toBe(200);
    expect(getKeyQuotaUsageMock).toHaveBeenCalledWith(10);

    const patchLimit = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/keys/10/limits/limitDailyUsd",
      headers,
      body: { value: 20 },
    });
    expect(patchLimit.response.status).toBe(200);
    expect(patchKeyLimitMock).toHaveBeenCalledWith(10, "limitDailyUsd", 20);

    const reset = await callV1Route({
      method: "POST",
      pathname: "/api/v1/keys/10/limits:reset",
      headers,
    });
    expect(reset.response.status).toBe(204);
    expect(resetKeyLimitsOnlyMock).toHaveBeenCalledWith(10);
  });

  test("batch updates keys and maps failures to problem+json", async () => {
    const batch = await callV1Route({
      method: "POST",
      pathname: "/api/v1/keys:batchUpdate",
      headers,
      body: { keyIds: [10], updates: { isEnabled: false } },
    });
    expect(batch.response.status).toBe(200);
    expect(batchUpdateKeysMock).toHaveBeenCalledWith({
      keyIds: [10],
      updates: { isEnabled: false },
    });

    editKeyMock.mockResolvedValueOnce({ ok: false, error: "密钥不存在", errorCode: "NOT_FOUND" });
    const missing = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/keys/404",
      headers,
      body: { name: "missing" },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.response.headers.get("content-type")).toContain("application/problem+json");
    expect(missing.json).toMatchObject({ detail: "Not found" });
    expect(JSON.stringify(missing.json)).not.toContain("密钥不存在");

    editKeyMock.mockResolvedValueOnce({
      ok: false,
      error: "database constraint leaked-secret",
    });
    const failed = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/keys/10",
      headers,
      body: { name: "default-3" },
    });
    expect(failed.response.status).toBe(400);
    expect(failed.json).toMatchObject({ detail: "Bad request" });
    expect(JSON.stringify(failed.json)).not.toContain("leaked-secret");
  });

  test("rejects invalid key requests and documents key REST paths", async () => {
    const invalid = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/keys/10/limits/notAField",
      headers,
      body: { value: 20 },
    });
    expect(invalid.response.status).toBe(400);
    expect(patchKeyLimitMock).not.toHaveBeenCalled();

    const { json } = await callV1Route({ method: "GET", pathname: "/api/v1/openapi.json" });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/users/{userId}/keys");
    expect(doc.paths).toHaveProperty("/api/v1/keys/{keyId}");
    expect(doc.paths).toHaveProperty("/api/v1/keys/{keyId}:enable");
    expect(doc.paths).toHaveProperty("/api/v1/keys/{keyId}:renew");
    expect(doc.paths).toHaveProperty("/api/v1/keys/{keyId}/limits:reset");
    expect(doc.paths).toHaveProperty("/api/v1/keys/{keyId}/limit-usage");
    expect(doc.paths).toHaveProperty("/api/v1/keys/{keyId}/quota");
    expect(doc.paths).toHaveProperty("/api/v1/keys/{keyId}/limits/{field}");
    expect(doc.paths).toHaveProperty("/api/v1/keys:batchUpdate");
  });
});

function createCookieAuthContext(headers: Record<string, string>) {
  const headerBag = new Headers(headers);
  return {
    req: {
      method: "POST",
      url: "http://localhost/api/v1/users/1/keys",
      raw: { headers: headerBag },
      header: (name: string) => headerBag.get(name) ?? undefined,
    },
  } as never;
}
