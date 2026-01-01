/**
 * 用户相关取值范围
 */
export const USER_LIMITS = {
  RPM: {
    MIN: 0, // 0 = 无限制
    MAX: 1_000_000, // 提升到 100 万
  },
  DAILY_QUOTA: {
    MIN: 0,
    MAX: 100_000, // 提升到 10 万美元
  },
} as const;
