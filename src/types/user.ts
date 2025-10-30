/**
 * 用户数据库实体类型
 */
export interface User {
  id: number;
  name: string;
  description: string;
  role: "admin" | "user";
  rpm: number; // 每分钟请求数限制
  dailyQuota: number; // 每日额度限制（美元）
  providerGroup: string | null; // 供应商分组
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

/**
 * 用户创建数据
 */
export interface CreateUserData {
  name: string;
  description: string;
  rpm?: number; // 可选，有默认值
  dailyQuota?: number; // 可选，有默认值
  providerGroup?: string | null; // 可选，供应商分组
}

/**
 * 用户更新数据
 */
export interface UpdateUserData {
  name?: string;
  description?: string;
  rpm?: number;
  dailyQuota?: number;
  providerGroup?: string | null; // 可选，供应商分组
}

/**
 * 用户密钥显示对象
 */
export interface UserKeyDisplay {
  id: number;
  name: string;
  maskedKey: string;
  fullKey?: string; // 仅管理员可见的完整密钥
  canCopy: boolean; // 是否可以复制完整密钥
  expiresAt: string; // 格式化后的日期字符串或"永不过期"
  status: "enabled" | "disabled";
  todayUsage: number; // 今日消耗金额（美元）
  todayCallCount: number; // 今日调用次数
  lastUsedAt: Date | null; // 最后使用时间
  lastProviderName: string | null; // 最后调用的供应商名称
  modelStats: Array<{
    model: string;
    callCount: number;
    totalCost: number;
  }>; // 各模型统计（当天）
  createdAt: Date; // 创建时间
  createdAtFormatted: string; // 格式化后的具体时间
  // 限额配置
  limit5hUsd: number | null; // 5小时消费上限（美元）
  limitWeeklyUsd: number | null; // 周消费上限（美元）
  limitMonthlyUsd: number | null; // 月消费上限（美元）
  limitConcurrentSessions: number; // 并发 Session 上限
}

/**
 * 用户显示对象（用于前端组件）
 */
export interface UserDisplay {
  id: number;
  name: string;
  note?: string;
  role: "admin" | "user";
  rpm: number;
  dailyQuota: number;
  providerGroup?: string | null;
  keys: UserKeyDisplay[];
}

/**
 * 用户表单数据
 */
