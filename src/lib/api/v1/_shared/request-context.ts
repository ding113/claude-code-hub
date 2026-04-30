/**
 * /api/v1 请求级上下文便利包装
 *
 * 把 `runWithAuthSession`（鉴权语义）和 `runWithRequestContext`（IP/UA 审计语义）
 * 合并成一次调用，避免 handler / middleware 反复嵌套两个 ALS。
 */

import "@/lib/auth-session-storage.node";

import type { Context } from "hono";
import { runWithRequestContext } from "@/lib/audit/request-context";
import { type AuthSession, runWithAuthSession } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";

export interface WithRequestContextOptions {
  /**
   * 与 `validateAuthToken({ allowReadOnlyAccess })` 保持一致的语义；
   * 仅对带 session 的调用生效。
   */
  allowReadOnlyAccess?: boolean;
}

/**
 * 在 ALS 中运行 fn：
 *
 * - 当 `session` 不为空：嵌套 `runWithAuthSession + runWithRequestContext`；
 * - 当 `session` 为空：仅运行 `runWithRequestContext`（公开接口仍需 IP/UA 审计）。
 *
 * IP / UA 取自 `c.req.raw.headers`，不依赖 next/headers。
 */
export function withRequestContext<T>(
  c: Context,
  session: AuthSession | null,
  fn: () => T | Promise<T>,
  options?: WithRequestContextOptions
): Promise<T> {
  const headers = c.req.raw.headers as unknown as Headers;
  const ip = getClientIp(headers) ?? null;
  const userAgent = c.req.header("user-agent") ?? null;

  const inner = () => Promise.resolve().then(fn);

  if (!session) {
    return runWithRequestContext({ ip, userAgent }, inner) as Promise<T>;
  }

  return runWithRequestContext({ ip, userAgent }, () =>
    runWithAuthSession(session, inner, {
      allowReadOnlyAccess: options?.allowReadOnlyAccess ?? false,
    })
  ) as Promise<T>;
}
