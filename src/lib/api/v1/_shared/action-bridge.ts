/**
 * /api/v1 资源 handler -> 旧 server action 桥接器
 *
 * 设计目标：
 * - 让 Wave 2 的 v1 路由 handler 在不重复实现业务逻辑的前提下，复用 `src/actions/*`
 *   中已有的 server action（仍以 `ActionResult<T>` 形式返回）；
 * - handler 只负责：
 *     1. 校验请求体 / 路径参数；
 *     2. 调用 `callAction(...)`；
 *     3. 把成功结果序列化、把失败结果直接 `return result.problem`。
 *
 * 行为：
 * - 在调用前把当前 Hono Context 中的 session（`requireAuth` 写入）和 IP / UA
 *   （`getAuditContext` 读取）写入 ALS：嵌套 `runWithRequestContext + runWithAuthSession`，
 *   保证旧 action 内部 `getSession()` / `resolveRequestContext()` 等能拿到正确数据；
 * - action 抛出异常 → 500 problem+json，errorCode = "internal_error"，并通过
 *   `logger.error` 记录（消息中不包含敏感数据）；
 * - action 返回 `{ ok: false, error, errorCode? }` → 用 `errorCode` 推导 HTTP 状态
 *   （缺省 400），构造 problem+json 响应；
 * - `treatRawAsActionResult: true`：对于个别返回原始数据（非 ActionResult）的 action，
 *   把整个原始返回值视为成功 data；默认按 ActionResult 解析。
 *
 * 该 helper 不应包含任何资源专属逻辑（webhook-targets 等）。
 */

import type { Context } from "hono";
import type { ActionResult, ErrorResult } from "@/actions/types";
import type { AuthSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { SESSION_CONTEXT_KEY } from "./audit-context";
import { problem } from "./error-envelope";
import { withRequestContext } from "./request-context";
import { pickStatus, type Status } from "./status-code-map";

/** callAction 选项 */
export interface ActionBridgeOptions {
  /** 透传给 `withRequestContext` 的 read-only 标记 */
  allowReadOnlyAccess?: boolean;
  /**
   * 当为 true 时，将 action 返回值整体当作成功 data（不要求 `{ ok: true, data }` 形态）。
   * 适用于早期未迁移到 ActionResult 的 action。
   */
  treatRawAsActionResult?: boolean;
}

/** callAction 返回值 */
export type ActionBridgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: Status; problem: Response };

function isActionResult(value: unknown): value is ActionResult<unknown> {
  if (!value || typeof value !== "object") return false;
  const ok = (value as { ok?: unknown }).ok;
  return typeof ok === "boolean";
}

function inferStatusFromErrorCode(errorCode: string | undefined): Status {
  if (!errorCode) return 400;
  return pickStatus(errorCode);
}

function buildProblemFromError(
  c: Context,
  err: ErrorResult
): { status: Status; response: Response } {
  const status = inferStatusFromErrorCode(err.errorCode);
  const response = problem(c, {
    status,
    errorCode: err.errorCode ?? "internal_error",
    detail: err.error,
    errorParams: err.errorParams,
  });
  return { status, response };
}

function buildInternalErrorProblem(
  c: Context,
  error: unknown
): {
  status: Status;
  response: Response;
} {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Action threw an unexpected error.";
  const response = problem(c, {
    status: 500,
    errorCode: "internal_error",
    title: "Internal Server Error",
    detail,
  });
  return { status: 500, response };
}

/**
 * 调用旧 server action，把它的返回值规范化为 v1 路由可以直接消费的形态。
 *
 * @typeParam T action 成功时 `data` 的类型
 * @param c     Hono 请求上下文（用于读取 session / 构造 problem+json）
 * @param action 旧 server action 函数
 * @param args  调用 action 时的参数（直接展开传入）
 * @param opts  可选行为开关
 */
export async function callAction<T>(
  c: Context,
  action: (...args: unknown[]) => Promise<unknown>,
  args: unknown[],
  opts?: ActionBridgeOptions
): Promise<ActionBridgeResult<T>> {
  const session = (c.get(SESSION_CONTEXT_KEY) as AuthSession | null | undefined) ?? null;
  const treatRaw = opts?.treatRawAsActionResult === true;

  let raw: unknown;
  try {
    raw = await withRequestContext(c, session, () => action(...args), {
      allowReadOnlyAccess: opts?.allowReadOnlyAccess ?? false,
    });
  } catch (error) {
    logger.error("[v1.action-bridge] action threw", {
      error: error instanceof Error ? error.message : String(error),
    });
    const built = buildInternalErrorProblem(c, error);
    return { ok: false, status: built.status, problem: built.response };
  }

  if (treatRaw) {
    return { ok: true, data: raw as T };
  }

  if (!isActionResult(raw)) {
    logger.error("[v1.action-bridge] action did not return ActionResult", {
      kind: typeof raw,
    });
    const built = buildInternalErrorProblem(
      c,
      new Error("Action did not return an ActionResult envelope.")
    );
    return { ok: false, status: built.status, problem: built.response };
  }

  if (raw.ok) {
    // SuccessResult<T = void> 的 data 可能为 undefined；交由调用方按 T 处理
    return { ok: true, data: (raw as { ok: true; data?: unknown }).data as T };
  }

  const built = buildProblemFromError(c, raw);
  return { ok: false, status: built.status, problem: built.response };
}
