import type { CurrencyCode } from "@/lib/utils";

// 计费模型来源: 'original' (重定向前) | 'redirected' (重定向后)
export type BillingModelSource = "original" | "redirected";

export interface ResponseFixerConfig {
  fixTruncatedJson: boolean;
  fixSseFormat: boolean;
  fixEncoding: boolean;
  maxJsonDepth: number;
  maxFixSize: number;
}

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

  // 可选拦截 Anthropic Warmup 请求（默认关闭）
  interceptAnthropicWarmupRequests: boolean;

  // thinking signature 整流器（默认开启）
  // 目标：当 Anthropic 类型供应商出现 thinking 签名不兼容导致的 400 错误时，自动整流并重试一次
  enableThinkingSignatureRectifier: boolean;

  // Codex Session ID 补全（默认开启）
  // 目标：当 Codex 请求缺少 session_id / prompt_cache_key 时，自动补全或生成稳定的会话标识
  enableCodexSessionIdCompletion: boolean;

  // 响应整流（默认开启）
  enableResponseFixer: boolean;
  responseFixerConfig: ResponseFixerConfig;

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

  // 可选拦截 Anthropic Warmup 请求（可选）
  interceptAnthropicWarmupRequests?: boolean;

  // thinking signature 整流器（可选）
  enableThinkingSignatureRectifier?: boolean;

  // Codex Session ID 补全（可选）
  enableCodexSessionIdCompletion?: boolean;

  // 响应整流（可选）
  enableResponseFixer?: boolean;
  responseFixerConfig?: Partial<ResponseFixerConfig>;
}
