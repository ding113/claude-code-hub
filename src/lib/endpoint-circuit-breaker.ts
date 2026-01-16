import "server-only";

import { logger } from "@/lib/logger";
import {
  deleteEndpointCircuitState,
  type EndpointCircuitBreakerState,
  type EndpointCircuitState,
  loadEndpointCircuitState,
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
const loadedFromRedis = new Set<number>();

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
  const needsRedisCheck =
    (!health && !loadedFromRedis.has(endpointId)) || (health && health.circuitState !== "closed");

  if (needsRedisCheck) {
    loadedFromRedis.add(endpointId);

    try {
      const redisState = await loadEndpointCircuitState(endpointId);
      if (redisState) {
        if (!health || redisState.circuitState !== health.circuitState) {
          health = {
            failureCount: redisState.failureCount,
            lastFailureTime: redisState.lastFailureTime,
            circuitState: redisState.circuitState,
            circuitOpenUntil: redisState.circuitOpenUntil,
            halfOpenSuccessCount: redisState.halfOpenSuccessCount,
          };
          healthMap.set(endpointId, health);
        }
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

export async function isEndpointCircuitOpen(endpointId: number): Promise<boolean> {
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
  const health = await getOrCreateHealth(endpointId);
  const config = DEFAULT_ENDPOINT_CIRCUIT_BREAKER_CONFIG;

  health.failureCount += 1;
  health.lastFailureTime = Date.now();

  if (config.failureThreshold > 0 && health.failureCount >= config.failureThreshold) {
    health.circuitState = "open";
    health.circuitOpenUntil = Date.now() + config.openDuration;
    health.halfOpenSuccessCount = 0;

    logger.warn("[EndpointCircuitBreaker] Endpoint circuit opened", {
      endpointId,
      failureCount: health.failureCount,
      threshold: config.failureThreshold,
      errorMessage: error.message,
    });
  }

  persistStateToRedis(endpointId, health);
}

export async function recordEndpointSuccess(endpointId: number): Promise<void> {
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

export async function resetEndpointCircuit(endpointId: number): Promise<void> {
  const health = getOrCreateHealthSync(endpointId);
  health.circuitState = "closed";
  health.failureCount = 0;
  health.lastFailureTime = null;
  health.circuitOpenUntil = null;
  health.halfOpenSuccessCount = 0;

  await deleteEndpointCircuitState(endpointId);
}
