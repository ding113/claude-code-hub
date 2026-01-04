import { cookies, headers } from "next/headers";
import { config } from "@/lib/config/config";
import { getEnvConfig } from "@/lib/config/env.schema";
import { findActiveKeyByKeyString } from "@/repository/key";
import { findUserById } from "@/repository/user";
import type { Key } from "@/types/key";
import type { User } from "@/types/user";

const AUTH_COOKIE_NAME = "auth-token";
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface AuthSession {
  user: User;
  key: Key;
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

  const key = await findActiveKeyByKeyString(keyString);
  if (!key) {
    return null;
  }

  // 检查 Web UI 登录权限
  if (!allowReadOnlyAccess && !key.canLoginWebUi) {
    return null;
  }

  const user = await findUserById(key.userId);
  if (!user) {
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
