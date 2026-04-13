import { normalizeAllowedModelRules } from "@/lib/allowed-model-rules";
import { parseProviderGroups } from "@/lib/utils/provider-group";
import type { CacheTtlPreference } from "@/types/cache";
import type {
  AllowedModelRule,
  AnthropicAdaptiveThinkingConfig,
  AnthropicMaxTokensPreference,
  AnthropicThinkingBudgetPreference,
  CodexParallelToolCallsPreference,
  CodexReasoningEffortPreference,
  CodexReasoningSummaryPreference,
  CodexServiceTierPreference,
  CodexTextVerbosityPreference,
  GeminiGoogleSearchPreference,
  McpPassthroughType,
  ProviderDisplay,
  ProviderModelRedirectRule,
} from "@/types/provider";
import { deepEquals } from "./deep-equals";

// 字段分析结果
export type FieldAnalysisResult<T> =
  | { status: "uniform"; value: T } // 所有 provider 值相同
  | { status: "mixed"; values: T[] } // 值不同
  | { status: "empty" }; // 所有 provider 为 null/undefined

// 批量设置分析结果（映射到 ProviderFormState 结构）
export interface BatchSettingsAnalysis {
  routing: {
    priority: FieldAnalysisResult<number>;
    weight: FieldAnalysisResult<number>;
    costMultiplier: FieldAnalysisResult<number>;
    groupTag: FieldAnalysisResult<string[]>;
    preserveClientIp: FieldAnalysisResult<boolean>;
    disableSessionReuse: FieldAnalysisResult<boolean>;
    modelRedirects: FieldAnalysisResult<ProviderModelRedirectRule[]>;
    allowedModels: FieldAnalysisResult<AllowedModelRule[]>;
    allowedClients: FieldAnalysisResult<string[]>;
    blockedClients: FieldAnalysisResult<string[]>;
    groupPriorities: FieldAnalysisResult<Record<string, number>>;
    cacheTtlPreference: FieldAnalysisResult<CacheTtlPreference>;
    swapCacheTtlBilling: FieldAnalysisResult<boolean>;
    codexReasoningEffortPreference: FieldAnalysisResult<CodexReasoningEffortPreference>;
    codexReasoningSummaryPreference: FieldAnalysisResult<CodexReasoningSummaryPreference>;
    codexTextVerbosityPreference: FieldAnalysisResult<CodexTextVerbosityPreference>;
    codexParallelToolCallsPreference: FieldAnalysisResult<CodexParallelToolCallsPreference>;
    codexServiceTierPreference: FieldAnalysisResult<CodexServiceTierPreference>;
    anthropicMaxTokensPreference: FieldAnalysisResult<AnthropicMaxTokensPreference>;
    anthropicThinkingBudgetPreference: FieldAnalysisResult<AnthropicThinkingBudgetPreference>;
    anthropicAdaptiveThinking: FieldAnalysisResult<AnthropicAdaptiveThinkingConfig | null>;
    geminiGoogleSearchPreference: FieldAnalysisResult<GeminiGoogleSearchPreference>;
    activeTimeStart: FieldAnalysisResult<string | null>;
    activeTimeEnd: FieldAnalysisResult<string | null>;
  };
  rateLimit: {
    limit5hUsd: FieldAnalysisResult<number | null>;
    limitDailyUsd: FieldAnalysisResult<number | null>;
    dailyResetMode: FieldAnalysisResult<"fixed" | "rolling">;
    dailyResetTime: FieldAnalysisResult<string>;
    limitWeeklyUsd: FieldAnalysisResult<number | null>;
    limitMonthlyUsd: FieldAnalysisResult<number | null>;
    limitTotalUsd: FieldAnalysisResult<number | null>;
    limitConcurrentSessions: FieldAnalysisResult<number | null>;
  };
  circuitBreaker: {
    failureThreshold: FieldAnalysisResult<number | undefined>;
    openDurationMinutes: FieldAnalysisResult<number | undefined>;
    halfOpenSuccessThreshold: FieldAnalysisResult<number | undefined>;
    maxRetryAttempts: FieldAnalysisResult<number | null>;
  };
  network: {
    proxyUrl: FieldAnalysisResult<string>;
    proxyFallbackToDirect: FieldAnalysisResult<boolean>;
    firstByteTimeoutStreamingSeconds: FieldAnalysisResult<number | undefined>;
    streamingIdleTimeoutSeconds: FieldAnalysisResult<number | undefined>;
    requestTimeoutNonStreamingSeconds: FieldAnalysisResult<number | undefined>;
  };
  mcp: {
    mcpPassthroughType: FieldAnalysisResult<McpPassthroughType>;
    mcpPassthroughUrl: FieldAnalysisResult<string>;
  };
}

/**
 * 分析单个字段的值分布
 */
function analyzeField<T>(
  providers: ProviderDisplay[],
  extractor: (p: ProviderDisplay) => T
): FieldAnalysisResult<T> {
  if (providers.length === 0) return { status: "empty" };

  const values = providers.map(extractor);
  const firstValue = values[0];

  // 检查是否所有值都为 null/undefined
  if (values.every((v) => v == null)) return { status: "empty" };

  // 检查是否所有值相同（使用深度比较）
  if (values.every((v) => deepEquals(v, firstValue))) {
    return { status: "uniform", value: firstValue };
  }

  // 值不同 - 去重
  const uniqueValues: T[] = [];
  for (const v of values) {
    if (!uniqueValues.some((existing) => deepEquals(existing, v))) {
      uniqueValues.push(v);
    }
  }

  return { status: "mixed", values: uniqueValues };
}

/**
 * 分析批量 provider 的所有字段设置
 */
export function analyzeBatchProviderSettings(providers: ProviderDisplay[]): BatchSettingsAnalysis {
  return {
    routing: {
      priority: analyzeField(providers, (p) => p.priority),
      weight: analyzeField(providers, (p) => p.weight),
      costMultiplier: analyzeField(providers, (p) => p.costMultiplier),
      groupTag: analyzeField(providers, (p) => parseProviderGroups(p.groupTag)),
      preserveClientIp: analyzeField(providers, (p) => p.preserveClientIp),
      disableSessionReuse: analyzeField(providers, (p) => p.disableSessionReuse),
      modelRedirects: analyzeField(providers, (p) => p.modelRedirects ?? []),
      allowedModels: analyzeField(
        providers,
        (p) => normalizeAllowedModelRules(p.allowedModels) ?? []
      ),
      allowedClients: analyzeField(providers, (p) => p.allowedClients ?? []),
      blockedClients: analyzeField(providers, (p) => p.blockedClients ?? []),
      groupPriorities: analyzeField(providers, (p) => p.groupPriorities ?? {}),
      cacheTtlPreference: analyzeField(providers, (p) => p.cacheTtlPreference ?? "inherit"),
      swapCacheTtlBilling: analyzeField(providers, (p) => p.swapCacheTtlBilling ?? false),
      codexReasoningEffortPreference: analyzeField(
        providers,
        (p) => p.codexReasoningEffortPreference ?? "inherit"
      ),
      codexReasoningSummaryPreference: analyzeField(
        providers,
        (p) => p.codexReasoningSummaryPreference ?? "inherit"
      ),
      codexTextVerbosityPreference: analyzeField(
        providers,
        (p) => p.codexTextVerbosityPreference ?? "inherit"
      ),
      codexParallelToolCallsPreference: analyzeField(
        providers,
        (p) => p.codexParallelToolCallsPreference ?? "inherit"
      ),
      codexServiceTierPreference: analyzeField(
        providers,
        (p) => p.codexServiceTierPreference ?? "inherit"
      ),
      anthropicMaxTokensPreference: analyzeField(
        providers,
        (p) => p.anthropicMaxTokensPreference ?? "inherit"
      ),
      anthropicThinkingBudgetPreference: analyzeField(
        providers,
        (p) => p.anthropicThinkingBudgetPreference ?? "inherit"
      ),
      anthropicAdaptiveThinking: analyzeField(
        providers,
        (p) => p.anthropicAdaptiveThinking ?? null
      ),
      geminiGoogleSearchPreference: analyzeField(
        providers,
        (p) => p.geminiGoogleSearchPreference ?? "inherit"
      ),
      activeTimeStart: analyzeField(providers, (p) => p.activeTimeStart ?? null),
      activeTimeEnd: analyzeField(providers, (p) => p.activeTimeEnd ?? null),
    },
    rateLimit: {
      limit5hUsd: analyzeField(providers, (p) => p.limit5hUsd ?? null),
      limitDailyUsd: analyzeField(providers, (p) => p.limitDailyUsd ?? null),
      dailyResetMode: analyzeField(providers, (p) => p.dailyResetMode ?? "fixed"),
      dailyResetTime: analyzeField(providers, (p) => p.dailyResetTime ?? "00:00"),
      limitWeeklyUsd: analyzeField(providers, (p) => p.limitWeeklyUsd ?? null),
      limitMonthlyUsd: analyzeField(providers, (p) => p.limitMonthlyUsd ?? null),
      limitTotalUsd: analyzeField(providers, (p) => p.limitTotalUsd ?? null),
      limitConcurrentSessions: analyzeField(providers, (p) => p.limitConcurrentSessions ?? null),
    },
    circuitBreaker: {
      failureThreshold: analyzeField(providers, (p) => p.circuitBreakerFailureThreshold),
      openDurationMinutes: analyzeField(providers, (p) =>
        p.circuitBreakerOpenDuration != null ? p.circuitBreakerOpenDuration / 60000 : undefined
      ),
      halfOpenSuccessThreshold: analyzeField(
        providers,
        (p) => p.circuitBreakerHalfOpenSuccessThreshold
      ),
      maxRetryAttempts: analyzeField(providers, (p) => p.maxRetryAttempts ?? null),
    },
    network: {
      proxyUrl: analyzeField(providers, (p) => p.proxyUrl ?? ""),
      proxyFallbackToDirect: analyzeField(providers, (p) => p.proxyFallbackToDirect ?? false),
      firstByteTimeoutStreamingSeconds: analyzeField(providers, (p) => {
        const ms = p.firstByteTimeoutStreamingMs;
        return ms != null && typeof ms === "number" && !Number.isNaN(ms) ? ms / 1000 : undefined;
      }),
      streamingIdleTimeoutSeconds: analyzeField(providers, (p) => {
        const ms = p.streamingIdleTimeoutMs;
        return ms != null && typeof ms === "number" && !Number.isNaN(ms) ? ms / 1000 : undefined;
      }),
      requestTimeoutNonStreamingSeconds: analyzeField(providers, (p) => {
        const ms = p.requestTimeoutNonStreamingMs;
        return ms != null && typeof ms === "number" && !Number.isNaN(ms) ? ms / 1000 : undefined;
      }),
    },
    mcp: {
      mcpPassthroughType: analyzeField(providers, (p) => p.mcpPassthroughType ?? "none"),
      mcpPassthroughUrl: analyzeField(providers, (p) => p.mcpPassthroughUrl ?? ""),
    },
  };
}
