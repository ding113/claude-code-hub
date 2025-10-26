import type { CurrencyCode } from "@/lib/utils";

export interface SystemSettings {
  id: number;
  siteTitle: string;
  allowGlobalUsageView: boolean;

  // 货币显示配置
  currencyDisplay: CurrencyCode;

  // 日志清理配置
  enableAutoCleanup?: boolean;
  cleanupRetentionDays?: number;
  cleanupSchedule?: string;
  cleanupBatchSize?: number;

  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateSystemSettingsInput {
  siteTitle: string;
  allowGlobalUsageView: boolean;

  // 货币显示配置（可选）
  currencyDisplay?: CurrencyCode;

  // 日志清理配置（可选）
  enableAutoCleanup?: boolean;
  cleanupRetentionDays?: number;
  cleanupSchedule?: string;
  cleanupBatchSize?: number;
}
