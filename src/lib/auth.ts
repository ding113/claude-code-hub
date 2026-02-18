import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import { config } from "@/lib/config/config";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import { findKeyList, validateApiKeyAndGetUser } from "@/repository/key";
import type { Key } from "@/types/key";
import type { User } from "@/types/user";

/**
 * Apply no-store / cache-busting headers to auth responses that mutate session state.
 * Prevents browsers and intermediary caches from storing sensitive auth responses.
 */
export function withNoStoreHeaders<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  return response;
}

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

export const AUTH_COOKIE_NAME = "auth-token";
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface AuthSession {
  user: User;
  key: Key;
}

export type SessionTokenMode = "legacy" | "dual" | "opaque";
export type SessionTokenKind = "legacy" | "opaque";

export function getSessionTokenMode(): SessionTokenMode {
  return getEnvConfig().SESSION_TOKEN_MODE;
}

// Session contract: opaque token is a random string, not the API key
export interface OpaqueSessionContract {
  sessionId: string; // random opaque token
  keyFingerprint: string; // hash of the API key (for audit, not auth)
  createdAt: number; // unix timestamp
  expiresAt: number; // unix timestamp
  userId: number;
  userRole: string;
}

export interface SessionTokenMigrationFlags {
  dualReadWindowEnabled: boolean;
  hardCutoverEnabled: boolean;
  emergencyRollbackEnabled: boolean;
}

export const SESSION_TOKEN_SEMANTICS = {
  expiry: "hard_expiry_at_expires_at",
  rotation: "rotate_before_expiry_and_revoke_previous_session_id",
  revocation: "server_side_revocation_invalidates_session_immediately",
  compatibility: {
    legacy: "accept_legacy_only",
    dual: "accept_legacy_and_opaque",
    opaque: "accept_opaque_only",
  },
} as const;

export function getSessionTokenMigrationFlags(
  mode: SessionTokenMode = getSessionTokenMode()
): SessionTokenMigrationFlags {
  return {
    dualReadWindowEnabled: mode === "dual",
    hardCutoverEnabled: mode === "opaque",
    emergencyRollbackEnabled: mode === "legacy",
  };
}

export function isSessionTokenKindAccepted(
  mode: SessionTokenMode,
  kind: SessionTokenKind
): boolean {
  if (mode === "dual") return true;
  if (mode === "legacy") return kind === "legacy";
  return kind === "opaque";
}

export function isOpaqueSessionContract(value: unknown): value is OpaqueSessionContract {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    typeof candidate.keyFingerprint === "string" &&
    candidate.keyFingerprint.length > 0 &&
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt) &&
    candidate.expiresAt > candidate.createdAt &&
    typeof candidate.userId === "number" &&
    Number.isInteger(candidate.userId) &&
    typeof candidate.userRole === "string" &&
    candidate.userRole.length > 0
  );
}

const OPAQUE_SESSION_ID_PREFIX = "sid_";

export function detectSessionTokenKind(token: string): SessionTokenKind {
  const trimmed = token.trim();
  if (!trimmed) return "legacy";
  return trimmed.startsWith(OPAQUE_SESSION_ID_PREFIX) ? "opaque" : "legacy";
}

export function isSessionTokenAccepted(
  token: string,
  mode: SessionTokenMode = getSessionTokenMode()
): boolean {
  return isSessionTokenKindAccepted(mode, detectSessionTokenKind(token));
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

  // 用户状态校验：与 v1 proxy 侧保持一致，避免禁用/过期用户继续登录或持有会话
  if (!user.isEnabled) {
    return null;
  }
  if (user.expiresAt && user.expiresAt.getTime() <= Date.now()) {
    return null;
  }

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

export async function validateAuthToken(
  token: string,
  options?: { allowReadOnlyAccess?: boolean }
): Promise<AuthSession | null> {
  const mode = getSessionTokenMode();

  if (mode !== "legacy") {
    try {
      const sessionStore = await getSessionStore();
      const sessionData = await sessionStore.read(token);
      if (sessionData) {
        if (sessionData.expiresAt <= Date.now()) {
          logger.warn("Opaque session expired (application-level check)", {
            sessionId: sessionData.sessionId,
            expiresAt: sessionData.expiresAt,
          });
          return null;
        }
        return convertToAuthSession(sessionData, options);
      }
    } catch (error) {
      logger.warn("Opaque session read failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (mode === "legacy" || mode === "dual") {
    return validateKey(token, options);
  }

  return null;
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

  return validateAuthToken(keyString, options);
}

type SessionStoreReader = {
  read(sessionId: string): Promise<OpaqueSessionContract | null>;
};

let sessionStorePromise: Promise<SessionStoreReader> | null = null;

async function getSessionStore(): Promise<SessionStoreReader> {
  if (!sessionStorePromise) {
    sessionStorePromise = import("@/lib/auth-session-store/redis-session-store")
      .then(({ RedisSessionStore }) => new RedisSessionStore())
      .catch((error) => {
        sessionStorePromise = null;
        throw error;
      });
  }

  return sessionStorePromise;
}

export async function toKeyFingerprint(keyString: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyString));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
  return `sha256:${hex}`;
}

function normalizeKeyFingerprint(fingerprint: string): string {
  return fingerprint.startsWith("sha256:") ? fingerprint : `sha256:${fingerprint}`;
}

async function convertToAuthSession(
  sessionData: OpaqueSessionContract,
  options?: { allowReadOnlyAccess?: boolean }
): Promise<AuthSession | null> {
  const expectedFingerprint = normalizeKeyFingerprint(sessionData.keyFingerprint);

  // Admin token uses virtual user (id=-1) which has no DB keys;
  // verify fingerprint against the configured admin token directly.
  if (sessionData.userId === -1) {
    const adminToken = config.auth.adminToken;
    if (!adminToken) return null;
    const adminFingerprint = await toKeyFingerprint(adminToken);
    return adminFingerprint === expectedFingerprint ? validateKey(adminToken, options) : null;
  }

  const keyList = await findKeyList(sessionData.userId);

  for (const key of keyList) {
    const keyFingerprint = await toKeyFingerprint(key.key);
    if (keyFingerprint === expectedFingerprint) {
      return validateKey(key.key, options);
    }
  }

  return null;
}

export async function getSessionWithDualRead(options?: {
  allowReadOnlyAccess?: boolean;
}): Promise<AuthSession | null> {
  return getSession(options);
}

export async function validateSession(options?: {
  allowReadOnlyAccess?: boolean;
}): Promise<AuthSession | null> {
  return getSessionWithDualRead(options);
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
