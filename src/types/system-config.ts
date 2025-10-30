import type { CurrencyCode } from "@/lib/utils";

export interface SystemSettings {
  id: number;
  siteTitle: string;
  allowGlobalUsageView: boolean;

  // 货币显示配置
  currencyDisplay: CurrencyCode;

  // 隐私保护配置：是否允许非管理员查看供应商名称和倍率（默认关闭）
  allowViewProviderInfo: boolean;
  // 非管理员用户前台显示货币（默认继承 currencyDisplay）
  nonAdminCurrencyDisplay: CurrencyCode;

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

  // 隐私保护配置（可选）
  allowViewProviderInfo?: boolean;
  nonAdminCurrencyDisplay?: CurrencyCode;

  // 日志清理配置（可选）
  enableAutoCleanup?: boolean;
  cleanupRetentionDays?: number;
  cleanupSchedule?: string;
  cleanupBatchSize?: number;
}
