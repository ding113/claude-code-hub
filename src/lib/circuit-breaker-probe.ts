/**
 * Circuit Breaker Smart Probe Scheduler
 *
 * Periodically probes providers in OPEN circuit state to enable faster recovery.
 * When a probe succeeds, the circuit transitions to HALF_OPEN state earlier.
 *
 * Configuration via environment variables:
 * - ENABLE_SMART_PROBING: Enable/disable smart probing (default: false)
 * - PROBE_INTERVAL_MS: Interval between probe cycles (default: 30000ms = 30s)
 * - PROBE_TIMEOUT_MS: Timeout for each probe request (default: 5000ms = 5s)
 */

import { logger } from "@/lib/logger";
import type { ProviderType } from "@/types/provider";
import { getAllHealthStatus, tripToHalfOpen } from "./circuit-breaker";
import { executeProviderTest } from "./provider-testing/test-service";

// Configuration
const ENABLE_SMART_PROBING = process.env.ENABLE_SMART_PROBING === "true";
const PROBE_INTERVAL_MS = parseInt(process.env.PROBE_INTERVAL_MS || "30000", 10);
const PROBE_TIMEOUT_MS = parseInt(process.env.PROBE_TIMEOUT_MS || "5000", 10);

// Probe state
let probeIntervalId: NodeJS.Timeout | null = null;
let isProbing = false;

// In-memory cache of provider configs for probing
interface ProbeProviderConfig {
  id: number;
  name: string;
  url: string;
  key: string;
  providerType: ProviderType;
  model?: string;
}

let providerConfigCache: Map<number, ProbeProviderConfig> = new Map();
let lastProviderCacheUpdate = 0;
const PROVIDER_CACHE_TTL = 60000; // 1 minute

/**
 * Load provider configurations for probing
 */
async function loadProviderConfigs(): Promise<void> {
  const now = Date.now();
  if (now - lastProviderCacheUpdate < PROVIDER_CACHE_TTL && providerConfigCache.size > 0) {
    return; // Cache still valid
  }

  try {
    // Dynamic import to avoid circular dependencies
    const { db } = await import("@/drizzle/db");
    const { providers } = await import("@/drizzle/schema");
    const { eq, isNull, and } = await import("drizzle-orm");

    const providerList = await db
      .select({
        id: providers.id,
        name: providers.name,
        url: providers.url,
        key: providers.key,
        providerType: providers.providerType,
      })
      .from(providers)
      .where(and(eq(providers.isEnabled, true), isNull(providers.deletedAt)));

    providerConfigCache = new Map(
      providerList.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          url: p.url,
          key: p.key,
          providerType: (p.providerType || "claude") as ProviderType,
        },
      ])
    );
    lastProviderCacheUpdate = now;

    logger.debug("[SmartProbe] Updated provider cache", {
      count: providerConfigCache.size,
    });
  } catch (error) {
    logger.error("[SmartProbe] Failed to load provider configs", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Probe a single provider
 */
async function probeProvider(providerId: number): Promise<boolean> {
  const config = providerConfigCache.get(providerId);
  if (!config) {
    logger.warn("[SmartProbe] Provider config not found", { providerId });
    return false;
  }

  try {
    logger.info("[SmartProbe] Probing provider", {
      providerId,
      providerName: config.name,
    });

    const result = await executeProviderTest({
      providerUrl: config.url,
      apiKey: config.key,
      providerType: config.providerType,
      timeoutMs: PROBE_TIMEOUT_MS,
    });

    if (result.success) {
      logger.info("[SmartProbe] Probe succeeded, transitioning to half-open", {
        providerId,
        providerName: config.name,
        latencyMs: result.latencyMs,
        status: result.status,
      });

      // Transition circuit to half-open state for safe recovery verification
      // This allows real requests to gradually test the provider before fully closing
      tripToHalfOpen(providerId);
      return true;
    }

    logger.info("[SmartProbe] Probe failed, keeping circuit open", {
      providerId,
      providerName: config.name,
      status: result.status,
      subStatus: result.subStatus,
      errorMessage: result.errorMessage,
    });
    return false;
  } catch (error) {
    logger.error("[SmartProbe] Probe execution error", {
      providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Run a single probe cycle
 */
async function runProbeCycle(): Promise<void> {
  if (isProbing) {
    logger.debug("[SmartProbe] Skipping cycle, previous cycle still running");
    return;
  }

  isProbing = true;

  try {
    // Load fresh provider configs
    await loadProviderConfigs();

    // Get all providers with open circuits
    const healthStatus = getAllHealthStatus();
    const openCircuits: number[] = [];

    for (const [providerId, health] of Object.entries(healthStatus)) {
      if (health.circuitState === "open") {
        openCircuits.push(parseInt(providerId, 10));
      }
    }

    if (openCircuits.length === 0) {
      logger.debug("[SmartProbe] No open circuits to probe");
      return;
    }

    logger.info("[SmartProbe] Starting probe cycle", {
      openCircuitCount: openCircuits.length,
      providerIds: openCircuits,
    });

    // Probe each provider with open circuit
    const results = await Promise.allSettled(openCircuits.map((id) => probeProvider(id)));

    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value === true).length;
    const failed = results.length - succeeded;

    logger.info("[SmartProbe] Probe cycle completed", {
      total: results.length,
      succeeded,
      failed,
    });
  } catch (error) {
    logger.error("[SmartProbe] Probe cycle error", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    isProbing = false;
  }
}

/**
 * Start the probe scheduler
 */
export function startProbeScheduler(): void {
  if (!ENABLE_SMART_PROBING) {
    logger.info("[SmartProbe] Smart probing is disabled");
    return;
  }

  if (probeIntervalId) {
    logger.warn("[SmartProbe] Scheduler already running");
    return;
  }

  logger.info("[SmartProbe] Starting probe scheduler", {
    intervalMs: PROBE_INTERVAL_MS,
    timeoutMs: PROBE_TIMEOUT_MS,
  });

  // Run immediately on startup
  runProbeCycle().catch((error) => {
    logger.error("[SmartProbe] Initial probe cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // Schedule periodic probes
  probeIntervalId = setInterval(() => {
    runProbeCycle().catch((error) => {
      logger.error("[SmartProbe] Scheduled probe cycle failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, PROBE_INTERVAL_MS);

  // Ensure cleanup on process exit
  process.on("SIGTERM", stopProbeScheduler);
  process.on("SIGINT", stopProbeScheduler);
}

/**
 * Stop the probe scheduler
 */
export function stopProbeScheduler(): void {
  if (probeIntervalId) {
    clearInterval(probeIntervalId);
    probeIntervalId = null;
    logger.info("[SmartProbe] Probe scheduler stopped");
  }
}

/**
 * Check if smart probing is enabled
 */
export function isSmartProbingEnabled(): boolean {
  return ENABLE_SMART_PROBING;
}

/**
 * Get probe scheduler status
 */
export function getProbeSchedulerStatus(): {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  timeoutMs: number;
} {
  return {
    enabled: ENABLE_SMART_PROBING,
    running: probeIntervalId !== null,
    intervalMs: PROBE_INTERVAL_MS,
    timeoutMs: PROBE_TIMEOUT_MS,
  };
}

/**
 * Manually trigger a probe for a specific provider
 */
export async function triggerManualProbe(providerId: number): Promise<boolean> {
  await loadProviderConfigs();
  return probeProvider(providerId);
}
