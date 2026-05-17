import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const getUsersMock = vi.hoisted(() => vi.fn());
const getUserByIdMock = vi.hoisted(() => vi.fn());
const getUsersBatchCoreMock = vi.hoisted(() => vi.fn());
const getUsersUsageBatchMock = vi.hoisted(() => vi.fn());
const addUserMock = vi.hoisted(() => vi.fn());
const createUserOnlyMock = vi.hoisted(() => vi.fn());
const editUserMock = vi.hoisted(() => vi.fn());
const removeUserMock = vi.hoisted(() => vi.fn());
const toggleUserEnabledMock = vi.hoisted(() => vi.fn());
const renewUserMock = vi.hoisted(() => vi.fn());
const getUserLimitUsageMock = vi.hoisted(() => vi.fn());
const getUserAllLimitUsageMock = vi.hoisted(() => vi.fn());
const resetUserLimitsOnlyMock = vi.hoisted(() => vi.fn());
const resetUserAllStatisticsMock = vi.hoisted(() => vi.fn());
const getAllUserTagsMock = vi.hoisted(() => vi.fn());
const getAllUserKeyGroupsMock = vi.hoisted(() => vi.fn());
const searchUsersForFilterMock = vi.hoisted(() => vi.fn());
const searchUsersMock = vi.hoisted(() => vi.fn());
const batchUpdateUsersMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

vi.mock("@/actions/users", () => ({
  getUsers: getUsersMock,
  getUserById: getUserByIdMock,
  getUsersBatchCore: getUsersBatchCoreMock,
  getUsersUsageBatch: getUsersUsageBatchMock,
  addUser: addUserMock,
  createUserOnly: createUserOnlyMock,
  editUser: editUserMock,
  removeUser: removeUserMock,
  toggleUserEnabled: toggleUserEnabledMock,
  renewUser: renewUserMock,
  getUserLimitUsage: getUserLimitUsageMock,
  getUserAllLimitUsage: getUserAllLimitUsageMock,
  resetUserLimitsOnly: resetUserLimitsOnlyMock,
  resetUserAllStatistics: resetUserAllStatisticsMock,
  getAllUserTags: getAllUserTagsMock,
  getAllUserKeyGroups: getAllUserKeyGroupsMock,
  searchUsersForFilter: searchUsersForFilterMock,
  searchUsers: searchUsersMock,
  batchUpdateUsers: batchUpdateUsersMock,
}));

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

const userSession = {
  user: { id: 9, role: "user", isEnabled: true },
  key: { id: 9, userId: 9, key: "user-token", canLoginWebUi: true },
} as AuthSession;

const headers = { Authorization: "Bearer admin-token" };

function user(id = 1) {
  return {
    id,
    name: `user-${id}`,
    role: "user",
    isEnabled: true,
    keys: [{ id: 10, name: "default", maskedKey: "sk-...cret", fullKey: "sk-user-secret" }],
    tags: ["team-a"],
    expiresAt: null,
  };
}

describe("v1 users endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getUsersBatchCoreMock.mockResolvedValue({
      ok: true,
      data: { users: [user(1)], nextCursor: "next", hasMore: true },
    });
    getUsersMock.mockResolvedValue([user(1), user(250)]);
    getUserByIdMock.mockImplementation(async (id: number) => {
      if (id === 404) {
        return { ok: false, error: "Not found", errorCode: "NOT_FOUND" };
      }
      return { ok: true, data: user(id) };
    });
    getUsersUsageBatchMock.mockResolvedValue({ ok: true, data: { usageByKeyId: {} } });
    addUserMock.mockResolvedValue({
      ok: true,
      data: {
        user: { id: 2, name: "new-user" },
        defaultKey: { id: 3, name: "default", key: "sk-new" },
      },
    });
    createUserOnlyMock.mockResolvedValue({ ok: true, data: { user: { id: 2, name: "new-user" } } });
    editUserMock.mockResolvedValue({ ok: true });
    removeUserMock.mockResolvedValue({ ok: true });
    toggleUserEnabledMock.mockResolvedValue({ ok: true });
    renewUserMock.mockResolvedValue({ ok: true });
    getUserLimitUsageMock.mockResolvedValue({
      ok: true,
      data: { rpm: { current: 0, limit: 100 } },
    });
    getUserAllLimitUsageMock.mockResolvedValue({
      ok: true,
      data: { limitDaily: { usage: 1, limit: 10 } },
    });
    resetUserLimitsOnlyMock.mockResolvedValue({ ok: true });
    resetUserAllStatisticsMock.mockResolvedValue({ ok: true });
    getAllUserTagsMock.mockResolvedValue({ ok: true, data: ["team-a"] });
    getAllUserKeyGroupsMock.mockResolvedValue({ ok: true, data: ["default"] });
    searchUsersForFilterMock.mockResolvedValue({ ok: true, data: [{ id: 1, name: "user-1" }] });
    searchUsersMock.mockResolvedValue({ ok: true, data: [{ id: 1, name: "user-1" }] });
    batchUpdateUsersMock.mockResolvedValue({
      ok: true,
      data: { requestedCount: 1, updatedCount: 1, updatedIds: [1] },
    });
  });

  test("lists and reads users with dashboard filters", async () => {
    const list = await callV1Route({
      method: "GET",
      pathname:
        "/api/v1/users?cursor=c1&limit=25&q=alice&tags=a,b&keyGroups=default&status=enabled&sortBy=name&sortOrder=desc",
      headers,
    });
    expect(list.response.status).toBe(200);
    expect(list.json).toMatchObject({
      items: [{ id: 1, name: "user-1" }],
      pageInfo: {
        nextCursor: "next",
        hasMore: true,
        limit: 25,
      },
    });
    expect(JSON.stringify(list.json)).not.toContain("sk-user-secret");
    expect(JSON.stringify(list.json)).not.toContain("fullKey");
    expect(getUsersBatchCoreMock).toHaveBeenCalledWith({
      cursor: "c1",
      limit: 25,
      searchTerm: "alice",
      tagFilters: ["a", "b"],
      keyGroupFilters: ["default"],
      statusFilter: "enabled",
      sortBy: "name",
      sortOrder: "desc",
    });

    const detail = await callV1Route({ method: "GET", pathname: "/api/v1/users/1", headers });
    expect(detail.response.status).toBe(200);
    expect(detail.json).toMatchObject({ id: 1, name: "user-1" });
    expect(JSON.stringify(detail.json)).not.toContain("sk-user-secret");
    expect(JSON.stringify(detail.json)).not.toContain("fullKey");
  });

  test("returns the current user from a read-tier self list endpoint", async () => {
    validateAuthTokenMock.mockResolvedValueOnce(userSession);

    const self = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users:self",
      headers: { Authorization: "Bearer user-token" },
    });

    expect(self.response.status).toBe(200);
    expect(self.json).toMatchObject({
      items: [{ id: 9, name: "user-9" }],
      pageInfo: {
        nextCursor: null,
        hasMore: false,
        limit: 1,
      },
    });
    expect(JSON.stringify(self.json)).not.toContain("sk-user-secret");
    expect(getUserByIdMock).toHaveBeenCalledWith(9);
    expect(getUsersMock).not.toHaveBeenCalled();
    expect(validateAuthTokenMock).toHaveBeenCalledWith("user-token", {
      allowReadOnlyAccess: true,
    });
  });

  test("does not expose the admin inventory through the read-tier self endpoint", async () => {
    validateAuthTokenMock.mockResolvedValueOnce(adminSession);

    const self = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users:self",
      headers,
    });

    expect(self.response.status).toBe(200);
    expect(self.json).toMatchObject({
      items: [{ id: 1, name: "user-1" }],
      pageInfo: { nextCursor: null, hasMore: false, limit: 1 },
    });
    expect(JSON.stringify(self.json)).not.toContain("user-250");
    expect(getUserByIdMock).toHaveBeenCalledWith(1);
    expect(getUsersMock).not.toHaveBeenCalled();
  });

  test("reads user detail from an id-capable action instead of the first list page", async () => {
    getUsersBatchCoreMock.mockClear();

    const detail = await callV1Route({ method: "GET", pathname: "/api/v1/users/250", headers });

    expect(detail.response.status).toBe(200);
    expect(detail.json).toMatchObject({ id: 250, name: "user-250" });
    expect(getUserByIdMock).toHaveBeenCalledWith(250);
    expect(getUsersMock).not.toHaveBeenCalled();
    expect(getUsersBatchCoreMock).not.toHaveBeenCalled();
  });

  test("creates updates deletes enables and renews users", async () => {
    const created = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users",
      headers,
      body: { name: "new-user", tags: ["team-a"] },
    });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("Location")).toBe("/api/v1/users/2");
    expect(created.response.headers.get("Cache-Control")).toContain("no-store");
    expect(created.response.headers.get("Pragma")).toBe("no-cache");
    expect(addUserMock).toHaveBeenCalledWith({ name: "new-user", tags: ["team-a"] });

    const createdWithoutKey = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users?withDefaultKey=false",
      headers,
      body: { name: "new-user" },
    });
    expect(createdWithoutKey.response.status).toBe(201);
    expect(createUserOnlyMock).toHaveBeenCalledWith({ name: "new-user" });

    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/users/1",
      headers,
      body: { note: "updated" },
    });
    expect(updated.response.status).toBe(200);
    expect(editUserMock).toHaveBeenCalledWith(1, { note: "updated" });

    const enabled = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users/1:enable",
      headers,
      body: { enabled: false },
    });
    expect(enabled.response.status).toBe(200);
    expect(toggleUserEnabledMock).toHaveBeenCalledWith(1, false);

    const renewed = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users/1:renew",
      headers,
      body: { expiresAt: "2027-01-01T00:00:00.000Z", enableUser: true },
    });
    expect(renewed.response.status).toBe(200);
    expect(renewUserMock).toHaveBeenCalledWith(1, {
      expiresAt: "2027-01-01T00:00:00.000Z",
      enableUser: true,
    });

    const deleted = await callV1Route({ method: "DELETE", pathname: "/api/v1/users/1", headers });
    expect(deleted.response.status).toBe(204);
    expect(removeUserMock).toHaveBeenCalledWith(1);
  });

  test("reads usage helpers and resets counters", async () => {
    const limitUsage = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users/1/limit-usage",
      headers,
    });
    expect(limitUsage.response.status).toBe(200);
    expect(getUserLimitUsageMock).toHaveBeenCalledWith(1);

    const allUsage = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users/1/limit-usage:all",
      headers,
    });
    expect(allUsage.response.status).toBe(200);
    expect(getUserAllLimitUsageMock).toHaveBeenCalledWith(1);

    const usageBatch = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users:usageBatch",
      headers,
      body: { userIds: [1] },
    });
    expect(usageBatch.response.status).toBe(200);
    expect(getUsersUsageBatchMock).toHaveBeenCalledWith([1]);

    const resetLimits = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users/1/limits:reset",
      headers,
    });
    expect(resetLimits.response.status).toBe(204);

    const resetStats = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users/1/statistics:reset",
      headers,
    });
    expect(resetStats.response.status).toBe(204);
  });

  test("maps structured authorization action errors to HTTP status codes", async () => {
    getUserLimitUsageMock.mockResolvedValueOnce({
      ok: false,
      error: "Forbidden",
      errorCode: "PERMISSION_DENIED",
    });

    const forbidden = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users/1/limit-usage",
      headers,
    });

    expect(forbidden.response.status).toBe(403);
    expect(forbidden.json).toMatchObject({ errorCode: "PERMISSION_DENIED" });

    getUserAllLimitUsageMock.mockResolvedValueOnce({
      ok: false,
      error: "Unauthorized",
      errorCode: "UNAUTHORIZED",
    });

    const unauthorized = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users/1/limit-usage:all",
      headers,
    });

    expect(unauthorized.response.status).toBe(401);
    expect(unauthorized.json).toMatchObject({ errorCode: "UNAUTHORIZED" });
  });

  test("maps unexpected user detail and limit usage failures to server errors", async () => {
    getUserByIdMock.mockResolvedValueOnce({
      ok: false,
      error: "database exploded",
      errorCode: "INTERNAL_ERROR",
    });

    const detailFailure = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users/1",
      headers,
    });

    expect(detailFailure.response.status).toBe(500);
    expect(detailFailure.json).toMatchObject({ errorCode: "INTERNAL_ERROR" });

    getUserLimitUsageMock.mockResolvedValueOnce({
      ok: false,
      error: "quota backend failed",
      errorCode: "OPERATION_FAILED",
    });

    const limitFailure = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users/1/limit-usage",
      headers,
    });

    expect(limitFailure.response.status).toBe(500);
    expect(limitFailure.json).toMatchObject({ errorCode: "OPERATION_FAILED" });

    getUserAllLimitUsageMock.mockResolvedValueOnce({
      ok: false,
      error: "database unavailable",
      errorCode: "DATABASE_ERROR",
    });

    const dependencyFailure = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users/1/limit-usage:all",
      headers,
    });

    expect(dependencyFailure.response.status).toBe(503);
    expect(dependencyFailure.json).toMatchObject({ errorCode: "DATABASE_ERROR" });
  });

  test("exposes user options and batch update endpoints", async () => {
    const tags = await callV1Route({ method: "GET", pathname: "/api/v1/users/tags", headers });
    expect(tags.json).toEqual({ items: ["team-a"] });

    const keyGroups = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users/key-groups",
      headers,
    });
    expect(keyGroups.json).toEqual({ items: ["default"] });

    const filterSearch = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users:filter-search?q=user&limit=10",
      headers,
    });
    expect(filterSearch.response.status).toBe(200);
    expect(searchUsersForFilterMock).toHaveBeenCalledWith("user", 10);

    const search = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users:search?q=user&limit=10",
      headers,
    });
    expect(search.response.status).toBe(200);
    expect(searchUsersMock).toHaveBeenCalledWith("user", 10);

    const largeSearch = await callV1Route({
      method: "GET",
      pathname: "/api/v1/users:search?limit=5000",
      headers,
    });
    expect(largeSearch.response.status).toBe(200);
    expect(searchUsersMock).toHaveBeenCalledWith("", 5000);

    const batch = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users:batchUpdate",
      headers,
      body: { userIds: [1], updates: { note: "bulk" } },
    });
    expect(batch.response.status).toBe(200);
    expect(batchUpdateUsersMock).toHaveBeenCalledWith({ userIds: [1], updates: { note: "bulk" } });
  });

  test("returns problem+json for invalid requests and missing users", async () => {
    const invalid = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users",
      headers,
      body: { name: "" },
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.response.headers.get("content-type")).toContain("application/problem+json");

    const missing = await callV1Route({ method: "GET", pathname: "/api/v1/users/404", headers });
    expect(missing.response.status).toBe(404);
    expect(missing.json).toMatchObject({ errorCode: "NOT_FOUND" });
  });

  test("documents user REST paths", async () => {
    const { json } = await callV1Route({ method: "GET", pathname: "/api/v1/openapi.json" });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/users");
    expect(doc.paths).toHaveProperty("/api/v1/users/{id}");
    expect(doc.paths).toHaveProperty("/api/v1/users/{id}:enable");
    expect(doc.paths).toHaveProperty("/api/v1/users/{id}:renew");
    expect(doc.paths).toHaveProperty("/api/v1/users/{id}/limit-usage");
    expect(doc.paths).toHaveProperty("/api/v1/users/{id}/limit-usage:all");
    expect(doc.paths).toHaveProperty("/api/v1/users/{id}/limits:reset");
    expect(doc.paths).toHaveProperty("/api/v1/users/{id}/statistics:reset");
    expect(doc.paths).toHaveProperty("/api/v1/users:batchUpdate");
    expect(doc.paths).toHaveProperty("/api/v1/users:usageBatch");
    expect(doc.paths).toHaveProperty("/api/v1/users:filter-search");
    const userDetail = doc.paths["/api/v1/users/{id}"] as {
      get?: { responses?: Record<string, unknown> };
    };
    expect(JSON.stringify(userDetail.get?.responses?.["200"])).toContain("createdAt");
    expect(userDetail.get?.responses).toHaveProperty("500");
    expect(userDetail.get?.responses).toHaveProperty("503");
  });
});
