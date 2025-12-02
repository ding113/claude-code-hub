import type { CurrencyCode } from "@/lib/utils";

// 计费模型来源: 'original' (重定向前) | 'redirected' (重定向后)
export type BillingModelSource = "original" | "redirected";

export interface SystemSettings {
  id: number;
  siteTitle: string;
  allowGlobalUsageView: boolean;

  // 货币显示配置
  currencyDisplay: CurrencyCode;

  // 计费模型来源配置
  billingModelSource: BillingModelSource;

  // 日志清理配置
  enableAutoCleanup?: boolean;
  cleanupRetentionDays?: number;
  cleanupSchedule?: string;
  cleanupBatchSize?: number;

  // 客户端版本检查配置
  enableClientVersionCheck: boolean;

  // 供应商不可用时是否返回详细错误信息
  verboseProviderError: boolean;

  // 启用 HTTP/2 连接供应商
  enableHttp2: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateSystemSettingsInput {
  // 所有字段均为可选，支持部分更新
  siteTitle?: string;
  allowGlobalUsageView?: boolean;

  // 货币显示配置（可选）
  currencyDisplay?: CurrencyCode;

  // 计费模型来源配置（可选）
  billingModelSource?: BillingModelSource;

  // 日志清理配置（可选）
  enableAutoCleanup?: boolean;
  cleanupRetentionDays?: number;
  cleanupSchedule?: string;
  cleanupBatchSize?: number;

  // 客户端版本检查配置（可选）
  enableClientVersionCheck?: boolean;

  // 供应商不可用时是否返回详细错误信息（可选）
  verboseProviderError?: boolean;

  // 启用 HTTP/2 连接供应商（可选）
  enableHttp2?: boolean;
}
