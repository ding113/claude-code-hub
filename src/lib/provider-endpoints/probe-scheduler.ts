import { logger } from "@/lib/logger";
import {
  acquireLeaderLock,
  type LeaderLock,
  releaseLeaderLock,
  renewLeaderLock,
} from "@/lib/provider-endpoints/leader-lock";
import { probeProviderEndpointAndRecordByEndpoint } from "@/lib/provider-endpoints/probe";
import {
  findEnabledProviderEndpointsForProbing,
  type ProviderEndpointProbeTarget,
} from "@/repository";

const LOCK_KEY = "locks:endpoint-probe-scheduler";

function parseIntWithDefault(value: string | undefined, fallback: number): number {
  const n = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

// Base interval (default 60s)
const BASE_INTERVAL_MS = Math.max(
  1,
  parseIntWithDefault(process.env.ENDPOINT_PROBE_INTERVAL_MS, 60_000)
);
// Single-vendor interval (10 minutes)
const SINGLE_VENDOR_INTERVAL_MS = 600_000;
// Timeout override interval (10 seconds)
const TIMEOUT_OVERRIDE_INTERVAL_MS = 10_000;
// Scheduler tick interval - use shortest possible interval to support timeout override
const TICK_INTERVAL_MS = Math.min(BASE_INTERVAL_MS, TIMEOUT_OVERRIDE_INTERVAL_MS);
const TIMEOUT_MS = Math.max(1, parseIntWithDefault(process.env.ENDPOINT_PROBE_TIMEOUT_MS, 5_000));
const CONCURRENCY = Math.max(1, parseIntWithDefault(process.env.ENDPOINT_PROBE_CONCURRENCY, 10));
const CYCLE_JITTER_MS = Math.max(
  0,
  parseIntWithDefault(process.env.ENDPOINT_PROBE_CYCLE_JITTER_MS, 1_000)
);
const LOCK_TTL_MS = Math.max(
  1,
  parseIntWithDefault(process.env.ENDPOINT_PROBE_LOCK_TTL_MS, 30_000)
);

const schedulerState = globalThis as unknown as {
  __CCH_ENDPOINT_PROBE_SCHEDULER_STARTED__?: boolean;
  __CCH_ENDPOINT_PROBE_SCHEDULER_INTERVAL_ID__?: ReturnType<typeof setInterval>;
  __CCH_ENDPOINT_PROBE_SCHEDULER_RUNNING__?: boolean;
  __CCH_ENDPOINT_PROBE_SCHEDULER_LOCK__?: LeaderLock;
  __CCH_ENDPOINT_PROBE_SCHEDULER_STOP_REQUESTED__?: boolean;
};

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

/**
 * Count enabled endpoints per vendor
 */
function countEndpointsByVendor(endpoints: ProviderEndpointProbeTarget[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const ep of endpoints) {
    counts.set(ep.vendorId, (counts.get(ep.vendorId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Calculate effective interval for an endpoint based on:
 * 1. Timeout override (10s) - if lastProbeErrorType === "timeout" and lastProbeOk !== true
 * 2. Single-vendor interval (10min) - if vendor has only 1 enabled endpoint
 * 3. Base interval (60s) - default
 *
 * Priority: timeout override > single-vendor > base
 */
function getEffectiveIntervalMs(
  endpoint: ProviderEndpointProbeTarget,
  vendorEndpointCounts: Map<number, number>
): number {
  // Timeout override takes highest priority
  const hasTimeoutError =
    endpoint.lastProbeErrorType === "timeout" && endpoint.lastProbeOk !== true;
  if (hasTimeoutError) {
    return TIMEOUT_OVERRIDE_INTERVAL_MS;
  }

  // Single-vendor interval
  const vendorCount = vendorEndpointCounts.get(endpoint.vendorId) ?? 0;
  if (vendorCount === 1) {
    return SINGLE_VENDOR_INTERVAL_MS;
  }

  // Default base interval
  return BASE_INTERVAL_MS;
}

/**
 * Filter endpoints that are due for probing based on their effective interval
 */
function filterDueEndpoints(
  endpoints: ProviderEndpointProbeTarget[],
  vendorEndpointCounts: Map<number, number>,
  now: Date
): ProviderEndpointProbeTarget[] {
  const nowMs = now.getTime();
  return endpoints.filter((ep) => {
    // Never probed - always due
    if (ep.lastProbedAt === null) {
      return true;
    }

    const effectiveInterval = getEffectiveIntervalMs(ep, vendorEndpointCounts);
    const dueAt = ep.lastProbedAt.getTime() + effectiveInterval;
    return nowMs >= dueAt;
  });
}

async function ensureLeaderLock(): Promise<boolean> {
  const current = schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_LOCK__;
  if (current) {
    const ok = await renewLeaderLock(current, LOCK_TTL_MS);
    if (ok) {
      return true;
    }

    schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_LOCK__ = undefined;
    await releaseLeaderLock(current);
  }

  const acquired = await acquireLeaderLock(LOCK_KEY, LOCK_TTL_MS);
  if (!acquired) {
    return false;
  }

  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_LOCK__ = acquired;
  return true;
}

function startLeaderLockKeepAlive(onLost: () => void): () => void {
  let stopped = false;
  let renewing = false;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (intervalId) clearInterval(intervalId);
  };

  const tick = async () => {
    if (stopped || renewing) return;

    const current = schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_LOCK__;
    if (!current) {
      stop();
      onLost();
      return;
    }

    renewing = true;
    try {
      const ok = await renewLeaderLock(current, LOCK_TTL_MS);
      if (!ok) {
        schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_LOCK__ = undefined;
        stop();
        onLost();
        logger.warn("[EndpointProbeScheduler] Lost leader lock during probe cycle", {
          key: current.key,
          lockType: current.lockType,
        });
      }
    } finally {
      renewing = false;
    }
  };

  const intervalMs = Math.max(1000, Math.floor(LOCK_TTL_MS / 2));
  intervalId = setInterval(() => {
    void tick();
  }, intervalMs);

  const timer = intervalId as unknown as { unref?: () => void };
  timer.unref?.();

  return stop;
}

async function runProbeCycle(): Promise<void> {
  if (schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_RUNNING__) {
    return;
  }

  if (schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_STOP_REQUESTED__) {
    return;
  }

  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_RUNNING__ = true;

  let leadershipLost = false;
  let stopKeepAlive: (() => void) | undefined;

  try {
    const isLeader = await ensureLeaderLock();
    if (!isLeader) {
      return;
    }

    stopKeepAlive = startLeaderLockKeepAlive(() => {
      leadershipLost = true;
    });

    const jitter = CYCLE_JITTER_MS > 0 ? Math.floor(Math.random() * CYCLE_JITTER_MS) : 0;
    await sleep(jitter);

    if (leadershipLost || schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_STOP_REQUESTED__) {
      return;
    }

    const allEndpoints = await findEnabledProviderEndpointsForProbing();
    if (allEndpoints.length === 0) {
      return;
    }

    // Calculate vendor endpoint counts for interval decisions
    const vendorEndpointCounts = countEndpointsByVendor(allEndpoints);

    // Filter to only endpoints that are due for probing
    const now = new Date();
    const endpoints = filterDueEndpoints(allEndpoints, vendorEndpointCounts, now);
    if (endpoints.length === 0) {
      return;
    }

    const concurrency = Math.max(1, Math.min(CONCURRENCY, endpoints.length));
    const minBatches = Math.ceil(endpoints.length / concurrency);
    const expectedFloorMs = minBatches * Math.max(0, TIMEOUT_MS);
    if (expectedFloorMs > TICK_INTERVAL_MS) {
      logger.warn("[EndpointProbeScheduler] Probe capacity may be insufficient", {
        dueEndpointsCount: endpoints.length,
        totalEndpointsCount: allEndpoints.length,
        tickIntervalMs: TICK_INTERVAL_MS,
        timeoutMs: TIMEOUT_MS,
        concurrency,
        expectedFloorMs,
      });
    }

    shuffleInPlace(endpoints);

    let index = 0;
    const worker = async () => {
      while (!leadershipLost && !schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_STOP_REQUESTED__) {
        const endpoint = endpoints[index];
        index += 1;
        if (!endpoint) {
          return;
        }

        try {
          await probeProviderEndpointAndRecordByEndpoint({
            endpoint,
            source: "scheduled",
            timeoutMs: TIMEOUT_MS,
          });
        } catch (error) {
          logger.warn("[EndpointProbeScheduler] Probe failed", {
            endpointId: endpoint.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } catch (error) {
    logger.warn("[EndpointProbeScheduler] Probe cycle error", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    stopKeepAlive?.();
    schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_RUNNING__ = false;
  }
}

export function startEndpointProbeScheduler(): void {
  if (schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_STARTED__) {
    return;
  }

  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_STOP_REQUESTED__ = false;
  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_STARTED__ = true;

  void runProbeCycle();

  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_INTERVAL_ID__ = setInterval(() => {
    void runProbeCycle();
  }, TICK_INTERVAL_MS);

  logger.info("[EndpointProbeScheduler] Started", {
    baseIntervalMs: BASE_INTERVAL_MS,
    singleVendorIntervalMs: SINGLE_VENDOR_INTERVAL_MS,
    timeoutOverrideIntervalMs: TIMEOUT_OVERRIDE_INTERVAL_MS,
    tickIntervalMs: TICK_INTERVAL_MS,
    timeoutMs: TIMEOUT_MS,
    concurrency: CONCURRENCY,
    jitterMs: CYCLE_JITTER_MS,
    lockTtlMs: LOCK_TTL_MS,
  });
}

export function stopEndpointProbeScheduler(): void {
  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_STOP_REQUESTED__ = true;

  const intervalId = schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_INTERVAL_ID__;
  if (intervalId) {
    clearInterval(intervalId);
  }

  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_INTERVAL_ID__ = undefined;
  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_STARTED__ = false;

  const lock = schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_LOCK__;
  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_LOCK__ = undefined;
  if (lock) {
    void releaseLeaderLock(lock);
  }
}

export function getEndpointProbeSchedulerStatus(): {
  started: boolean;
  running: boolean;
  baseIntervalMs: number;
  singleVendorIntervalMs: number;
  timeoutOverrideIntervalMs: number;
  tickIntervalMs: number;
  timeoutMs: number;
  concurrency: number;
  jitterMs: number;
  lockTtlMs: number;
} {
  return {
    started: schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_STARTED__ === true,
    running: schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_RUNNING__ === true,
    baseIntervalMs: BASE_INTERVAL_MS,
    singleVendorIntervalMs: SINGLE_VENDOR_INTERVAL_MS,
    timeoutOverrideIntervalMs: TIMEOUT_OVERRIDE_INTERVAL_MS,
    tickIntervalMs: TICK_INTERVAL_MS,
    timeoutMs: TIMEOUT_MS,
    concurrency: CONCURRENCY,
    jitterMs: CYCLE_JITTER_MS,
    lockTtlMs: LOCK_TTL_MS,
  };
}
