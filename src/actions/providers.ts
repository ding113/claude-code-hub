"use server";

import {
  findProviderList,
  createProvider,
  updateProvider,
  deleteProvider,
  getProviderStatistics,
  findProviderById,
} from "@/repository/provider";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { type ProviderDisplay, type ProviderType } from "@/types/provider";
import { maskKey } from "@/lib/utils/validation";
import { getSession } from "@/lib/auth";
import { CreateProviderSchema, UpdateProviderSchema } from "@/lib/validation/schemas";
import type { ActionResult } from "./types";
import { getAllHealthStatus, resetCircuit, clearConfigCache } from "@/lib/circuit-breaker";
import {
  saveProviderCircuitConfig,
  deleteProviderCircuitConfig,
} from "@/lib/redis/circuit-breaker-config";
import {
  createProxyAgentForProvider,
  isValidProxyUrl,
  type ProviderProxyConfig,
} from "@/lib/proxy-agent";
import { CodexInstructionsCache } from "@/lib/codex-instructions-cache";
import { isClientAbortError } from "@/app/v1/_lib/proxy/errors";
import { PROVIDER_TIMEOUT_DEFAULTS } from "@/lib/constants/provider.constants";
import { GeminiAuth } from "@/app/v1/_lib/gemini/auth";

// API 测试配置常量
const API_TEST_CONFIG = {
  TIMEOUT_MS: 10000, // 10 秒超时
  MAX_RESPONSE_PREVIEW_LENGTH: 100, // 响应内容预览最大长度
  TEST_MAX_TOKENS: 100, // 测试请求的最大 token 数
  TEST_PROMPT: "Hello", // 测试请求的默认提示词
} as const;

// 获取服务商数据
export async function getProviders(): Promise<ProviderDisplay[]> {
  try {
    const session = await getSession();
    logger.trace("getProviders:session", { hasSession: !!session, role: session?.user.role });

    if (!session || session.user.role !== "admin") {
      logger.trace("getProviders:unauthorized", {
        hasSession: !!session,
        role: session?.user.role,
      });
      return [];
    }

    // 并行获取供应商列表和统计数据
    const [providers, statistics] = await Promise.all([
      findProviderList(),
      getProviderStatistics().catch((error) => {
        logger.trace("getProviders:statistics_error", {
          message: error.message,
          stack: error.stack,
          name: error.name,
        });
        logger.error("获取供应商统计数据失败:", error);
        return []; // 统计查询失败时返回空数组，不影响供应商列表显示
      }),
    ]);

    logger.trace("getProviders:raw_data", {
      providerCount: providers.length,
      statisticsCount: statistics.length,
      providerIds: providers.map((p) => p.id),
    });

    // 将统计数据按 provider_id 索引
    const statsMap = new Map(statistics.map((stat) => [stat.id, stat]));

    const result = providers.map((provider) => {
      const stats = statsMap.get(provider.id);

      // 安全处理 last_call_time: 可能是 Date 对象、字符串或其他类型
      let lastCallTimeStr: string | null = null;
      try {
        if (stats?.last_call_time) {
          if (stats.last_call_time instanceof Date) {
            lastCallTimeStr = stats.last_call_time.toISOString();
          } else if (typeof stats.last_call_time === "string") {
            // 原生 SQL 查询返回的是字符串,直接使用
            lastCallTimeStr = stats.last_call_time;
          } else {
            // 尝试将其他类型转换为 Date
            const date = new Date(stats.last_call_time as string | number);
            if (!isNaN(date.getTime())) {
              lastCallTimeStr = date.toISOString();
            }
          }
        }
      } catch (error) {
        logger.trace("getProviders:last_call_time_conversion_error", {
          providerId: provider.id,
          rawValue: stats?.last_call_time,
          error: error instanceof Error ? error.message : String(error),
        });
        // 转换失败时保持 null,不影响整体数据返回
        lastCallTimeStr = null;
      }

      // 安全处理 createdAt 和 updatedAt
      let createdAtStr: string;
      let updatedAtStr: string;
      try {
        createdAtStr = provider.createdAt.toISOString().split("T")[0];
        updatedAtStr = provider.updatedAt.toISOString().split("T")[0];
      } catch (error) {
        logger.trace("getProviders:date_conversion_error", {
          providerId: provider.id,
          error: error instanceof Error ? error.message : String(error),
        });
        createdAtStr = new Date().toISOString().split("T")[0];
        updatedAtStr = createdAtStr;
      }

      return {
        id: provider.id,
        name: provider.name,
        url: provider.url,
        maskedKey: maskKey(provider.key),
        isEnabled: provider.isEnabled,
        weight: provider.weight,
        priority: provider.priority,
        costMultiplier: provider.costMultiplier,
        groupTag: provider.groupTag,
        providerType: provider.providerType,
        modelRedirects: provider.modelRedirects,
        allowedModels: provider.allowedModels,
        joinClaudePool: provider.joinClaudePool,
        codexInstructionsStrategy: provider.codexInstructionsStrategy,
        limit5hUsd: provider.limit5hUsd,
        limitDailyUsd: provider.limitDailyUsd,
        dailyResetMode: provider.dailyResetMode,
        dailyResetTime: provider.dailyResetTime,
        limitWeeklyUsd: provider.limitWeeklyUsd,
        limitMonthlyUsd: provider.limitMonthlyUsd,
        limitConcurrentSessions: provider.limitConcurrentSessions,
        circuitBreakerFailureThreshold: provider.circuitBreakerFailureThreshold,
        circuitBreakerOpenDuration: provider.circuitBreakerOpenDuration,
        circuitBreakerHalfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
        proxyUrl: provider.proxyUrl,
        proxyFallbackToDirect: provider.proxyFallbackToDirect,
        firstByteTimeoutStreamingMs: provider.firstByteTimeoutStreamingMs,
        streamingIdleTimeoutMs: provider.streamingIdleTimeoutMs,
        requestTimeoutNonStreamingMs: provider.requestTimeoutNonStreamingMs,
        websiteUrl: provider.websiteUrl,
        faviconUrl: provider.faviconUrl,
        tpm: provider.tpm,
        rpm: provider.rpm,
        rpd: provider.rpd,
        cc: provider.cc,
        createdAt: createdAtStr,
        updatedAt: updatedAtStr,
        // 统计数据（可能为空）
        todayTotalCostUsd: stats?.today_cost ?? "0",
        todayCallCount: stats?.today_calls ?? 0,
        lastCallTime: lastCallTimeStr,
        lastCallModel: stats?.last_call_model ?? null,
      };
    });

    logger.trace("getProviders:final_result", { count: result.length });
    return result;
  } catch (error) {
    logger.trace("getProviders:catch_error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logger.error("获取服务商数据失败:", error);
    return [];
  }
}

// 添加服务商
export async function addProvider(data: {
  name: string;
  url: string;
  key: string;
  is_enabled?: boolean;
  weight?: number;
  priority?: number;
  cost_multiplier?: number;
  group_tag?: string | null;
  provider_type?: ProviderType;
  model_redirects?: Record<string, string> | null;
  allowed_models?: string[] | null;
  join_claude_pool?: boolean;
  limit_5h_usd?: number | null;
  limit_daily_usd?: number | null;
  daily_reset_mode?: "fixed" | "rolling";
  daily_reset_time?: string;
  limit_weekly_usd?: number | null;
  limit_monthly_usd?: number | null;
  limit_concurrent_sessions?: number | null;
  circuit_breaker_failure_threshold?: number;
  circuit_breaker_open_duration?: number;
  circuit_breaker_half_open_success_threshold?: number;
  proxy_url?: string | null;
  proxy_fallback_to_direct?: boolean;
  first_byte_timeout_streaming_ms?: number;
  streaming_idle_timeout_ms?: number;
  request_timeout_non_streaming_ms?: number;
  website_url?: string | null;
  codex_instructions_strategy?: "auto" | "force_official" | "keep_original";
  tpm: number | null;
  rpm: number | null;
  rpd: number | null;
  cc: number | null;
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    logger.trace("addProvider:input", {
      name: data.name,
      url: data.url,
      provider_type: data.provider_type,
      proxy_url: data.proxy_url ? data.proxy_url.replace(/:\/\/[^@]*@/, "://***@") : null,
    });

    // 验证代理 URL 格式
    if (data.proxy_url && !isValidProxyUrl(data.proxy_url)) {
      return {
        ok: false,
        error: "代理地址格式无效，支持格式: http://, https://, socks5://, socks4://",
      };
    }

    const validated = CreateProviderSchema.parse(data);
    logger.trace("addProvider:validated", { name: validated.name });

    // 获取 favicon URL
    let faviconUrl: string | null = null;
    if (validated.website_url) {
      try {
        const url = new URL(validated.website_url);
        const domain = url.hostname;
        faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        logger.trace("addProvider:favicon_generated", { domain, faviconUrl });
      } catch (error) {
        logger.warn("addProvider:favicon_fetch_failed", {
          websiteUrl: validated.website_url,
          error: error instanceof Error ? error.message : String(error),
        });
        // Favicon 获取失败不影响主流程
      }
    }

    const payload = {
      ...validated,
      limit_5h_usd: validated.limit_5h_usd ?? null,
      limit_daily_usd: validated.limit_daily_usd ?? null,
      daily_reset_mode: validated.daily_reset_mode ?? "fixed",
      daily_reset_time: validated.daily_reset_time ?? "00:00",
      limit_weekly_usd: validated.limit_weekly_usd ?? null,
      limit_monthly_usd: validated.limit_monthly_usd ?? null,
      limit_concurrent_sessions: validated.limit_concurrent_sessions ?? 0,
      circuit_breaker_failure_threshold: validated.circuit_breaker_failure_threshold ?? 5,
      circuit_breaker_open_duration: validated.circuit_breaker_open_duration ?? 1800000,
      circuit_breaker_half_open_success_threshold:
        validated.circuit_breaker_half_open_success_threshold ?? 2,
      proxy_url: validated.proxy_url ?? null,
      proxy_fallback_to_direct: validated.proxy_fallback_to_direct ?? false,
      first_byte_timeout_streaming_ms:
        validated.first_byte_timeout_streaming_ms ??
        PROVIDER_TIMEOUT_DEFAULTS.FIRST_BYTE_TIMEOUT_STREAMING_MS,
      streaming_idle_timeout_ms:
        validated.streaming_idle_timeout_ms ?? PROVIDER_TIMEOUT_DEFAULTS.STREAMING_IDLE_TIMEOUT_MS,
      request_timeout_non_streaming_ms:
        validated.request_timeout_non_streaming_ms ??
        PROVIDER_TIMEOUT_DEFAULTS.REQUEST_TIMEOUT_NON_STREAMING_MS,
      website_url: validated.website_url ?? null,
      favicon_url: faviconUrl,
      tpm: validated.tpm ?? null,
      rpm: validated.rpm ?? null,
      rpd: validated.rpd ?? null,
      cc: validated.cc ?? null,
    };

    const provider = await createProvider(payload);
    logger.trace("addProvider:created_success", { name: validated.name, providerId: provider.id });

    // 同步熔断器配置到 Redis
    try {
      await saveProviderCircuitConfig(provider.id, {
        failureThreshold: provider.circuitBreakerFailureThreshold,
        openDuration: provider.circuitBreakerOpenDuration,
        halfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
      });
      logger.debug("addProvider:config_synced_to_redis", { providerId: provider.id });
    } catch (error) {
      logger.warn("addProvider:redis_sync_failed", {
        providerId: provider.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // 不影响主流程，仅记录警告
    }

    revalidatePath("/settings/providers");
    logger.trace("addProvider:revalidated", { path: "/settings/providers" });

    return { ok: true };
  } catch (error) {
    logger.trace("addProvider:error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logger.error("创建服务商失败:", error);
    const message = error instanceof Error ? error.message : "创建服务商失败";
    return { ok: false, error: message };
  }
}

// 更新服务商
export async function editProvider(
  providerId: number,
  data: {
    name?: string;
    url?: string;
    key?: string;
    is_enabled?: boolean;
    weight?: number;
    priority?: number;
    cost_multiplier?: number;
    group_tag?: string | null;
    provider_type?: ProviderType;
    model_redirects?: Record<string, string> | null;
    allowed_models?: string[] | null;
    join_claude_pool?: boolean;
    limit_5h_usd?: number | null;
    limit_daily_usd?: number | null;
    daily_reset_time?: string;
    limit_weekly_usd?: number | null;
    limit_monthly_usd?: number | null;
    limit_concurrent_sessions?: number | null;
    circuit_breaker_failure_threshold?: number;
    circuit_breaker_open_duration?: number;
    circuit_breaker_half_open_success_threshold?: number;
    proxy_url?: string | null;
    proxy_fallback_to_direct?: boolean;
    first_byte_timeout_streaming_ms?: number;
    streaming_idle_timeout_ms?: number;
    request_timeout_non_streaming_ms?: number;
    website_url?: string | null;
    codex_instructions_strategy?: "auto" | "force_official" | "keep_original";
    tpm?: number | null;
    rpm?: number | null;
    rpd?: number | null;
    cc?: number | null;
  }
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    // 验证代理 URL 格式
    if (data.proxy_url && !isValidProxyUrl(data.proxy_url)) {
      return {
        ok: false,
        error: "代理地址格式无效，支持格式: http://, https://, socks5://, socks4://",
      };
    }

    const validated = UpdateProviderSchema.parse(data);

    // 如果 website_url 被更新，重新生成 favicon URL
    let faviconUrl: string | null | undefined = undefined; // undefined 表示不更新
    if (validated.website_url !== undefined) {
      if (validated.website_url) {
        try {
          const url = new URL(validated.website_url);
          const domain = url.hostname;
          faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
          logger.trace("editProvider:favicon_generated", { domain, faviconUrl });
        } catch (error) {
          logger.warn("editProvider:favicon_fetch_failed", {
            websiteUrl: validated.website_url,
            error: error instanceof Error ? error.message : String(error),
          });
          faviconUrl = null;
        }
      } else {
        faviconUrl = null; // website_url 被清空时也清空 favicon
      }
    }

    const payload = {
      ...validated,
      ...(faviconUrl !== undefined && { favicon_url: faviconUrl }),
    };

    const provider = await updateProvider(providerId, payload);

    if (!provider) {
      return { ok: false, error: "供应商不存在" };
    }

    // 同步熔断器配置到 Redis（如果配置有变化）
    const hasCircuitConfigChange =
      validated.circuit_breaker_failure_threshold !== undefined ||
      validated.circuit_breaker_open_duration !== undefined ||
      validated.circuit_breaker_half_open_success_threshold !== undefined;

    if (hasCircuitConfigChange) {
      try {
        await saveProviderCircuitConfig(providerId, {
          failureThreshold: provider.circuitBreakerFailureThreshold,
          openDuration: provider.circuitBreakerOpenDuration,
          halfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
        });
        // 清除内存缓存，强制下次读取最新配置
        clearConfigCache(providerId);
        logger.debug("editProvider:config_synced_to_redis", { providerId });
      } catch (error) {
        logger.warn("editProvider:redis_sync_failed", {
          providerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 清理 Codex Instructions 缓存（如果策略有变化）
    if (validated.codex_instructions_strategy !== undefined) {
      try {
        await CodexInstructionsCache.clearByProvider(providerId);
        logger.debug("editProvider:codex_cache_cleared", { providerId });
      } catch (error) {
        logger.warn("editProvider:codex_cache_clear_failed", {
          providerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    revalidatePath("/settings/providers");
    return { ok: true };
  } catch (error) {
    logger.error("更新服务商失败:", error);
    const message = error instanceof Error ? error.message : "更新服务商失败";
    return { ok: false, error: message };
  }
}

// 删除服务商
export async function removeProvider(providerId: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    await deleteProvider(providerId);

    // 删除 Redis 缓存
    try {
      await deleteProviderCircuitConfig(providerId);
      // 清除内存缓存
      clearConfigCache(providerId);
      logger.debug("removeProvider:cache_cleared", { providerId });
    } catch (error) {
      logger.warn("removeProvider:cache_clear_failed", {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    revalidatePath("/settings/providers");
    return { ok: true };
  } catch (error) {
    logger.error("删除服务商失败:", error);
    const message = error instanceof Error ? error.message : "删除服务商失败";
    return { ok: false, error: message };
  }
}

/**
 * 获取所有供应商的熔断器健康状态
 * 返回格式：{ providerId: { circuitState, failureCount, circuitOpenUntil, ... } }
 */
export async function getProvidersHealthStatus() {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {};
    }

    const healthStatus = getAllHealthStatus();

    // 转换为前端友好的格式
    const enrichedStatus: Record<
      number,
      {
        circuitState: "closed" | "open" | "half-open";
        failureCount: number;
        lastFailureTime: number | null;
        circuitOpenUntil: number | null;
        recoveryMinutes: number | null; // 距离恢复的分钟数
      }
    > = {};

    Object.entries(healthStatus).forEach(([providerId, health]) => {
      enrichedStatus[Number(providerId)] = {
        circuitState: health.circuitState,
        failureCount: health.failureCount,
        lastFailureTime: health.lastFailureTime,
        circuitOpenUntil: health.circuitOpenUntil,
        recoveryMinutes: health.circuitOpenUntil
          ? Math.ceil((health.circuitOpenUntil - Date.now()) / 60000)
          : null,
      };
    });

    return enrichedStatus;
  } catch (error) {
    logger.error("获取熔断器状态失败:", error);
    return {};
  }
}

/**
 * 手动重置供应商的熔断器状态
 */
export async function resetProviderCircuit(providerId: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    resetCircuit(providerId);
    revalidatePath("/settings/providers");

    return { ok: true };
  } catch (error) {
    logger.error("重置熔断器失败:", error);
    const message = error instanceof Error ? error.message : "重置熔断器失败";
    return { ok: false, error: message };
  }
}

/**
 * 获取供应商限额使用情况
 */
export async function getProviderLimitUsage(providerId: number): Promise<
  ActionResult<{
    cost5h: { current: number; limit: number | null; resetInfo: string };
    costDaily: { current: number; limit: number | null; resetAt?: Date };
    costWeekly: { current: number; limit: number | null; resetAt: Date };
    costMonthly: { current: number; limit: number | null; resetAt: Date };
    concurrentSessions: { current: number; limit: number };
  }>
> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const provider = await findProviderById(providerId);
    if (!provider) {
      return { ok: false, error: "供应商不存在" };
    }

    // 动态导入避免循环依赖
    const { RateLimitService } = await import("@/lib/rate-limit");
    const { SessionTracker } = await import("@/lib/session-tracker");
    const { getResetInfo, getResetInfoWithMode } = await import("@/lib/rate-limit/time-utils");

    // 获取金额消费（优先 Redis，降级数据库）
    const [cost5h, costDaily, costWeekly, costMonthly, concurrentSessions] = await Promise.all([
      RateLimitService.getCurrentCost(providerId, "provider", "5h"),
      RateLimitService.getCurrentCost(
        providerId,
        "provider",
        "daily",
        provider.dailyResetTime,
        provider.dailyResetMode ?? "fixed"
      ),
      RateLimitService.getCurrentCost(providerId, "provider", "weekly"),
      RateLimitService.getCurrentCost(providerId, "provider", "monthly"),
      SessionTracker.getProviderSessionCount(providerId),
    ]);

    // 获取重置时间信息
    const reset5h = getResetInfo("5h");
    const resetDaily = getResetInfoWithMode(
      "daily",
      provider.dailyResetTime,
      provider.dailyResetMode ?? "fixed"
    );
    const resetWeekly = getResetInfo("weekly");
    const resetMonthly = getResetInfo("monthly");

    return {
      ok: true,
      data: {
        cost5h: {
          current: cost5h,
          limit: provider.limit5hUsd,
          resetInfo: reset5h.type === "rolling" ? `滚动窗口（${reset5h.period}）` : "自然时间窗口",
        },
        costDaily: {
          current: costDaily,
          limit: provider.limitDailyUsd,
          resetAt: resetDaily.type === "rolling" ? undefined : resetDaily.resetAt!,
        },
        costWeekly: {
          current: costWeekly,
          limit: provider.limitWeeklyUsd,
          resetAt: resetWeekly.resetAt!,
        },
        costMonthly: {
          current: costMonthly,
          limit: provider.limitMonthlyUsd,
          resetAt: resetMonthly.resetAt!,
        },
        concurrentSessions: {
          current: concurrentSessions,
          limit: provider.limitConcurrentSessions || 0,
        },
      },
    };
  } catch (error) {
    logger.error("获取供应商限额使用情况失败:", error);
    const message = error instanceof Error ? error.message : "获取供应商限额使用情况失败";
    return { ok: false, error: message };
  }
}

/**
 * 测试代理连接
 * 通过代理访问供应商 URL，验证代理配置是否正确
 */
export async function testProviderProxy(data: {
  providerUrl: string;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
}): Promise<
  ActionResult<{
    success: boolean;
    message: string;
    details?: {
      statusCode?: number;
      responseTime?: number;
      usedProxy?: boolean;
      proxyUrl?: string;
      error?: string;
      errorType?: string;
    };
  }>
> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const providerUrlValidation = validateProviderUrlForConnectivity(data.providerUrl);
    if (!providerUrlValidation.valid) {
      return {
        ok: true,
        data: {
          success: false,
          message: providerUrlValidation.error.message,
          details: providerUrlValidation.error.details,
        },
      };
    }

    // 验证代理 URL 格式
    if (data.proxyUrl && !isValidProxyUrl(data.proxyUrl)) {
      return {
        ok: true,
        data: {
          success: false,
          message: "代理地址格式无效",
          details: {
            error: "支持格式: http://, https://, socks5://, socks4://",
            errorType: "InvalidProxyUrl",
          },
        },
      };
    }

    const startTime = Date.now();

    // 构造临时 Provider 对象（用于创建代理 agent）
    // 使用类型安全的 ProviderProxyConfig 接口，避免 any
    const tempProvider: ProviderProxyConfig = {
      id: -1,
      name: "test-connection",
      proxyUrl: data.proxyUrl ?? null,
      proxyFallbackToDirect: data.proxyFallbackToDirect ?? false,
    };

    try {
      // 创建代理配置
      const proxyConfig = createProxyAgentForProvider(tempProvider, data.providerUrl);

      // 扩展 RequestInit 类型
      interface UndiciFetchOptions extends RequestInit {
        dispatcher?: unknown;
      }

      const init: UndiciFetchOptions = {
        method: "HEAD", // 使用 HEAD 请求，减少流量
        signal: AbortSignal.timeout(API_TEST_CONFIG.TIMEOUT_MS),
      };

      // 应用代理配置
      if (proxyConfig) {
        init.dispatcher = proxyConfig.agent;
      }

      // 发起测试请求
      const response = await fetch(data.providerUrl, init);
      const responseTime = Date.now() - startTime;

      return {
        ok: true,
        data: {
          success: true,
          message: `成功连接到 ${new URL(data.providerUrl).hostname}`,
          details: {
            statusCode: response.status,
            responseTime,
            usedProxy: !!proxyConfig,
            proxyUrl: proxyConfig?.proxyUrl,
          },
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const err = error as Error & { code?: string };

      // 判断错误类型
      const isProxyError =
        err.message.includes("proxy") ||
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("ENOTFOUND") ||
        err.message.includes("ETIMEDOUT");

      const errorType = isClientAbortError(err)
        ? "Timeout"
        : isProxyError
          ? "ProxyError"
          : "NetworkError";

      return {
        ok: true,
        data: {
          success: false,
          message: `连接失败: ${err.message}`,
          details: {
            responseTime,
            usedProxy: !!data.proxyUrl,
            proxyUrl: data.proxyUrl ?? undefined,
            error: err.message,
            errorType,
          },
        },
      };
    }
  } catch (error) {
    logger.error("测试代理连接失败:", error);
    const message = error instanceof Error ? error.message : "测试代理连接失败";
    return { ok: false, error: message };
  }
}

/**
 * 获取供应商的未脱敏密钥（仅管理员）
 * 用于安全展示和复制完整 API Key
 */
export async function getUnmaskedProviderKey(id: number): Promise<ActionResult<{ key: string }>> {
  "use server";

  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "权限不足：仅管理员可查看完整密钥" };
    }

    const provider = await findProviderById(id);
    if (!provider) {
      return { ok: false, error: "供应商不存在" };
    }

    // 记录查看行为（不记录密钥内容）
    logger.info("Admin viewed provider key", {
      userId: session.user.id,
      providerId: id,
      providerName: provider.name,
    });

    return { ok: true, data: { key: provider.key } };
  } catch (error) {
    logger.error("获取供应商密钥失败:", error);
    const message = error instanceof Error ? error.message : "获取供应商密钥失败";
    return { ok: false, error: message };
  }
}

type ProviderApiTestArgs = {
  providerUrl: string;
  apiKey: string;
  model?: string;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
};

type ProviderApiTestResult = ActionResult<
  | {
      success: true;
      message: string;
      details?: {
        responseTime?: number;
        model?: string;
        usage?: Record<string, unknown>;
        content?: string;
      };
    }
  | {
      success: false;
      message: string;
      details?: {
        responseTime?: number;
        error?: string;
      };
    }
>;

// Anthropic Messages API 响应类型
type AnthropicMessagesResponse = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<{ type: "text"; text: string }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

// OpenAI Chat Completions API 响应类型
type OpenAIChatResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    reasoning_tokens?: number;
  };
};

// OpenAI Responses API 响应类型
type OpenAIResponsesResponse = {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  output: Array<{
    type: "message";
    id: string;
    status: string;
    role: "assistant";
    content: Array<{
      type: "output_text";
      text: string;
      annotations?: unknown[];
    }>;
  }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
};

// Gemini API 响应类型
type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code: number;
    message: string;
    status: string;
  };
};

// 联合类型：所有支持的 API 响应格式
type ProviderApiResponse =
  | AnthropicMessagesResponse
  | OpenAIChatResponse
  | OpenAIResponsesResponse
  | GeminiResponse;

function extractFirstTextSnippet(
  response: ProviderApiResponse,
  maxLength?: number
): string | undefined {
  const limit = maxLength ?? API_TEST_CONFIG.MAX_RESPONSE_PREVIEW_LENGTH;

  // Anthropic Messages API
  if ("content" in response && Array.isArray(response.content)) {
    const firstText = response.content.find((item) => item.type === "text");
    if (firstText && "text" in firstText) {
      return firstText.text.substring(0, limit);
    }
  }

  // OpenAI Chat Completions API
  if ("choices" in response && Array.isArray(response.choices)) {
    const firstChoice = response.choices[0];
    if (firstChoice?.message?.content) {
      return firstChoice.message.content.substring(0, limit);
    }
  }

  // OpenAI Responses API
  if ("output" in response && Array.isArray(response.output)) {
    const firstOutput = response.output[0];
    if (firstOutput?.type === "message" && Array.isArray(firstOutput.content)) {
      const textContent = firstOutput.content.find((c) => c.type === "output_text");
      if (textContent && "text" in textContent) {
        return textContent.text.substring(0, limit);
      }
    }
  }

  // Gemini API
  if ("candidates" in response && Array.isArray(response.candidates)) {
    const firstCandidate = response.candidates[0];
    if (firstCandidate?.content?.parts?.[0]?.text) {
      return firstCandidate.content.parts[0].text.substring(0, limit);
    }
  }

  return undefined;
}

function clipText(value: unknown, maxLength?: number): string | undefined {
  const limit = maxLength ?? API_TEST_CONFIG.MAX_RESPONSE_PREVIEW_LENGTH;
  return typeof value === "string" ? value.substring(0, limit) : undefined;
}

type ProviderUrlValidationError = {
  message: string;
  details: {
    error: string;
    errorType: "InvalidProviderUrl" | "BlockedUrl" | "BlockedPort";
  };
};

function validateProviderUrlForConnectivity(
  providerUrl: string
): { valid: true; normalizedUrl: string } | { valid: false; error: ProviderUrlValidationError } {
  const trimmedUrl = providerUrl.trim();

  try {
    const parsedProviderUrl = new URL(trimmedUrl);

    if (!["https:", "http:"].includes(parsedProviderUrl.protocol)) {
      return {
        valid: false,
        error: {
          message: "供应商地址格式无效",
          details: {
            error: "仅支持 HTTP 和 HTTPS 协议",
            errorType: "InvalidProviderUrl",
          },
        },
      };
    }

    const hostname = parsedProviderUrl.hostname.toLowerCase();
    const blockedPatterns = [
      /^localhost$/i,
      /^127\.\d+\.\d+\.\d+$/,
      /^10\.\d+\.\d+\.\d+$/,
      /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
      /^192\.168\.\d+\.\d+$/,
      /^169\.254\.\d+\.\d+$/,
      /^::1$/,
      /^fe80:/i,
      /^fc00:/i,
      /^fd00:/i,
    ];

    if (blockedPatterns.some((pattern) => pattern.test(hostname))) {
      return {
        valid: false,
        error: {
          message: "供应商地址安全检查失败",
          details: {
            error: "不允许访问内部网络地址",
            errorType: "BlockedUrl",
          },
        },
      };
    }

    const port = parsedProviderUrl.port ? parseInt(parsedProviderUrl.port, 10) : null;
    const dangerousPorts = [22, 23, 25, 3306, 5432, 6379, 27017, 9200];
    if (port && dangerousPorts.includes(port)) {
      return {
        valid: false,
        error: {
          message: "供应商地址端口检查失败",
          details: {
            error: "不允许访问内部服务端口",
            errorType: "BlockedPort",
          },
        },
      };
    }

    return { valid: true, normalizedUrl: trimmedUrl };
  } catch (error) {
    return {
      valid: false,
      error: {
        message: "供应商地址格式无效",
        details: {
          error: error instanceof Error ? error.message : "URL 解析失败",
          errorType: "InvalidProviderUrl",
        },
      },
    };
  }
}

async function executeProviderApiTest(
  data: ProviderApiTestArgs,
  options: {
    path: string | ((model: string, apiKey: string) => string);
    defaultModel: string;
    headers: (apiKey: string) => Record<string, string>;
    body: (model: string) => unknown;
    successMessage: string;
    extract: (result: ProviderApiResponse) => {
      model?: string;
      usage?: Record<string, unknown>;
      content?: string;
    };
  }
): Promise<ProviderApiTestResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    if (data.proxyUrl && !isValidProxyUrl(data.proxyUrl)) {
      return {
        ok: true,
        data: {
          success: false,
          message: "代理地址格式无效",
          details: {
            error: "支持格式: http://, https://, socks5://, socks4://",
          },
        },
      };
    }

    const providerUrlValidation = validateProviderUrlForConnectivity(data.providerUrl);
    if (!providerUrlValidation.valid) {
      return {
        ok: true,
        data: {
          success: false,
          message: providerUrlValidation.error.message,
          details: providerUrlValidation.error.details,
        },
      };
    }

    const normalizedProviderUrl = providerUrlValidation.normalizedUrl.replace(/\/$/, "");

    const startTime = Date.now();

    const tempProvider: ProviderProxyConfig = {
      id: -1,
      name: "api-test",
      proxyUrl: data.proxyUrl ?? null,
      proxyFallbackToDirect: data.proxyFallbackToDirect ?? false,
    };

    const model = data.model || options.defaultModel;
    const path =
      typeof options.path === "function" ? options.path(model, data.apiKey) : options.path;
    const url = normalizedProviderUrl + path;

    try {
      const proxyConfig = createProxyAgentForProvider(tempProvider, url);

      interface UndiciFetchOptions extends RequestInit {
        dispatcher?: unknown;
      }

      const init: UndiciFetchOptions = {
        method: "POST",
        headers: {
          ...options.headers(data.apiKey),
          "User-Agent": "claude-cli/2.0.33 (external, cli)",
        },
        body: JSON.stringify(options.body(model)),
        signal: AbortSignal.timeout(API_TEST_CONFIG.TIMEOUT_MS),
      };

      if (proxyConfig) {
        init.dispatcher = proxyConfig.agent;
      }

      const response = await fetch(url, init);
      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        let errorDetail: string | undefined;
        try {
          const errorJson = JSON.parse(errorText);
          errorDetail = errorJson.error?.message || errorJson.message;
        } catch {
          errorDetail = undefined;
        }

        logger.error("Provider API test failed", {
          providerUrl: normalizedProviderUrl.replace(/:\/\/[^@]*@/, "://***@"),
          path: typeof options.path === "string" ? options.path : "dynamic",
          status: response.status,
          errorDetail: errorDetail ?? clipText(errorText, 200),
        });

        return {
          ok: true,
          data: {
            success: false,
            message: `API 返回错误: HTTP ${response.status}`,
            details: {
              responseTime,
              error: "API 请求失败，查看日志以获得更多信息",
            },
          },
        };
      }

      const result = (await response.json()) as ProviderApiResponse;
      const extracted = options.extract(result);

      return {
        ok: true,
        data: {
          success: true,
          message: options.successMessage,
          details: {
            responseTime,
            ...extracted,
          },
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const err = error as Error & { code?: string };

      return {
        ok: true,
        data: {
          success: false,
          message: `连接失败: ${err.message}`,
          details: {
            responseTime,
            error: err.message,
          },
        },
      };
    }
  } catch (error) {
    logger.error("测试供应商 API 失败:", error);
    const message = error instanceof Error ? error.message : "测试失败";
    return { ok: false, error: message };
  }
}

/**
 * 测试 Anthropic Messages API 连通性
 */
export async function testProviderAnthropicMessages(
  data: ProviderApiTestArgs
): Promise<ProviderApiTestResult> {
  return executeProviderApiTest(data, {
    path: "/v1/messages",
    defaultModel: "claude-sonnet-4-5-20250929",
    headers: (apiKey) => ({
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    }),
    body: (model) => ({
      model,
      max_tokens: API_TEST_CONFIG.TEST_MAX_TOKENS,
      messages: [{ role: "user", content: API_TEST_CONFIG.TEST_PROMPT }],
    }),
    successMessage: "Anthropic Messages API 测试成功",
    extract: (result) => ({
      model: "model" in result ? result.model : undefined,
      usage: "usage" in result ? (result.usage as Record<string, unknown>) : undefined,
      content: extractFirstTextSnippet(result),
    }),
  });
}

/**
 * 测试 OpenAI Chat Completions API 连通性
 */
export async function testProviderOpenAIChatCompletions(
  data: ProviderApiTestArgs
): Promise<ProviderApiTestResult> {
  return executeProviderApiTest(data, {
    path: "/v1/chat/completions",
    defaultModel: "gpt-5.1-codex",
    headers: (apiKey) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    }),
    body: (model) => ({
      model,
      max_tokens: API_TEST_CONFIG.TEST_MAX_TOKENS,
      messages: [
        { role: "developer", content: "你是一个有帮助的助手。" },
        { role: "user", content: "你好" },
      ],
    }),
    successMessage: "OpenAI Chat Completions API 测试成功",
    extract: (result) => ({
      model: "model" in result ? result.model : undefined,
      usage: "usage" in result ? (result.usage as Record<string, unknown>) : undefined,
      content: extractFirstTextSnippet(result),
    }),
  });
}

/**
 * 测试 OpenAI Responses API 连通性
 */
export async function testProviderOpenAIResponses(
  data: ProviderApiTestArgs
): Promise<ProviderApiTestResult> {
  return executeProviderApiTest(data, {
    path: "/v1/responses",
    defaultModel: "gpt-5.1-codex",
    headers: (apiKey) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    }),
    body: (model) => ({
      model,
      max_output_tokens: API_TEST_CONFIG.TEST_MAX_TOKENS,
      input: "讲一个简短的故事",
    }),
    successMessage: "OpenAI Responses API 测试成功",
    extract: (result) => ({
      model: "model" in result ? result.model : undefined,
      usage: "usage" in result ? (result.usage as Record<string, unknown>) : undefined,
      content: extractFirstTextSnippet(result),
    }),
  });
}

/**
 * 测试 Gemini API 连通性
 */
export async function testProviderGemini(
  data: ProviderApiTestArgs
): Promise<ProviderApiTestResult> {
  // 预处理 Auth，如果是 API Key 保持原样，如果是 JSON 则解析 Access Token
  let processedApiKey = data.apiKey;
  let isJsonCreds = false;

  try {
    // 使用 GeminiAuth 获取 token (如果是 json 凭证)
    processedApiKey = await GeminiAuth.getAccessToken(data.apiKey);
    isJsonCreds = GeminiAuth.isJson(data.apiKey);
  } catch (e) {
    // 忽略错误，让后续请求失败
    logger.warn("testProviderGemini:auth_process_failed", { error: e });
  }

  return executeProviderApiTest(
    { ...data, apiKey: processedApiKey },
    {
      path: (model, apiKey) => {
        if (!isJsonCreds) {
          return `/v1beta/models/${model}:generateContent?key=${apiKey}`;
        }
        return `/v1beta/models/${model}:generateContent`;
      },
      defaultModel: "gemini-1.5-pro",
      headers: (apiKey) => {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (isJsonCreds) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }
        return headers;
      },
      body: (model) => ({
        contents: [{ parts: [{ text: API_TEST_CONFIG.TEST_PROMPT }] }],
        generationConfig: {
          maxOutputTokens: API_TEST_CONFIG.TEST_MAX_TOKENS,
        },
      }),
      successMessage: "Gemini API 测试成功",
      extract: (result) => {
        const geminiResult = result as GeminiResponse;
        return {
          model: undefined,
          usage: geminiResult.usageMetadata as Record<string, unknown>,
          content: extractFirstTextSnippet(geminiResult),
        };
      },
    }
  );
}
