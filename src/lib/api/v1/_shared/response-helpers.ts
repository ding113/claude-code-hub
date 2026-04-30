/**
 * /api/v1 成功响应辅助
 *
 * 这些 helper 不会重写 X-API-Version（由根 app 中间件统一附加），
 * 只负责 Content-Type / Location / 状态码 / 空 body 等业务侧关心的语义。
 */

import type { Context } from "hono";
import { CACHE_NONE } from "./cache-control";
import { CONTENT_TYPE_JSON, HEADER_NAMES } from "./constants";

/** respondJson 选项 */
export interface RespondJsonOptions {
  /**
   * 写入 `Cache-Control: no-store, no-cache, must-revalidate` 与
   * `Pragma: no-cache` 到该响应。
   *
   * 这是必要的：handler 即便提前调用了 `setNoStore(c)`，Hono 在直接返回新
   * `Response` 时会用它替换 `c.res`，导致先前写到 `c.res` 上的 cache 头被丢弃。
   * 因此「敏感数据响应」必须显式传 `noStore: true`，让 helper 把 cache 头写到
   * 这个最终返回的 Response 上。
   */
  noStore?: boolean;
}

/**
 * 成功 (2xx) JSON 响应。
 *
 * 入参 `status` 必须落在 200-299 之间；其它状态码请走 `problem(...)`。
 * 通过显式断言禁止把错误状态混进成功通道，避免绕过 problem+json 契约。
 */
export function respondJson(
  _c: Context,
  body: unknown,
  status = 200,
  options?: RespondJsonOptions
): Response {
  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    throw new TypeError(
      `respondJson only supports 2xx statuses (got ${status}). Use problem(...) for errors.`
    );
  }
  const headers: Record<string, string> = {
    [HEADER_NAMES.ContentType]: CONTENT_TYPE_JSON,
  };
  if (options?.noStore) {
    headers[HEADER_NAMES.CacheControl] = CACHE_NONE;
    headers[HEADER_NAMES.Pragma] = "no-cache";
  }
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

/**
 * 201 Created。强制带 Location 头（RFC 9110 要求）。
 *
 * @param locationPath 创建资源的 URL 路径，例如 "/api/v1/users/42"
 */
export function respondCreated(_c: Context, body: unknown, locationPath: string): Response {
  if (!locationPath || typeof locationPath !== "string") {
    throw new TypeError("respondCreated requires a non-empty locationPath");
  }
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: {
      [HEADER_NAMES.ContentType]: CONTENT_TYPE_JSON,
      [HEADER_NAMES.Location]: locationPath,
    },
  });
}

/** 204 No Content；body 必须为空 */
export function respondNoContent(_c: Context): Response {
  return new Response(null, {
    status: 204,
  });
}

/** 202 Accepted（用于异步 job 启动） */
export function respondAccepted(
  _c: Context,
  payload: { jobId: string; statusUrl: string; status?: string }
): Response {
  if (!payload.jobId) {
    throw new TypeError("respondAccepted requires a non-empty jobId");
  }
  if (!payload.statusUrl) {
    throw new TypeError("respondAccepted requires a non-empty statusUrl");
  }
  const body = {
    jobId: payload.jobId,
    status: payload.status ?? "queued",
    statusUrl: payload.statusUrl,
  };
  return new Response(JSON.stringify(body), {
    status: 202,
    headers: {
      [HEADER_NAMES.ContentType]: CONTENT_TYPE_JSON,
    },
  });
}
