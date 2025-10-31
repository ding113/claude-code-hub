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
