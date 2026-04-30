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
 * 旧版 server action 使用的 SCREAMING_SNAKE_CASE 错误码 -> 状态码映射。
 *
 * 这些 code 由 `src/actions/*.ts` 通过 `ActionResult.errorCode` 返回；v1 的桥接层
 * 不能假设它们落在 `STATUS_CODE_MAP` 里（那是 v1 自身的语义化键），否则所有合法
 * 业务失败（如 NAME_REQUIRED / DUPLICATE_NAME / NOT_FOUND）都会被归到 500，
 * 破坏 HTTP 语义并误导客户端把可恢复错误当成内部错误。
 *
 * 选取范围严格限定在 `src/lib/utils/error-messages.ts` + `src/actions/providers.ts`
 * 中的常用业务码集合，未列出的码继续回退到 500（与 `STATUS_CODE_MAP` 行为一致）。
 */
export const LEGACY_ERROR_CODE_STATUS_MAP: Readonly<Record<string, Status>> = {
  // 校验类（必填 / 格式 / 范围 / 空更新）
  REQUIRED_FIELD: 400,
  USER_NAME_REQUIRED: 400,
  API_KEY_REQUIRED: 400,
  PROVIDER_NAME_REQUIRED: 400,
  PROVIDER_URL_REQUIRED: 400,
  NAME_REQUIRED: 400,
  MIN_LENGTH: 400,
  MAX_LENGTH: 400,
  INVALID_EMAIL: 400,
  INVALID_URL: 400,
  MIN_VALUE: 400,
  MAX_VALUE: 400,
  MUST_BE_INTEGER: 400,
  MUST_BE_POSITIVE: 400,
  INVALID_TYPE: 400,
  INVALID_FORMAT: 400,
  INVALID_RANGE: 400,
  EMPTY_UPDATE: 400,
  EXPIRES_AT_MUST_BE_FUTURE: 400,
  EXPIRES_AT_TOO_FAR: 400,
  // 鉴权 / 授权
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  TOKEN_REQUIRED: 401,
  INVALID_TOKEN: 401,
  PERMISSION_DENIED: 403,
  // 资源状态
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_NAME: 409,
  INVALID_STATE: 409,
  RESOURCE_BUSY: 409,
  // 限流 / 配额
  QUOTA_EXCEEDED: 429,
  RATE_LIMIT_EXCEEDED: 429,
  RATE_LIMIT_RPM_EXCEEDED: 429,
  RATE_LIMIT_5H_EXCEEDED: 429,
  RATE_LIMIT_5H_ROLLING_EXCEEDED: 429,
  RATE_LIMIT_WEEKLY_EXCEEDED: 429,
  RATE_LIMIT_MONTHLY_EXCEEDED: 429,
  RATE_LIMIT_TOTAL_EXCEEDED: 429,
  RATE_LIMIT_CONCURRENT_SESSIONS_EXCEEDED: 429,
  RATE_LIMIT_DAILY_QUOTA_EXCEEDED: 429,
  RATE_LIMIT_DAILY_ROLLING_EXCEEDED: 429,
  // 服务端 / 操作失败
  INTERNAL_ERROR: 500,
  DATABASE_ERROR: 500,
  OPERATION_FAILED: 500,
  CREATE_FAILED: 500,
  UPDATE_FAILED: 500,
  DELETE_FAILED: 500,
  // 网络
  CONNECTION_FAILED: 503,
  TIMEOUT: 503,
  NETWORK_ERROR: 503,
} as const;

/**
 * 根据错误类别字符串挑选 HTTP 状态码。
 *
 * 优先匹配 v1 自身的语义化键（snake_case，如 `not_found` / `validation_failed`），
 * 退化为旧版 action 的 SCREAMING_SNAKE_CASE 业务码（如 `DUPLICATE_NAME` / `NOT_FOUND`）。
 * 当两者都未命中时回退为 500，保证无论上层逻辑写错，问题都不会被静默吞掉
 * （而是体现在响应里被运维/测试发现）。
 */
export function pickStatus(errorCode: string): Status {
  const direct = STATUS_CODE_MAP[errorCode];
  if (direct !== undefined) return direct;
  const legacy = LEGACY_ERROR_CODE_STATUS_MAP[errorCode];
  if (legacy !== undefined) return legacy;
  return 500;
}
