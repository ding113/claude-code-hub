/**
 * Redis 熔断器状态持久化层
 *
 * 功能：
 * 1. 将熔断器运行时状态持久化到 Redis
 * 2. 支持多实例共享熔断器状态
 * 3. 服务重启后恢复熔断器状态
 * 4. 降级策略：Redis 不可用时使用内存存储
 *
 * 存储结构（Redis Hash）：
 * Key: circuit_breaker:state:{providerId}
 * Fields:
 *   - failureCount: number
 *   - lastFailureTime: number | null
 *   - circuitState: "closed" | "open" | "half-open"
 *   - circuitOpenUntil: number | null
 *   - halfOpenSuccessCount: number
 */

import { logger } from "@/lib/logger";
import { getRedisClient } from "./client";

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerState {
  failureCount: number;
  lastFailureTime: number | null;
  circuitState: CircuitState;
  circuitOpenUntil: number | null;
  halfOpenSuccessCount: number;
}

// 默认状态（正常关闭）
export const DEFAULT_CIRCUIT_STATE: CircuitBreakerState = {
  failureCount: 0,
  lastFailureTime: null,
  circuitState: "closed",
  circuitOpenUntil: null,
  halfOpenSuccessCount: 0,
};

// State TTL: 24 hours (cleanup old states)
const STATE_TTL_SECONDS = 86400;

/**
 * 生成 Redis Key
 */
function getStateKey(providerId: number): string {
  return `circuit_breaker:state:${providerId}`;
}

/**
 * 将状态对象序列化为 Redis Hash 格式
 */
function serializeState(state: CircuitBreakerState): Record<string, string> {
  return {
    failureCount: state.failureCount.toString(),
    lastFailureTime: state.lastFailureTime?.toString() ?? "",
    circuitState: state.circuitState,
    circuitOpenUntil: state.circuitOpenUntil?.toString() ?? "",
    halfOpenSuccessCount: state.halfOpenSuccessCount.toString(),
  };
}

/**
 * 将 Redis Hash 格式反序列化为状态对象
 */
function deserializeState(data: Record<string, string>): CircuitBreakerState {
  return {
    failureCount: parseInt(data.failureCount || "0", 10),
    lastFailureTime: data.lastFailureTime ? parseInt(data.lastFailureTime, 10) : null,
    circuitState: (data.circuitState as CircuitState) || "closed",
    circuitOpenUntil: data.circuitOpenUntil ? parseInt(data.circuitOpenUntil, 10) : null,
    halfOpenSuccessCount: parseInt(data.halfOpenSuccessCount || "0", 10),
  };
}

/**
 * 从 Redis 加载熔断器状态
 *
 * @param providerId 供应商 ID
 * @returns 熔断器状态，未找到或失败时返回 null
 */
export async function loadCircuitState(providerId: number): Promise<CircuitBreakerState | null> {
  const redis = getRedisClient();

  if (!redis) {
    logger.debug("[CircuitBreakerState] Redis not available, returning null", { providerId });
    return null;
  }

  try {
    const key = getStateKey(providerId);
    const data = await redis.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      logger.debug("[CircuitBreakerState] No state found in Redis", { providerId });
      return null;
    }

    const state = deserializeState(data);
    logger.debug("[CircuitBreakerState] Loaded from Redis", { providerId, state });
    return state;
  } catch (error) {
    logger.warn("[CircuitBreakerState] Failed to load from Redis", {
      providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 保存熔断器状态到 Redis
 *
 * @param providerId 供应商 ID
 * @param state 熔断器状态
 */
export async function saveCircuitState(
  providerId: number,
  state: CircuitBreakerState
): Promise<void> {
  const redis = getRedisClient();

  if (!redis) {
    logger.debug("[CircuitBreakerState] Redis not available, skip saving", { providerId });
    return;
  }

  try {
    const key = getStateKey(providerId);
    const data = serializeState(state);

    // Use pipeline for atomic operation
    await redis.hset(key, data);
    await redis.expire(key, STATE_TTL_SECONDS);

    logger.debug("[CircuitBreakerState] Saved to Redis", { providerId, state: state.circuitState });
  } catch (error) {
    logger.warn("[CircuitBreakerState] Failed to save to Redis", {
      providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - fail-open strategy
  }
}

/**
 * 删除熔断器状态
 *
 * @param providerId 供应商 ID
 */
export async function deleteCircuitState(providerId: number): Promise<void> {
  const redis = getRedisClient();

  if (!redis) {
    return;
  }

  try {
    const key = getStateKey(providerId);
    await redis.del(key);
    logger.debug("[CircuitBreakerState] Deleted from Redis", { providerId });
  } catch (error) {
    logger.warn("[CircuitBreakerState] Failed to delete from Redis", {
      providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 批量加载所有熔断器状态
 * 用于应用启动时恢复状态
 *
 * @param providerIds 供应商 ID 列表
 * @returns 状态映射表
 */
export async function loadAllCircuitStates(
  providerIds: number[]
): Promise<Map<number, CircuitBreakerState>> {
  const redis = getRedisClient();
  const stateMap = new Map<number, CircuitBreakerState>();

  if (!redis || providerIds.length === 0) {
    return stateMap;
  }

  try {
    logger.info("[CircuitBreakerState] Loading states for providers", {
      count: providerIds.length,
    });

    // Use Promise.allSettled to load all states in parallel
    const results = await Promise.allSettled(
      providerIds.map(async (id) => ({
        id,
        state: await loadCircuitState(id),
      }))
    );

    let loadedCount = 0;
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.state) {
        stateMap.set(result.value.id, result.value.state);
        loadedCount++;
      }
    }

    logger.info("[CircuitBreakerState] Loaded states from Redis", {
      total: providerIds.length,
      loaded: loadedCount,
    });

    return stateMap;
  } catch (error) {
    logger.error("[CircuitBreakerState] Failed to load all states", {
      error: error instanceof Error ? error.message : String(error),
    });
    return stateMap;
  }
}

/**
 * 列出所有熔断器状态的 Key（用于调试和监控）
 *
 * @returns 供应商 ID 列表
 */
export async function listCircuitStateKeys(): Promise<number[]> {
  const redis = getRedisClient();

  if (!redis) {
    return [];
  }

  try {
    const keys = await redis.keys("circuit_breaker:state:*");
    return keys
      .map((key) => parseInt(key.replace("circuit_breaker:state:", ""), 10))
      .filter(Boolean);
  } catch (error) {
    logger.warn("[CircuitBreakerState] Failed to list keys", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
