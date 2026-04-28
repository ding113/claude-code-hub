/**
 * /api/v1 错误码 -> HTTP 状态码映射
 *
 * 该映射是 problem+json 错误响应的「权威单一来源」：handler 只需要决定语义上
 * 的错误类别（例如 "not_found"），具体的 HTTP 状态由本模块决定。
 *
 * 所有键都使用 snake_case 的「错误类别」（不要与 errorCode 混淆，errorCode 是
 * 业务侧用于 i18n 翻译的键，例如 "user.not_found"，会进入 problem.errorCode 字段）。
 *
 * 状态码与 plan 文档的 “Status map” 章节严格对齐：
 *   - 400  validation        -> 校验失败 / 非法 JSON / 非法枚举
 *   - 401  unauthorized      -> 未认证或凭证无效
 *   - 403  forbidden         -> 已认证但无权限或 CSRF 失败
 *   - 404  not_found         -> 资源不存在
 *   - 405  method_not_allowed-> 方法不支持（应同时返回 Allow 头）
 *   - 409  conflict          -> 重复 / 冲突 / 非法状态转换
 *   - 410  gone              -> 永久不可用
 *   - 415  unsupported_media_type -> Content-Type 不支持
 *   - 422  unprocessable     -> 语义上不合法（语法已通过）
 *   - 429  rate_limited      -> 限流
 *   - 500  internal          -> 未预期的内部错误
 *   - 503  dependency_unavailable -> 依赖不可用
 */

/** 合法的 HTTP 状态码联合类型（仅本模块使用的子集） */
export type Status = 400 | 401 | 403 | 404 | 405 | 409 | 410 | 415 | 422 | 429 | 500 | 503;

/** 错误类别 -> 状态码 的常量表 */
export const STATUS_CODE_MAP: Readonly<Record<string, Status>> = {
  validation: 400,
  validation_failed: 400,
  malformed_json: 400,
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  csrf_failed: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  gone: 410,
  unsupported_media_type: 415,
  unprocessable: 422,
  unprocessable_entity: 422,
  rate_limited: 429,
  internal: 500,
  internal_error: 500,
  dependency_unavailable: 503,
} as const;

/**
 * 根据错误类别字符串挑选 HTTP 状态码。
 *
 * 当传入未知类别时回退为 500，保证无论上层逻辑写错，问题都不会被静默吞掉
 * （而是体现在响应里被运维/测试发现）。
 */
export function pickStatus(errorCode: string): Status {
  const status = STATUS_CODE_MAP[errorCode];
  return status ?? 500;
}
