import "server-only";

import { logger } from "@/lib/logger";
import { getRedisClient } from "./client";

export type EndpointCircuitState = "closed" | "open" | "half-open";

export interface EndpointCircuitBreakerState {
  failureCount: number;
  lastFailureTime: number | null;
  circuitState: EndpointCircuitState;
  circuitOpenUntil: number | null;
  halfOpenSuccessCount: number;
}

export const DEFAULT_ENDPOINT_CIRCUIT_STATE: EndpointCircuitBreakerState = {
  failureCount: 0,
  lastFailureTime: null,
  circuitState: "closed",
  circuitOpenUntil: null,
  halfOpenSuccessCount: 0,
};

const STATE_TTL_SECONDS = 86400;

function getStateKey(endpointId: number): string {
  return `endpoint_circuit_breaker:state:${endpointId}`;
}

function serializeState(state: EndpointCircuitBreakerState): Record<string, string> {
  return {
    failureCount: state.failureCount.toString(),
    lastFailureTime: state.lastFailureTime?.toString() ?? "",
    circuitState: state.circuitState,
    circuitOpenUntil: state.circuitOpenUntil?.toString() ?? "",
    halfOpenSuccessCount: state.halfOpenSuccessCount.toString(),
  };
}

function deserializeState(data: Record<string, string>): EndpointCircuitBreakerState {
  return {
    failureCount: Number.parseInt(data.failureCount || "0", 10),
    lastFailureTime: data.lastFailureTime ? Number.parseInt(data.lastFailureTime, 10) : null,
    circuitState: (data.circuitState as EndpointCircuitState) || "closed",
    circuitOpenUntil: data.circuitOpenUntil ? Number.parseInt(data.circuitOpenUntil, 10) : null,
    halfOpenSuccessCount: Number.parseInt(data.halfOpenSuccessCount || "0", 10),
  };
}

export async function loadEndpointCircuitStates(
  endpointIds: readonly number[]
): Promise<Map<number, EndpointCircuitBreakerState | null>> {
  const uniqueEndpointIds = Array.from(new Set(endpointIds));
  const stateMap = new Map<number, EndpointCircuitBreakerState | null>();

  for (const endpointId of uniqueEndpointIds) {
    stateMap.set(endpointId, null);
  }

  const redis = getRedisClient();

  if (!redis || uniqueEndpointIds.length === 0) {
    if (!redis && uniqueEndpointIds.length > 0) {
      logger.debug("[EndpointCircuitState] Redis not available, returning null", {
        count: uniqueEndpointIds.length,
      });
    }
    return stateMap;
  }

  const PIPELINE_BATCH_SIZE = 200;

  try {
    for (let i = 0; i < uniqueEndpointIds.length; i += PIPELINE_BATCH_SIZE) {
      const batchIds = uniqueEndpointIds.slice(i, i + PIPELINE_BATCH_SIZE);
      const pipeline = redis.pipeline();

      for (const endpointId of batchIds) {
        pipeline.hgetall(getStateKey(endpointId));
      }

      const results = await pipeline.exec();
      if (!results) {
        logger.warn("[EndpointCircuitState] Pipeline exec returned null", {
          count: batchIds.length,
        });
        continue;
      }

      let errorCount = 0;
      const errorSamples: Array<{ endpointId: number; error: string }> = [];

      for (let index = 0; index < batchIds.length; index++) {
        const endpointId = batchIds[index];
        const [error, data] = results[index] ?? [];

        if (error) {
          errorCount += 1;
          if (errorSamples.length < 3) {
            errorSamples.push({
              endpointId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          continue;
        }

        if (!data || typeof data !== "object" || Array.isArray(data)) {
          continue;
        }

        const record = data as Record<string, string>;
        if (Object.keys(record).length === 0) {
          continue;
        }

        stateMap.set(endpointId, deserializeState(record));
      }

      if (errorCount > 0) {
        logger.warn("[EndpointCircuitState] Partial batch load failures", {
          errorCount,
          sample: errorSamples,
        });
      }
    }

    return stateMap;
  } catch (error) {
    logger.warn("[EndpointCircuitState] Failed to batch load from Redis", {
      count: uniqueEndpointIds.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return stateMap;
  }
}

export async function loadEndpointCircuitState(
  endpointId: number
): Promise<EndpointCircuitBreakerState | null> {
  const redis = getRedisClient();

  if (!redis) {
    logger.debug("[EndpointCircuitState] Redis not available, returning null", { endpointId });
    return null;
  }

  try {
    const key = getStateKey(endpointId);
    const data = await redis.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return deserializeState(data);
  } catch (error) {
    logger.warn("[EndpointCircuitState] Failed to load from Redis", {
      endpointId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function saveEndpointCircuitState(
  endpointId: number,
  state: EndpointCircuitBreakerState
): Promise<void> {
  const redis = getRedisClient();

  if (!redis) {
    logger.debug("[EndpointCircuitState] Redis not available, skip saving", { endpointId });
    return;
  }

  try {
    const key = getStateKey(endpointId);
    const data = serializeState(state);
    await redis.hset(key, data);
    await redis.expire(key, STATE_TTL_SECONDS);
  } catch (error) {
    logger.warn("[EndpointCircuitState] Failed to save to Redis", {
      endpointId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function deleteEndpointCircuitState(endpointId: number): Promise<void> {
  const redis = getRedisClient();

  if (!redis) {
    return;
  }

  try {
    const key = getStateKey(endpointId);
    await redis.del(key);
  } catch (error) {
    logger.warn("[EndpointCircuitState] Failed to delete from Redis", {
      endpointId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
