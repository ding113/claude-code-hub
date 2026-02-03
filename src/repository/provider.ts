"use server";

import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providers } from "@/drizzle/schema";
import { getCachedProviders } from "@/lib/cache/provider-cache";
import { logger } from "@/lib/logger";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import type { CreateProviderData, Provider, UpdateProviderData } from "@/types/provider";
import { toProvider } from "./_shared/transformers";
import {
  ensureProviderEndpointExistsForUrl,
  getOrCreateProviderVendorIdFromUrls,
  tryDeleteProviderVendorIfEmpty,
} from "./provider-endpoints";

export async function createProvider(providerData: CreateProviderData): Promise<Provider> {
  const providerVendorId = await getOrCreateProviderVendorIdFromUrls({
    providerUrl: providerData.url,
    websiteUrl: providerData.website_url ?? null,
    faviconUrl: providerData.favicon_url ?? null,
    displayName: providerData.name,
  });

  const dbData = {
    name: providerData.name,
    url: providerData.url,
    key: providerData.key,
    providerVendorId,
    isEnabled: providerData.is_enabled,
    weight: providerData.weight,
    priority: providerData.priority,
    costMultiplier:
      providerData.cost_multiplier != null ? providerData.cost_multiplier.toString() : "1.0",
    groupTag: providerData.group_tag,
    providerType: providerData.provider_type,
    preserveClientIp: providerData.preserve_client_ip ?? false,
    modelRedirects: providerData.model_redirects,
    allowedModels: providerData.allowed_models,
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
    context1mPreference: providerData.context_1m_preference ?? null,
    codexReasoningEffortPreference: providerData.codex_reasoning_effort_preference ?? null,
    codexReasoningSummaryPreference: providerData.codex_reasoning_summary_preference ?? null,
    codexTextVerbosityPreference: providerData.codex_text_verbosity_preference ?? null,
    codexParallelToolCallsPreference: providerData.codex_parallel_tool_calls_preference ?? null,
    anthropicMaxTokensPreference: providerData.anthropic_max_tokens_preference ?? null,
    anthropicThinkingBudgetPreference: providerData.anthropic_thinking_budget_preference ?? null,
    tpm: providerData.tpm,
    rpm: providerData.rpm,
    rpd: providerData.rpd,
    cc: providerData.cc,
  };

  const [provider] = await db.insert(providers).values(dbData).returning({
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
    context1mPreference: providers.context1mPreference,
    codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
    codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
    codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
    codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
    anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
    anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
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
    try {
      await ensureProviderEndpointExistsForUrl({
        vendorId: created.providerVendorId,
        providerType: created.providerType,
        url: created.url,
      });
    } catch (error) {
      logger.warn("[Provider] Failed to seed provider endpoint from provider.url", {
        providerVendorId,
        providerType: created.providerType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return created;
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
      costMultiplier: providers.costMultiplier,
      groupTag: providers.groupTag,
      providerType: providers.providerType,
      preserveClientIp: providers.preserveClientIp,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
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
      context1mPreference: providers.context1mPreference,
      codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
      codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
      codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
      codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
      anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
      anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
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
      costMultiplier: providers.costMultiplier,
      groupTag: providers.groupTag,
      providerType: providers.providerType,
      preserveClientIp: providers.preserveClientIp,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
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
      context1mPreference: providers.context1mPreference,
      codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
      codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
      codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
      codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
      anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
      anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
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
      costMultiplier: providers.costMultiplier,
      groupTag: providers.groupTag,
      providerType: providers.providerType,
      preserveClientIp: providers.preserveClientIp,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
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
      context1mPreference: providers.context1mPreference,
      codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
      codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
      codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
      codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
      anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
      anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbData: any = {
    updatedAt: new Date(),
  };

  if (providerData.name !== undefined) dbData.name = providerData.name;
  if (providerData.url !== undefined) dbData.url = providerData.url;
  if (providerData.key !== undefined) dbData.key = providerData.key;
  if (providerData.is_enabled !== undefined) dbData.isEnabled = providerData.is_enabled;
  if (providerData.weight !== undefined) dbData.weight = providerData.weight;
  if (providerData.priority !== undefined) dbData.priority = providerData.priority;
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
  if (providerData.tpm !== undefined) dbData.tpm = providerData.tpm;
  if (providerData.rpm !== undefined) dbData.rpm = providerData.rpm;
  if (providerData.rpd !== undefined) dbData.rpd = providerData.rpd;
  if (providerData.cc !== undefined) dbData.cc = providerData.cc;

  let previousVendorId: number | null = null;
  if (providerData.url !== undefined || providerData.website_url !== undefined) {
    const [current] = await db
      .select({
        url: providers.url,
        websiteUrl: providers.websiteUrl,
        faviconUrl: providers.faviconUrl,
        name: providers.name,
        providerVendorId: providers.providerVendorId,
      })
      .from(providers)
      .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
      .limit(1);

    if (current) {
      previousVendorId = current.providerVendorId;
      const providerVendorId = await getOrCreateProviderVendorIdFromUrls({
        providerUrl: providerData.url ?? current.url,
        websiteUrl: providerData.website_url ?? current.websiteUrl,
        faviconUrl: providerData.favicon_url ?? current.faviconUrl,
        displayName: providerData.name ?? current.name,
      });
      dbData.providerVendorId = providerVendorId;
    }
  }

  const [provider] = await db
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
      costMultiplier: providers.costMultiplier,
      groupTag: providers.groupTag,
      providerType: providers.providerType,
      preserveClientIp: providers.preserveClientIp,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
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
      context1mPreference: providers.context1mPreference,
      codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
      codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
      codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
      codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
      anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
      anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
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

  if (
    providerData.url !== undefined ||
    providerData.provider_type !== undefined ||
    providerData.website_url !== undefined
  ) {
    if (
      transformed.providerVendorId &&
      (providerData.url !== undefined ||
        transformed.providerVendorId !== previousVendorId ||
        previousVendorId === null)
    ) {
      try {
        await ensureProviderEndpointExistsForUrl({
          vendorId: transformed.providerVendorId,
          providerType: transformed.providerType,
          url: transformed.url,
        });
      } catch (error) {
        logger.warn("[Provider] Failed to seed provider endpoint after provider update", {
          providerId: transformed.id,
          providerVendorId: transformed.providerVendorId,
          providerType: transformed.providerType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (previousVendorId && transformed.providerVendorId !== previousVendorId) {
    await tryDeleteProviderVendorIfEmpty(previousVendorId);
  }

  return transformed;
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
  return (result as any).rowCount || 0;
}

export async function deleteProvider(id: number): Promise<boolean> {
  const result = await db
    .update(providers)
    .set({ deletedAt: new Date() })
    .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
    .returning({ id: providers.id });

  return result.length > 0;
}

export interface BatchProviderUpdates {
  isEnabled?: boolean;
  priority?: number;
  weight?: number;
  costMultiplier?: string;
  groupTag?: string | null;
}

export async function updateProvidersBatch(
  ids: number[],
  updates: BatchProviderUpdates
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const uniqueIds = [...new Set(ids)];
  const setClauses: Record<string, unknown> = { updatedAt: new Date() };

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

  if (Object.keys(setClauses).length === 1) {
    return 0;
  }

  const idList = sql.join(
    uniqueIds.map((id) => sql`${id}`),
    sql`, `
  );

  const result = await db
    .update(providers)
    .set(setClauses)
    .where(sql`id IN (${idList}) AND deleted_at IS NULL`)
    .returning({ id: providers.id });

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
  const idList = sql.join(
    uniqueIds.map((id) => sql`${id}`),
    sql`, `
  );

  const result = await db
    .update(providers)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(sql`id IN (${idList}) AND deleted_at IS NULL`)
    .returning({ id: providers.id });

  logger.debug("deleteProvidersBatch:completed", {
    requestedIds: uniqueIds.length,
    deletedCount: result.length,
  });

  return result.length;
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
 * - provider_stats CTE: LEFT JOIN 添加日期过滤，仅扫描今日数据（避免全表扫描）
 * - latest_call CTE: 添加 7 天时间范围限制（避免扫描历史数据）
 */
export async function getProviderStatistics(): Promise<
  Array<{
    id: number;
    today_cost: string;
    today_calls: number;
    last_call_time: Date | null;
    last_call_model: string | null;
  }>
> {
  try {
    // 统一的时区处理：使用 PostgreSQL AT TIME ZONE + 系统时区配置
    // 参考 getUserStatisticsFromDB 的实现，避免 Node.js Date 带来的时区偏移
    const timezone = await resolveSystemTimezone();

    // ⭐ 使用 providerChain 最后一项的 providerId 来确定最终供应商（兼容重试切换）
    // 如果 provider_chain 为空（无重试），则使用 provider_id 字段
    const query = sql`
      WITH provider_stats AS (
        SELECT
          p.id,
          COALESCE(
            SUM(CASE
              WHEN (mr.created_at AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date
                AND (
                  -- 情况1：无重试（provider_chain 为 NULL 或空数组），使用 provider_id
                  (mr.provider_chain IS NULL OR jsonb_array_length(mr.provider_chain) = 0) AND mr.provider_id = p.id
                  OR
                  -- 情况2：有重试，使用 providerChain 最后一项的 id
                  (mr.provider_chain IS NOT NULL AND jsonb_array_length(mr.provider_chain) > 0
                   AND (mr.provider_chain->-1->>'id')::int = p.id)
                )
              THEN mr.cost_usd ELSE 0 END),
            0
          ) AS today_cost,
          COUNT(CASE
            WHEN (mr.created_at AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date
              AND (
                (mr.provider_chain IS NULL OR jsonb_array_length(mr.provider_chain) = 0) AND mr.provider_id = p.id
                OR
                (mr.provider_chain IS NOT NULL AND jsonb_array_length(mr.provider_chain) > 0
                 AND (mr.provider_chain->-1->>'id')::int = p.id)
              )
            THEN 1 END)::integer AS today_calls
        FROM providers p
        -- 性能优化：添加日期过滤条件，仅扫描今日数据（避免全表扫描）
        LEFT JOIN message_request mr ON mr.deleted_at IS NULL
          AND (mr.blocked_by IS NULL OR mr.blocked_by <> 'warmup')
          AND mr.created_at >= (CURRENT_DATE AT TIME ZONE ${timezone})
        WHERE p.deleted_at IS NULL
        GROUP BY p.id
      ),
      latest_call AS (
        SELECT DISTINCT ON (final_provider_id)
          -- 计算最终供应商ID：优先使用 providerChain 最后一项的 id
          CASE
            WHEN provider_chain IS NULL OR jsonb_array_length(provider_chain) = 0 THEN provider_id
            ELSE (provider_chain->-1->>'id')::int
          END AS final_provider_id,
          created_at AS last_call_time,
          model AS last_call_model
        FROM message_request
        -- 性能优化：添加 7 天时间范围限制（避免扫描历史数据）
        WHERE deleted_at IS NULL
          AND (blocked_by IS NULL OR blocked_by <> 'warmup')
          AND created_at >= (CURRENT_DATE AT TIME ZONE ${timezone} - INTERVAL '7 days')
        ORDER BY final_provider_id, created_at DESC
      )
      SELECT
        ps.id,
        ps.today_cost,
        ps.today_calls,
        lc.last_call_time,
        lc.last_call_model
      FROM provider_stats ps
      LEFT JOIN latest_call lc ON ps.id = lc.final_provider_id
      ORDER BY ps.id ASC
    `;

    logger.trace("getProviderStatistics:executing_query");

    const result = await db.execute(query);

    logger.trace("getProviderStatistics:result", {
      count: Array.isArray(result) ? result.length : 0,
    });

    // 注意：返回结果中的 today_cost 为 numeric，使用字符串表示；
    // last_call_time 由数据库返回为时间戳（UTC）。
    // 这里保持原样，交由上层进行展示格式化。
    return result as unknown as Array<{
      id: number;
      today_cost: string;
      today_calls: number;
      last_call_time: Date | null;
      last_call_model: string | null;
    }>;
  } catch (error) {
    logger.trace("getProviderStatistics:error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
