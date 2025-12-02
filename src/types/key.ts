/**
 * 密钥数据库实体类型
 */
export interface Key {
  id: number;
  userId: number;
  name: string;
  key: string;
  isEnabled: boolean;
  expiresAt?: Date;

  // Web UI 登录权限控制
  canLoginWebUi: boolean;

  // 金额限流配置
  limit5hUsd: number | null;
  limitDailyUsd: number | null;
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string; // HH:mm 格式
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  limitTotalUsd?: number | null;
  limitConcurrentSessions: number;

  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

/**
 * 密钥创建数据
 */
export interface CreateKeyData {
  user_id: number;
  name: string;
  key: string;
  is_enabled?: boolean;
  expires_at?: Date | null; // null = 永不过期
  // Web UI 登录权限控制
  can_login_web_ui?: boolean;
  // 金额限流配置
  limit_5h_usd?: number | null;
  limit_daily_usd?: number | null;
  daily_reset_mode?: "fixed" | "rolling";
  daily_reset_time?: string;
  limit_weekly_usd?: number | null;
  limit_monthly_usd?: number | null;
  limit_total_usd?: number | null;
  limit_concurrent_sessions?: number;
}

/**
 * 密钥更新数据
 */
export interface UpdateKeyData {
  name?: string;
  is_enabled?: boolean;
  expires_at?: Date | null; // null = 清除日期（永不过期）
  // Web UI 登录权限控制
  can_login_web_ui?: boolean;
  // 金额限流配置
  limit_5h_usd?: number | null;
  limit_daily_usd?: number | null;
  daily_reset_mode?: "fixed" | "rolling";
  daily_reset_time?: string;
  limit_weekly_usd?: number | null;
  limit_monthly_usd?: number | null;
  limit_total_usd?: number | null;
  limit_concurrent_sessions?: number;
}
