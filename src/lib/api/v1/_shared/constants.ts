/**
 * /api/v1 共享常量
 *
 * 仅放置「跨多个 helper 共享、不依赖任何业务模块」的纯常量与字符串。
 * 任何会引入业务依赖的常量都不应该出现在这里。
 */

/** 当前管理 API 版本号（与 X-API-Version 响应头对齐） */
export const MANAGEMENT_API_VERSION = "1.0.0";

/** RFC 9457 problem+json 内容类型 */
export const CONTENT_TYPE_PROBLEM_JSON = "application/problem+json";

/** 普通 JSON 内容类型 */
export const CONTENT_TYPE_JSON = "application/json";

/** 常用响应头名称（统一拼写，避免散落字符串） */
export const HEADER_NAMES = {
  ContentType: "Content-Type",
  ApiVersion: "X-API-Version",
  Location: "Location",
  CacheControl: "Cache-Control",
  Pragma: "Pragma",
  Allow: "Allow",
} as const;

/** 常用请求头名称 */
export const REQUEST_HEADER_NAMES = {
  Authorization: "Authorization",
  ApiKey: "X-Api-Key",
  CsrfToken: "X-Csrf-Token",
  IdempotencyKey: "Idempotency-Key",
} as const;

/** problem+json 中 type 字段的默认占位值（无具体文档时使用） */
export const PROBLEM_TYPE_BLANK = "about:blank";
