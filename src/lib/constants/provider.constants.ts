/**
 * 供应商配置相关常量
 */
export const PROVIDER_LIMITS = {
  // 权重：用于加权轮询，1-100 覆盖绝大多数场景
  WEIGHT: { MIN: 1, MAX: 100 },
  // 5小时消费上限：保持 1000 USD 上限，步进 1 美元
  LIMIT_5H_USD: { MIN: 0.1, MAX: 1000, STEP: 1 },
  // 周消费上限：降低到 5000 USD，步进 1 美元
  LIMIT_WEEKLY_USD: { MIN: 1, MAX: 5000, STEP: 1 },
  // 月消费上限：降低到 30000 USD，步进 1 美元
  LIMIT_MONTHLY_USD: { MIN: 10, MAX: 30000, STEP: 1 },
  // 并发 Session 上限：降低到 150（单供应商合理上限）
  CONCURRENT_SESSIONS: { MIN: 1, MAX: 150 },
} as const;

export const PROVIDER_DEFAULTS = {
  IS_ENABLED: false,
  WEIGHT: 1,
} as const;

/**
 * 供应商超时配置常量（毫秒）
 */
export const PROVIDER_TIMEOUT_LIMITS = {
  // 流式请求首字节超时：1-120 秒（1000-120000 毫秒）
  // 核心：解决流式请求重试缓慢问题
  FIRST_BYTE_TIMEOUT_STREAMING_MS: { MIN: 1000, MAX: 120000 },
  // 流式请求静默期超时：1-120 秒（1000-120000 毫秒）
  // 核心：解决流式中途卡住问题
  STREAMING_IDLE_TIMEOUT_MS: { MIN: 1000, MAX: 120000 },
  // 非流式请求总超时：60-1200 秒（60000-1200000 毫秒）
  // 核心：防止长请求无限挂起
  REQUEST_TIMEOUT_NON_STREAMING_MS: { MIN: 60000, MAX: 1200000 },
} as const;

export const PROVIDER_TIMEOUT_DEFAULTS = {
  // 流式首字节超时默认 30 秒（快速失败）
  FIRST_BYTE_TIMEOUT_STREAMING_MS: 30000,
  // 流式静默期超时默认 10 秒（防止中途卡住）
  STREAMING_IDLE_TIMEOUT_MS: 10000,
  // 非流式总超时默认 600 秒（10 分钟）
  REQUEST_TIMEOUT_NON_STREAMING_MS: 600000,
} as const;
