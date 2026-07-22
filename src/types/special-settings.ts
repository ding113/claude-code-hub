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
  | ThinkingSignatureRectifierSpecialSetting
  | ThinkingBudgetRectifierSpecialSetting
  | ThinkingEffortConflictRectifierSpecialSetting
  | BillingHeaderRectifierSpecialSetting
  | CodexSessionIdCompletionSpecialSetting
  | ClaudeMetadataUserIdInjectionSpecialSetting
  | AnthropicEffortSpecialSetting
  | CodexReasoningEffortSpecialSetting
  | AnthropicCacheTtlHeaderOverrideSpecialSetting
  | AnthropicContext1mHeaderOverrideSpecialSetting
  | LongContextPricingSpecialSetting
  | GeminiFunctionIdRectifierSpecialSetting
  | GeminiGoogleSearchOverrideSpecialSetting
  | PricingResolutionSpecialSetting
  | CodexServiceTierResultSpecialSetting
  | ResponseInputRectifierSpecialSetting
  | ThinkingSignatureModelDetectionSpecialSetting;

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
 * Anthropic effort 请求参数审计
 *
 * 用于记录原始 Anthropic 请求体中的 output_config.effort，
 * 便于在使用记录中以标签形式展示。
 */
export type AnthropicEffortSpecialSetting = {
  type: "anthropic_effort";
  scope: "request";
  hit: boolean;
  effort: string;
};

/**
 * Codex reasoning effort 请求参数审计
 *
 * 记录客户端发送给 Codex 供应商的 reasoning.effort；供应商级覆写后的值由
 * provider_parameter_override 审计补充，使用记录可同时呈现请求值与实际转发值。
 */
export type CodexReasoningEffortSpecialSetting = {
  type: "codex_reasoning_effort";
  scope: "request";
  hit: boolean;
  effort: string;
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

/**
 * 长上下文 premium 计费审计
 *
 * 用于记录：请求因命中模型的长上下文定价规则而按 premium 费率计费。
 */
export type LongContextPricingSpecialSetting = {
  type: "long_context_pricing";
  scope: "billing";
  hit: boolean;
  pricingScope: "request" | "session" | null;
  thresholdTokens: number | null;
};

/**
 * Thinking signature 整流器审计
 *
 * 用于记录：当 Anthropic 类型供应商遇到 thinking 签名不兼容/非法请求等 400 错误时，
 * 代理对请求体进行最小整流（移除 thinking/redacted_thinking 与遗留 signature 字段）
 * 并对同供应商自动重试一次的行为，便于在请求日志中审计与回溯。
 */
export type ThinkingSignatureRectifierSpecialSetting = {
  type: "thinking_signature_rectifier";
  scope: "request";
  hit: boolean;
  providerId: number | null;
  providerName: string | null;
  trigger:
    | "invalid_signature_in_thinking_block"
    | "assistant_message_must_start_with_thinking"
    | "invalid_request";
  attemptNumber: number;
  retryAttemptNumber: number;
  removedThinkingBlocks: number;
  removedRedactedThinkingBlocks: number;
  removedSignatureFields: number;
};

/**
 * Thinking effort 冲突整流器审计
 *
 * 用于记录：当 Anthropic 兼容供应商（如 DeepSeek、MiMo 等）因
 * thinking 关闭 + reasoning_effort/output_config.effort 同时存在而返回 400 时，
 * 代理剥离 effort 字段并对同供应商自动重试一次的行为。
 */
export type ThinkingEffortConflictRectifierSpecialSetting = {
  type: "thinking_effort_conflict_rectifier";
  scope: "request";
  hit: boolean;
  providerId: number | null;
  providerName: string | null;
  trigger: "thinking_disabled_with_reasoning_effort";
  attemptNumber: number;
  retryAttemptNumber: number;
  removedOutputConfigEffort: boolean;
  removedReasoningEffort: boolean;
  thinkingType: string | null;
  effort: string | null;
};

/**
 * Codex Session ID 补全审计
 *
 * 用于记录：当 Codex 请求缺少 session_id / prompt_cache_key 时，
 * 系统自动补全或生成会话标识，提升供应商复用与会话粘性稳定性。
 */
export type CodexSessionIdCompletionSpecialSetting = {
  type: "codex_session_id_completion";
  scope: "request";
  hit: boolean;
  action: "completed_missing_fields" | "generated_uuid_v7" | "reused_fingerprint_cache";
  source:
    | "header_session_id"
    | "header_x_session_id"
    | "body_prompt_cache_key"
    | "body_metadata_session_id"
    | "fingerprint_cache"
    | "generated_uuid_v7";
  sessionId: string;
};

/**
 * Claude metadata.user_id 注入审计
 *
 * 用于记录：在 Claude 请求中注入 metadata.user_id 的命中情况，
 * 以及跳过注入时的原因（例如客户端已提供、缺少 key/session 信息等）。
 */
export type ClaudeMetadataUserIdInjectionSpecialSetting = {
  type: "claude_metadata_user_id_injection";
  scope: "request";
  hit: boolean;
  action: "injected" | "skipped";
  reason: "injected" | "already_exists" | "missing_key_id" | "missing_session_id";
  keyId: number | null;
  sessionId: string | null;
};

export type BillingHeaderRectifierSpecialSetting = {
  type: "billing_header_rectifier";
  scope: "request";
  hit: boolean;
  removedCount: number;
  extractedValues: string[];
};

export type ThinkingBudgetRectifierSpecialSetting = {
  type: "thinking_budget_rectifier";
  scope: "request";
  hit: boolean;
  providerId: number | null;
  providerName: string | null;
  trigger: "budget_tokens_too_low";
  attemptNumber: number;
  retryAttemptNumber: number;
  before: {
    maxTokens: number | null;
    thinkingType: string | null;
    thinkingBudgetTokens: number | null;
  };
  after: {
    maxTokens: number | null;
    thinkingType: string | null;
    thinkingBudgetTokens: number | null;
  };
};

/**
 * Gemini function id 整流器审计
 *
 * 用于记录：Vertex AI 严格 schema 拒绝 functionCall/functionResponse 中的 `id` 字段时，
 * 系统剥离该字段并对同供应商重试一次的行为。
 */
export type GeminiFunctionIdRectifierSpecialSetting = {
  type: "gemini_function_id_rectifier";
  scope: "request";
  hit: boolean;
  providerId: number | null;
  providerName: string | null;
  trigger: "unknown_function_id_field";
  attemptNumber: number;
  retryAttemptNumber: number;
  strippedFunctionCallIds: number;
  strippedFunctionResponseIds: number;
};

/**
 * Gemini Google Search 覆写审计
 *
 * 用于记录：当 Gemini 类型供应商配置了 googleSearch 偏好时，
 * 系统对请求体中 tools 数组进行注入或移除 googleSearch 工具的行为。
 */
export type GeminiGoogleSearchOverrideSpecialSetting = {
  type: "gemini_google_search_override";
  scope: "request";
  hit: boolean;
  providerId: number | null;
  providerName: string | null;
  action: "inject" | "remove" | "passthrough";
  preference: "enabled" | "disabled";
  hadGoogleSearchInRequest: boolean;
};

export type PricingResolutionSpecialSetting = {
  type: "pricing_resolution";
  scope: "billing";
  hit: boolean;
  modelName: string;
  resolvedModelName: string;
  resolvedPricingProviderKey: string;
  source:
    | "local_manual"
    | "cloud_exact"
    | "cloud_model_fallback"
    | "cloud_official"
    | "priority_fallback"
    | "single_provider_top_level"
    | "official_fallback";
};

export type CodexServiceTierResultSpecialSetting = {
  type: "codex_service_tier_result";
  scope: "response";
  hit: boolean;
  requestedServiceTier: string | null;
  actualServiceTier: string | null;
  billingSourcePreference?: "requested" | "actual" | null;
  resolvedFrom?: "requested" | "actual" | null;
  effectivePriority: boolean;
};

/**
 * Response Input 整流器审计
 *
 * 用于记录：当 /v1/responses 端点收到非数组格式的 input 时，
 * 系统自动将其规范化为数组格式的行为，便于在请求日志中审计。
 */
export type ResponseInputRectifierSpecialSetting = {
  type: "response_input_rectifier";
  scope: "request";
  hit: boolean;
  action: "string_to_array" | "object_to_array" | "empty_string_to_empty_array" | "passthrough";
  originalType: "string" | "object" | "array" | "other";
};

/**
 * Anthropic 思考签名模型检测审计
 *
 * 在 Anthropic 流式响应中,优先用 `signature_delta` 的 protobuf payload
 * (字段路径 [2, 1, 6])解出实际响应模型,比 `message_start` 明文 model 更准确。
 *
 * `source` 三态:
 * - `signature`: 成功从签名解出模型(最理想路径)
 * - `fallback_no_signature_with_thinking`: 请求开启了思考但流中没拿到可用签名
 *   (无 signature_delta 事件 / base64 损坏 / protobuf 字段路径解不出),
 *   退化到 message_start 明文 model。UI 在此 source 下亮"无思考签名"badge。
 * - `fallback_no_thinking`: 请求未开启思考(正常路径,无 badge)
 *
 * `hit` 仅在 `fallback_no_signature_with_thinking` 时为 true(异常告警语义),
 * 与现有 rectifier hit 语义一致。
 */
export type ThinkingSignatureModelDetectionSpecialSetting = {
  type: "thinking_signature_model_detection";
  scope: "response";
  hit: boolean;
  source: "signature" | "fallback_no_signature_with_thinking" | "fallback_no_thinking";
  extractedModel: string | null;
  signatureFound: boolean;
  thinkingEnabled: boolean;
  requestedModel: string | null;
};
