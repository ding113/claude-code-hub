import type { CurrencyCode } from "@/lib/utils";

export interface SystemSettings {
  id: number;
  siteTitle: string;
  allowGlobalUsageView: boolean;
  // 供应商分组降级配置：当分组内无可用供应商时，是否允许跨组降级到全局供应商池
  allowCrossGroupOnDegrade: boolean;

  // 货币显示配置
  currencyDisplay: CurrencyCode;

  // 日志清理配置
  enableAutoCleanup?: boolean;
  cleanupRetentionDays?: number;
  cleanupSchedule?: string;
  cleanupBatchSize?: number;

  // 客户端版本检查配置
  enableClientVersionCheck: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateSystemSettingsInput {
  // 所有字段均为可选，支持部分更新
  siteTitle?: string;
  allowGlobalUsageView?: boolean;
  // 供应商分组降级配置（可选）
  allowCrossGroupOnDegrade?: boolean;

  // 货币显示配置（可选）
  currencyDisplay?: CurrencyCode;

  // 日志清理配置（可选）
  enableAutoCleanup?: boolean;
  cleanupRetentionDays?: number;
  cleanupSchedule?: string;
  cleanupBatchSize?: number;

  // 客户端版本检查配置（可选）
  enableClientVersionCheck?: boolean;
}
