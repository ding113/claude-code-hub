import "server-only";

import { logger } from "@/lib/logger";
import {
  deleteVendorTypeCircuitState,
  loadVendorTypeCircuitState,
  saveVendorTypeCircuitState,
  type VendorTypeCircuitBreakerState,
} from "@/lib/redis/vendor-type-circuit-breaker-state";
import type { ProviderType } from "@/types/provider";

export interface VendorTypeCircuitInfo {
  vendorId: number;
  providerType: ProviderType;
  circuitState: "closed" | "open";
  circuitOpenUntil: number | null;
  lastFailureTime: number | null;
  manualOpen: boolean;
}

const AUTO_OPEN_DURATION_MS = 60000;

const stateMap = new Map<string, VendorTypeCircuitBreakerState>();
const loadedFromRedis = new Set<string>();

function getKey(vendorId: number, providerType: ProviderType): string {
  return `${vendorId}:${providerType}`;
}

function toInfo(
  vendorId: number,
  providerType: ProviderType,
  state: VendorTypeCircuitBreakerState
): VendorTypeCircuitInfo {
  return {
    vendorId,
    providerType,
    circuitState: state.circuitState,
    circuitOpenUntil: state.circuitOpenUntil,
    lastFailureTime: state.lastFailureTime,
    manualOpen: state.manualOpen,
  };
}

async function getOrCreateState(
  vendorId: number,
  providerType: ProviderType
): Promise<VendorTypeCircuitBreakerState> {
  const key = getKey(vendorId, providerType);
  let state = stateMap.get(key);
  const needsRedisCheck =
    (!state && !loadedFromRedis.has(key)) ||
    (state && (state.circuitState !== "closed" || state.manualOpen));

  if (needsRedisCheck) {
    loadedFromRedis.add(key);

    try {
      const redisState = await loadVendorTypeCircuitState(vendorId, providerType);
      if (redisState) {
        stateMap.set(key, redisState);
        return redisState;
      }

      if (state && (state.circuitState !== "closed" || state.manualOpen)) {
        state.circuitState = "closed";
        state.circuitOpenUntil = null;
        state.lastFailureTime = null;
        state.manualOpen = false;
      }
    } catch (error) {
      logger.warn("[VendorTypeCircuitBreaker] Failed to sync state from Redis", {
        vendorId,
        providerType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!state) {
    state = {
      circuitState: "closed",
      circuitOpenUntil: null,
      lastFailureTime: null,
      manualOpen: false,
    };
    stateMap.set(key, state);
  }

  return state;
}

function persist(
  vendorId: number,
  providerType: ProviderType,
  state: VendorTypeCircuitBreakerState
): void {
  saveVendorTypeCircuitState(vendorId, providerType, state).catch((error) => {
    logger.warn("[VendorTypeCircuitBreaker] Failed to persist state to Redis", {
      vendorId,
      providerType,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function getVendorTypeCircuitInfo(
  vendorId: number,
  providerType: ProviderType
): Promise<VendorTypeCircuitInfo> {
  const state = await getOrCreateState(vendorId, providerType);
  return toInfo(vendorId, providerType, state);
}

export async function isVendorTypeCircuitOpen(
  vendorId: number,
  providerType: ProviderType
): Promise<boolean> {
  const state = await getOrCreateState(vendorId, providerType);

  if (state.manualOpen) {
    return true;
  }

  if (state.circuitState === "open") {
    if (state.circuitOpenUntil && Date.now() > state.circuitOpenUntil) {
      state.circuitState = "closed";
      state.circuitOpenUntil = null;
      state.lastFailureTime = null;
      persist(vendorId, providerType, state);
      return false;
    }
    return true;
  }

  return false;
}

export async function recordVendorTypeAllEndpointsTimeout(
  vendorId: number,
  providerType: ProviderType,
  openDurationMs: number = AUTO_OPEN_DURATION_MS
): Promise<void> {
  const state = await getOrCreateState(vendorId, providerType);

  if (state.manualOpen) {
    return;
  }

  state.circuitState = "open";
  state.lastFailureTime = Date.now();
  state.circuitOpenUntil = Date.now() + Math.max(1000, openDurationMs);

  persist(vendorId, providerType, state);
}

export async function setVendorTypeCircuitManualOpen(
  vendorId: number,
  providerType: ProviderType,
  manualOpen: boolean
): Promise<void> {
  const state = await getOrCreateState(vendorId, providerType);

  state.manualOpen = manualOpen;

  if (manualOpen) {
    state.circuitState = "open";
    state.circuitOpenUntil = null;
    state.lastFailureTime = Date.now();
  } else {
    state.circuitState = "closed";
    state.circuitOpenUntil = null;
    state.lastFailureTime = null;
  }

  persist(vendorId, providerType, state);
}

export async function resetVendorTypeCircuit(
  vendorId: number,
  providerType: ProviderType
): Promise<void> {
  const key = getKey(vendorId, providerType);
  stateMap.delete(key);
  loadedFromRedis.delete(key);
  await deleteVendorTypeCircuitState(vendorId, providerType);
}
