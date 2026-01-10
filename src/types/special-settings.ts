/**
 * 特殊设置（通用审计字段）
 *
 * 用于记录请求在代理链路中发生的“特殊行为/特殊覆写”的命中与生效情况，
 * 便于在请求记录与请求详情中展示，支持后续扩展更多类型。
 */

export type SpecialSetting =
  | ProviderParameterOverrideSpecialSetting
  | ResponseFixerSpecialSetting
  | GuardInterceptSpecialSetting
  | AnthropicCacheTtlHeaderOverrideSpecialSetting
  | AnthropicContext1mHeaderOverrideSpecialSetting;

export type SpecialSettingChangeValue = string | number | boolean | null;

export type ProviderParameterOverrideSpecialSetting = {
  type: "provider_parameter_override";
  scope: "provider";
  providerId: number | null;
  providerName: string | null;
  providerType: string | null;
  hit: boolean;
  changed: boolean;
  changes: Array<{
    path: string;
    before: SpecialSettingChangeValue;
    after: SpecialSettingChangeValue;
    changed: boolean;
  }>;
};

export type ResponseFixerSpecialSetting = {
  type: "response_fixer";
  scope: "response";
  hit: boolean;
  fixersApplied: Array<{
    fixer: "json" | "sse" | "encoding";
    applied: boolean;
    details?: string;
  }>;
  totalBytesProcessed: number;
  processingTimeMs: number;
};

/**
 * 守卫拦截/阻断审计
 *
 * 用于把 warmup 抢答、敏感词拦截等“请求未进入上游”但会影响请求/响应结果的行为，
 * 统一纳入 specialSettings 展示区域，方便在日志详情与 Session 详情中排查。
 */
export type GuardInterceptSpecialSetting = {
  type: "guard_intercept";
  scope: "guard";
  hit: boolean;
  guard: string;
  action: "intercept_response" | "block_request";
  statusCode: number | null;
  /**
   * 原始原因（通常为 JSON 字符串），保持原样以便前端与日志一致展示。
   */
  reason: string | null;
};

/**
 * Anthropic 缓存 TTL 相关标头覆写审计
 *
 * 说明：当系统根据配置/偏好对请求应用缓存 TTL 能力时，需要在“特殊设置”中可见，
 * 便于审计与排查（与计费字段/Token 字段的展示互补）。
 */
export type AnthropicCacheTtlHeaderOverrideSpecialSetting = {
  type: "anthropic_cache_ttl_header_override";
  scope: "request_header";
  hit: boolean;
  ttl: string;
};

/**
 * Anthropic 1M 上下文相关标头覆写审计
 */
export type AnthropicContext1mHeaderOverrideSpecialSetting = {
  type: "anthropic_context_1m_header_override";
  scope: "request_header";
  hit: boolean;
  header: "anthropic-beta";
  flag: string;
};
