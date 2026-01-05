/**
 * 用户数据库实体类型
 */
export interface User {
  id: number;
  name: string;
  description: string;
  role: "admin" | "user";
  rpm: number | null; // 每分钟请求数限制，null = 无限制
  dailyQuota: number | null; // 每日额度限制（美元），null = 无限制
  providerGroup: string | null; // 供应商分组
  tags?: string[]; // 用户标签（可选）
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  // User-level quota fields
  limit5hUsd?: number; // 5小时消费上限（美元）
  limitWeeklyUsd?: number; // 周消费上限（美元）
  limitMonthlyUsd?: number; // 月消费上限（美元）
  limitTotalUsd?: number | null; // 总消费上限（美元）
  limitConcurrentSessions?: number; // 并发 Session 上限
  // Daily quota reset mode
  dailyResetMode: "fixed" | "rolling"; // 每日限额重置模式
  dailyResetTime: string; // 每日重置时间 (HH:mm)
  // User status and expiry management
  isEnabled: boolean; // 用户启用状态
  expiresAt?: Date | null; // 用户过期时间
  // Allowed clients (CLI/IDE restrictions)
  allowedClients?: string[]; // 允许的客户端模式（空数组=无限制）
  // Allowed models (AI model restrictions)
  allowedModels?: string[]; // 允许的AI模型（空数组=无限制）
}

/**
 * 用户创建数据
 */
export interface CreateUserData {
  name: string;
  description: string;
  rpm?: number | null; // 可选，null = 无限制
  dailyQuota?: number | null; // 可选，null = 无限制
  providerGroup?: string | null; // 可选，供应商分组
  tags?: string[]; // 可选，用户标签
  // User-level quota fields
  limit5hUsd?: number;
  limitWeeklyUsd?: number;
  limitMonthlyUsd?: number;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number;
  // Daily quota reset mode
  dailyResetMode?: "fixed" | "rolling";
  dailyResetTime?: string;
  // User status and expiry management
  isEnabled?: boolean;
  expiresAt?: Date | null;
  // Allowed clients (CLI/IDE restrictions)
  allowedClients?: string[];
  // Allowed models (AI model restrictions)
  allowedModels?: string[];
}

/**
 * 用户更新数据
 */
export interface UpdateUserData {
  name?: string;
  description?: string;
  rpm?: number | null;
  dailyQuota?: number | null;
  providerGroup?: string | null; // 可选，供应商分组
  tags?: string[]; // 可选，用户标签
  // User-level quota fields
  limit5hUsd?: number | null;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number | null;
  // Daily quota reset mode
  dailyResetMode?: "fixed" | "rolling";
  dailyResetTime?: string;
  // User status and expiry management
  isEnabled?: boolean;
  expiresAt?: Date | null;
  // Allowed clients (CLI/IDE restrictions)
  allowedClients?: string[];
  // Allowed models (AI model restrictions)
  allowedModels?: string[];
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
  // Web UI 登录权限控制
  canLoginWebUi: boolean; // 是否允许使用该 Key 登录 Web UI
  // 限额配置
  limit5hUsd: number | null; // 5小时消费上限（美元）
  limitDailyUsd: number | null; // 每日消费上限
  dailyResetMode: "fixed" | "rolling"; // 每日重置模式
  dailyResetTime: string; // 每日重置时间
  limitWeeklyUsd: number | null; // 周消费上限（美元）
  limitMonthlyUsd: number | null; // 月消费上限（美元）
  limitTotalUsd?: number | null; // 总消费上限（美元）
  limitConcurrentSessions: number; // 并发 Session 上限
  // Provider group override (null = inherit from user)
  providerGroup?: string | null;
}

/**
 * 用户显示对象（用于前端组件）
 */
export interface UserDisplay {
  id: number;
  name: string;
  note?: string;
  role: "admin" | "user";
  rpm: number | null;
  dailyQuota: number | null;
  providerGroup?: string | null;
  tags?: string[]; // 用户标签
  keys: UserKeyDisplay[];
  // User-level quota fields
  limit5hUsd?: number | null;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number | null;
  // Daily quota reset mode
  dailyResetMode?: "fixed" | "rolling";
  dailyResetTime?: string;
  // User status and expiry management
  isEnabled: boolean; // 用户启用状态
  expiresAt?: Date | null; // 用户过期时间
  // Allowed clients (CLI/IDE restrictions)
  allowedClients?: string[]; // 允许的客户端模式（空数组=无限制）
  // Allowed models (AI model restrictions)
  allowedModels?: string[]; // 允许的AI模型（空数组=无限制）
}

/**
 * Key Dialog 所需的用户上下文（精简版）
 * 用于 AddKeyDialog/EditKeyDialog 组件，只包含限额相关字段
 */
export interface KeyDialogUserContext {
  id: number;
  providerGroup?: string | null;
  limit5hUsd?: number;
  limitWeeklyUsd?: number;
  limitMonthlyUsd?: number;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number;
}

/**
 * 用户表单数据
 */
