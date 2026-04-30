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
 * 客户端可携带的最大 requestId 长度（字符）。
 *
 * 选择 128 是为了在常见 CDN/反代约束下足够宽松，又不会让攻击者把多 KB 的载荷写
 * 进审计字段。该长度也覆盖标准 trace-id 形态（W3C trace-id 32 hex chars 等）。
 */
const MAX_INCOMING_REQUEST_ID_LENGTH = 128;

/**
 * 允许在透传场景中保留的 ASCII 字符集合。
 *
 * - 仅保留可见且对日志友好的字符：字母数字 + `_` `-` `.`；
 * - 显式拒绝空白、控制字符、CR/LF、JSON 元字符，避免日志注入与 multi-line splice。
 */
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9_\-.]+$/;

/**
 * 校验客户端提供的 X-Request-Id 是否安全可透传。
 *
 * 不通过时调用方应忽略来源值并改用服务端生成的 ID，从而保证 audit/log 字段
 * 不会被恶意 payload 污染（CR/LF、控制字符、过长字符串、JSON 注入）。
 */
function isSafeIncomingRequestId(value: string): boolean {
  if (value.length === 0 || value.length > MAX_INCOMING_REQUEST_ID_LENGTH) return false;
  return SAFE_REQUEST_ID_PATTERN.test(value);
}

/**
 * `attachRequestId()` 中间件
 *
 * - 若请求带 `X-Request-Id` 且通过 `isSafeIncomingRequestId` 白名单校验，则透传；
 *   否则忽略来源值并生成服务端 ID（避免日志/审计被注入控制字符或超长 payload）；
 * - 写到 c.set("requestId") 与响应头 X-Request-Id；
 * - 必须挂在所有其它中间件之前。
 */
export function attachRequestId(): MiddlewareHandler {
  return async (c, next) => {
    const incoming = c.req.header("x-request-id")?.trim();
    const requestId =
      incoming && isSafeIncomingRequestId(incoming) ? incoming : generateRequestId();
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
