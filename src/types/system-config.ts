import type { CurrencyCode } from "@/lib/utils";
import type { IpExtractionConfig } from "@/types/ip-extraction";

// 计费模型来源: 'original' (重定向前) | 'redirected' (重定向后)
export type BillingModelSource = "original" | "redirected";
export type CodexPriorityBillingSource = "requested" | "actual";

// F1 流式内容门控模式: 'off' (关闭) | 'shadow' (仅旁路统计) | 'enforce' (启用)
export type StreamGateSettingMode = "off" | "shadow" | "enforce";

export interface ResponseFixerConfig {
  fixTruncatedJson: boolean;
  fixSseFormat: boolean;
  fixEncoding: boolean;
  maxJsonDepth: number;
  maxFixSize: number;
}

// Fake streaming whitelist entry: pairs an exact client-requested model name
// with optional provider group tags. Empty groupTags means "all groups".
export interface FakeStreamingWhitelistEntry {
  model: string;
  groupTags: string[];
}

// Default whitelist used when system_settings has no persisted value (legacy
// upgrade path). A persisted empty array is preserved as explicit opt-out.
export const DEFAULT_FAKE_STREAMING_WHITELIST: ReadonlyArray<FakeStreamingWhitelistEntry> = [];

export interface SystemSettings {
  id: number;
  siteTitle: string;
  allowGlobalUsageView: boolean;

  // 货币显示配置
  currencyDisplay: CurrencyCode;

  // 计费模型来源配置
  billingModelSource: BillingModelSource;

  // Codex Priority 单独计费口径
  codexPriorityBillingSource: CodexPriorityBillingSource;

  // 非成功请求按 token 用量计费（默认关闭）
  // 开启后：返回非 2xx 状态（如 499 客户端中断）但上游仍回报了正向 token 用量时按 usage 计费；
  //         fake-200 上游错误识别仍生效，保证假成功响应不会被错误计费。
  billNonSuccessfulRequests: boolean;

  // 供应商竞速（streaming hedge）输家计费（默认开启）
  // 开启后：竞速落败的供应商不再被直接掐断，而是后台拿回其上游响应并按 token 用量计费，
  //         其费用异步累加进该请求的总花费（与上游对多个供应商分别计费保持一致）。
  billHedgeLosers: boolean;

  // 系统时区配置 (IANA timezone identifier)
  // 用于统一后端时间边界计算和前端日期/时间显示
  // null 表示使用环境变量 TZ 或默认 UTC
  timezone: string | null;

  // 日志清理配置
  enableAutoCleanup?: boolean;
  cleanupRetentionDays?: number;
  cleanupSchedule?: string;
  cleanupBatchSize?: number;

  // 客户端版本检查配置
  enableClientVersionCheck: boolean;

  // 供应商不可用时是否返回详细错误信息
  verboseProviderError: boolean;

  // 是否在标准代理错误响应中透传安全脱敏后的上游错误 message
  passThroughUpstreamErrorMessage: boolean;

  // 启用 HTTP/2 连接供应商
  enableHttp2: boolean;

  // 启用 OpenAI Responses WebSocket 支持（仅 Codex 类型供应商生效）
  // 目标：让客户端以 WebSocket 连接 /v1/responses 时，CCH 与上游也以 WS 建连；
  // 上游不支持时优雅降级为 HTTP，客户端 WebSocket 保持打开。
  enableOpenaiResponsesWebsocket: boolean;

  // 高并发模式（默认关闭）
  // 目标：关闭部分 Redis 调试快照与实时观测写入，降低高并发下的 CPU 与 IO 开销
  enableHighConcurrencyMode: boolean;

  // 可选拦截 Anthropic Warmup 请求（默认关闭）
  interceptAnthropicWarmupRequests: boolean;

  // thinking signature 整流器（默认开启）
  // 目标：当 Anthropic 类型供应商出现 thinking 签名不兼容导致的 400 错误时，自动整流并重试一次
  enableThinkingSignatureRectifier: boolean;

  // thinking budget 整流器（默认开启）
  // 目标：当 Anthropic 类型供应商出现 budget_tokens < 1024 错误时，自动整流并重试一次
  enableThinkingBudgetRectifier: boolean;

  // thinking effort 冲突整流器（默认开启）
  // 目标：当 Anthropic 兼容供应商（DeepSeek/MiMo 等）因 thinking 关闭 + reasoning_effort
  // 同时存在返回 400 错误时，自动剥离 effort 字段并对同供应商重试一次
  enableThinkingEffortConflictRectifier: boolean;

  // Gemini function id 整流器（默认开启）
  // 目标：当 Gemini 类型供应商（Vertex 等严格上游）因 functionCall/functionResponse 携带 id
  // 返回 400 错误时，自动剥离 id 字段并对同供应商重试一次
  enableGeminiFunctionIdRectifier: boolean;

  // billing header 整流器（默认开启）
  // 目标：主动移除 Claude Code 客户端注入到 system 提示中的 x-anthropic-billing-header 文本块，
  // 防止 Amazon Bedrock 等非原生 Anthropic 上游返回 400 错误
  enableBillingHeaderRectifier: boolean;

  // Response API input 整流器（默认开启）
  // 目标：当 /v1/responses 端点收到非数组 input（字符串或单对象）时，
  // 自动规范化为数组格式，确保下游处理兼容 OpenAI 完整规范
  enableResponseInputRectifier: boolean;

  // 非对话端点跨供应商 fallback（默认开启）
  // 当前仅作用于 count_tokens / compact 这两个 raw endpoint
  allowNonConversationEndpointProviderFallback: boolean;

  // Fake 流式输出白名单（缺省时使用 DEFAULT_FAKE_STREAMING_WHITELIST，持久化空数组表示显式禁用）
  fakeStreamingWhitelist: FakeStreamingWhitelistEntry[];

  // Codex Session ID 补全（默认开启）
  // 目标：当 Codex 请求缺少 session_id / prompt_cache_key 时，自动补全或生成稳定的会话标识
  enableCodexSessionIdCompletion: boolean;

  // Claude metadata.user_id 注入（默认开启）
  // 目标：为 Claude 请求补全 metadata.user_id，提升中转缓存命中稳定性
  enableClaudeMetadataUserIdInjection: boolean;

  // 响应整流（默认开启）
  enableResponseFixer: boolean;
  responseFixerConfig: ResponseFixerConfig;

  // Quota lease settings
  quotaDbRefreshIntervalSeconds?: number;
  quotaLeasePercent5h?: number;
  quotaLeasePercentDaily?: number;
  quotaLeasePercentWeekly?: number;
  quotaLeasePercentMonthly?: number;
  quotaLeaseCapUsd?: number | null;

  // 客户端 IP 提取链（null 走内置默认）
  ipExtractionConfig: IpExtractionConfig | null;
  // 是否启用 IP 归属地查询
  ipGeoLookupEnabled: boolean;
  // Public Status 全局配置
  publicStatusWindowHours: number;
  publicStatusAggregationIntervalMinutes: number;

  // F1 流式内容门控模式（默认 enforce）
  // enforce：首个有效内容帧前缓冲，错误/空流时自动切换供应商；shadow：仅旁路统计分歧
  streamGateMode: StreamGateSettingMode;

  // 忽略客户端 Session ID（默认开启）
  // 开启后：可指纹化的请求强制使用最长前缀亲和做供应商粘性（跳过客户端 Session ID 绑定），
  // 不可指纹化的请求仍走会话复用
  affinityIgnoreClientSessionId: boolean;

  /** Bounded streaming Discovery settings. */
  discoveryEnabled: boolean;
  discoveryConcurrency: number;
  maxDiscoveryRounds: number;
  discoverySlaMs: number;
  stickySlaMs: number;
  racingTotalTimeoutMs: number;
  stickyTimeoutCooldownMs: number;

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

  // Codex Priority 单独计费口径（可选）
  codexPriorityBillingSource?: CodexPriorityBillingSource;

  // 非成功请求按 token 用量计费（可选）
  billNonSuccessfulRequests?: boolean;

  // 供应商竞速输家计费（可选）
  billHedgeLosers?: boolean;

  discoveryEnabled?: boolean;
  discoveryConcurrency?: number;
  maxDiscoveryRounds?: number;
  discoverySlaMs?: number;
  stickySlaMs?: number;
  racingTotalTimeoutMs?: number;
  stickyTimeoutCooldownMs?: number;

  // 系统时区配置（可选）
  timezone?: string | null;

  // 日志清理配置（可选）
  enableAutoCleanup?: boolean;
  cleanupRetentionDays?: number;
  cleanupSchedule?: string;
  cleanupBatchSize?: number;

  // 客户端版本检查配置（可选）
  enableClientVersionCheck?: boolean;

  // 供应商不可用时是否返回详细错误信息（可选）
  verboseProviderError?: boolean;

  // 是否在标准代理错误响应中透传安全脱敏后的上游错误 message（可选）
  passThroughUpstreamErrorMessage?: boolean;

  // 启用 HTTP/2 连接供应商（可选）
  enableHttp2?: boolean;

  // 启用 OpenAI Responses WebSocket 支持（可选，仅 Codex 类型供应商生效）
  enableOpenaiResponsesWebsocket?: boolean;

  // 高并发模式（可选）
  enableHighConcurrencyMode?: boolean;

  // 可选拦截 Anthropic Warmup 请求（可选）
  interceptAnthropicWarmupRequests?: boolean;

  // thinking signature 整流器（可选）
  enableThinkingSignatureRectifier?: boolean;

  // thinking budget 整流器（可选）
  enableThinkingBudgetRectifier?: boolean;

  // thinking effort 冲突整流器（可选）
  enableThinkingEffortConflictRectifier?: boolean;

  // Gemini function id 整流器（可选）
  enableGeminiFunctionIdRectifier?: boolean;

  // billing header 整流器（可选）
  enableBillingHeaderRectifier?: boolean;

  // Response API input 整流器（可选）
  enableResponseInputRectifier?: boolean;

  // 非对话端点跨供应商 fallback（可选）
  allowNonConversationEndpointProviderFallback?: boolean;

  // Fake 流式输出白名单（可选）
  fakeStreamingWhitelist?: FakeStreamingWhitelistEntry[];

  // Codex Session ID 补全（可选）
  enableCodexSessionIdCompletion?: boolean;

  // Claude metadata.user_id 注入（可选）
  enableClaudeMetadataUserIdInjection?: boolean;

  // 响应整流（可选）
  enableResponseFixer?: boolean;
  responseFixerConfig?: Partial<ResponseFixerConfig>;

  // Quota lease settings（可选）
  quotaDbRefreshIntervalSeconds?: number;
  quotaLeasePercent5h?: number;
  quotaLeasePercentDaily?: number;
  quotaLeasePercentWeekly?: number;
  quotaLeasePercentMonthly?: number;
  quotaLeaseCapUsd?: number | null;

  // 客户端 IP 提取链（可选，null = 使用默认）
  ipExtractionConfig?: IpExtractionConfig | null;
  // 是否启用 IP 归属地查询（可选）
  ipGeoLookupEnabled?: boolean;
  // Public Status 全局配置（可选）
  publicStatusWindowHours?: number;
  publicStatusAggregationIntervalMinutes?: number;

  // F1 流式内容门控模式（可选）
  streamGateMode?: StreamGateSettingMode;

  // 忽略客户端 Session ID（可选）
  affinityIgnoreClientSessionId?: boolean;
}
