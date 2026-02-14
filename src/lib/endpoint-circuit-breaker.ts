import "server-only";

import { logger } from "@/lib/logger";
import {
  deleteEndpointCircuitState,
  type EndpointCircuitBreakerState,
  type EndpointCircuitState,
  loadEndpointCircuitState,
  loadEndpointCircuitStates,
  saveEndpointCircuitState,
} from "@/lib/redis/endpoint-circuit-breaker-state";

export interface EndpointCircuitBreakerConfig {
  failureThreshold: number;
  openDuration: number;
  halfOpenSuccessThreshold: number;
}

export const DEFAULT_ENDPOINT_CIRCUIT_BREAKER_CONFIG: EndpointCircuitBreakerConfig = {
  failureThreshold: 3,
  openDuration: 300000,
  halfOpenSuccessThreshold: 1,
};

export interface EndpointHealth {
  failureCount: number;
  lastFailureTime: number | null;
  circuitState: EndpointCircuitState;
  circuitOpenUntil: number | null;
  halfOpenSuccessCount: number;
}

const healthMap = new Map<number, EndpointHealth>();
const loadedFromRedisAt = new Map<number, number>();
const REDIS_SYNC_TTL_MS = 1_000;

function getOrCreateHealthSync(endpointId: number): EndpointHealth {
  let health = healthMap.get(endpointId);
  if (!health) {
    health = {
      failureCount: 0,
      lastFailureTime: null,
      circuitState: "closed",
      circuitOpenUntil: null,
      halfOpenSuccessCount: 0,
    };
    healthMap.set(endpointId, health);
  }
  return health;
}

async function getOrCreateHealth(endpointId: number): Promise<EndpointHealth> {
  let health = healthMap.get(endpointId);
  const loadedAt = loadedFromRedisAt.get(endpointId);
  const now = Date.now();
  const needsRedisCheck =
    loadedAt === undefined || (loadedAt !== undefined && now - loadedAt > REDIS_SYNC_TTL_MS);

  if (needsRedisCheck) {
    loadedFromRedisAt.set(endpointId, now);

    try {
      const redisState = await loadEndpointCircuitState(endpointId);
      if (redisState) {
        // 从 Redis 同步到内存时，不能只在 circuitState 变化时才更新：
        // failureCount / halfOpenSuccessCount 等字段也可能在其它实例中发生变化。
        if (health) {
          health.failureCount = redisState.failureCount;
          health.lastFailureTime = redisState.lastFailureTime;
          health.circuitState = redisState.circuitState;
          health.circuitOpenUntil = redisState.circuitOpenUntil;
          health.halfOpenSuccessCount = redisState.halfOpenSuccessCount;
          return health;
        }

        health = {
          failureCount: redisState.failureCount,
          lastFailureTime: redisState.lastFailureTime,
          circuitState: redisState.circuitState,
          circuitOpenUntil: redisState.circuitOpenUntil,
          halfOpenSuccessCount: redisState.halfOpenSuccessCount,
        };
        healthMap.set(endpointId, health);
        return health;
      }

      if (health && health.circuitState !== "closed") {
        health.circuitState = "closed";
        health.failureCount = 0;
        health.lastFailureTime = null;
        health.circuitOpenUntil = null;
        health.halfOpenSuccessCount = 0;
      }
    } catch (error) {
      logger.warn("[EndpointCircuitBreaker] Failed to sync state from Redis", {
        endpointId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return getOrCreateHealthSync(endpointId);
}

function persistStateToRedis(endpointId: number, health: EndpointHealth): void {
  const state: EndpointCircuitBreakerState = {
    failureCount: health.failureCount,
    lastFailureTime: health.lastFailureTime,
    circuitState: health.circuitState,
    circuitOpenUntil: health.circuitOpenUntil,
    halfOpenSuccessCount: health.halfOpenSuccessCount,
  };

  saveEndpointCircuitState(endpointId, state).catch((error) => {
    logger.warn("[EndpointCircuitBreaker] Failed to persist state to Redis", {
      endpointId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function getEndpointHealthInfo(
  endpointId: number
): Promise<{ health: EndpointHealth; config: EndpointCircuitBreakerConfig }> {
  const health = await getOrCreateHealth(endpointId);
  return { health, config: DEFAULT_ENDPOINT_CIRCUIT_BREAKER_CONFIG };
}

export async function getAllEndpointHealthStatusAsync(
  endpointIds: number[],
  options?: { forceRefresh?: boolean }
): Promise<Record<number, EndpointHealth>> {
  const { forceRefresh = false } = options || {};

  if (endpointIds.length === 0) {
    return {};
  }

  const uniqueEndpointIds = Array.from(new Set(endpointIds));

  if (forceRefresh) {
    for (const endpointId of uniqueEndpointIds) {
      loadedFromRedisAt.delete(endpointId);
    }
  }

  const refreshNow = Date.now();
  const needsRefresh = uniqueEndpointIds.filter((endpointId) => {
    const memoryState = healthMap.get(endpointId);
    if (!memoryState) return true;

    const loadedAt = loadedFromRedisAt.get(endpointId);
    if (loadedAt === undefined) return true;
    return refreshNow - loadedAt > REDIS_SYNC_TTL_MS;
  });

  if (needsRefresh.length > 0) {
    try {
      const redisStates = await loadEndpointCircuitStates(needsRefresh);

      for (const endpointId of needsRefresh) {
        loadedFromRedisAt.set(endpointId, refreshNow);

        const redisState = redisStates.get(endpointId) ?? null;
        if (redisState) {
          // 从 Redis 同步到内存时，不能只在 circuitState 变化时才更新：
          // failureCount / halfOpenSuccessCount 等字段在 forceRefresh 下也应保持一致。
          const existingHealth = healthMap.get(endpointId);
          if (existingHealth) {
            existingHealth.failureCount = redisState.failureCount;
            existingHealth.lastFailureTime = redisState.lastFailureTime;
            existingHealth.circuitState = redisState.circuitState;
            existingHealth.circuitOpenUntil = redisState.circuitOpenUntil;
            existingHealth.halfOpenSuccessCount = redisState.halfOpenSuccessCount;
          } else {
            healthMap.set(endpointId, {
              failureCount: redisState.failureCount,
              lastFailureTime: redisState.lastFailureTime,
              circuitState: redisState.circuitState,
              circuitOpenUntil: redisState.circuitOpenUntil,
              halfOpenSuccessCount: redisState.halfOpenSuccessCount,
            });
          }
          continue;
        }

        const existingHealth = healthMap.get(endpointId);
        if (existingHealth && existingHealth.circuitState !== "closed") {
          existingHealth.circuitState = "closed";
          existingHealth.failureCount = 0;
          existingHealth.lastFailureTime = null;
          existingHealth.circuitOpenUntil = null;
          existingHealth.halfOpenSuccessCount = 0;
        }
      }
    } catch (error) {
      logger.warn("[EndpointCircuitBreaker] Failed to batch sync state from Redis", {
        count: needsRefresh.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const now = Date.now();
  const status: Record<number, EndpointHealth> = {};

  for (const endpointId of uniqueEndpointIds) {
    const health = getOrCreateHealthSync(endpointId);

    if (health.circuitState === "open") {
      if (health.circuitOpenUntil && now > health.circuitOpenUntil) {
        health.circuitState = "half-open";
        health.halfOpenSuccessCount = 0;
        persistStateToRedis(endpointId, health);
      }
    }

    status[endpointId] = { ...health };
  }

  return status;
}

export async function isEndpointCircuitOpen(endpointId: number): Promise<boolean> {
  const { getEnvConfig } = await import("@/lib/config/env.schema");
  if (!getEnvConfig().ENABLE_ENDPOINT_CIRCUIT_BREAKER) {
    return false;
  }

  const health = await getOrCreateHealth(endpointId);

  if (health.circuitState === "closed") {
    return false;
  }

  if (health.circuitState === "open") {
    if (health.circuitOpenUntil && Date.now() > health.circuitOpenUntil) {
      health.circuitState = "half-open";
      health.halfOpenSuccessCount = 0;
      persistStateToRedis(endpointId, health);
      return false;
    }

    return true;
  }

  return false;
}

export async function recordEndpointFailure(endpointId: number, error: Error): Promise<void> {
  const { getEnvConfig } = await import("@/lib/config/env.schema");
  if (!getEnvConfig().ENABLE_ENDPOINT_CIRCUIT_BREAKER) {
    return;
  }

  const health = await getOrCreateHealth(endpointId);
  const config = DEFAULT_ENDPOINT_CIRCUIT_BREAKER_CONFIG;

  health.failureCount += 1;
  health.lastFailureTime = Date.now();

  if (config.failureThreshold > 0 && health.failureCount >= config.failureThreshold) {
    if (health.circuitState !== "open") {
      // Only set timer and alert on initial transition (closed->open or half-open->open)
      health.circuitState = "open";
      health.circuitOpenUntil = Date.now() + config.openDuration;
      health.halfOpenSuccessCount = 0;

      const retryAt = new Date(health.circuitOpenUntil).toISOString();

      logger.warn("[EndpointCircuitBreaker] Endpoint circuit opened", {
        endpointId,
        failureCount: health.failureCount,
        threshold: config.failureThreshold,
        errorMessage: error.message,
      });

      // Async alert (non-blocking)
      triggerEndpointCircuitBreakerAlert(
        endpointId,
        health.failureCount,
        retryAt,
        error.message
      ).catch((err) => {
        logger.error({
          action: "trigger_endpoint_circuit_breaker_alert_error",
          endpointId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    // If already open: failureCount is updated above, but timer stays fixed — no death spiral
  }

  persistStateToRedis(endpointId, health);
}

export async function recordEndpointSuccess(endpointId: number): Promise<void> {
  const { getEnvConfig } = await import("@/lib/config/env.schema");
  if (!getEnvConfig().ENABLE_ENDPOINT_CIRCUIT_BREAKER) {
    return;
  }

  const health = await getOrCreateHealth(endpointId);
  const config = DEFAULT_ENDPOINT_CIRCUIT_BREAKER_CONFIG;

  if (health.circuitState === "half-open") {
    health.halfOpenSuccessCount += 1;

    if (health.halfOpenSuccessCount >= config.halfOpenSuccessThreshold) {
      health.circuitState = "closed";
      health.failureCount = 0;
      health.lastFailureTime = null;
      health.circuitOpenUntil = null;
      health.halfOpenSuccessCount = 0;
    }

    persistStateToRedis(endpointId, health);
    return;
  }

  if (health.failureCount > 0) {
    health.failureCount = 0;
    health.lastFailureTime = null;
    health.circuitOpenUntil = null;
    persistStateToRedis(endpointId, health);
  }
}

export function getEndpointCircuitStateSync(endpointId: number): EndpointCircuitState {
  return healthMap.get(endpointId)?.circuitState ?? "closed";
}

export async function resetEndpointCircuit(endpointId: number): Promise<void> {
  const health = getOrCreateHealthSync(endpointId);
  health.circuitState = "closed";
  health.failureCount = 0;
  health.lastFailureTime = null;
  health.circuitOpenUntil = null;
  health.halfOpenSuccessCount = 0;

  await deleteEndpointCircuitState(endpointId);
}

/**
 * Alert data for endpoint circuit breaker events.
 */
export interface EndpointCircuitAlertData {
  endpointId: number;
  failureCount: number;
  retryAt: string;
  lastError: string;
  endpointUrl?: string;
}

/**
 * Trigger circuit breaker alert for an endpoint.
 * Looks up endpoint info to enrich the alert data, then delegates to sendCircuitBreakerAlert.
 */
export async function triggerEndpointCircuitBreakerAlert(
  endpointId: number,
  failureCount: number,
  retryAt: string,
  lastError: string
): Promise<void> {
  const { getEnvConfig } = await import("@/lib/config/env.schema");
  if (!getEnvConfig().ENABLE_ENDPOINT_CIRCUIT_BREAKER) {
    return;
  }

  try {
    const { sendCircuitBreakerAlert } = await import("@/lib/notification/notifier");

    // Try to enrich with endpoint URL and vendor info from database
    let endpointUrl: string | undefined;
    let vendorId = 0;
    let endpointLabel = "";
    try {
      const { findProviderEndpointById } = await import("@/repository");
      const endpoint = await findProviderEndpointById(endpointId);
      if (endpoint) {
        endpointUrl = endpoint.url;
        vendorId = endpoint.vendorId;
        endpointLabel = endpoint.label || "";
      }
    } catch (lookupError) {
      logger.warn("[EndpointCircuitBreaker] Failed to enrich alert with endpoint info", {
        endpointId,
        error: lookupError instanceof Error ? lookupError.message : String(lookupError),
      });
    }

    await sendCircuitBreakerAlert({
      providerId: vendorId,
      providerName: endpointLabel || `endpoint:${endpointId}`,
      failureCount,
      retryAt,
      lastError,
      incidentSource: "endpoint",
      endpointId,
      endpointUrl,
    });
  } catch (error) {
    logger.error({
      action: "endpoint_circuit_breaker_alert_error",
      endpointId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Startup initialization: when ENABLE_ENDPOINT_CIRCUIT_BREAKER is disabled,
 * clear all endpoint circuit breaker states from both in-memory map and Redis
 * to ensure no stale open states block endpoints.
 *
 * Called once at application startup.
 */
export async function initEndpointCircuitBreaker(): Promise<void> {
  const { getEnvConfig } = await import("@/lib/config/env.schema");
  if (getEnvConfig().ENABLE_ENDPOINT_CIRCUIT_BREAKER) {
    return;
  }

  healthMap.clear();
  loadedFromRedisAt.clear();

  try {
    const { getRedisClient } = await import("@/lib/redis/client");
    const redis = getRedisClient();
    if (!redis) return;

    const pattern = "endpoint_circuit_breaker:state:*";
    let cursor = "0";
    let deletedCount = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
        deletedCount += keys.length;
      }
    } while (cursor !== "0");

    if (deletedCount > 0) {
      logger.info("[EndpointCircuitBreaker] Cleared stale states on startup (feature disabled)", {
        deletedCount,
      });
    }
  } catch (error) {
    logger.warn("[EndpointCircuitBreaker] Failed to clear stale states on startup", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
