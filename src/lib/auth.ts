import { cookies, headers } from "next/headers";
import { config } from "@/lib/config/config";
import { getEnvConfig } from "@/lib/config/env.schema";
import { validateApiKeyAndGetUser } from "@/repository/key";
import type { Key } from "@/types/key";
import type { User } from "@/types/user";

export type ScopedAuthContext = {
  session: AuthSession;
  /**
   * 本次请求在 adapter 层 validateKey 时使用的 allowReadOnlyAccess 参数。
   * - true：允许 canLoginWebUi=false 的 key 作为“只读会话”使用
   * - false：严格要求 canLoginWebUi=true
   */
  allowReadOnlyAccess: boolean;
};

export type AuthSessionStorage = {
  run<T>(store: ScopedAuthContext, callback: () => T): T;
  getStore(): ScopedAuthContext | undefined;
};

declare global {
  // eslint-disable-next-line no-var
  var __cchAuthSessionStorage: AuthSessionStorage | undefined;
}

const AUTH_COOKIE_NAME = "auth-token";
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface AuthSession {
  user: User;
  key: Key;
}

export function runWithAuthSession<T>(
  session: AuthSession,
  fn: () => T,
  options?: { allowReadOnlyAccess?: boolean }
): T {
  const storage = globalThis.__cchAuthSessionStorage;
  if (!storage) return fn();
  return storage.run({ session, allowReadOnlyAccess: options?.allowReadOnlyAccess ?? false }, fn);
}

export function getScopedAuthSession(): AuthSession | null {
  const storage = globalThis.__cchAuthSessionStorage;
  return storage?.getStore()?.session ?? null;
}

export function getScopedAuthContext(): ScopedAuthContext | null {
  const storage = globalThis.__cchAuthSessionStorage;
  return storage?.getStore() ?? null;
}

export async function validateKey(
  keyString: string,
  options?: {
    /**
     * 允许仅访问只读页面（如 my-usage），跳过 canLoginWebUi 校验
     */
    allowReadOnlyAccess?: boolean;
  }
): Promise<AuthSession | null> {
  const allowReadOnlyAccess = options?.allowReadOnlyAccess ?? false;

  const adminToken = config.auth.adminToken;
  if (adminToken && keyString === adminToken) {
    const now = new Date();
    const adminUser: User = {
      id: -1,
      name: "Admin Token",
      description: "Environment admin session",
      role: "admin",
      rpm: 0,
      dailyQuota: 0,
      providerGroup: null,
      isEnabled: true,
      expiresAt: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      createdAt: now,
      updatedAt: now,
    };

    const adminKey: Key = {
      id: -1,
      userId: adminUser.id,
      name: "ADMIN_TOKEN",
      key: keyString,
      isEnabled: true,
      canLoginWebUi: true, // Admin Token
      providerGroup: null,
      limit5hUsd: null,
      limitDailyUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitConcurrentSessions: 0,
      cacheTtlPreference: null,
      createdAt: now,
      updatedAt: now,
    };

    return { user: adminUser, key: adminKey };
  }

  // 默认鉴权链路：Vacuum Filter（仅负向短路） → Redis（key/user 缓存） → DB（权威校验）
  const authResult = await validateApiKeyAndGetUser(keyString);
  if (!authResult) {
    return null;
  }

  const { user, key } = authResult;

  // 检查 Web UI 登录权限
  if (!allowReadOnlyAccess && !key.canLoginWebUi) {
    return null;
  }

  return { user, key };
}

export function getLoginRedirectTarget(session: AuthSession): string {
  if (session.user.role === "admin") return "/dashboard";
  if (session.key.canLoginWebUi) return "/dashboard";
  return "/my-usage";
}

export async function setAuthCookie(keyString: string) {
  const cookieStore = await cookies();
  const env = getEnvConfig();
  cookieStore.set(AUTH_COOKIE_NAME, keyString, {
    httpOnly: true,
    secure: env.ENABLE_SECURE_COOKIES,
    sameSite: "lax",
    maxAge: AUTH_COOKIE_MAX_AGE,
    path: "/",
  });
}

export async function getAuthCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_COOKIE_NAME)?.value;
}

export async function clearAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE_NAME);
}

export async function getSession(options?: {
  /**
   * 允许仅访问只读页面（如 my-usage），跳过 canLoginWebUi 校验
   */
  allowReadOnlyAccess?: boolean;
}): Promise<AuthSession | null> {
  // 优先读取 adapter 注入的请求级会话（适配 /api/actions 等非 Next 原生上下文场景）
  const scoped = getScopedAuthContext();
  if (scoped) {
    // 关键：scoped 会话必须遵循其"创建时语义"，仅允许内部显式降权（不允许提权）
    const effectiveAllowReadOnlyAccess =
      scoped.allowReadOnlyAccess && (options?.allowReadOnlyAccess ?? true);
    if (!effectiveAllowReadOnlyAccess && !scoped.session.key.canLoginWebUi) {
      return null;
    }
    return scoped.session;
  }

  const keyString = await getAuthToken();
  if (!keyString) {
    return null;
  }

  return validateKey(keyString, options);
}

function parseBearerToken(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;

  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  const token = match?.[1]?.trim();
  return token || undefined;
}

async function getAuthToken(): Promise<string | undefined> {
  // 优先使用 Cookie（兼容现有 Web UI 的登录态）
  const cookieToken = await getAuthCookie();
  if (cookieToken) return cookieToken;

  // Cookie 缺失时，允许通过 Authorization: Bearer <token> 自助调用只读接口
  const headersStore = await headers();
  return parseBearerToken(headersStore.get("authorization"));
}
