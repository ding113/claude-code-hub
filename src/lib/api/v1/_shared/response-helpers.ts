/**
 * /api/v1 成功响应辅助
 *
 * 这些 helper 不会重写 X-API-Version（由根 app 中间件统一附加），
 * 只负责 Content-Type / Location / 状态码 / 空 body 等业务侧关心的语义。
 */

import type { Context } from "hono";
import { CONTENT_TYPE_JSON, HEADER_NAMES } from "./constants";

/** 200 / 任意 2xx JSON 响应 */
export function respondJson(_c: Context, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      [HEADER_NAMES.ContentType]: CONTENT_TYPE_JSON,
    },
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
