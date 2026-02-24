import "server-only";

import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerEndpoints, providers } from "@/drizzle/schema";
import { getCachedProviders } from "@/lib/cache/provider-cache";
import { resetEndpointCircuit } from "@/lib/endpoint-circuit-breaker";
import { logger } from "@/lib/logger";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import type {
  AnthropicAdaptiveThinkingConfig,
  CreateProviderData,
  Provider,
  UpdateProviderData,
} from "@/types/provider";
import { toProvider } from "./_shared/transformers";
import {
  ensureProviderEndpointExistsForUrl,
  getOrCreateProviderVendorIdFromUrls,
  syncProviderEndpointOnProviderEdit,
  tryDeleteProviderVendorIfEmpty,
} from "./provider-endpoints";

type ProviderTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PROVIDER_RESTORE_MAX_AGE_MS = 60_000;
const ENDPOINT_RESTORE_TIME_TOLERANCE_MS = 1_000;

interface ProviderRestoreCandidate {
  id: number;
  providerVendorId: number | null;
  providerType: Provider["providerType"];
  url: string;
  deletedAt: Date | null;
}

async function restoreSoftDeletedEndpointForProvider(
  tx: ProviderTransaction,
  provider: ProviderRestoreCandidate,
  now: Date
): Promise<void> {
  if (provider.providerVendorId == null || !provider.url || !provider.deletedAt) {
    return;
  }

  const trimmedUrl = provider.url.trim();
  if (!trimmedUrl) {
    return;
  }

  const [activeReference] = await tx
    .select({ id: providers.id })
    .from(providers)
    .where(
      and(
        eq(providers.providerVendorId, provider.providerVendorId),
        eq(providers.providerType, provider.providerType),
        eq(providers.url, trimmedUrl),
        eq(providers.isEnabled, true),
        isNull(providers.deletedAt),
        ne(providers.id, provider.id)
      )
    )
    .limit(1);

  if (activeReference) {
    return;
  }

  const [activeEndpoint] = await tx
    .select({ id: providerEndpoints.id })
    .from(providerEndpoints)
    .where(
      and(
        eq(providerEndpoints.vendorId, provider.providerVendorId),
        eq(providerEndpoints.providerType, provider.providerType),
        eq(providerEndpoints.url, trimmedUrl),
        isNull(providerEndpoints.deletedAt)
      )
    )
    .limit(1);

  if (activeEndpoint) {
    return;
  }

  const lowerIso = new Date(
    provider.deletedAt.getTime() - ENDPOINT_RESTORE_TIME_TOLERANCE_MS
  ).toISOString();
  const upperIso = new Date(
    provider.deletedAt.getTime() + ENDPOINT_RESTORE_TIME_TOLERANCE_MS
  ).toISOString();

  const [endpointToRestore] = await tx
    .select({ id: providerEndpoints.id })
    .from(providerEndpoints)
    .where(
      and(
        eq(providerEndpoints.vendorId, provider.providerVendorId),
        eq(providerEndpoints.providerType, provider.providerType),
        eq(providerEndpoints.url, trimmedUrl),
        isNotNull(providerEndpoints.deletedAt),
        sql`${providerEndpoints.deletedAt} >= ${lowerIso}::timestamptz`,
        sql`${providerEndpoints.deletedAt} <= ${upperIso}::timestamptz`
      )
    )
    .orderBy(desc(providerEndpoints.deletedAt), desc(providerEndpoints.id))
    .limit(1);

  if (!endpointToRestore) {
    return;
  }

  await tx
    .update(providerEndpoints)
    .set({
      deletedAt: null,
      isEnabled: true,
      updatedAt: now,
    })
    .where(
      and(eq(providerEndpoints.id, endpointToRestore.id), isNotNull(providerEndpoints.deletedAt))
    );
}

async function restoreProviderInTransaction(
  tx: ProviderTransaction,
  providerId: number,
  now: Date
): Promise<boolean> {
  const [candidate] = await tx
    .select({
      id: providers.id,
      providerVendorId: providers.providerVendorId,
      providerType: providers.providerType,
      url: providers.url,
      deletedAt: providers.deletedAt,
    })
    .from(providers)
    .where(and(eq(providers.id, providerId), isNotNull(providers.deletedAt)))
    .limit(1);

  if (!candidate?.deletedAt) {
    return false;
  }

  if (now.getTime() - candidate.deletedAt.getTime() > PROVIDER_RESTORE_MAX_AGE_MS) {
    return false;
  }

  const restored = await tx
    .update(providers)
    .set({ deletedAt: null, updatedAt: now })
    .where(
      and(
        eq(providers.id, providerId),
        isNotNull(providers.deletedAt),
        eq(providers.deletedAt, candidate.deletedAt)
      )
    )
    .returning({ id: providers.id });

  if (restored.length === 0) {
    return false;
  }

  await restoreSoftDeletedEndpointForProvider(tx, candidate, now);

  return true;
}

export async function createProvider(providerData: CreateProviderData): Promise<Provider> {
  const dbData = {
    name: providerData.name,
    url: providerData.url,
    key: providerData.key,
    isEnabled: providerData.is_enabled,
    weight: providerData.weight,
    priority: providerData.priority,
    groupPriorities: providerData.group_priorities ?? null,
    costMultiplier:
      providerData.cost_multiplier != null ? providerData.cost_multiplier.toString() : "1.0",
    groupTag: providerData.group_tag,
    providerType: providerData.provider_type,
    preserveClientIp: providerData.preserve_client_ip ?? false,
    modelRedirects: providerData.model_redirects,
    allowedModels: providerData.allowed_models,
    allowedClients: providerData.allowed_clients ?? [],
    blockedClients: providerData.blocked_clients ?? [],
    mcpPassthroughType: providerData.mcp_passthrough_type ?? "none",
    mcpPassthroughUrl: providerData.mcp_passthrough_url ?? null,
    limit5hUsd: providerData.limit_5h_usd != null ? providerData.limit_5h_usd.toString() : null,
    limitDailyUsd:
      providerData.limit_daily_usd != null ? providerData.limit_daily_usd.toString() : null,
    dailyResetMode: providerData.daily_reset_mode ?? "fixed",
    dailyResetTime: providerData.daily_reset_time ?? "00:00",
    limitWeeklyUsd:
      providerData.limit_weekly_usd != null ? providerData.limit_weekly_usd.toString() : null,
    limitMonthlyUsd:
      providerData.limit_monthly_usd != null ? providerData.limit_monthly_usd.toString() : null,
    limitTotalUsd:
      providerData.limit_total_usd != null ? providerData.limit_total_usd.toString() : null,
    limitConcurrentSessions: providerData.limit_concurrent_sessions,
    maxRetryAttempts: providerData.max_retry_attempts ?? null,
    circuitBreakerFailureThreshold: providerData.circuit_breaker_failure_threshold ?? 5,
    circuitBreakerOpenDuration: providerData.circuit_breaker_open_duration ?? 1800000,
    circuitBreakerHalfOpenSuccessThreshold:
      providerData.circuit_breaker_half_open_success_threshold ?? 2,
    proxyUrl: providerData.proxy_url ?? null,
    proxyFallbackToDirect: providerData.proxy_fallback_to_direct ?? false,
    firstByteTimeoutStreamingMs: providerData.first_byte_timeout_streaming_ms ?? 30000,
    streamingIdleTimeoutMs: providerData.streaming_idle_timeout_ms ?? 10000,
    requestTimeoutNonStreamingMs: providerData.request_timeout_non_streaming_ms ?? 600000,
    websiteUrl: providerData.website_url ?? null,
    faviconUrl: providerData.favicon_url ?? null,
    cacheTtlPreference: providerData.cache_ttl_preference ?? null,
    swapCacheTtlBilling: providerData.swap_cache_ttl_billing ?? false,
    context1mPreference: providerData.context_1m_preference ?? null,
    codexReasoningEffortPreference: providerData.codex_reasoning_effort_preference ?? null,
    codexReasoningSummaryPreference: providerData.codex_reasoning_summary_preference ?? null,
    codexTextVerbosityPreference: providerData.codex_text_verbosity_preference ?? null,
    codexParallelToolCallsPreference: providerData.codex_parallel_tool_calls_preference ?? null,
    anthropicMaxTokensPreference: providerData.anthropic_max_tokens_preference ?? null,
    anthropicThinkingBudgetPreference: providerData.anthropic_thinking_budget_preference ?? null,
    anthropicAdaptiveThinking: providerData.anthropic_adaptive_thinking ?? null,
    geminiGoogleSearchPreference: providerData.gemini_google_search_preference ?? null,
    tpm: providerData.tpm,
    rpm: providerData.rpm,
    rpd: providerData.rpd,
    cc: providerData.cc,
  };

  return db.transaction(async (tx) => {
    const providerVendorId = await getOrCreateProviderVendorIdFromUrls(
      {
        providerUrl: providerData.url,
        websiteUrl: providerData.website_url ?? null,
        faviconUrl: providerData.favicon_url ?? null,
        displayName: providerData.name,
      },
      { tx }
    );

    const [provider] = await tx
      .insert(providers)
      .values({
        ...dbData,
        providerVendorId,
      })
      .returning({
        id: providers.id,
        name: providers.name,
        url: providers.url,
        key: providers.key,
        providerVendorId: providers.providerVendorId,
        isEnabled: providers.isEnabled,
        weight: providers.weight,
        priority: providers.priority,
        costMultiplier: providers.costMultiplier,
        groupTag: providers.groupTag,
        providerType: providers.providerType,
        preserveClientIp: providers.preserveClientIp,
        modelRedirects: providers.modelRedirects,
        allowedModels: providers.allowedModels,
        allowedClients: providers.allowedClients,
        blockedClients: providers.blockedClients,
        mcpPassthroughType: providers.mcpPassthroughType,
        mcpPassthroughUrl: providers.mcpPassthroughUrl,
        limit5hUsd: providers.limit5hUsd,
        limitDailyUsd: providers.limitDailyUsd,
        dailyResetMode: providers.dailyResetMode,
        dailyResetTime: providers.dailyResetTime,
        limitWeeklyUsd: providers.limitWeeklyUsd,
        limitMonthlyUsd: providers.limitMonthlyUsd,
        limitTotalUsd: providers.limitTotalUsd,
        totalCostResetAt: providers.totalCostResetAt,
        limitConcurrentSessions: providers.limitConcurrentSessions,
        maxRetryAttempts: providers.maxRetryAttempts,
        circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
        circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
        circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
        proxyUrl: providers.proxyUrl,
        proxyFallbackToDirect: providers.proxyFallbackToDirect,
        firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
        streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
        requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
        websiteUrl: providers.websiteUrl,
        faviconUrl: providers.faviconUrl,
        cacheTtlPreference: providers.cacheTtlPreference,
        swapCacheTtlBilling: providers.swapCacheTtlBilling,
        context1mPreference: providers.context1mPreference,
        codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
        codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
        codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
        codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
        anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
        anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
        anthropicAdaptiveThinking: providers.anthropicAdaptiveThinking,
        geminiGoogleSearchPreference: providers.geminiGoogleSearchPreference,
        tpm: providers.tpm,
        rpm: providers.rpm,
        rpd: providers.rpd,
        cc: providers.cc,
        createdAt: providers.createdAt,
        updatedAt: providers.updatedAt,
        deletedAt: providers.deletedAt,
      });

    const created = toProvider(provider);

    if (created.providerVendorId) {
      await ensureProviderEndpointExistsForUrl(
        {
          vendorId: created.providerVendorId,
          providerType: created.providerType,
          url: created.url,
        },
        { tx }
      );
    }

    return created;
  });
}

export async function findProviderList(
  limit: number = 50,
  offset: number = 0
): Promise<Provider[]> {
  const result = await db
    .select({
      id: providers.id,
      name: providers.name,
      url: providers.url,
      key: providers.key,
      providerVendorId: providers.providerVendorId,
      isEnabled: providers.isEnabled,
      weight: providers.weight,
      priority: providers.priority,
      groupPriorities: providers.groupPriorities,
      costMultiplier: providers.costMultiplier,
      groupTag: providers.groupTag,
      providerType: providers.providerType,
      preserveClientIp: providers.preserveClientIp,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
      allowedClients: providers.allowedClients,
      blockedClients: providers.blockedClients,
      mcpPassthroughType: providers.mcpPassthroughType,
      mcpPassthroughUrl: providers.mcpPassthroughUrl,
      limit5hUsd: providers.limit5hUsd,
      limitDailyUsd: providers.limitDailyUsd,
      dailyResetMode: providers.dailyResetMode,
      dailyResetTime: providers.dailyResetTime,
      limitWeeklyUsd: providers.limitWeeklyUsd,
      limitMonthlyUsd: providers.limitMonthlyUsd,
      limitTotalUsd: providers.limitTotalUsd,
      totalCostResetAt: providers.totalCostResetAt,
      limitConcurrentSessions: providers.limitConcurrentSessions,
      maxRetryAttempts: providers.maxRetryAttempts,
      circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
      circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
      circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
      proxyUrl: providers.proxyUrl,
      proxyFallbackToDirect: providers.proxyFallbackToDirect,
      firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
      streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
      requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
      websiteUrl: providers.websiteUrl,
      faviconUrl: providers.faviconUrl,
      cacheTtlPreference: providers.cacheTtlPreference,
      swapCacheTtlBilling: providers.swapCacheTtlBilling,
      context1mPreference: providers.context1mPreference,
      codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
      codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
      codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
      codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
      anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
      anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
      anthropicAdaptiveThinking: providers.anthropicAdaptiveThinking,
      geminiGoogleSearchPreference: providers.geminiGoogleSearchPreference,
      tpm: providers.tpm,
      rpm: providers.rpm,
      rpd: providers.rpd,
      cc: providers.cc,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
      deletedAt: providers.deletedAt,
    })
    .from(providers)
    .where(isNull(providers.deletedAt))
    .orderBy(desc(providers.createdAt))
    .limit(limit)
    .offset(offset);

  logger.trace("findProviderList:query_result", {
    count: result.length,
    ids: result.map((r) => r.id),
  });

  return result.map(toProvider);
}

/**
 * 直接从数据库获取所有供应商（绕过缓存）
 *
 * 用于：
 * - 管理后台需要保证数据新鲜度的场景
 * - 缓存刷新时的数据源
 */
export async function findAllProvidersFresh(): Promise<Provider[]> {
  const result = await db
    .select({
      id: providers.id,
      name: providers.name,
      url: providers.url,
      key: providers.key,
      providerVendorId: providers.providerVendorId,
      isEnabled: providers.isEnabled,
      weight: providers.weight,
      priority: providers.priority,
      groupPriorities: providers.groupPriorities,
      costMultiplier: providers.costMultiplier,
      groupTag: providers.groupTag,
      providerType: providers.providerType,
      preserveClientIp: providers.preserveClientIp,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
      allowedClients: providers.allowedClients,
      blockedClients: providers.blockedClients,
      mcpPassthroughType: providers.mcpPassthroughType,
      mcpPassthroughUrl: providers.mcpPassthroughUrl,
      limit5hUsd: providers.limit5hUsd,
      limitDailyUsd: providers.limitDailyUsd,
      dailyResetMode: providers.dailyResetMode,
      dailyResetTime: providers.dailyResetTime,
      limitWeeklyUsd: providers.limitWeeklyUsd,
      limitMonthlyUsd: providers.limitMonthlyUsd,
      limitTotalUsd: providers.limitTotalUsd,
      totalCostResetAt: providers.totalCostResetAt,
      limitConcurrentSessions: providers.limitConcurrentSessions,
      maxRetryAttempts: providers.maxRetryAttempts,
      circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
      circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
      circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
      proxyUrl: providers.proxyUrl,
      proxyFallbackToDirect: providers.proxyFallbackToDirect,
      firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
      streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
      requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
      websiteUrl: providers.websiteUrl,
      faviconUrl: providers.faviconUrl,
      cacheTtlPreference: providers.cacheTtlPreference,
      swapCacheTtlBilling: providers.swapCacheTtlBilling,
      context1mPreference: providers.context1mPreference,
      codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
      codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
      codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
      codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
      anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
      anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
      anthropicAdaptiveThinking: providers.anthropicAdaptiveThinking,
      geminiGoogleSearchPreference: providers.geminiGoogleSearchPreference,
      tpm: providers.tpm,
      rpm: providers.rpm,
      rpd: providers.rpd,
      cc: providers.cc,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
      deletedAt: providers.deletedAt,
    })
    .from(providers)
    .where(isNull(providers.deletedAt))
    .orderBy(desc(providers.createdAt));

  logger.trace("findAllProvidersFresh:query_result", {
    count: result.length,
    ids: result.map((r) => r.id),
  });

  return result.map(toProvider);
}

/**
 * 获取所有供应商（带缓存）
 *
 * 使用进程级缓存：
 * - 30s TTL 自动过期
 * - Redis Pub/Sub 跨实例即时失效
 *
 * 用于高频读取场景（如供应商选择）
 */
export async function findAllProviders(): Promise<Provider[]> {
  return getCachedProviders(findAllProvidersFresh);
}

export async function findProviderById(id: number): Promise<Provider | null> {
  const [provider] = await db
    .select({
      id: providers.id,
      name: providers.name,
      url: providers.url,
      key: providers.key,
      providerVendorId: providers.providerVendorId,
      isEnabled: providers.isEnabled,
      weight: providers.weight,
      priority: providers.priority,
      groupPriorities: providers.groupPriorities,
      costMultiplier: providers.costMultiplier,
      groupTag: providers.groupTag,
      providerType: providers.providerType,
      preserveClientIp: providers.preserveClientIp,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
      allowedClients: providers.allowedClients,
      blockedClients: providers.blockedClients,
      mcpPassthroughType: providers.mcpPassthroughType,
      mcpPassthroughUrl: providers.mcpPassthroughUrl,
      limit5hUsd: providers.limit5hUsd,
      limitDailyUsd: providers.limitDailyUsd,
      dailyResetMode: providers.dailyResetMode,
      dailyResetTime: providers.dailyResetTime,
      limitWeeklyUsd: providers.limitWeeklyUsd,
      limitMonthlyUsd: providers.limitMonthlyUsd,
      limitTotalUsd: providers.limitTotalUsd,
      totalCostResetAt: providers.totalCostResetAt,
      limitConcurrentSessions: providers.limitConcurrentSessions,
      maxRetryAttempts: providers.maxRetryAttempts,
      circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
      circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
      circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
      proxyUrl: providers.proxyUrl,
      proxyFallbackToDirect: providers.proxyFallbackToDirect,
      firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
      streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
      requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
      websiteUrl: providers.websiteUrl,
      faviconUrl: providers.faviconUrl,
      cacheTtlPreference: providers.cacheTtlPreference,
      swapCacheTtlBilling: providers.swapCacheTtlBilling,
      context1mPreference: providers.context1mPreference,
      codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
      codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
      codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
      codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
      anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
      anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
      anthropicAdaptiveThinking: providers.anthropicAdaptiveThinking,
      geminiGoogleSearchPreference: providers.geminiGoogleSearchPreference,
      tpm: providers.tpm,
      rpm: providers.rpm,
      rpd: providers.rpd,
      cc: providers.cc,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
      deletedAt: providers.deletedAt,
    })
    .from(providers)
    .where(and(eq(providers.id, id), isNull(providers.deletedAt)));

  if (!provider) return null;
  return toProvider(provider);
}

export async function updateProvider(
  id: number,
  providerData: UpdateProviderData
): Promise<Provider | null> {
  if (Object.keys(providerData).length === 0) {
    return findProviderById(id);
  }

  const dbData: Partial<typeof providers.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (providerData.name !== undefined) dbData.name = providerData.name;
  if (providerData.url !== undefined) dbData.url = providerData.url;
  if (providerData.key !== undefined) dbData.key = providerData.key;
  if (providerData.is_enabled !== undefined) dbData.isEnabled = providerData.is_enabled;
  if (providerData.weight !== undefined) dbData.weight = providerData.weight;
  if (providerData.priority !== undefined) dbData.priority = providerData.priority;
  if (providerData.group_priorities !== undefined)
    dbData.groupPriorities = providerData.group_priorities ?? null;
  if (providerData.cost_multiplier !== undefined)
    dbData.costMultiplier =
      providerData.cost_multiplier != null ? providerData.cost_multiplier.toString() : "1.0";
  if (providerData.group_tag !== undefined) dbData.groupTag = providerData.group_tag;
  if (providerData.provider_type !== undefined) dbData.providerType = providerData.provider_type;
  if (providerData.preserve_client_ip !== undefined)
    dbData.preserveClientIp = providerData.preserve_client_ip;
  if (providerData.model_redirects !== undefined)
    dbData.modelRedirects = providerData.model_redirects;
  if (providerData.allowed_models !== undefined) dbData.allowedModels = providerData.allowed_models;
  if (providerData.allowed_clients !== undefined)
    dbData.allowedClients = providerData.allowed_clients ?? [];
  if (providerData.blocked_clients !== undefined)
    dbData.blockedClients = providerData.blocked_clients ?? [];
  if (providerData.mcp_passthrough_type !== undefined)
    dbData.mcpPassthroughType = providerData.mcp_passthrough_type;
  if (providerData.mcp_passthrough_url !== undefined)
    dbData.mcpPassthroughUrl = providerData.mcp_passthrough_url;
  if (providerData.limit_5h_usd !== undefined)
    dbData.limit5hUsd =
      providerData.limit_5h_usd != null ? providerData.limit_5h_usd.toString() : null;
  if (providerData.limit_daily_usd !== undefined)
    dbData.limitDailyUsd =
      providerData.limit_daily_usd != null ? providerData.limit_daily_usd.toString() : null;
  if (providerData.daily_reset_mode !== undefined)
    dbData.dailyResetMode = providerData.daily_reset_mode;
  if (providerData.daily_reset_time !== undefined)
    dbData.dailyResetTime = providerData.daily_reset_time;
  if (providerData.limit_weekly_usd !== undefined)
    dbData.limitWeeklyUsd =
      providerData.limit_weekly_usd != null ? providerData.limit_weekly_usd.toString() : null;
  if (providerData.limit_monthly_usd !== undefined)
    dbData.limitMonthlyUsd =
      providerData.limit_monthly_usd != null ? providerData.limit_monthly_usd.toString() : null;
  if (providerData.limit_total_usd !== undefined)
    dbData.limitTotalUsd =
      providerData.limit_total_usd != null ? providerData.limit_total_usd.toString() : null;
  if (providerData.limit_concurrent_sessions !== undefined)
    dbData.limitConcurrentSessions = providerData.limit_concurrent_sessions;
  if (providerData.max_retry_attempts !== undefined)
    dbData.maxRetryAttempts = providerData.max_retry_attempts;
  if (providerData.circuit_breaker_failure_threshold !== undefined)
    dbData.circuitBreakerFailureThreshold = providerData.circuit_breaker_failure_threshold;
  if (providerData.circuit_breaker_open_duration !== undefined)
    dbData.circuitBreakerOpenDuration = providerData.circuit_breaker_open_duration;
  if (providerData.circuit_breaker_half_open_success_threshold !== undefined)
    dbData.circuitBreakerHalfOpenSuccessThreshold =
      providerData.circuit_breaker_half_open_success_threshold;
  if (providerData.proxy_url !== undefined) dbData.proxyUrl = providerData.proxy_url;
  if (providerData.proxy_fallback_to_direct !== undefined)
    dbData.proxyFallbackToDirect = providerData.proxy_fallback_to_direct;
  if (providerData.first_byte_timeout_streaming_ms !== undefined)
    dbData.firstByteTimeoutStreamingMs = providerData.first_byte_timeout_streaming_ms;
  if (providerData.streaming_idle_timeout_ms !== undefined)
    dbData.streamingIdleTimeoutMs = providerData.streaming_idle_timeout_ms;
  if (providerData.request_timeout_non_streaming_ms !== undefined)
    dbData.requestTimeoutNonStreamingMs = providerData.request_timeout_non_streaming_ms;
  if (providerData.website_url !== undefined) dbData.websiteUrl = providerData.website_url;
  if (providerData.favicon_url !== undefined) dbData.faviconUrl = providerData.favicon_url;
  if (providerData.cache_ttl_preference !== undefined)
    dbData.cacheTtlPreference = providerData.cache_ttl_preference ?? null;
  if (providerData.swap_cache_ttl_billing !== undefined)
    dbData.swapCacheTtlBilling = providerData.swap_cache_ttl_billing;
  if (providerData.context_1m_preference !== undefined)
    dbData.context1mPreference = providerData.context_1m_preference ?? null;
  if (providerData.codex_reasoning_effort_preference !== undefined)
    dbData.codexReasoningEffortPreference = providerData.codex_reasoning_effort_preference ?? null;
  if (providerData.codex_reasoning_summary_preference !== undefined)
    dbData.codexReasoningSummaryPreference =
      providerData.codex_reasoning_summary_preference ?? null;
  if (providerData.codex_text_verbosity_preference !== undefined)
    dbData.codexTextVerbosityPreference = providerData.codex_text_verbosity_preference ?? null;
  if (providerData.codex_parallel_tool_calls_preference !== undefined)
    dbData.codexParallelToolCallsPreference =
      providerData.codex_parallel_tool_calls_preference ?? null;
  if (providerData.anthropic_max_tokens_preference !== undefined)
    dbData.anthropicMaxTokensPreference = providerData.anthropic_max_tokens_preference ?? null;
  if (providerData.anthropic_thinking_budget_preference !== undefined)
    dbData.anthropicThinkingBudgetPreference =
      providerData.anthropic_thinking_budget_preference ?? null;
  if (providerData.anthropic_adaptive_thinking !== undefined)
    dbData.anthropicAdaptiveThinking = providerData.anthropic_adaptive_thinking ?? null;
  if (providerData.gemini_google_search_preference !== undefined)
    dbData.geminiGoogleSearchPreference = providerData.gemini_google_search_preference ?? null;
  if (providerData.tpm !== undefined) dbData.tpm = providerData.tpm;
  if (providerData.rpm !== undefined) dbData.rpm = providerData.rpm;
  if (providerData.rpd !== undefined) dbData.rpd = providerData.rpd;
  if (providerData.cc !== undefined) dbData.cc = providerData.cc;

  const shouldRefreshVendor =
    providerData.url !== undefined || providerData.website_url !== undefined;
  const shouldSyncEndpoint =
    shouldRefreshVendor ||
    providerData.provider_type !== undefined ||
    providerData.is_enabled === true;

  const updateResult = await db.transaction(async (tx) => {
    let previousVendorId: number | null = null;
    let previousUrl: string | null = null;
    let previousProviderType: Provider["providerType"] | null = null;
    let previousIsEnabled: boolean | null = null;
    let endpointCircuitResetId: number | null = null;

    if (shouldSyncEndpoint) {
      const [current] = await tx
        .select({
          url: providers.url,
          websiteUrl: providers.websiteUrl,
          faviconUrl: providers.faviconUrl,
          name: providers.name,
          providerVendorId: providers.providerVendorId,
          providerType: providers.providerType,
          isEnabled: providers.isEnabled,
        })
        .from(providers)
        .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
        .limit(1);

      if (current) {
        previousVendorId = current.providerVendorId;
        previousUrl = current.url;
        previousProviderType = current.providerType;
        previousIsEnabled = current.isEnabled;

        if (shouldRefreshVendor) {
          const providerVendorId = await getOrCreateProviderVendorIdFromUrls(
            {
              providerUrl: providerData.url ?? current.url,
              websiteUrl: providerData.website_url ?? current.websiteUrl,
              faviconUrl: providerData.favicon_url ?? current.faviconUrl,
              displayName: providerData.name ?? current.name,
            },
            { tx }
          );
          dbData.providerVendorId = providerVendorId;
        }
      }
    }

    const [provider] = await tx
      .update(providers)
      .set(dbData)
      .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
      .returning({
        id: providers.id,
        name: providers.name,
        url: providers.url,
        key: providers.key,
        providerVendorId: providers.providerVendorId,
        isEnabled: providers.isEnabled,
        weight: providers.weight,
        priority: providers.priority,
        groupPriorities: providers.groupPriorities,
        costMultiplier: providers.costMultiplier,
        groupTag: providers.groupTag,
        providerType: providers.providerType,
        preserveClientIp: providers.preserveClientIp,
        modelRedirects: providers.modelRedirects,
        allowedModels: providers.allowedModels,
        allowedClients: providers.allowedClients,
        blockedClients: providers.blockedClients,
        mcpPassthroughType: providers.mcpPassthroughType,
        mcpPassthroughUrl: providers.mcpPassthroughUrl,
        limit5hUsd: providers.limit5hUsd,
        limitDailyUsd: providers.limitDailyUsd,
        dailyResetMode: providers.dailyResetMode,
        dailyResetTime: providers.dailyResetTime,
        limitWeeklyUsd: providers.limitWeeklyUsd,
        limitMonthlyUsd: providers.limitMonthlyUsd,
        limitTotalUsd: providers.limitTotalUsd,
        totalCostResetAt: providers.totalCostResetAt,
        limitConcurrentSessions: providers.limitConcurrentSessions,
        maxRetryAttempts: providers.maxRetryAttempts,
        circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
        circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
        circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
        proxyUrl: providers.proxyUrl,
        proxyFallbackToDirect: providers.proxyFallbackToDirect,
        firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
        streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
        requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
        websiteUrl: providers.websiteUrl,
        faviconUrl: providers.faviconUrl,
        cacheTtlPreference: providers.cacheTtlPreference,
        swapCacheTtlBilling: providers.swapCacheTtlBilling,
        context1mPreference: providers.context1mPreference,
        codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
        codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
        codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
        codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
        anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
        anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
        anthropicAdaptiveThinking: providers.anthropicAdaptiveThinking,
        geminiGoogleSearchPreference: providers.geminiGoogleSearchPreference,
        tpm: providers.tpm,
        rpm: providers.rpm,
        rpd: providers.rpd,
        cc: providers.cc,
        createdAt: providers.createdAt,
        updatedAt: providers.updatedAt,
        deletedAt: providers.deletedAt,
      });

    if (!provider) return null;
    const transformed = toProvider(provider);

    if (shouldSyncEndpoint && transformed.providerVendorId) {
      // 注意：即使 provider 当前处于禁用态，只要 vendor/type/url 发生变化也同步 endpoint pool：
      // - 避免旧 URL 残留为 orphan endpoints（#781）
      // - 保证后续启用/其它同 vendor/type 的 provider 能直接复用端点池
      if (
        previousUrl &&
        previousProviderType &&
        (previousUrl !== transformed.url ||
          previousProviderType !== transformed.providerType ||
          (previousVendorId != null && previousVendorId !== transformed.providerVendorId))
      ) {
        const syncResult = await syncProviderEndpointOnProviderEdit(
          {
            providerId: transformed.id,
            vendorId: transformed.providerVendorId,
            providerType: transformed.providerType,
            previousVendorId,
            previousProviderType,
            previousUrl,
            nextUrl: transformed.url,
            keepPreviousWhenReferenced: true,
          },
          { tx }
        );

        endpointCircuitResetId = syncResult.resetCircuitEndpointId ?? null;
      } else if (previousIsEnabled === false && transformed.isEnabled === true) {
        await ensureProviderEndpointExistsForUrl(
          {
            vendorId: transformed.providerVendorId,
            providerType: transformed.providerType,
            url: transformed.url,
          },
          { tx }
        );
      }
    }

    return {
      provider: transformed,
      previousVendorIdToCleanup:
        previousVendorId && transformed.providerVendorId !== previousVendorId
          ? previousVendorId
          : null,
      endpointCircuitResetId,
    };
  });

  if (!updateResult) {
    return null;
  }

  if (updateResult.endpointCircuitResetId != null) {
    try {
      await resetEndpointCircuit(updateResult.endpointCircuitResetId);
    } catch (error) {
      logger.warn("updateProvider:reset_endpoint_circuit_failed", {
        providerId: updateResult.provider.id,
        endpointId: updateResult.endpointCircuitResetId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (updateResult.previousVendorIdToCleanup) {
    try {
      await tryDeleteProviderVendorIfEmpty(updateResult.previousVendorIdToCleanup);
    } catch (error) {
      logger.warn("updateProvider:vendor_cleanup_failed", {
        providerId: updateResult.provider.id,
        previousVendorId: updateResult.previousVendorIdToCleanup,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return updateResult.provider;
}

export async function updateProviderPrioritiesBatch(
  updates: Array<{ id: number; priority: number }>
): Promise<number> {
  if (updates.length === 0) {
    return 0;
  }

  // Deduplicate ids: last one wins
  const updateMap = new Map<number, number>();
  for (const update of updates) {
    updateMap.set(update.id, update.priority);
  }

  const ids = Array.from(updateMap.keys());
  const priorityCol = sql.identifier("priority");
  const updatedAtCol = sql.identifier("updated_at");
  const cases = ids.map((id) => sql`WHEN ${id} THEN ${updateMap.get(id)!}`);

  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  );

  const query = sql`
    UPDATE providers
    SET
      ${priorityCol} = CASE id ${sql.join(cases, sql` `)} ELSE ${priorityCol} END,
      ${updatedAtCol} = NOW()
    WHERE id IN (${idList}) AND deleted_at IS NULL
  `;

  const result = await db.execute(query);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Number((result as any).count) || 0;
}

export async function deleteProvider(id: number): Promise<boolean> {
  const now = new Date();

  const deleted = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        providerVendorId: providers.providerVendorId,
        providerType: providers.providerType,
        url: providers.url,
      })
      .from(providers)
      .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
      .limit(1);

    if (!current) {
      return false;
    }

    const result = await tx
      .update(providers)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
      .returning({ id: providers.id });

    if (result.length === 0) {
      return false;
    }

    if (current.providerVendorId != null && current.url) {
      const [activeReference] = await tx
        .select({ id: providers.id })
        .from(providers)
        .where(
          and(
            eq(providers.providerVendorId, current.providerVendorId),
            eq(providers.providerType, current.providerType),
            eq(providers.url, current.url),
            eq(providers.isEnabled, true),
            isNull(providers.deletedAt)
          )
        )
        .limit(1);

      if (!activeReference) {
        await tx
          .update(providerEndpoints)
          .set({
            deletedAt: now,
            isEnabled: false,
            updatedAt: now,
          })
          .where(
            and(
              eq(providerEndpoints.vendorId, current.providerVendorId),
              eq(providerEndpoints.providerType, current.providerType),
              eq(providerEndpoints.url, current.url),
              isNull(providerEndpoints.deletedAt)
            )
          );
      }
    }

    return true;
  });

  return deleted;
}

/**
 * 恢复单个软删除供应商及其关联端点。
 *
 * 安全策略：仅允许恢复 60 秒内删除的供应商。
 */
export async function restoreProvider(id: number): Promise<boolean> {
  const now = new Date();

  const restored = await db.transaction(async (tx) => restoreProviderInTransaction(tx, id, now));

  return restored;
}

export interface BatchProviderUpdates {
  isEnabled?: boolean;
  priority?: number;
  weight?: number;
  costMultiplier?: string;
  groupTag?: string | null;
  modelRedirects?: Record<string, string> | null;
  allowedModels?: string[] | null;
  allowedClients?: string[] | null;
  blockedClients?: string[] | null;
  anthropicThinkingBudgetPreference?: string | null;
  anthropicAdaptiveThinking?: AnthropicAdaptiveThinkingConfig | null;
  // Routing
  preserveClientIp?: boolean;
  groupPriorities?: Record<string, number> | null;
  cacheTtlPreference?: string | null;
  swapCacheTtlBilling?: boolean;
  context1mPreference?: string | null;
  codexReasoningEffortPreference?: string | null;
  codexReasoningSummaryPreference?: string | null;
  codexTextVerbosityPreference?: string | null;
  codexParallelToolCallsPreference?: string | null;
  anthropicMaxTokensPreference?: string | null;
  geminiGoogleSearchPreference?: string | null;
  // Rate Limit
  limit5hUsd?: string | null;
  limitDailyUsd?: string | null;
  dailyResetMode?: string;
  dailyResetTime?: string;
  limitWeeklyUsd?: string | null;
  limitMonthlyUsd?: string | null;
  limitTotalUsd?: string | null;
  limitConcurrentSessions?: number;
  // Circuit Breaker
  circuitBreakerFailureThreshold?: number;
  circuitBreakerOpenDuration?: number;
  circuitBreakerHalfOpenSuccessThreshold?: number;
  maxRetryAttempts?: number | null;
  // Network
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
  firstByteTimeoutStreamingMs?: number;
  streamingIdleTimeoutMs?: number;
  requestTimeoutNonStreamingMs?: number;
  // MCP
  mcpPassthroughType?: string;
  mcpPassthroughUrl?: string | null;
}

export async function updateProvidersBatch(
  ids: number[],
  updates: BatchProviderUpdates
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const uniqueIds = [...new Set(ids)];
  const now = new Date();
  const setClauses: Record<string, unknown> = { updatedAt: now };

  if (updates.isEnabled !== undefined) {
    setClauses.isEnabled = updates.isEnabled;
  }
  if (updates.priority !== undefined) {
    setClauses.priority = updates.priority;
  }
  if (updates.weight !== undefined) {
    setClauses.weight = updates.weight;
  }
  if (updates.costMultiplier !== undefined) {
    setClauses.costMultiplier = updates.costMultiplier;
  }
  if (updates.groupTag !== undefined) {
    setClauses.groupTag = updates.groupTag;
  }
  if (updates.modelRedirects !== undefined) {
    setClauses.modelRedirects = updates.modelRedirects;
  }
  if (updates.allowedModels !== undefined) {
    setClauses.allowedModels = updates.allowedModels;
  }
  if (updates.allowedClients !== undefined) {
    setClauses.allowedClients = updates.allowedClients;
  }
  if (updates.blockedClients !== undefined) {
    setClauses.blockedClients = updates.blockedClients;
  }
  if (updates.anthropicThinkingBudgetPreference !== undefined) {
    setClauses.anthropicThinkingBudgetPreference = updates.anthropicThinkingBudgetPreference;
  }
  if (updates.anthropicAdaptiveThinking !== undefined) {
    setClauses.anthropicAdaptiveThinking = updates.anthropicAdaptiveThinking;
  }
  // Routing
  if (updates.preserveClientIp !== undefined) {
    setClauses.preserveClientIp = updates.preserveClientIp;
  }
  if (updates.groupPriorities !== undefined) {
    setClauses.groupPriorities = updates.groupPriorities;
  }
  if (updates.cacheTtlPreference !== undefined) {
    setClauses.cacheTtlPreference = updates.cacheTtlPreference;
  }
  if (updates.swapCacheTtlBilling !== undefined) {
    setClauses.swapCacheTtlBilling = updates.swapCacheTtlBilling;
  }
  if (updates.context1mPreference !== undefined) {
    setClauses.context1mPreference = updates.context1mPreference;
  }
  if (updates.codexReasoningEffortPreference !== undefined) {
    setClauses.codexReasoningEffortPreference = updates.codexReasoningEffortPreference;
  }
  if (updates.codexReasoningSummaryPreference !== undefined) {
    setClauses.codexReasoningSummaryPreference = updates.codexReasoningSummaryPreference;
  }
  if (updates.codexTextVerbosityPreference !== undefined) {
    setClauses.codexTextVerbosityPreference = updates.codexTextVerbosityPreference;
  }
  if (updates.codexParallelToolCallsPreference !== undefined) {
    setClauses.codexParallelToolCallsPreference = updates.codexParallelToolCallsPreference;
  }
  if (updates.anthropicMaxTokensPreference !== undefined) {
    setClauses.anthropicMaxTokensPreference = updates.anthropicMaxTokensPreference;
  }
  if (updates.geminiGoogleSearchPreference !== undefined) {
    setClauses.geminiGoogleSearchPreference = updates.geminiGoogleSearchPreference;
  }
  // Rate Limit
  if (updates.limit5hUsd !== undefined) {
    setClauses.limit5hUsd = updates.limit5hUsd;
  }
  if (updates.limitDailyUsd !== undefined) {
    setClauses.limitDailyUsd = updates.limitDailyUsd;
  }
  if (updates.dailyResetMode !== undefined) {
    setClauses.dailyResetMode = updates.dailyResetMode;
  }
  if (updates.dailyResetTime !== undefined) {
    setClauses.dailyResetTime = updates.dailyResetTime;
  }
  if (updates.limitWeeklyUsd !== undefined) {
    setClauses.limitWeeklyUsd = updates.limitWeeklyUsd;
  }
  if (updates.limitMonthlyUsd !== undefined) {
    setClauses.limitMonthlyUsd = updates.limitMonthlyUsd;
  }
  if (updates.limitTotalUsd !== undefined) {
    setClauses.limitTotalUsd = updates.limitTotalUsd;
  }
  if (updates.limitConcurrentSessions !== undefined) {
    setClauses.limitConcurrentSessions = updates.limitConcurrentSessions;
  }
  // Circuit Breaker
  if (updates.circuitBreakerFailureThreshold !== undefined) {
    setClauses.circuitBreakerFailureThreshold = updates.circuitBreakerFailureThreshold;
  }
  if (updates.circuitBreakerOpenDuration !== undefined) {
    setClauses.circuitBreakerOpenDuration = updates.circuitBreakerOpenDuration;
  }
  if (updates.circuitBreakerHalfOpenSuccessThreshold !== undefined) {
    setClauses.circuitBreakerHalfOpenSuccessThreshold =
      updates.circuitBreakerHalfOpenSuccessThreshold;
  }
  if (updates.maxRetryAttempts !== undefined) {
    setClauses.maxRetryAttempts = updates.maxRetryAttempts;
  }
  // Network
  if (updates.proxyUrl !== undefined) {
    setClauses.proxyUrl = updates.proxyUrl;
  }
  if (updates.proxyFallbackToDirect !== undefined) {
    setClauses.proxyFallbackToDirect = updates.proxyFallbackToDirect;
  }
  if (updates.firstByteTimeoutStreamingMs !== undefined) {
    setClauses.firstByteTimeoutStreamingMs = updates.firstByteTimeoutStreamingMs;
  }
  if (updates.streamingIdleTimeoutMs !== undefined) {
    setClauses.streamingIdleTimeoutMs = updates.streamingIdleTimeoutMs;
  }
  if (updates.requestTimeoutNonStreamingMs !== undefined) {
    setClauses.requestTimeoutNonStreamingMs = updates.requestTimeoutNonStreamingMs;
  }
  // MCP
  if (updates.mcpPassthroughType !== undefined) {
    setClauses.mcpPassthroughType = updates.mcpPassthroughType;
  }
  if (updates.mcpPassthroughUrl !== undefined) {
    setClauses.mcpPassthroughUrl = updates.mcpPassthroughUrl;
  }

  if (Object.keys(setClauses).length === 1) {
    return 0;
  }

  const result = await db
    .update(providers)
    .set(setClauses)
    .where(and(inArray(providers.id, uniqueIds), isNull(providers.deletedAt)))
    .returning({
      id: providers.id,
      providerVendorId: providers.providerVendorId,
      providerType: providers.providerType,
      url: providers.url,
    });

  // #779/#781：批量启用供应商时，best-effort 确保 endpoint pool 中存在对应 URL（避免历史/竞态导致启用后严格端点被阻断）。
  if (updates.isEnabled === true && result.length > 0) {
    const endpointKeys = new Map<
      string,
      { vendorId: number; providerType: Provider["providerType"]; url: string }
    >();

    for (const row of result) {
      if (row.providerVendorId == null || typeof row.url !== "string") {
        continue;
      }

      const trimmedUrl = row.url.trim();
      if (!trimmedUrl) {
        continue;
      }

      try {
        // eslint-disable-next-line no-new
        new URL(trimmedUrl);
      } catch {
        logger.warn("updateProvidersBatch:skip_invalid_url", {
          providerId: row.id,
          vendorId: row.providerVendorId,
          providerType: row.providerType,
          url: trimmedUrl,
        });
        continue;
      }

      const key = `${row.providerVendorId}::${row.providerType}::${trimmedUrl}`;
      if (endpointKeys.has(key)) continue;

      endpointKeys.set(key, {
        vendorId: row.providerVendorId,
        providerType: row.providerType,
        url: trimmedUrl,
      });
    }

    if (endpointKeys.size > 0) {
      try {
        const inserted = await db
          .insert(providerEndpoints)
          .values(
            Array.from(endpointKeys.values()).map((endpoint) => ({
              vendorId: endpoint.vendorId,
              providerType: endpoint.providerType,
              url: endpoint.url,
              label: null,
              updatedAt: now,
            }))
          )
          .onConflictDoNothing({
            target: [
              providerEndpoints.vendorId,
              providerEndpoints.providerType,
              providerEndpoints.url,
            ],
            where: sql`${providerEndpoints.deletedAt} IS NULL`,
          })
          .returning({ id: providerEndpoints.id });

        logger.debug("updateProvidersBatch:ensured_provider_endpoints", {
          updatedProviders: result.length,
          candidateEndpoints: endpointKeys.size,
          insertedEndpoints: inserted.length,
        });
      } catch (error) {
        logger.warn("updateProvidersBatch:ensure_provider_endpoints_failed", {
          updatedProviders: result.length,
          candidateEndpoints: endpointKeys.size,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  logger.debug("updateProvidersBatch:completed", {
    requestedIds: uniqueIds.length,
    updatedCount: result.length,
    fields: Object.keys(setClauses).filter((k) => k !== "updatedAt"),
  });

  return result.length;
}

export async function deleteProvidersBatch(ids: number[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const uniqueIds = [...new Set(ids)];
  const now = new Date();

  const deletedCount = await db.transaction(async (tx) => {
    const result = await tx
      .update(providers)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(inArray(providers.id, uniqueIds), isNull(providers.deletedAt)))
      .returning({
        id: providers.id,
        providerVendorId: providers.providerVendorId,
        providerType: providers.providerType,
        url: providers.url,
      });

    if (result.length === 0) {
      return 0;
    }

    const endpointKeys = new Map<
      string,
      { vendorId: number; providerType: Provider["providerType"]; url: string }
    >();

    for (const candidate of result) {
      if (candidate.providerVendorId == null || !candidate.url) {
        continue;
      }

      const key = `${candidate.providerVendorId}::${candidate.providerType}::${candidate.url}`;
      if (endpointKeys.has(key)) {
        continue;
      }

      endpointKeys.set(key, {
        vendorId: candidate.providerVendorId,
        providerType: candidate.providerType,
        url: candidate.url,
      });
    }

    const endpoints = Array.from(endpointKeys.values());
    if (endpoints.length === 0) {
      return result.length;
    }

    const chunkSize = 200;

    for (let i = 0; i < endpoints.length; i += chunkSize) {
      const chunk = endpoints.slice(i, i + chunkSize);
      const tupleList = sql.join(
        chunk.map(
          (endpoint) => sql`(${endpoint.vendorId}, ${endpoint.providerType}, ${endpoint.url})`
        ),
        sql`, `
      );

      await tx
        .update(providerEndpoints)
        .set({
          deletedAt: now,
          isEnabled: false,
          updatedAt: now,
        })
        .where(
          and(
            isNull(providerEndpoints.deletedAt),
            sql`(${providerEndpoints.vendorId}, ${providerEndpoints.providerType}, ${providerEndpoints.url}) IN (${tupleList})`,
            sql`NOT EXISTS (
              SELECT 1
              FROM providers p
              WHERE p.is_enabled = true
                AND p.deleted_at IS NULL
                AND p.provider_vendor_id = ${providerEndpoints.vendorId}
                AND p.provider_type = ${providerEndpoints.providerType}
                AND p.url = ${providerEndpoints.url}
            )`
          )
        );
    }

    return result.length;
  });

  logger.debug("deleteProvidersBatch:completed", {
    requestedIds: uniqueIds.length,
    deletedCount,
  });

  return deletedCount;
}

/**
 * 批量恢复软删除供应商及其关联端点（事务内逐个恢复）。
 *
 * 安全策略：仅允许恢复 60 秒内删除的供应商。
 */
export async function restoreProvidersBatch(ids: number[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const uniqueIds = [...new Set(ids)];
  const now = new Date();

  const restoredCount = await db.transaction(async (tx) => {
    let restored = 0;

    for (const id of uniqueIds) {
      if (await restoreProviderInTransaction(tx, id, now)) {
        restored += 1;
      }
    }

    return restored;
  });

  logger.debug("restoreProvidersBatch:completed", {
    requestedIds: uniqueIds.length,
    restoredCount,
  });

  return restoredCount;
}

/**
 * 手动重置供应商"总消费"统计起点
 *
 * 说明：
 * - 不删除 message_request 历史记录，仅通过 resetAt 作为聚合下限实现“从 0 重新累计”。
 */
export async function resetProviderTotalCostResetAt(
  providerId: number,
  resetAt: Date
): Promise<boolean> {
  const result = await db
    .update(providers)
    .set({ totalCostResetAt: resetAt, updatedAt: new Date() })
    .where(and(eq(providers.id, providerId), isNull(providers.deletedAt)))
    .returning({ id: providers.id });

  return result.length > 0;
}

/**
 * 获取所有不同的供应商分组标签
 * 用于用户表单中的供应商分组选择建议
 *
 * 注意：groupTag 字段以逗号分隔存储多个标签（如 "cli,chat"），
 * 此函数会拆分并去重，返回单个标签的数组（如 ["chat", "cli"]）
 */
export async function getDistinctProviderGroups(): Promise<string[]> {
  const result = await db
    .selectDistinct({ groupTag: providers.groupTag })
    .from(providers)
    .where(
      and(
        isNull(providers.deletedAt),
        and(isNotNull(providers.groupTag), ne(providers.groupTag, ""))
      )
    )
    .orderBy(providers.groupTag);

  // 拆分逗号分隔的标签并去重
  const allTags = result
    .map((r) => r.groupTag)
    .filter((tag): tag is string => tag !== null)
    .flatMap((tag) =>
      tag
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    );

  return [...new Set(allTags)].sort();
}

/**
 * 获取所有供应商的统计信息
 * 包括：今天的总金额、今天的调用次数、最近一次调用时间和模型
 *
 * 性能优化：
 * - provider_stats: 先按最终供应商聚合，再与 providers 做 LEFT JOIN，避免 providers × usage_ledger 的笛卡尔积
 * - bounds: 用“按时区计算的时间范围”过滤 created_at，便于命中 created_at 索引
 * - DST 兼容：对“本地日界/近 7 日”先在 timestamp 上做 +interval，再 AT TIME ZONE 回到 timestamptz，避免夏令时跨日偏移
 * - latest_call: 限制近 7 天范围，避免扫描历史数据
 */
export type ProviderStatisticsRow = {
  id: number;
  today_cost: string;
  today_calls: number;
  last_call_time: Date | null;
  last_call_model: string | null;
};

// 轻量内存缓存：降低后台轮询/重复加载导致的重复扫描
const PROVIDER_STATISTICS_CACHE_TTL_MS = 10 * 1000; // 10 秒
let providerStatisticsCache: {
  timezone: string;
  expiresAt: number;
  data: ProviderStatisticsRow[];
} | null = null;

// in-flight 去重：避免缓存过期瞬间并发触发多次相同查询（thundering herd）
let providerStatisticsInFlight: {
  timezone: string;
  promise: Promise<ProviderStatisticsRow[]>;
} | null = null;

export async function getProviderStatistics(): Promise<ProviderStatisticsRow[]> {
  try {
    // 统一的时区处理：使用 PostgreSQL AT TIME ZONE + 系统时区配置
    // 参考 getUserStatisticsFromDB 的实现，避免 Node.js Date 带来的时区偏移
    const timezone = await resolveSystemTimezone();
    const now = Date.now();
    if (
      providerStatisticsCache &&
      providerStatisticsCache.expiresAt > now &&
      providerStatisticsCache.timezone === timezone
    ) {
      return providerStatisticsCache.data;
    }

    if (providerStatisticsInFlight && providerStatisticsInFlight.timezone === timezone) {
      return await providerStatisticsInFlight.promise;
    }

    const promise: Promise<ProviderStatisticsRow[]> = (async () => {
      const query = sql`
         WITH bounds AS (
           SELECT
             (DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone}) AS today_start,
             ((DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) + INTERVAL '1 day') AT TIME ZONE ${timezone}) AS tomorrow_start,
             ((DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) - INTERVAL '7 days') AT TIME ZONE ${timezone}) AS last7_start
         ),
         provider_stats AS (
           -- 先按最终供应商聚合，再与 providers 做 LEFT JOIN，避免 providers × 今日请求 的笛卡尔积
           SELECT
            final_provider_id,
            COALESCE(SUM(cost_usd), 0) AS today_cost,
            COUNT(*)::integer AS today_calls
          FROM usage_ledger
          WHERE blocked_by IS NULL
            AND created_at >= (SELECT today_start FROM bounds)
            AND created_at < (SELECT tomorrow_start FROM bounds)
          GROUP BY final_provider_id
        ),
        latest_call AS (
          SELECT DISTINCT ON (final_provider_id)
            final_provider_id,
            created_at AS last_call_time,
            model AS last_call_model
          FROM usage_ledger
          WHERE blocked_by IS NULL
            AND created_at >= (SELECT last7_start FROM bounds)
          -- 性能优化：添加 7 天时间范围限制（避免扫描历史数据）
          ORDER BY final_provider_id, created_at DESC, id DESC
        )
        SELECT
          p.id,
          COALESCE(ps.today_cost, 0) AS today_cost,
          COALESCE(ps.today_calls, 0) AS today_calls,
          lc.last_call_time,
          lc.last_call_model
        FROM providers p
        LEFT JOIN provider_stats ps ON p.id = ps.final_provider_id
        LEFT JOIN latest_call lc ON p.id = lc.final_provider_id
        WHERE p.deleted_at IS NULL
        ORDER BY p.id ASC
      `;

      logger.trace("getProviderStatistics:executing_query");

      const result = await db.execute(query);
      const data = Array.from(result) as ProviderStatisticsRow[];

      logger.trace("getProviderStatistics:result", {
        count: data.length,
      });

      // 注意：返回结果中的 today_cost 为 numeric，使用字符串表示；
      // last_call_time 由数据库返回为时间戳（UTC）。
      // 这里保持原样，交由上层进行展示格式化。
      providerStatisticsCache = {
        timezone,
        expiresAt: Date.now() + PROVIDER_STATISTICS_CACHE_TTL_MS,
        data,
      };

      return data;
    })();

    // Set in-flight BEFORE awaiting to prevent concurrent callers from starting duplicate queries
    providerStatisticsInFlight = { timezone, promise };

    try {
      return await promise;
    } finally {
      if (providerStatisticsInFlight?.promise === promise) {
        providerStatisticsInFlight = null;
      }
    }
  } catch (error) {
    logger.trace("getProviderStatistics:error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
