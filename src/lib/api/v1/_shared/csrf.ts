/**
 * /api/v1 CSRF 令牌：HMAC + 1 小时桶
 *
 * 设计要点：
 * - 仅保护 Cookie 鉴权（authMode === "session"）；API key / admin token 走 Bearer 时跳过；
 * - 令牌结构：`base64url(HMAC_SHA256(serverSecret, "v1-csrf:" + authToken + ":" + userId + ":" + bucket))`；
 * - bucket = floor(now / 3600_000)，校验时接受当前桶或上一个桶（最大 1 小时漂移）；
 * - serverSecret 来自 ADMIN_TOKEN，缺失时使用进程内随机 fallback（仅 dev）；
 * - 校验失败一律返回 problem+json，errorCode = "csrf_invalid"，HTTP 403。
 */

import { createHmac, randomBytes } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AuthSession } from "@/lib/auth";
import { config } from "@/lib/config/config";
import { constantTimeEqual } from "@/lib/security/constant-time-compare";
import { AUTH_MODE_CONTEXT_KEY, type AuthMode, SESSION_CONTEXT_KEY } from "./audit-context";
import { problem } from "./error-envelope";

/** 请求头：CSRF 令牌 */
export const CSRF_TOKEN_HEADER = "X-CCH-CSRF";

/** HMAC 前缀（避免与其它系统的 HMAC 重用） */
const CSRF_PREFIX = "v1-csrf:";

/** 1 小时桶大小（毫秒） */
const BUCKET_DURATION_MS = 60 * 60 * 1000;

/** 不需要 CSRF 校验的方法（按 RFC 7231 / 9110 安全方法） */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

let _serverSecretCache: string | null = null;

/**
 * 获取服务端 secret。
 *
 * 优先 `config.auth.adminToken`（由 ADMIN_TOKEN 环境变量解析得到）；缺失时使用
 * 进程级随机回退（仅 dev / 测试场景，重启后失效，因此生产环境必须设置
 * ADMIN_TOKEN）。直接走 config，避免散落的 `process.env` 访问，保证测试可控。
 */
function getServerSecret(): string {
  if (_serverSecretCache !== null) return _serverSecretCache;
  const fromConfig = config.auth.adminToken?.trim();
  if (fromConfig) {
    _serverSecretCache = fromConfig;
  } else {
    _serverSecretCache = `dev-fallback-${randomBytes(16).toString("hex")}`;
  }
  return _serverSecretCache;
}

/** 仅供测试使用 */
export function __resetCsrfSecretCacheForTests(): void {
  _serverSecretCache = null;
}

function currentBucket(): number {
  return Math.floor(Date.now() / BUCKET_DURATION_MS);
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function computeToken(authToken: string, userId: number, bucket: number): string {
  const secret = getServerSecret();
  const payload = `${CSRF_PREFIX}${authToken}:${userId}:${bucket}`;
  const mac = createHmac("sha256", secret).update(payload).digest();
  return base64urlEncode(mac);
}

/**
 * 生成当前时间桶下的 CSRF 令牌（写入响应给前端，前端必须随后续请求一起带回）。
 */
export function generateCsrfToken(authToken: string, userId: number): string {
  return computeToken(authToken, userId, currentBucket());
}

/**
 * 校验 CSRF 令牌；接受当前桶与上一桶（处理跨小时边界）。
 *
 * 比较使用 `@/lib/security/constant-time-compare` 中的 `constantTimeEqual`，
 * 与项目内其它安全敏感比较保持一致。
 */
export function validateCsrfToken(provided: string, authToken: string, userId: number): boolean {
  if (!provided || typeof provided !== "string") return false;
  const bucket = currentBucket();
  const candidates = [
    computeToken(authToken, userId, bucket),
    computeToken(authToken, userId, bucket - 1),
  ];
  return candidates.some((expected) => constantTimeEqual(provided, expected));
}

/**
 * `requireCsrf()` 中间件
 *
 * - GET / HEAD / OPTIONS 跳过；
 * - 仅当 authMode === "session"（cookie 登录）时检查 X-CCH-CSRF 头；
 * - 没有 / 不匹配 → 403 problem+json errorCode=csrf_invalid，并附带 no-store。
 */
export function requireCsrf(): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (SAFE_METHODS.has(method)) {
      return next();
    }

    const mode = c.get(AUTH_MODE_CONTEXT_KEY) as AuthMode | null | undefined;
    if (mode !== "session") {
      return next();
    }

    const session = c.get(SESSION_CONTEXT_KEY) as AuthSession | null | undefined;
    if (!session) {
      // 没有 session 时根本到不了 CSRF（前置 require 已 401），保险起见放行。
      return next();
    }

    const provided = c.req.header(CSRF_TOKEN_HEADER)?.trim() ?? "";
    const ok = validateCsrfToken(provided, session.key.key, session.user.id);
    if (!ok) {
      const response = problem(c, {
        status: 403,
        errorCode: "csrf_invalid",
        title: "CSRF token missing or invalid",
        detail: "Provide the X-CCH-CSRF header obtained from GET /api/v1/auth/csrf.",
      });
      // 标记 no-store，避免中间缓存复用 403 响应。
      // Hono 在 handler 直接 return 一个 fresh Response 时会用它替换 c.res，
      // 所以 cache-control 必须直接写到当前要返回的 response 上。
      response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
      response.headers.set("Pragma", "no-cache");
      return response;
    }

    return next();
  };
}
