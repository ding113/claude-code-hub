import "server-only";

/**
 * 简单的熔断器服务（内存实现 + Redis 持久化 + 动态配置）
 *
 * 状态机：
 * - Closed（关闭）：正常状态，请求通过
 * - Open（打开）：失败次数超过阈值，请求被拒绝
 * - Half-Open（半开）：等待一段时间后，允许少量请求尝试
 *
 * 特性：
 * - 支持每个供应商独立的熔断器配置（从 Redis/数据库读取）
 * - 内存缓存配置以提升性能
 * - Redis 持久化运行时状态（支持多实例共享、重启恢复）
 * - 降级策略：配置/状态读取失败时使用默认值
 */

import { logger } from "@/lib/logger";
import {
  type CircuitBreakerConfig,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  loadProviderCircuitConfig,
} from "@/lib/redis/circuit-breaker-config";
import {
  type CircuitBreakerState,
  loadAllCircuitStates,
  loadCircuitState,
  saveCircuitState,
} from "@/lib/redis/circuit-breaker-state";

// 修复：导出 ProviderHealth 类型，供其他模块使用
export interface ProviderHealth {
  failureCount: number;
  lastFailureTime: number | null;
  circuitState: "closed" | "open" | "half-open";
  circuitOpenUntil: number | null;
  halfOpenSuccessCount: number;
  // 缓存的配置（减少 Redis 查询）
  config: CircuitBreakerConfig | null;
  configLoadedAt: number | null; // 配置加载时间戳
}

// 内存存储
const healthMap = new Map<number, ProviderHealth>();

// 配置缓存 TTL（5 分钟）
const CONFIG_CACHE_TTL = 5 * 60 * 1000;

// 标记已从 Redis 加载过状态的供应商（避免重复加载）
const loadedFromRedis = new Set<number>();

/**
 * 获取或创建供应商的健康状态（同步版本，用于内部）
 */
function getOrCreateHealthSync(providerId: number): ProviderHealth {
  let health = healthMap.get(providerId);
  if (!health) {
    health = {
      failureCount: 0,
      lastFailureTime: null,
      circuitState: "closed",
      circuitOpenUntil: null,
      halfOpenSuccessCount: 0,
      config: null,
      configLoadedAt: null,
    };
    healthMap.set(providerId, health);
  }
  return health;
}

/**
 * 获取或创建供应商的健康状态（异步版本，首次会尝试从 Redis 加载）
 * 对于 open/half-open 状态，始终检查 Redis 以同步外部重置操作
 */
async function getOrCreateHealth(providerId: number): Promise<ProviderHealth> {
  let health = healthMap.get(providerId);

  // Determine if we need to check Redis:
  // 1. No health in memory AND not yet loaded from Redis (initial load)
  // 2. OR health exists but is in non-closed state (may have been reset externally)
  const needsRedisCheck =
    (!health && !loadedFromRedis.has(providerId)) || (health && health.circuitState !== "closed");

  if (needsRedisCheck) {
    loadedFromRedis.add(providerId);

    try {
      const redisState = await loadCircuitState(providerId);
      if (redisState) {
        // If Redis has different state, use Redis state (source of truth)
        if (!health || redisState.circuitState !== health.circuitState) {
          health = {
            ...redisState,
            config: health?.config || null,
            configLoadedAt: health?.configLoadedAt || null,
          };
          healthMap.set(providerId, health);
          logger.debug(`[CircuitBreaker] Synced state from Redis for provider ${providerId}`, {
            providerId,
            state: redisState.circuitState,
          });
        }
        return health;
      } else if (health && health.circuitState !== "closed") {
        // Redis has no state (was reset/deleted), reset memory to closed
        health.circuitState = "closed";
        health.failureCount = 0;
        health.lastFailureTime = null;
        health.circuitOpenUntil = null;
        health.halfOpenSuccessCount = 0;
        logger.info(
          `[CircuitBreaker] Provider ${providerId} reset to closed (Redis state cleared)`
        );
      }
    } catch (error) {
      logger.warn(`[CircuitBreaker] Failed to sync state from Redis for provider ${providerId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!health) {
    health = {
      failureCount: 0,
      lastFailureTime: null,
      circuitState: "closed",
      circuitOpenUntil: null,
      halfOpenSuccessCount: 0,
      config: null,
      configLoadedAt: null,
    };
    healthMap.set(providerId, health);
  }

  return health;
}

/**
 * 将健康状态保存到 Redis（异步，非阻塞）
 */
function persistStateToRedis(providerId: number, health: ProviderHealth): void {
  const state: CircuitBreakerState = {
    failureCount: health.failureCount,
    lastFailureTime: health.lastFailureTime,
    circuitState: health.circuitState,
    circuitOpenUntil: health.circuitOpenUntil,
    halfOpenSuccessCount: health.halfOpenSuccessCount,
  };

  saveCircuitState(providerId, state).catch((error) => {
    logger.warn(`[CircuitBreaker] Failed to persist state to Redis for provider ${providerId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * 获取供应商的熔断器配置（带缓存）
 * 缓存策略：内存缓存 5 分钟，避免频繁查询 Redis
 */
async function getProviderConfig(providerId: number): Promise<CircuitBreakerConfig> {
  const health = await getOrCreateHealth(providerId);

  // 检查内存缓存是否有效
  const now = Date.now();
  if (health.config && health.configLoadedAt && now - health.configLoadedAt < CONFIG_CACHE_TTL) {
    return health.config;
  }

  // 从 Redis/数据库加载配置
  try {
    const config = await loadProviderCircuitConfig(providerId);
    health.config = config;
    health.configLoadedAt = now;
    return config;
  } catch (error) {
    logger.warn(
      `[CircuitBreaker] Failed to load config for provider ${providerId}, using default`,
      {
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return DEFAULT_CIRCUIT_BREAKER_CONFIG;
  }
}

/**
 * 修复：导出获取健康状态和配置的公共函数（用于决策链记录）
 */
export async function getProviderHealthInfo(providerId: number): Promise<{
  health: ProviderHealth;
  config: CircuitBreakerConfig;
}> {
  const health = await getOrCreateHealth(providerId);
  const config = await getProviderConfig(providerId);
  return { health, config };
}

/**
 * 检查熔断器是否打开（不允许请求）
 */
export async function isCircuitOpen(providerId: number): Promise<boolean> {
  const health = await getOrCreateHealth(providerId);

  if (health.circuitState === "closed") {
    return false;
  }

  if (health.circuitState === "open") {
    // 检查是否可以转为半开状态
    if (health.circuitOpenUntil && Date.now() > health.circuitOpenUntil) {
      health.circuitState = "half-open";
      health.halfOpenSuccessCount = 0;
      logger.info(`[CircuitBreaker] Provider ${providerId} transitioned to half-open`);
      // 持久化状态变更到 Redis
      persistStateToRedis(providerId, health);
      return false; // 允许尝试
    }
    return true; // 仍在打开状态
  }

  // half-open 状态：允许尝试
  return false;
}

/**
 * 记录请求失败
 */
export async function recordFailure(providerId: number, error: Error): Promise<void> {
  const health = await getOrCreateHealth(providerId);
  const config = await getProviderConfig(providerId);

  health.failureCount++;
  health.lastFailureTime = Date.now();

  logger.warn(
    `[CircuitBreaker] Provider ${providerId} failure recorded (${health.failureCount}/${config.failureThreshold}): ${error.message}`,
    {
      providerId,
      failureCount: health.failureCount,
      threshold: config.failureThreshold,
      errorMessage: error.message,
    }
  );

  // 检查是否需要打开熔断器
  if (health.failureCount >= config.failureThreshold) {
    health.circuitState = "open";
    health.circuitOpenUntil = Date.now() + config.openDuration;
    health.halfOpenSuccessCount = 0;

    const retryAt = new Date(health.circuitOpenUntil).toISOString();

    logger.error(
      `[CircuitBreaker] Provider ${providerId} circuit opened after ${health.failureCount} failures, will retry at ${retryAt}`,
      {
        providerId,
        failureCount: health.failureCount,
        openDuration: config.openDuration,
        retryAt,
      }
    );

    // 异步发送熔断器告警（不阻塞主流程）
    triggerCircuitBreakerAlert(providerId, health.failureCount, retryAt, error.message).catch(
      (err) => {
        logger.error({
          action: "trigger_circuit_breaker_alert_error",
          providerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    );
  }

  // 持久化状态变更到 Redis
  persistStateToRedis(providerId, health);
}

/**
 * 触发熔断器告警通知
 */
async function triggerCircuitBreakerAlert(
  providerId: number,
  failureCount: number,
  retryAt: string,
  lastError: string
): Promise<void> {
  try {
    // 动态导入以避免循环依赖
    const { db } = await import("@/drizzle/db");
    const { providers } = await import("@/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { sendCircuitBreakerAlert } = await import("@/lib/notification/notifier");

    // 查询供应商名称
    const provider = await db
      .select({ name: providers.name })
      .from(providers)
      .where(eq(providers.id, providerId))
      .limit(1);

    if (!provider || provider.length === 0) {
      logger.warn({
        action: "circuit_breaker_alert_provider_not_found",
        providerId,
      });
      return;
    }

    // sendCircuitBreakerAlert 只接受一个参数，webhook URL 在函数内部从配置读取
    await sendCircuitBreakerAlert({
      providerName: provider[0].name,
      providerId,
      failureCount,
      retryAt,
      lastError,
    });
  } catch (error) {
    // 告警失败不影响熔断器功能
    logger.error({
      action: "circuit_breaker_alert_error",
      providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 记录请求成功
 */
export async function recordSuccess(providerId: number): Promise<void> {
  const health = await getOrCreateHealth(providerId);
  const config = await getProviderConfig(providerId);
  let stateChanged = false;

  if (health.circuitState === "half-open") {
    // 半开状态下成功
    health.halfOpenSuccessCount++;
    stateChanged = true;

    if (health.halfOpenSuccessCount >= config.halfOpenSuccessThreshold) {
      // 关闭熔断器
      health.circuitState = "closed";
      health.failureCount = 0;
      health.lastFailureTime = null;
      health.circuitOpenUntil = null;
      health.halfOpenSuccessCount = 0;

      logger.info(
        `[CircuitBreaker] Provider ${providerId} circuit closed after ${config.halfOpenSuccessThreshold} successes`,
        {
          providerId,
          successThreshold: config.halfOpenSuccessThreshold,
        }
      );
    } else {
      logger.debug(
        `[CircuitBreaker] Provider ${providerId} half-open success (${health.halfOpenSuccessCount}/${config.halfOpenSuccessThreshold})`,
        {
          providerId,
          successCount: health.halfOpenSuccessCount,
          threshold: config.halfOpenSuccessThreshold,
        }
      );
    }
  } else if (health.circuitState === "closed") {
    // 正常状态下成功，重置失败计数
    if (health.failureCount > 0) {
      logger.debug(
        `[CircuitBreaker] Provider ${providerId} success, resetting failure count from ${health.failureCount} to 0`,
        {
          providerId,
          previousFailureCount: health.failureCount,
        }
      );
      health.failureCount = 0;
      health.lastFailureTime = null;
      stateChanged = true;
    }
  }

  // 仅在状态变化时持久化到 Redis
  if (stateChanged) {
    persistStateToRedis(providerId, health);
  }
}

/**
 * 获取供应商的熔断器状态（用于决策链记录）
 * 注意：这是同步函数，仅访问内存中的状态
 */
export function getCircuitState(providerId: number): "closed" | "open" | "half-open" {
  const health = getOrCreateHealthSync(providerId);
  return health.circuitState;
}

/**
 * 获取所有供应商的健康状态（用于监控）
 * 会主动检查并更新过期的熔断器状态
 */
export function getAllHealthStatus(): Record<number, ProviderHealth> {
  const now = Date.now();
  const status: Record<number, ProviderHealth> = {};

  healthMap.forEach((health, providerId) => {
    // 检查并更新过期的熔断器状态
    if (health.circuitState === "open") {
      if (health.circuitOpenUntil && now > health.circuitOpenUntil) {
        // 熔断时间已过，转为半开状态
        health.circuitState = "half-open";
        health.halfOpenSuccessCount = 0;
        logger.info(
          `[CircuitBreaker] Provider ${providerId} auto-transitioned to half-open (on status check)`
        );
        // 持久化状态变更到 Redis
        persistStateToRedis(providerId, health);
      }
    }

    status[providerId] = { ...health };
  });

  return status;
}

/**
 * Asynchronously get health status for specified providers (with Redis batch loading)
 * Used for admin dashboard to display circuit breaker status
 *
 * @param providerIds - Array of provider IDs to fetch status for
 * @param options - Optional configuration
 * @param options.forceRefresh - When true, always reload from Redis (for admin dashboard)
 * @returns Promise resolving to a record mapping provider ID to health status
 */
export async function getAllHealthStatusAsync(
  providerIds: number[],
  options?: { forceRefresh?: boolean }
): Promise<Record<number, ProviderHealth>> {
  const { forceRefresh = false } = options || {};

  // Early return for empty input
  if (providerIds.length === 0) {
    return {};
  }

  const now = Date.now();
  const status: Record<number, ProviderHealth> = {};

  // If forceRefresh, clear loadedFromRedis for these providers to force Redis reload
  if (forceRefresh) {
    for (const id of providerIds) {
      loadedFromRedis.delete(id);
    }
  }

  // Find providers that need Redis refresh:
  // 1. Not in loadedFromRedis (never loaded)
  // 2. OR (when not forceRefresh) providers with non-closed state that may have changed
  const needsRefresh = providerIds.filter((id) => {
    if (!loadedFromRedis.has(id)) return true;
    // Always refresh non-closed states to catch recovery
    const memoryState = healthMap.get(id);
    return memoryState && memoryState.circuitState !== "closed";
  });

  if (needsRefresh.length > 0) {
    try {
      const redisStates = await loadAllCircuitStates(needsRefresh);

      for (const [providerId, redisState] of redisStates) {
        loadedFromRedis.add(providerId);

        const health: ProviderHealth = {
          ...redisState,
          config: null,
          configLoadedAt: null,
        };
        healthMap.set(providerId, health);

        logger.debug(`[CircuitBreaker] Restored state from Redis for provider ${providerId}`, {
          providerId,
          state: redisState.circuitState,
        });
      }

      // Mark IDs without Redis state as "loaded" to prevent repeated queries
      for (const id of needsRefresh) {
        loadedFromRedis.add(id);
      }
    } catch (error) {
      logger.warn(`[CircuitBreaker] Failed to batch load states from Redis`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Only include status for requested providers (not all in healthMap)
  for (const providerId of providerIds) {
    let health = healthMap.get(providerId);

    // Create default closed state for providers not in healthMap
    if (!health) {
      health = {
        failureCount: 0,
        lastFailureTime: null,
        circuitState: "closed",
        circuitOpenUntil: null,
        halfOpenSuccessCount: 0,
        config: null,
        configLoadedAt: null,
      };
      healthMap.set(providerId, health);
    }

    // Check and update expired circuit breaker status
    if (health.circuitState === "open") {
      if (health.circuitOpenUntil && now > health.circuitOpenUntil) {
        health.circuitState = "half-open";
        health.halfOpenSuccessCount = 0;
        logger.info(
          `[CircuitBreaker] Provider ${providerId} auto-transitioned to half-open (on status check)`
        );
        persistStateToRedis(providerId, health);
      }
    }
    status[providerId] = { ...health };
  }

  return status;
}

/**
 * 手动重置熔断器（用于运维手动恢复）
 */
export function resetCircuit(providerId: number): void {
  const health = getOrCreateHealthSync(providerId);

  const oldState = health.circuitState;

  // 重置所有状态
  health.circuitState = "closed";
  health.failureCount = 0;
  health.lastFailureTime = null;
  health.circuitOpenUntil = null;
  health.halfOpenSuccessCount = 0;

  logger.info(
    `[CircuitBreaker] Provider ${providerId} circuit manually reset from ${oldState} to closed`,
    {
      providerId,
      previousState: oldState,
      newState: "closed",
    }
  );

  // 持久化状态变更到 Redis
  persistStateToRedis(providerId, health);
}

/**
 * 将熔断器从 OPEN 状态转换到 HALF_OPEN 状态（用于智能探测）
 * 比直接 resetCircuit 更安全，允许通过 HALF_OPEN 阶段验证恢复
 */
export function tripToHalfOpen(providerId: number): boolean {
  const health = getOrCreateHealthSync(providerId);

  // 只有 OPEN 状态才能转换到 HALF_OPEN
  if (health.circuitState !== "open") {
    logger.debug(
      `[CircuitBreaker] Provider ${providerId} not in OPEN state, cannot trip to half-open`,
      {
        providerId,
        currentState: health.circuitState,
      }
    );
    return false;
  }

  const oldState = health.circuitState;

  // 转换到 HALF_OPEN 状态
  health.circuitState = "half-open";
  health.halfOpenSuccessCount = 0;
  health.circuitOpenUntil = null;

  logger.info(
    `[CircuitBreaker] Provider ${providerId} circuit transitioned from ${oldState} to half-open via smart probe`,
    {
      providerId,
      previousState: oldState,
      newState: "half-open",
    }
  );

  // 持久化状态变更到 Redis
  persistStateToRedis(providerId, health);

  return true;
}

/**
 * 清除供应商的配置缓存（供应商更新后调用）
 */
export function clearConfigCache(providerId: number): void {
  const health = healthMap.get(providerId);
  if (health) {
    health.config = null;
    health.configLoadedAt = null;
    logger.debug(`[CircuitBreaker] Cleared config cache for provider ${providerId}`);
  }
}

/**
 * 清除供应商的所有熔断器状态（内存 + Redis）
 * 用于供应商删除时调用
 */
export async function clearProviderState(providerId: number): Promise<void> {
  // 清除内存状态
  healthMap.delete(providerId);
  loadedFromRedis.delete(providerId);

  // 清除 Redis 状态
  const { deleteCircuitState } = await import("@/lib/redis/circuit-breaker-state");
  await deleteCircuitState(providerId);

  logger.info(`[CircuitBreaker] Cleared all state for provider ${providerId}`, {
    providerId,
  });
}
