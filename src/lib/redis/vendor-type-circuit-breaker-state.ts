import "server-only";

import { logger } from "@/lib/logger";
import type { ProviderType } from "@/types/provider";
import { getRedisClient } from "./client";

export type VendorTypeCircuitStateValue = "closed" | "open";

export interface VendorTypeCircuitBreakerState {
  circuitState: VendorTypeCircuitStateValue;
  circuitOpenUntil: number | null;
  lastFailureTime: number | null;
  manualOpen: boolean;
}

export const DEFAULT_VENDOR_TYPE_CIRCUIT_STATE: VendorTypeCircuitBreakerState = {
  circuitState: "closed",
  circuitOpenUntil: null,
  lastFailureTime: null,
  manualOpen: false,
};

const STATE_TTL_SECONDS = 2592000;

function getStateKey(vendorId: number, providerType: ProviderType): string {
  return `vendor_type_circuit_breaker:state:${vendorId}:${providerType}`;
}

function serializeState(state: VendorTypeCircuitBreakerState): Record<string, string> {
  return {
    circuitState: state.circuitState,
    circuitOpenUntil: state.circuitOpenUntil?.toString() ?? "",
    lastFailureTime: state.lastFailureTime?.toString() ?? "",
    manualOpen: state.manualOpen ? "1" : "0",
  };
}

function deserializeState(data: Record<string, string>): VendorTypeCircuitBreakerState {
  return {
    circuitState: (data.circuitState as VendorTypeCircuitStateValue) || "closed",
    circuitOpenUntil: data.circuitOpenUntil ? Number.parseInt(data.circuitOpenUntil, 10) : null,
    lastFailureTime: data.lastFailureTime ? Number.parseInt(data.lastFailureTime, 10) : null,
    manualOpen: data.manualOpen === "1",
  };
}

export async function loadVendorTypeCircuitState(
  vendorId: number,
  providerType: ProviderType
): Promise<VendorTypeCircuitBreakerState | null> {
  const redis = getRedisClient();

  if (!redis) {
    return null;
  }

  try {
    const key = getStateKey(vendorId, providerType);
    const data = await redis.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return deserializeState(data);
  } catch (error) {
    logger.warn("[VendorTypeCircuitState] Failed to load from Redis", {
      vendorId,
      providerType,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function saveVendorTypeCircuitState(
  vendorId: number,
  providerType: ProviderType,
  state: VendorTypeCircuitBreakerState
): Promise<void> {
  const redis = getRedisClient();

  if (!redis) {
    return;
  }

  try {
    const key = getStateKey(vendorId, providerType);
    const data = serializeState(state);
    await redis.hset(key, data);
    await redis.expire(key, STATE_TTL_SECONDS);
  } catch (error) {
    logger.warn("[VendorTypeCircuitState] Failed to save to Redis", {
      vendorId,
      providerType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function deleteVendorTypeCircuitState(
  vendorId: number,
  providerType: ProviderType
): Promise<void> {
  const redis = getRedisClient();

  if (!redis) {
    return;
  }

  try {
    const key = getStateKey(vendorId, providerType);
    await redis.del(key);
  } catch (error) {
    logger.warn("[VendorTypeCircuitState] Failed to delete from Redis", {
      vendorId,
      providerType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
