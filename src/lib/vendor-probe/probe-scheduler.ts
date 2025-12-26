import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/drizzle/db";
import { vendorEndpoints, vendors } from "@/drizzle/schema-v2";
import { logger } from "@/lib/logger";

import type { VendorEndpointProbeStore } from "./latency-probe";
import { runLatencyProbeCycle } from "./latency-probe";

const DEFAULT_PROBE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_PROBE_TIMEOUT_MS = 5000;

let intervalId: NodeJS.Timeout | null = null;
let isRunning = false;

export function isVendorProbingEnabled(): boolean {
  return process.env.ENABLE_VENDOR_PROBING === "true";
}

function createDrizzleStore(): VendorEndpointProbeStore {
  return {
    async listEnabledEndpoints() {
      return await db
        .select({
          id: vendorEndpoints.id,
          url: vendorEndpoints.url,
          healthCheckEnabled: vendorEndpoints.healthCheckEnabled,
          healthCheckEndpoint: vendorEndpoints.healthCheckEndpoint,
          healthCheckTimeoutMs: vendorEndpoints.healthCheckTimeoutMs,
        })
        .from(vendorEndpoints)
        .innerJoin(vendors, eq(vendorEndpoints.vendorId, vendors.id))
        .where(
          and(
            eq(vendorEndpoints.isEnabled, true),
            isNull(vendorEndpoints.deletedAt),
            eq(vendors.isEnabled, true),
            isNull(vendors.deletedAt)
          )
        );
    },

    async updateEndpointLatencyMs(endpointId, latencyMs) {
      await db
        .update(vendorEndpoints)
        .set({
          latencyMs,
          updatedAt: new Date(),
        })
        .where(and(eq(vendorEndpoints.id, endpointId), isNull(vendorEndpoints.deletedAt)));
    },
  };
}

async function runCycle(timeoutMs: number): Promise<void> {
  if (isRunning) {
    logger.debug("[VendorProbe] Skipping cycle, previous cycle still running");
    return;
  }

  isRunning = true;
  try {
    const results = await runLatencyProbeCycle({
      store: createDrizzleStore(),
      defaultTimeoutMs: timeoutMs,
    });

    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;

    logger.info("[VendorProbe] Probe cycle completed", {
      total: results.length,
      ok,
      failed,
    });
  } catch (error) {
    logger.error("[VendorProbe] Probe cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    isRunning = false;
  }
}

export function startVendorProbeScheduler(options?: {
  intervalMs?: number;
  timeoutMs?: number;
}): void {
  if (!isVendorProbingEnabled()) {
    logger.info("[VendorProbe] Vendor probing is disabled");
    return;
  }

  if (intervalId) {
    logger.warn("[VendorProbe] Scheduler already running");
    return;
  }

  const intervalMs =
    options?.intervalMs != null && Number.isFinite(options.intervalMs) && options.intervalMs > 0
      ? options.intervalMs
      : DEFAULT_PROBE_INTERVAL_MS;
  const timeoutMs =
    options?.timeoutMs != null && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_PROBE_TIMEOUT_MS;

  logger.info("[VendorProbe] Starting vendor probe scheduler", {
    intervalMs,
    timeoutMs,
  });

  void runCycle(timeoutMs);

  intervalId = setInterval(() => {
    void runCycle(timeoutMs);
  }, intervalMs);

  process.on("SIGTERM", stopVendorProbeScheduler);
  process.on("SIGINT", stopVendorProbeScheduler);
}

export function stopVendorProbeScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("[VendorProbe] Vendor probe scheduler stopped");
  }
}

export function getVendorProbeSchedulerStatus(): {
  enabled: boolean;
  running: boolean;
} {
  return {
    enabled: isVendorProbingEnabled(),
    running: intervalId !== null,
  };
}
