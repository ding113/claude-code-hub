import "server-only";

import { logger } from "@/lib/logger";
import type { ProviderType } from "@/types/provider";

export type EndpointCircuitState = "closed" | "open" | "half-open";

export interface EndpointHealth {
  failureCount: number;
  lastFailureTime: number | null;
  circuitState: EndpointCircuitState;
  circuitOpenUntil: number | null;
  halfOpenSuccessCount: number;
}

type VendorTypeFuseKey = string;

type VendorTypeFuseState = {
  openUntil: number;
  openedAt: number;
  lastReason: string;
};

function parsePositiveInt(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const ENDPOINT_FAILURE_THRESHOLD = parsePositiveInt(
  process.env.ENDPOINT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  3
);
const ENDPOINT_OPEN_DURATION_MS = parsePositiveInt(
  process.env.ENDPOINT_CIRCUIT_BREAKER_OPEN_DURATION_MS,
  5 * 60 * 1000
);
const ENDPOINT_HALF_OPEN_SUCCESS_THRESHOLD = parsePositiveInt(
  process.env.ENDPOINT_CIRCUIT_BREAKER_HALF_OPEN_SUCCESS_THRESHOLD,
  2
);

const VENDOR_TYPE_FUSE_OPEN_DURATION_MS = parsePositiveInt(
  process.env.VENDOR_TYPE_FUSE_OPEN_DURATION_MS,
  60 * 1000
);

const endpointHealthMap = new Map<number, EndpointHealth>();
const vendorTypeFuseMap = new Map<VendorTypeFuseKey, VendorTypeFuseState>();

function getOrCreateEndpointHealth(endpointId: number): EndpointHealth {
  const existing = endpointHealthMap.get(endpointId);
  if (existing) return existing;

  const health: EndpointHealth = {
    failureCount: 0,
    lastFailureTime: null,
    circuitState: "closed",
    circuitOpenUntil: null,
    halfOpenSuccessCount: 0,
  };

  endpointHealthMap.set(endpointId, health);
  return health;
}

function getVendorTypeFuseKey(vendorId: number, providerType: ProviderType): VendorTypeFuseKey {
  return `${vendorId}:${providerType}`;
}

export function getEndpointCircuitState(endpointId: number): EndpointCircuitState {
  return getOrCreateEndpointHealth(endpointId).circuitState;
}

export function isEndpointCircuitOpen(endpointId: number): boolean {
  const health = getOrCreateEndpointHealth(endpointId);

  if (health.circuitState !== "open") {
    return false;
  }

  if (!health.circuitOpenUntil) {
    return true;
  }

  const now = Date.now();
  if (now <= health.circuitOpenUntil) {
    return true;
  }

  health.circuitState = "half-open";
  health.circuitOpenUntil = null;
  health.halfOpenSuccessCount = 0;

  return false;
}

export function recordEndpointFailure(endpointId: number, error: Error): void {
  const health = getOrCreateEndpointHealth(endpointId);

  if (health.circuitState === "half-open") {
    health.circuitState = "open";
    health.failureCount = ENDPOINT_FAILURE_THRESHOLD;
    health.lastFailureTime = Date.now();
    health.circuitOpenUntil = Date.now() + ENDPOINT_OPEN_DURATION_MS;
    health.halfOpenSuccessCount = 0;

    logger.warn("[EndpointCircuitBreaker] Half-open failure, reopening", {
      endpointId,
      errorName: error.name,
    });

    return;
  }

  health.failureCount += 1;
  health.lastFailureTime = Date.now();

  if (ENDPOINT_FAILURE_THRESHOLD > 0 && health.failureCount >= ENDPOINT_FAILURE_THRESHOLD) {
    health.circuitState = "open";
    health.circuitOpenUntil = Date.now() + ENDPOINT_OPEN_DURATION_MS;
    health.halfOpenSuccessCount = 0;

    logger.warn("[EndpointCircuitBreaker] Circuit opened", {
      endpointId,
      failureCount: health.failureCount,
      threshold: ENDPOINT_FAILURE_THRESHOLD,
      errorName: error.name,
    });
  }
}

export function recordEndpointSuccess(endpointId: number): void {
  const health = getOrCreateEndpointHealth(endpointId);

  if (health.circuitState === "half-open") {
    health.halfOpenSuccessCount += 1;

    if (health.halfOpenSuccessCount >= ENDPOINT_HALF_OPEN_SUCCESS_THRESHOLD) {
      health.circuitState = "closed";
      health.failureCount = 0;
      health.lastFailureTime = null;
      health.circuitOpenUntil = null;
      health.halfOpenSuccessCount = 0;
    }

    return;
  }

  if (health.circuitState === "closed" && health.failureCount > 0) {
    health.failureCount = 0;
    health.lastFailureTime = null;
  }
}

export function openVendorTypeFuse(options: {
  vendorId: number;
  providerType: ProviderType;
  reason: string;
}): void {
  const now = Date.now();
  const key = getVendorTypeFuseKey(options.vendorId, options.providerType);

  vendorTypeFuseMap.set(key, {
    openUntil: now + VENDOR_TYPE_FUSE_OPEN_DURATION_MS,
    openedAt: now,
    lastReason: options.reason,
  });

  logger.warn("[EndpointCircuitBreaker] Vendor+type fuse opened", {
    vendorId: options.vendorId,
    providerType: options.providerType,
    reason: options.reason,
    openDurationMs: VENDOR_TYPE_FUSE_OPEN_DURATION_MS,
  });
}

export function isVendorTypeFuseOpen(vendorId: number, providerType: ProviderType): boolean {
  const key = getVendorTypeFuseKey(vendorId, providerType);
  const state = vendorTypeFuseMap.get(key);
  if (!state) return false;

  const now = Date.now();
  if (now <= state.openUntil) {
    return true;
  }

  vendorTypeFuseMap.delete(key);
  return false;
}
