// 供应商类型枚举
export type ProviderType = "claude" | "claude-auth" | "codex" | "gemini-cli" | "openai-compatible";

export interface Provider {
  id: number;
  name: string;
  url: string;
  key: string;
  // 是否启用
  isEnabled: boolean;
  // 权重（0-100）
  weight: number;

  // 优先级和分组配置
  priority: number;
  costMultiplier: number;
  groupTag: string | null;

  // 供应商类型：扩展支持 4 种类型
  providerType: ProviderType;
  modelRedirects: Record<string, string> | null;

  // 模型列表：双重语义
  // - Anthropic 提供商：白名单（管理员限制可调度的模型，可选）
  // - 非 Anthropic 提供商：声明列表（提供商声称支持的模型，可选）
  // - null 或空数组：Anthropic 允许所有 claude 模型，非 Anthropic 允许任意模型
  allowedModels: string[] | null;

  // 加入 Claude 调度池：仅对非 Anthropic 提供商有效
  joinClaudePool: boolean;

  // 金额限流配置
  limit5hUsd: number | null;
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  limitConcurrentSessions: number;

  // 熔断器配置（每个供应商独立配置）
  circuitBreakerFailureThreshold: number;
  circuitBreakerOpenDuration: number; // 毫秒
  circuitBreakerHalfOpenSuccessThreshold: number;

  // 代理配置（支持 HTTP/HTTPS/SOCKS5）
  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;

  // 废弃（保留向后兼容，但不再使用）
  // TPM (Tokens Per Minute): 每分钟可处理的文本总量
  tpm: number | null;
  // RPM (Requests Per Minute): 每分钟可发起的API调用次数
  rpm: number | null;
  // RPD (Requests Per Day): 每天可发起的API调用总次数
  rpd: number | null;
  // CC (Concurrent Connections/Requests): 同一时刻能同时处理的请求数量
  cc: number | null;

  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// 前端显示用的供应商类型（包含格式化后的数据）
export interface ProviderDisplay {
  id: number;
  name: string;
  url: string;
  maskedKey: string;
  isEnabled: boolean;
  weight: number;
  // 优先级和分组配置
  priority: number;
  costMultiplier: number;
  groupTag: string | null;
  // 供应商类型
  providerType: ProviderType;
  modelRedirects: Record<string, string> | null;
  // 模型列表（双重语义）
  allowedModels: string[] | null;
  // 加入 Claude 调度池
  joinClaudePool: boolean;
  // 金额限流配置
  limit5hUsd: number | null;
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  limitConcurrentSessions: number;
  // 熔断器配置
  circuitBreakerFailureThreshold: number;
  circuitBreakerOpenDuration: number; // 毫秒
  circuitBreakerHalfOpenSuccessThreshold: number;
  // 代理配置
  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;
  // 废弃字段（保留向后兼容）
  tpm: number | null;
  rpm: number | null;
  rpd: number | null;
  cc: number | null;
  createdAt: string; // 格式化后的日期字符串
  updatedAt: string; // 格式化后的日期字符串
  // 统计数据（可选）
  todayTotalCostUsd?: string;
  todayCallCount?: number;
  lastCallTime?: string | null;
  lastCallModel?: string | null;
}

export interface CreateProviderData {
  name: string;
  url: string;
  key: string;
  // 是否启用（默认 true）- 数据库字段名
  is_enabled?: boolean;
  // 权重（默认 1）
  weight?: number;

  // 优先级和分组配置
  priority?: number;
  cost_multiplier?: number;
  group_tag?: string | null;

  // 供应商类型和模型配置
  provider_type?: ProviderType;
  model_redirects?: Record<string, string> | null;
  allowed_models?: string[] | null;
  join_claude_pool?: boolean;

  // 金额限流配置
  limit_5h_usd?: number | null;
  limit_weekly_usd?: number | null;
  limit_monthly_usd?: number | null;
  limit_concurrent_sessions?: number;

  // 熔断器配置
  circuit_breaker_failure_threshold?: number;
  circuit_breaker_open_duration?: number; // 毫秒
  circuit_breaker_half_open_success_threshold?: number;

  // 代理配置（支持 HTTP/HTTPS/SOCKS5）
  proxy_url?: string | null;
  proxy_fallback_to_direct?: boolean;

  // 废弃字段（保留向后兼容）
  // TPM (Tokens Per Minute): 每分钟可处理的文本总量
  tpm: number | null;
  // RPM (Requests Per Minute): 每分钟可发起的API调用次数
  rpm: number | null;
  // RPD (Requests Per Day): 每天可发起的API调用总次数
  rpd: number | null;
  // CC (Concurrent Connections/Requests): 同一时刻能同时处理的请求数量
  cc: number | null;
}

export interface UpdateProviderData {
  name?: string;
  url?: string;
  key?: string;
  // 是否启用 - 数据库字段名
  is_enabled?: boolean;
  // 权重（0-100）
  weight?: number;

  // 优先级和分组配置
  priority?: number;
  cost_multiplier?: number;
  group_tag?: string | null;

  // 供应商类型和模型配置
  provider_type?: ProviderType;
  model_redirects?: Record<string, string> | null;
  allowed_models?: string[] | null;
  join_claude_pool?: boolean;

  // 金额限流配置
  limit_5h_usd?: number | null;
  limit_weekly_usd?: number | null;
  limit_monthly_usd?: number | null;
  limit_concurrent_sessions?: number;

  // 熔断器配置
  circuit_breaker_failure_threshold?: number;
  circuit_breaker_open_duration?: number; // 毫秒
  circuit_breaker_half_open_success_threshold?: number;

  // 代理配置（支持 HTTP/HTTPS/SOCKS5）
  proxy_url?: string | null;
  proxy_fallback_to_direct?: boolean;

  // 废弃字段（保留向后兼容）
  // TPM (Tokens Per Minute): 每分钟可处理的文本总量
  tpm?: number | null;
  // RPM (Requests Per Minute): 每分钟可发起的API调用次数
  rpm?: number | null;
  // RPD (Requests Per Day): 每天可发起的API调用总次数
  rpd?: number | null;
  // CC (Concurrent Connections/Requests): 同一时刻能同时处理的请求数量
  cc?: number | null;
}
