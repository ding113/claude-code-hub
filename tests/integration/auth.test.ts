import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { inArray } from "drizzle-orm";
import type { NextResponse } from "next/server";
import { db } from "@/drizzle/db";
import { keys, users } from "@/drizzle/schema";
import {
  type AuthSession,
  clearAuthCookie,
  detectSessionTokenKind,
  getAuthCookie,
  getLoginRedirectTarget,
  getScopedAuthContext,
  getScopedAuthSession,
  getSession,
  getSessionTokenMigrationFlags,
  getSessionWithDualRead,
  isOpaqueSessionContract,
  isSessionTokenAccepted,
  isSessionTokenKindAccepted,
  runWithAuthSession,
  type ScopedAuthContext,
  setAuthCookie,
  validateKey,
  validateSession,
  withNoStoreHeaders,
} from "@/lib/auth";
import type { Key } from "@/types/key";
import type { User } from "@/types/user";

/**
 * 透传式仓储 mock：
 * - 默认（override 为 undefined）转发到真实实现，DSN 集成用例语义不变
 * - 无 DB 用例通过设置 override 驱动 validateKey 的用户状态分支
 */
const keyRepoOverride = vi.hoisted(() => ({
  validateApiKeyAndGetUser: undefined as
    | ((keyString: string) => Promise<{ user: User; key: Key } | null>)
    | undefined,
}));

vi.mock("@/repository/key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/key")>();
  return {
    ...actual,
    validateApiKeyAndGetUser: (keyString: string) =>
      keyRepoOverride.validateApiKeyAndGetUser
        ? keyRepoOverride.validateApiKeyAndGetUser(keyString)
        : actual.validateApiKeyAndGetUser(keyString),
  };
});

/**
 * 说明：
 * - 本文件用于覆盖 auth.ts 的权限边界与 Cookie 行为
 * - 重点验证：allowReadOnlyAccess 白名单语义
 * - 以及 getSession/cookie 的读写一致性
 */

let currentCookieValue: string | undefined;
let currentAuthorizationValue: string | undefined;
const cookieSet = vi.fn((name: string, value: string) => {
  if (name === "auth-token") currentCookieValue = value;
});
const cookieDelete = vi.fn((name: string) => {
  if (name === "auth-token") currentCookieValue = undefined;
});

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      if (name !== "auth-token") return undefined;
      return currentCookieValue ? { value: currentCookieValue } : undefined;
    },
    set: cookieSet,
    delete: cookieDelete,
    has: (name: string) => name === "auth-token" && Boolean(currentCookieValue),
  }),
  headers: () => ({
    get: (name: string) => {
      if (name.toLowerCase() !== "authorization") return null;
      return currentAuthorizationValue ?? null;
    },
  }),
}));

type TestUser = { id: number; name: string };
type TestKey = { id: number; userId: number; key: string; canLoginWebUi: boolean };

async function createTestUser(name: string): Promise<TestUser> {
  const [row] = await db
    .insert(users)
    .values({ name })
    .returning({ id: users.id, name: users.name });
  if (!row) throw new Error("创建测试用户失败：未返回插入结果");
  return row;
}

async function createTestKey(params: {
  userId: number;
  key: string;
  canLoginWebUi: boolean;
}): Promise<TestKey> {
  const [row] = await db
    .insert(keys)
    .values({
      userId: params.userId,
      key: params.key,
      name: `key-${params.key}`,
      canLoginWebUi: params.canLoginWebUi,
      dailyResetMode: "rolling",
      dailyResetTime: "00:00",
    })
    .returning({
      id: keys.id,
      userId: keys.userId,
      key: keys.key,
      canLoginWebUi: keys.canLoginWebUi,
    });

  if (!row) throw new Error("创建测试 Key 失败：未返回插入结果");
  return row;
}

describe("auth.ts：validateKey / getSession（安全边界）", () => {
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
    currentCookieValue = undefined;
    currentAuthorizationValue = undefined;
    cookieSet.mockClear();
    cookieDelete.mockClear();
  });

  test("admin token：应返回 admin session（无需 DB）", async () => {
    const adminToken = process.env.ADMIN_TOKEN;
    expect(adminToken).toBeTruthy();

    const session = await validateKey(adminToken as string);
    expect(session?.user.role).toBe("admin");
    expect(session?.key.canLoginWebUi).toBe(true);
  });

  test.skipIf(!process.env.DSN)("不存在的 key：validateKey 应返回 null", async () => {
    const session = await validateKey(`non-existent-${Date.now()}`);
    expect(session).toBeNull();
  });

  test.skipIf(!process.env.DSN)(
    "canLoginWebUi=false 且 allowReadOnlyAccess=false：应拒绝",
    async () => {
      const unique = `auth-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const user = await createTestUser(`Test ${unique}`);
      createdUserIds.push(user.id);
      const key = await createTestKey({
        userId: user.id,
        key: `test-key-${unique}`,
        canLoginWebUi: false,
      });
      createdKeyIds.push(key.id);

      const session = await validateKey(key.key, { allowReadOnlyAccess: false });
      expect(session).toBeNull();
    }
  );

  test.skipIf(!process.env.DSN)(
    "allowReadOnlyAccess=true：应允许只读 key 查询自己的数据",
    async () => {
      const unique = `auth-ro-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const user = await createTestUser(`Test ${unique}`);
      createdUserIds.push(user.id);
      const key = await createTestKey({
        userId: user.id,
        key: `test-ro-key-${unique}`,
        canLoginWebUi: false,
      });
      createdKeyIds.push(key.id);

      const session = await validateKey(key.key, { allowReadOnlyAccess: true });
      expect(session?.key.key).toBe(key.key);
      expect(session?.key.canLoginWebUi).toBe(false);
    }
  );

  test.skipIf(!process.env.DSN)("用户被软删除：validateKey 应返回 null", async () => {
    const unique = `auth-del-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Test ${unique}`);
    createdUserIds.push(user.id);
    const key = await createTestKey({
      userId: user.id,
      key: `test-key-${unique}`,
      canLoginWebUi: true,
    });
    createdKeyIds.push(key.id);

    const now = new Date();
    await db
      .update(users)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(users.id, [user.id]));

    const session = await validateKey(key.key, { allowReadOnlyAccess: true });
    expect(session).toBeNull();
  });

  test.skipIf(!process.env.DSN)(
    "getSession：无 Cookie 时返回 null；有 Cookie 时返回 session",
    async () => {
      const noCookie = await getSession({ allowReadOnlyAccess: true });
      expect(noCookie).toBeNull();

      const unique = `auth-sess-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const user = await createTestUser(`Test ${unique}`);
      createdUserIds.push(user.id);
      const key = await createTestKey({
        userId: user.id,
        key: `test-key-${unique}`,
        canLoginWebUi: false,
      });
      createdKeyIds.push(key.id);

      currentCookieValue = key.key;
      const session = await getSession({ allowReadOnlyAccess: true });
      expect(session?.key.key).toBe(key.key);
    }
  );

  test.skipIf(!process.env.DSN)(
    "getSession：仅 Authorization: Bearer 时也应返回 session",
    async () => {
      const unique = `auth-bearer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const user = await createTestUser(`Test ${unique}`);
      createdUserIds.push(user.id);
      const key = await createTestKey({
        userId: user.id,
        key: `test-key-${unique}`,
        canLoginWebUi: false,
      });
      createdKeyIds.push(key.id);

      currentAuthorizationValue = `Bearer ${key.key}`;
      const session = await getSession({ allowReadOnlyAccess: true });
      expect(session?.key.key).toBe(key.key);
    }
  );
});

describe("auth.ts：Cookie 工具函数与跳转目标", () => {
  beforeEach(() => {
    currentCookieValue = undefined;
    currentAuthorizationValue = undefined;
    cookieSet.mockClear();
    cookieDelete.mockClear();
  });

  test("set/get/clear auth cookie：应读写一致", async () => {
    await setAuthCookie("abc");
    expect(cookieSet).toHaveBeenCalled();

    const value = await getAuthCookie();
    expect(value).toBe("abc");

    await clearAuthCookie();
    expect(cookieDelete).toHaveBeenCalledWith("auth-token");
    expect(await getAuthCookie()).toBeUndefined();
  });

  test("getLoginRedirectTarget：应根据 role 与 canLoginWebUi 决定跳转", () => {
    const adminTarget = getLoginRedirectTarget({
      user: { role: "admin" } as any,
      key: { canLoginWebUi: false } as any,
    });
    expect(adminTarget).toBe("/dashboard");

    const webUiTarget = getLoginRedirectTarget({
      user: { role: "user" } as any,
      key: { canLoginWebUi: true } as any,
    });
    expect(webUiTarget).toBe("/dashboard");

    const readonlyTarget = getLoginRedirectTarget({
      user: { role: "user" } as any,
      key: { canLoginWebUi: false } as any,
    });
    expect(readonlyTarget).toBe("/my-usage");
  });
});

function buildDbUser(overrides: Partial<User> = {}): User {
  const now = new Date();
  return {
    id: 101,
    name: "Mock User",
    description: "unit mock user",
    role: "user",
    rpm: 0,
    dailyQuota: 0,
    providerGroup: null,
    isEnabled: true,
    expiresAt: null,
    limit5hResetMode: "rolling",
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildDbKey(overrides: Partial<Key> = {}): Key {
  const now = new Date();
  return {
    id: 201,
    userId: 101,
    name: "mock-key",
    key: "sk-mock-key",
    isEnabled: true,
    canLoginWebUi: true,
    providerGroup: null,
    limit5hUsd: null,
    limit5hResetMode: "rolling",
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitConcurrentSessions: 0,
    cacheTtlPreference: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("auth.ts：令牌格式与迁移开关（无需 DB）", () => {
  test("detectSessionTokenKind：空白与 sid_ 前缀判定", () => {
    expect(detectSessionTokenKind("")).toBe("legacy");
    expect(detectSessionTokenKind("   ")).toBe("legacy");
    expect(detectSessionTokenKind("sid_abc123")).toBe("opaque");
    expect(detectSessionTokenKind("  sid_abc123  ")).toBe("opaque");
    expect(detectSessionTokenKind("sk-plain-key")).toBe("legacy");
  });

  test("isSessionTokenKindAccepted：三种模式与两种 kind 的组合", () => {
    expect(isSessionTokenKindAccepted("dual", "legacy")).toBe(true);
    expect(isSessionTokenKindAccepted("dual", "opaque")).toBe(true);
    expect(isSessionTokenKindAccepted("legacy", "legacy")).toBe(true);
    expect(isSessionTokenKindAccepted("legacy", "opaque")).toBe(false);
    expect(isSessionTokenKindAccepted("opaque", "opaque")).toBe(true);
    expect(isSessionTokenKindAccepted("opaque", "legacy")).toBe(false);
  });

  test("isSessionTokenAccepted：显式模式与默认模式（测试环境默认 opaque）", () => {
    expect(isSessionTokenAccepted("sk-legacy", "legacy")).toBe(true);
    expect(isSessionTokenAccepted("sid_x", "legacy")).toBe(false);
    expect(isSessionTokenAccepted("sid_x")).toBe(true);
    expect(isSessionTokenAccepted("sk-legacy")).toBe(false);
  });

  test("getSessionTokenMigrationFlags：模式与迁移开关一一对应", () => {
    expect(getSessionTokenMigrationFlags("legacy")).toEqual({
      dualReadWindowEnabled: false,
      hardCutoverEnabled: false,
      emergencyRollbackEnabled: true,
    });
    expect(getSessionTokenMigrationFlags("dual")).toEqual({
      dualReadWindowEnabled: true,
      hardCutoverEnabled: false,
      emergencyRollbackEnabled: false,
    });
    expect(getSessionTokenMigrationFlags("opaque")).toEqual({
      dualReadWindowEnabled: false,
      hardCutoverEnabled: true,
      emergencyRollbackEnabled: false,
    });
    expect(getSessionTokenMigrationFlags()).toEqual(getSessionTokenMigrationFlags("opaque"));
  });

  test("isOpaqueSessionContract：合法契约与字段级拒绝", () => {
    const valid = {
      sessionId: "sid_1",
      keyFingerprint: "sha256:ab",
      createdAt: 1000,
      expiresAt: 2000,
      userId: 7,
      userRole: "user",
    };

    expect(isOpaqueSessionContract(valid)).toBe(true);
    expect(isOpaqueSessionContract({ ...valid, credentialType: "session" })).toBe(true);
    expect(isOpaqueSessionContract({ ...valid, credentialType: "admin-token" })).toBe(true);
    expect(isOpaqueSessionContract({ ...valid, credentialType: "user-api-key" })).toBe(true);

    expect(isOpaqueSessionContract(null)).toBe(false);
    expect(isOpaqueSessionContract(undefined)).toBe(false);
    expect(isOpaqueSessionContract("sid_1")).toBe(false);
    expect(isOpaqueSessionContract(42)).toBe(false);
    expect(isOpaqueSessionContract({ ...valid, sessionId: 5 })).toBe(false);
    expect(isOpaqueSessionContract({ ...valid, sessionId: "" })).toBe(false);
    expect(isOpaqueSessionContract({ ...valid, keyFingerprint: 9 })).toBe(false);
    expect(isOpaqueSessionContract({ ...valid, keyFingerprint: "" })).toBe(false);
    expect(isOpaqueSessionContract({ ...valid, createdAt: "1000" })).toBe(false);
    expect(isOpaqueSessionContract({ ...valid, createdAt: Number.NaN })).toBe(false);
    expect(isOpaqueSessionContract({ ...valid, expiresAt: "2000" })).toBe(false);
    expect(isOpaqueSessionContract({ ...valid, expiresAt: Number.NaN })).toBe(false);
    expect(isOpaqueSessionContract({ ...valid, expiresAt: 1000 })).toBe(false);
    expect(isOpaqueSessionContract({ ...valid, userId: "7" })).toBe(false);
    expect(isOpaqueSessionContract({ ...valid, userId: 7.5 })).toBe(false);
    expect(isOpaqueSessionContract({ ...valid, userRole: 1 })).toBe(false);
    expect(isOpaqueSessionContract({ ...valid, userRole: "" })).toBe(false);
    expect(isOpaqueSessionContract({ ...valid, credentialType: "bogus" })).toBe(false);
  });

  test("withNoStoreHeaders：应设置禁止缓存响应头并返回原响应", () => {
    const response = { headers: new Headers() } as unknown as NextResponse;
    const result = withNoStoreHeaders(response);
    expect(result).toBe(response);
    expect(result.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
    expect(result.headers.get("Pragma")).toBe("no-cache");
  });
});

describe("auth.ts：validateKey 用户状态边界（mock 仓储层，无需 DB）", () => {
  afterEach(() => {
    keyRepoOverride.validateApiKeyAndGetUser = undefined;
  });

  test("key 不存在：仓储返回 null 时应返回 null", async () => {
    keyRepoOverride.validateApiKeyAndGetUser = async () => null;
    await expect(validateKey("sk-mock-missing")).resolves.toBeNull();
  });

  test("用户被禁用：应返回 null", async () => {
    keyRepoOverride.validateApiKeyAndGetUser = async () => ({
      user: buildDbUser({ isEnabled: false }),
      key: buildDbKey(),
    });
    await expect(validateKey("sk-mock-key")).resolves.toBeNull();
  });

  test("用户已过期：应返回 null", async () => {
    keyRepoOverride.validateApiKeyAndGetUser = async () => ({
      user: buildDbUser({ expiresAt: new Date(Date.now() - 60_000) }),
      key: buildDbKey(),
    });
    await expect(validateKey("sk-mock-key")).resolves.toBeNull();
  });

  test("canLoginWebUi=false：默认拒绝，allowReadOnlyAccess=true 放行", async () => {
    keyRepoOverride.validateApiKeyAndGetUser = async () => ({
      user: buildDbUser(),
      key: buildDbKey({ canLoginWebUi: false }),
    });

    await expect(validateKey("sk-mock-key")).resolves.toBeNull();

    const readonlySession = await validateKey("sk-mock-key", { allowReadOnlyAccess: true });
    expect(readonlySession?.key.canLoginWebUi).toBe(false);
    expect(readonlySession?.user.id).toBe(101);
  });

  test("正常 key：应透传仓储返回的 user/key", async () => {
    const user = buildDbUser({ expiresAt: new Date(Date.now() + 3_600_000) });
    const key = buildDbKey();
    keyRepoOverride.validateApiKeyAndGetUser = async () => ({ user, key });

    const session = await validateKey("sk-mock-key");
    expect(session?.user).toBe(user);
    expect(session?.key).toBe(key);
  });
});

describe("auth.ts：scoped 会话与 Bearer 解析（无需 DB）", () => {
  const storage = new AsyncLocalStorage<ScopedAuthContext>();

  function buildReadonlySession(overrides: Partial<Key> = {}): AuthSession {
    return {
      user: buildDbUser(),
      key: buildDbKey({ canLoginWebUi: false, ...overrides }),
    };
  }

  beforeEach(() => {
    currentCookieValue = undefined;
    currentAuthorizationValue = undefined;
    globalThis.__cchAuthSessionStorage = {
      run: (store, callback) => storage.run(store, callback),
      getStore: () => storage.getStore(),
    };
  });

  afterEach(() => {
    globalThis.__cchAuthSessionStorage = undefined;
  });

  test("runWithAuthSession：无 storage 时直接执行回调且无 scoped 会话", () => {
    globalThis.__cchAuthSessionStorage = undefined;
    const session = buildReadonlySession();

    expect(runWithAuthSession(session, () => 42)).toBe(42);
    expect(getScopedAuthSession()).toBeNull();
    expect(getScopedAuthContext()).toBeNull();
  });

  test("runWithAuthSession：storage 内可读取 scoped 会话与 allowReadOnlyAccess 语义", () => {
    const session = buildReadonlySession();

    const observed = runWithAuthSession(
      session,
      () => ({ session: getScopedAuthSession(), ctx: getScopedAuthContext() }),
      { allowReadOnlyAccess: true }
    );
    expect(observed.session).toBe(session);
    expect(observed.ctx?.allowReadOnlyAccess).toBe(true);

    const defaultCtx = runWithAuthSession(session, () => getScopedAuthContext());
    expect(defaultCtx?.allowReadOnlyAccess).toBe(false);
  });

  test("getSession：scoped 只读会话遵循创建时语义，仅允许内部降权", async () => {
    const readonlySession = buildReadonlySession();

    // 只读作用域 + 默认选项：放行
    await expect(
      runWithAuthSession(readonlySession, () => getSession(), { allowReadOnlyAccess: true })
    ).resolves.toBe(readonlySession);

    // 只读作用域 + 显式降权：拒绝
    await expect(
      runWithAuthSession(readonlySession, () => getSession({ allowReadOnlyAccess: false }), {
        allowReadOnlyAccess: true,
      })
    ).resolves.toBeNull();

    // 非只读作用域创建的会话不允许提权为只读访问
    await expect(
      runWithAuthSession(readonlySession, () => getSession({ allowReadOnlyAccess: true }), {
        allowReadOnlyAccess: false,
      })
    ).resolves.toBeNull();

    // canLoginWebUi=true 的 scoped 会话不受只读语义限制
    const webUiSession = buildReadonlySession({ canLoginWebUi: true });
    await expect(
      runWithAuthSession(webUiSession, () => getSession(), { allowReadOnlyAccess: false })
    ).resolves.toBe(webUiSession);
  });

  test("validateSession / getSessionWithDualRead：无任何凭证时返回 null", async () => {
    await expect(validateSession({ allowReadOnlyAccess: true })).resolves.toBeNull();
    await expect(getSessionWithDualRead()).resolves.toBeNull();
  });

  test("Authorization 头格式边界：空白或非 Bearer 时不产生会话", async () => {
    currentAuthorizationValue = "   ";
    await expect(getSession({ allowReadOnlyAccess: true })).resolves.toBeNull();

    currentAuthorizationValue = "Token sk-not-bearer";
    await expect(getSession({ allowReadOnlyAccess: true })).resolves.toBeNull();

    currentAuthorizationValue = "Bearer    ";
    await expect(getSession({ allowReadOnlyAccess: true })).resolves.toBeNull();
  });
});
