/**
 * /api/v1 请求审计上下文工具
 *
 * 提供：
 * - `attachRequestId()` 中间件：为每个请求生成 `req_<ts>_<rand>` 形式的 requestId，
 *   并把它写到 `c.set("requestId", ...)` 与响应头 `X-Request-Id`；
 * - `getAuditContext(c)`：构造一个适合写审计日志的快照（ip / userAgent / userId / requestId）。
 *
 * 这些 helper 不依赖业务模块，只依赖 Hono Context、`@/lib/ip`、`@/lib/audit/request-context`。
 */

import type { Context, MiddlewareHandler } from "hono";
import { getRequestContext } from "@/lib/audit/request-context";
import type { AuthSession } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";

/** Hono context key：当前请求的 requestId */
export const REQUEST_ID_CONTEXT_KEY = "requestId";

/** Hono context key：当前请求的 AuthSession（authentication middleware 设置） */
export const SESSION_CONTEXT_KEY = "session";

/** Hono context key：当前请求所使用的鉴权模式 */
export const AUTH_MODE_CONTEXT_KEY = "authMode";

/** 响应头名 */
export const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * 鉴权模式：
 * - "session"     -> Cookie + Web UI 登录（含 Bearer 但 token 来自 cookie 的等价路径）
 * - "api-key"     -> X-Api-Key 头部 / 第三方 DB API key 调用
 * - "admin-token" -> 请求 Bearer 与 ADMIN_TOKEN 环境值匹配
 */
export type AuthMode = "session" | "api-key" | "admin-token";

/**
 * 审计快照：写审计日志时使用。
 */
export interface AuditContext {
  ip: string | null;
  userAgent: string | null;
  userId?: number;
  requestId: string;
}

/**
 * 生成新的 requestId。
 *
 * 形如 `req_<unixMs>_<rand8>`；不依赖 webcrypto，便于测试 / Edge 环境运行。
 */
export function generateRequestId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `req_${ts}_${rand}`;
}

/**
 * `attachRequestId()` 中间件
 *
 * - 若请求已带 `X-Request-Id` 头则透传；否则生成一个；
 * - 写到 c.set("requestId") 与响应头 X-Request-Id；
 * - 必须挂在所有其它中间件之前。
 */
export function attachRequestId(): MiddlewareHandler {
  return async (c, next) => {
    const incoming = c.req.header("x-request-id")?.trim();
    const requestId = incoming && incoming.length > 0 ? incoming : generateRequestId();
    c.set(REQUEST_ID_CONTEXT_KEY, requestId);
    await next();
    c.res.headers.set(REQUEST_ID_HEADER, requestId);
  };
}

/**
 * 构造审计快照。
 *
 * - `ip` / `userAgent` 优先取自 ALS（runWithRequestContext），
 *   否则回退到当前请求头；
 * - `userId` 来自 `c.get("session")` 中的 user.id（无 session 则缺省）；
 * - `requestId` 来自 `c.get("requestId")`，没有则即时生成。
 */
export function getAuditContext(c: Context): AuditContext {
  const fromAls = getRequestContext();
  const ip = fromAls.ip ?? getClientIp(c.req.raw.headers as unknown as Headers) ?? null;
  const userAgent = fromAls.userAgent ?? c.req.header("user-agent") ?? null;

  const session = (c.get(SESSION_CONTEXT_KEY) as AuthSession | null | undefined) ?? null;
  const userId = session?.user?.id;

  let requestId = c.get(REQUEST_ID_CONTEXT_KEY) as string | undefined;
  if (!requestId || typeof requestId !== "string") {
    requestId = generateRequestId();
    c.set(REQUEST_ID_CONTEXT_KEY, requestId);
  }

  const ctx: AuditContext = {
    ip,
    userAgent,
    requestId,
  };
  if (typeof userId === "number") {
    ctx.userId = userId;
  }
  return ctx;
}
