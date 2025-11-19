/**
 * 用户相关默认值与取值范围
 */
export const USER_DEFAULTS = {
  RPM: 100,
  DAILY_QUOTA: 100,
} as const;

export const USER_LIMITS = {
  RPM: {
    MIN: 1,
    MAX: 1_000_000, // 提升到 100 万
  },
  DAILY_QUOTA: {
    MIN: 0.01,
    MAX: 100_000, // 提升到 10 万美元
  },
} as const;
