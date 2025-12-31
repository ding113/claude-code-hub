/**
 * 通知相关常量
 */
export const NOTIFICATION_JOB_TYPES = [
  "circuit-breaker",
  "cost-alert",
  "daily-leaderboard",
] as const;

export type NotificationJobType = (typeof NOTIFICATION_JOB_TYPES)[number];
