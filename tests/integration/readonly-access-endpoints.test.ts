import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys, users } from "@/drizzle/schema";
import { callActionsRoute } from "../test-utils";

/**
 * Issue #687: allowReadOnlyAccess endpoints test
 *
 * Test that endpoints with allowReadOnlyAccess: true can be accessed
 * by API keys with canLoginWebUi=false (readonly keys).
 *
 * These endpoints have business logic that already supports regular users
 * (returning only their own data), so they should allow readonly access.
 */

let currentAuthToken: string | undefined;
let currentAuthorization: string | undefined;

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      if (name !== "auth-token") return undefined;
      return currentAuthToken ? { value: currentAuthToken } : undefined;
    },
    set: vi.fn(),
    delete: vi.fn(),
    has: (name: string) => name === "auth-token" && Boolean(currentAuthToken),
  }),
  headers: () => ({
    get: (name: string) => {
      if (name.toLowerCase() !== "authorization") return null;
      return currentAuthorization ?? null;
    },
  }),
}));

type TestKey = { id: number; userId: number; key: string; name: string };
type TestUser = { id: number; name: string };

async function createTestUser(name: string): Promise<TestUser> {
  const [row] = await db
    .insert(users)
    .values({ name })
    .returning({ id: users.id, name: users.name });

  if (!row) {
    throw new Error("Failed to create test user");
  }
  return row;
}

async function createTestKey(params: {
  userId: number;
  key: string;
  name: string;
  canLoginWebUi: boolean;
}): Promise<TestKey> {
  const [row] = await db
    .insert(keys)
    .values({
      userId: params.userId,
      key: params.key,
      name: params.name,
      canLoginWebUi: params.canLoginWebUi,
      dailyResetMode: "rolling",
      dailyResetTime: "00:00",
    })
    .returning({ id: keys.id, userId: keys.userId, key: keys.key, name: keys.name });

  if (!row) {
    throw new Error("Failed to create test key");
  }
  return row;
}

describe("allowReadOnlyAccess endpoints (Issue #687)", () => {
  const createdUserIds: number[] = [];
  const createdKeyIds: number[] = [];

  afterAll(async () => {
    const now = new Date();
    if (createdKeyIds.length > 0) {
      await db
        .update(keys)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(keys.id, createdKeyIds));
    }
    if (createdUserIds.length > 0) {
      await db
        .update(users)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(users.id, createdUserIds));
    }
  });

  beforeEach(() => {
    currentAuthToken = undefined;
    currentAuthorization = undefined;
  });

  test("readonly key (canLoginWebUi=false) can access getUsers endpoint", async () => {
    const unique = `readonly-getusers-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Test ${unique}`);
    createdUserIds.push(user.id);

    const readonlyKey = await createTestKey({
      userId: user.id,
      key: `test-readonly-key-${unique}`,
      name: `readonly-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(readonlyKey.id);

    currentAuthToken = readonlyKey.key;

    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/users/getUsers",
      authToken: readonlyKey.key,
      body: {},
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ ok: true });

    // Regular user should only see their own data
    const data = (json as { ok: boolean; data: Array<{ id: number }> }).data;
    expect(data.length).toBe(1);
    expect(data[0].id).toBe(user.id);
  });

  test("readonly key can access getUserLimitUsage for own user", async () => {
    const unique = `readonly-userlimit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Test ${unique}`);
    createdUserIds.push(user.id);

    const readonlyKey = await createTestKey({
      userId: user.id,
      key: `test-readonly-key-${unique}`,
      name: `readonly-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(readonlyKey.id);

    currentAuthToken = readonlyKey.key;

    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/users/getUserLimitUsage",
      authToken: readonlyKey.key,
      body: { userId: user.id },
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ ok: true });
  });

  // Note: getKeys and getKeyLimitUsage are intentionally NOT allowReadOnlyAccess
  // because a readonly key should not be able to see other keys under the same user

  test("readonly key can access getUserStatistics", async () => {
    const unique = `readonly-stats-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Test ${unique}`);
    createdUserIds.push(user.id);

    const readonlyKey = await createTestKey({
      userId: user.id,
      key: `test-readonly-key-${unique}`,
      name: `readonly-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(readonlyKey.id);

    currentAuthToken = readonlyKey.key;

    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/statistics/getUserStatistics",
      authToken: readonlyKey.key,
      body: { timeRange: "today" },
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ ok: true });
  });

  test("readonly key can access getUsageLogs", async () => {
    const unique = `readonly-logs-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Test ${unique}`);
    createdUserIds.push(user.id);

    const readonlyKey = await createTestKey({
      userId: user.id,
      key: `test-readonly-key-${unique}`,
      name: `readonly-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(readonlyKey.id);

    currentAuthToken = readonlyKey.key;

    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/usage-logs/getUsageLogs",
      authToken: readonlyKey.key,
      body: {},
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ ok: true });
  });

  test("readonly key can access getOverviewData", async () => {
    const unique = `readonly-overview-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Test ${unique}`);
    createdUserIds.push(user.id);

    const readonlyKey = await createTestKey({
      userId: user.id,
      key: `test-readonly-key-${unique}`,
      name: `readonly-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(readonlyKey.id);

    currentAuthToken = readonlyKey.key;

    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/overview/getOverviewData",
      authToken: readonlyKey.key,
      body: {},
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ ok: true });
  });

  test("readonly key can access getActiveSessions", async () => {
    const unique = `readonly-sessions-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Test ${unique}`);
    createdUserIds.push(user.id);

    const readonlyKey = await createTestKey({
      userId: user.id,
      key: `test-readonly-key-${unique}`,
      name: `readonly-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(readonlyKey.id);

    currentAuthToken = readonlyKey.key;

    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/active-sessions/getActiveSessions",
      authToken: readonlyKey.key,
      body: {},
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ ok: true });
  });

  test("readonly key cannot access other user's data", async () => {
    const unique = `readonly-isolation-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Create user A with readonly key
    const userA = await createTestUser(`Test ${unique}-A`);
    createdUserIds.push(userA.id);
    const keyA = await createTestKey({
      userId: userA.id,
      key: `test-readonly-key-A-${unique}`,
      name: `readonly-A-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(keyA.id);

    // Create user B
    const userB = await createTestUser(`Test ${unique}-B`);
    createdUserIds.push(userB.id);
    const keyB = await createTestKey({
      userId: userB.id,
      key: `test-readonly-key-B-${unique}`,
      name: `readonly-B-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(keyB.id);

    currentAuthToken = keyA.key;

    // User A trying to access User B's limit usage should fail
    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/users/getUserLimitUsage",
      authToken: keyA.key,
      body: { userId: userB.id },
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ ok: false });
  });

  test("readonly key cannot access admin-only endpoints", async () => {
    const unique = `readonly-admin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Test ${unique}`);
    createdUserIds.push(user.id);

    const readonlyKey = await createTestKey({
      userId: user.id,
      key: `test-readonly-key-${unique}`,
      name: `readonly-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(readonlyKey.id);

    currentAuthToken = readonlyKey.key;

    // Sensitive words management is admin-only
    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/sensitive-words/listSensitiveWords",
      authToken: readonlyKey.key,
      body: {},
    });

    // Should be rejected (either 401 or 403)
    expect([401, 403]).toContain(response.status);
    expect(json).toMatchObject({ ok: false });
  });

  test("Bearer token authentication works for readonly endpoints", async () => {
    const unique = `readonly-bearer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Test ${unique}`);
    createdUserIds.push(user.id);

    const readonlyKey = await createTestKey({
      userId: user.id,
      key: `test-readonly-key-${unique}`,
      name: `readonly-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(readonlyKey.id);

    currentAuthorization = `Bearer ${readonlyKey.key}`;

    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/users/getUsers",
      headers: { Authorization: currentAuthorization },
      body: {},
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ ok: true });
  });
});
