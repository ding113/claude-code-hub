/**
 * /api/v1 三层鉴权中间件
 *
 * 三个 tier：
 *   - "public" -> 不要求 token，仅写入 session=null；
 *   - "read"   -> 要求 token；允许只读 key（canLoginWebUi=false）；
 *   - "admin"  -> 要求 token；要求 user.role === "admin"；
 *                 当 ENABLE_API_KEY_ADMIN_ACCESS=true 且 token 来源是 admin 用户的 DB key 时，
 *                 也视为 admin（用于第三方系统通过 X-Api-Key 调用管理 API）。
 *
 * 实现要点：
 *   - token 解析顺序：Authorization: Bearer > X-Api-Key > Cookie auth-token；
 *   - 鉴权失败统一走 problem+json，errorCode = auth_invalid / permission_denied；
 *   - 失败响应同时写入 Cache-Control: no-store / Pragma: no-cache；
 *   - 失败时累计到 v1LoginAbusePolicy，被锁定的 IP 直接 429；
 *   - 成功时调用 runWithAuthSession + runWithRequestContext，保证 ALS 在下游 handler 可见。
 */

import "@/lib/auth-session-storage.node";

import type { Context, MiddlewareHandler, Next } from "hono";
import { getCookie } from "hono/cookie";
import { extractApiKeyFromHeaders } from "@/app/v1/_lib/proxy/auth-guard";
import { runWithRequestContext } from "@/lib/audit/request-context";
import { type AuthSession, runWithAuthSession, validateAuthToken } from "@/lib/auth";
import { config } from "@/lib/config/config";
import { isApiKeyAdminAccessEnabled } from "@/lib/config/env.schema";
import { getClientIp } from "@/lib/ip";
import { constantTimeEqual } from "@/lib/security/constant-time-compare";
import { AUTH_MODE_CONTEXT_KEY, type AuthMode, SESSION_CONTEXT_KEY } from "./audit-context";
import { problem } from "./error-envelope";
import { checkAuthAllowed, recordAuthFailure, recordAuthSuccess } from "./login-abuse";

/** Cookie 名（与 src/lib/auth.ts 同步；不直接 import 以避免 Next 服务运行时副作用） */
const AUTH_COOKIE_NAME = "auth-token";

export type AuthTier = "public" | "read" | "admin";

export interface RequireAuthOptions {
  tier: AuthTier;
  /**
   * 仅对 tier === "read" 生效。默认 true：允许 canLoginWebUi=false 的 key 进入只读会话。
   * tier === "admin" 时强制为 false。
   */
  allowReadOnlyAccess?: boolean;
}

/**
 * 描述「token 来自哪种凭证位置」，便于 admin tier 区分 admin 通道：
 * - "bearer"  -> Authorization: Bearer ...
 * - "header"  -> X-Api-Key: ...
 * - "cookie"  -> auth-token cookie
 */
type TokenSource = "bearer" | "header" | "cookie";

interface ExtractedToken {
  token: string;
  source: TokenSource;
}

/**
 * 从 Hono 请求中读取并解码指定 cookie。
 *
 * 行为：
 * - 直接复用 `hono/cookie` 的 `getCookie`，相比手动 `decodeURIComponent`
 *   能正确处理 RFC 6265 中的 quoted value 与 percent-encoding；
 * - 当 cookie 值包含非法的 percent-encoding 时 `getCookie` 内部会触发
 *   `URIError`，我们在此 catch 并返回 `undefined`（语义：无 cookie），
 *   避免恶意构造的 cookie 头让中间件抛 500，而是走标准 401 流程。
 */
function safeReadCookie(c: Context, name: string): string | undefined {
  try {
    return getCookie(c, name);
  } catch {
    return undefined;
  }
}

function extractTokenFromContext(c: Context): ExtractedToken | null {
  const authorization = c.req.header("authorization") ?? null;
  const apiKeyHeader = c.req.header("x-api-key") ?? null;
  const fromExtracter = extractApiKeyFromHeaders({
    authorization,
    "x-api-key": apiKeyHeader,
  });

  if (fromExtracter) {
    if (authorization?.toLowerCase().startsWith("bearer ")) {
      return { token: fromExtracter, source: "bearer" };
    }
    if (apiKeyHeader && apiKeyHeader.trim() === fromExtracter) {
      return { token: fromExtracter, source: "header" };
    }
    // x-goog-api-key 等其它头，回退到 header
    return { token: fromExtracter, source: "header" };
  }

  // Cookie：auth-token=...
  const cookieToken = safeReadCookie(c, AUTH_COOKIE_NAME)?.trim();
  if (cookieToken) {
    return { token: cookieToken, source: "cookie" };
  }
  return null;
}

function attachNoStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  return response;
}

function buildAuthInvalid(c: Context): Response {
  const response = problem(c, {
    status: 401,
    errorCode: "auth_invalid",
    title: "Unauthorized",
    detail: "Authentication required or token is invalid.",
  });
  return attachNoStore(response);
}

function buildPermissionDenied(c: Context): Response {
  const response = problem(c, {
    status: 403,
    errorCode: "permission_denied",
    title: "Forbidden",
    detail: "Caller does not have permission to access this resource.",
  });
  return attachNoStore(response);
}

function buildRateLimited(c: Context, retryAfterSeconds: number | undefined): Response {
  const response = attachNoStore(
    problem(c, {
      status: 429,
      errorCode: "rate_limited",
      title: "Too Many Requests",
      detail: "Too many authentication failures. Please retry later.",
    })
  );
  if (retryAfterSeconds != null) {
    response.headers.set("Retry-After", String(retryAfterSeconds));
  }
  return response;
}

function isAdminTokenMatch(token: string): boolean {
  const adminToken = config.auth.adminToken;
  if (!adminToken) return false;
  return constantTimeEqual(token, adminToken);
}

function determineAuthMode(extracted: ExtractedToken, isAdminEnv: boolean): AuthMode {
  if (isAdminEnv) return "admin-token";
  // 仅 cookie auth-token 对应 "session"（CSRF 仅保护 cookie 通道）；
  // bearer / X-Api-Key 都是非 cookie 凭证，统一归为 "api-key"，
  // 这样 Bearer API key 调用不会被 CSRF 中间件误拦。
  if (extracted.source === "cookie") return "session";
  return "api-key";
}

function runDownstream(
  c: Context,
  session: AuthSession,
  allowReadOnlyAccess: boolean,
  next: Next
): Promise<void> {
  const headers = c.req.raw.headers as unknown as Headers;
  const ip = getClientIp(headers) ?? null;
  const userAgent = c.req.header("user-agent") ?? null;

  return runWithRequestContext(
    { ip, userAgent },
    () =>
      runWithAuthSession(
        session,
        async () => {
          await next();
        },
        { allowReadOnlyAccess }
      ) as unknown as Promise<void>
  );
}

function runDownstreamPublic(c: Context, next: Next): Promise<void> {
  const headers = c.req.raw.headers as unknown as Headers;
  const ip = getClientIp(headers) ?? null;
  const userAgent = c.req.header("user-agent") ?? null;
  return runWithRequestContext({ ip, userAgent }, async () => {
    await next();
  });
}

/**
 * 三层鉴权中间件入口。
 *
 * 注意：
 * - 必须放在 attachRequestId 之后，确保审计 requestId 已经写入；
 * - 通过 `c.set("session", ...)` / `c.set("authMode", ...)` 暴露给下游 handler；
 * - 失败响应统一带 problem+json 与 no-store。
 */
export function requireAuth(opts: RequireAuthOptions): MiddlewareHandler {
  const tier = opts.tier;
  const allowReadOnlyAccess = tier === "admin" ? false : (opts.allowReadOnlyAccess ?? true);

  return async (c, next) => {
    if (tier === "public") {
      c.set(SESSION_CONTEXT_KEY, null);
      c.set(AUTH_MODE_CONTEXT_KEY, "session" satisfies AuthMode);
      await runDownstreamPublic(c, next);
      return;
    }

    const extracted = extractTokenFromContext(c);
    const headers = c.req.raw.headers as unknown as Headers;
    const clientIp = getClientIp(headers) ?? "unknown";

    const decision = checkAuthAllowed(clientIp, extracted?.token);
    if (!decision.allowed) {
      return buildRateLimited(c, decision.retryAfterSeconds);
    }

    if (!extracted) {
      recordAuthFailure(clientIp);
      return buildAuthInvalid(c);
    }

    const isAdminEnv = isAdminTokenMatch(extracted.token);

    // 鉴权策略：
    //   - read tier：直接走 allowReadOnlyAccess（默认 true）；
    //   - admin tier：先以 read-only 模式验证 token 是否有效（区分「无效 token」与
    //     「token 有效但权限不足」）；token 有效后再断言权限。
    let session: AuthSession | null;
    if (tier === "admin") {
      session = await validateAuthToken(extracted.token, { allowReadOnlyAccess: true });
    } else {
      session = await validateAuthToken(extracted.token, { allowReadOnlyAccess });
    }

    if (!session) {
      recordAuthFailure(clientIp, extracted.token);
      return buildAuthInvalid(c);
    }

    if (tier === "admin") {
      const isAdminUser = session.user.role === "admin";
      // admin tier 严格语义：
      //   - 来自 ADMIN_TOKEN 环境的虚拟会话：始终允许；
      //   - 来自 DB API key（X-Api-Key 头）：仅当 ENABLE_API_KEY_ADMIN_ACCESS=true
      //     且 user.role==="admin" 时允许；
      //   - 来自 cookie/bearer 的 user 会话：必须 user.role==="admin" 且 key.canLoginWebUi=true；
      //   - 否则 403。
      if (isAdminEnv) {
        // env admin token：强制 admin tier 允许
      } else if (extracted.source === "header") {
        if (!isApiKeyAdminAccessEnabled() || !isAdminUser) {
          recordAuthFailure(clientIp, extracted.token);
          return buildPermissionDenied(c);
        }
      } else {
        // session/cookie/bearer-with-db-key
        if (!isAdminUser) {
          recordAuthFailure(clientIp, extracted.token);
          return buildPermissionDenied(c);
        }
        if (!session.key.canLoginWebUi) {
          recordAuthFailure(clientIp, extracted.token);
          return buildPermissionDenied(c);
        }
      }
    }

    recordAuthSuccess(clientIp, extracted.token);

    const mode = determineAuthMode(extracted, isAdminEnv);
    c.set(SESSION_CONTEXT_KEY, session);
    c.set(AUTH_MODE_CONTEXT_KEY, mode satisfies AuthMode);

    await runDownstream(c, session, allowReadOnlyAccess, next);
  };
}
