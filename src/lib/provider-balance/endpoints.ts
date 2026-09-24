// 上游余额查询端点常量
//
// 每个端点都是只读的 GET，使用供应商自身的密钥认证。

/** New API / One API 家族的额度单位：500000 quota = 1 USD */
export const NEW_API_QUOTA_PER_USD = 500_000;

/**
 * OpenAI 兼容网关常把 hard_limit_usd 填成一个极大的哨兵值表示「不限量」，
 * 超过该阈值时不把它当作可消费余额展示。
 */
export const OPENAI_BILLING_SENTINEL_LIMIT_USD = 1_000_000;

export const PROVIDER_BALANCE_ENDPOINTS = {
  /** New API / One API 家族的令牌额度 */
  newApiTokenUsage: "/api/usage/token/",
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
