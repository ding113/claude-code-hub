/**
 * 供应商配置相关常量
 */
export const PROVIDER_LIMITS = {
  WEIGHT: { MIN: 0, MAX: 2147483647 }, // 使用 INT 最大值，不再限制在 100
  PRIORITY: { MIN: 0, MAX: 256 }, // 优先级限制范围
  LIMIT_5H_USD: { MIN: 0.01, MAX: 1000, STEP: 0.01 },
  LIMIT_WEEKLY_USD: { MIN: 0.01, MAX: 10000, STEP: 0.01 },
  LIMIT_MONTHLY_USD: { MIN: 0.01, MAX: 100000, STEP: 0.01 },
  CONCURRENT_SESSIONS: { MIN: 1, MAX: 500 },
} as const;

export const PROVIDER_DEFAULTS = {
  IS_ENABLED: false,
  WEIGHT: 1,
} as const;
