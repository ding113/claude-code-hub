// 上游余额查询端点常量
//
// 每个端点都是只读的 GET。New API 账户端点使用管理员配置的系统访问令牌认证，
// 其余端点使用供应商自身的密钥认证。

/** New API / One API 家族的额度单位：500000 quota = 1 USD */
export const NEW_API_QUOTA_PER_USD = 500_000;

/**
 * New API 家族账户端点读取用户 ID 的请求头。
 *
 * New API 在 2026-07 之前的版本要求系统访问令牌同时携带 New-Api-User，
 * 各个分支改用了不同的头名，同一个用户 ID 按 all-api-hub 的兼容列表全部发送。
 */
export const NEW_API_USER_ID_HEADERS = [
  "New-Api-User",
  "Veloera-User",
  "X-Api-User",
  "voapi-user",
  "User-id",
  "Rix-Api-User",
  "neo-api-user",
] as const;

/**
 * OpenAI 兼容网关常把 hard_limit_usd 填成一个极大的哨兵值表示「不限量」，
 * 超过该阈值时不把它当作可消费余额展示。
 */
export const OPENAI_BILLING_SENTINEL_LIMIT_USD = 1_000_000;

export const PROVIDER_BALANCE_ENDPOINTS = {
  /** New API / One API 家族的令牌额度 */
  newApiTokenUsage: "/api/usage/token/",
  /** New API / One API 家族的当前用户信息，含账户剩余额度 */
  newApiUserSelf: "/api/user/self",
  /** Sub2API 为 CC Switch 提供的密钥用量端点，返回钱包余额、订阅或密钥限额 */
  sub2ApiUsage: "/v1/usage",
  /** OpenAI 兼容计费端点 */
  openAiBillingSubscription: "/v1/dashboard/billing/subscription",
  openAiBillingUsage: "/v1/dashboard/billing/usage",
  /** DeepSeek 开放平台钱包 */
  deepSeekBalance: "/user/balance",
  /** Moonshot / Kimi 开放平台钱包 */
  kimiBalance: "/v1/users/me/balance",
  /** ChatGPT 后端用量端点，返回结构化额度且不消耗任何配额 */
  chatGptWhamUsage: "/backend-api/wham/usage",
} as const;

/** 单次探测的超时时间（毫秒） */
export const PROVIDER_BALANCE_REQUEST_TIMEOUT_MS = 8_000;

/**
 * 单次响应体的读取上限（字节）。
 *
 * 余额端点的正常响应都在几 KB 以内；上游返回登录页或大体积错误页时，
 * 超过上限直接判定该来源不可用，不把整个响应读进内存。
 */
export const PROVIDER_BALANCE_MAX_RESPONSE_BYTES = 256 * 1024;
