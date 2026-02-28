import { logger } from "@/lib/logger";
import {
  acquireLeaderLock,
  type LeaderLock,
  releaseLeaderLock,
  renewLeaderLock,
  startLeaderLockKeepAlive,
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
// Max idle DB polling interval (bounded by base interval)
const IDLE_DB_POLL_INTERVAL_MS = Math.min(BASE_INTERVAL_MS, 30_000);
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
  __CCH_ENDPOINT_PROBE_SCHEDULER_NEXT_DUE_AT_MS__?: number;
  __CCH_ENDPOINT_PROBE_SCHEDULER_NEXT_DB_POLL_AT_MS__?: number;
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
 * Count enabled endpoints per vendor/type
 */
function countEndpointsByVendorType(endpoints: ProviderEndpointProbeTarget[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ep of endpoints) {
    const key = `${ep.vendorId}:${ep.providerType}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
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
  vendorEndpointCounts: Map<string, number>
): number {
  // Timeout override takes highest priority
  const hasTimeoutError =
    endpoint.lastProbeErrorType === "timeout" && endpoint.lastProbeOk !== true;
  if (hasTimeoutError) {
    return TIMEOUT_OVERRIDE_INTERVAL_MS;
  }

  // Single-vendor interval
  const vendorCount =
    vendorEndpointCounts.get(`${endpoint.vendorId}:${endpoint.providerType}`) ?? 0;
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
  vendorEndpointCounts: Map<string, number>,
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

function computeNextDueAtMs(
  endpoints: ProviderEndpointProbeTarget[],
  vendorEndpointCounts: Map<string, number>,
  nowMs: number
): number {
  let nextDueAtMs = Number.POSITIVE_INFINITY;
  for (const ep of endpoints) {
    // Never probed - treat as immediately due (force refresh on next tick)
    if (ep.lastProbedAt === null) {
      return nowMs;
    }

    const effectiveInterval = getEffectiveIntervalMs(ep, vendorEndpointCounts);
    const dueAtMs = ep.lastProbedAt.getTime() + effectiveInterval;
    if (dueAtMs < nextDueAtMs) {
      nextDueAtMs = dueAtMs;
    }
  }
  return nextDueAtMs;
}

function clearNextWorkHints(): void {
  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_NEXT_DUE_AT_MS__ = undefined;
  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_NEXT_DB_POLL_AT_MS__ = undefined;
}

function updateNextWorkHints(input: { nextDueAtMs: number; nowMs: number }): void {
  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_NEXT_DUE_AT_MS__ = input.nextDueAtMs;
  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_NEXT_DB_POLL_AT_MS__ =
    input.nowMs + IDLE_DB_POLL_INTERVAL_MS;
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
      clearNextWorkHints();
      return;
    }

    const nowMsBeforeCycle = Date.now();
    const nextDueAtMs = schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_NEXT_DUE_AT_MS__;
    const nextDbPollAtMs = schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_NEXT_DB_POLL_AT_MS__;
    if (typeof nextDueAtMs === "number" && typeof nextDbPollAtMs === "number") {
      const nextWorkAtMs = Math.min(nextDueAtMs, nextDbPollAtMs);
      if (nowMsBeforeCycle < nextWorkAtMs) {
        return;
      }
    }

    stopKeepAlive = startLeaderLockKeepAlive({
      getLock: () => schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_LOCK__,
      clearLock: () => {
        schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_LOCK__ = undefined;
      },
      ttlMs: LOCK_TTL_MS,
      logTag: "EndpointProbeScheduler",
      onLost: () => {
        leadershipLost = true;
        clearNextWorkHints();
      },
    }).stop;

    const jitter = CYCLE_JITTER_MS > 0 ? Math.floor(Math.random() * CYCLE_JITTER_MS) : 0;
    await sleep(jitter);

    if (leadershipLost || schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_STOP_REQUESTED__) {
      return;
    }

    const allEndpoints = await findEnabledProviderEndpointsForProbing();
    if (allEndpoints.length === 0) {
      updateNextWorkHints({ nextDueAtMs: Number.POSITIVE_INFINITY, nowMs: Date.now() });
      return;
    }

    // Calculate vendor endpoint counts for interval decisions
    const vendorEndpointCounts = countEndpointsByVendorType(allEndpoints);

    // Filter to only endpoints that are due for probing
    const now = new Date();
    const endpoints = filterDueEndpoints(allEndpoints, vendorEndpointCounts, now);
    if (endpoints.length === 0) {
      const nowMs = now.getTime();
      updateNextWorkHints({
        nextDueAtMs: computeNextDueAtMs(allEndpoints, vendorEndpointCounts, nowMs),
        nowMs,
      });
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
          const result = await probeProviderEndpointAndRecordByEndpoint({
            endpoint,
            source: "scheduled",
            timeoutMs: TIMEOUT_MS,
          });

          endpoint.lastProbedAt = new Date();
          endpoint.lastProbeOk = result.ok;
          endpoint.lastProbeErrorType = result.ok ? null : result.errorType;
        } catch (error) {
          logger.warn("[EndpointProbeScheduler] Probe failed", {
            endpointId: endpoint.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    if (leadershipLost || schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_STOP_REQUESTED__) {
      clearNextWorkHints();
      return;
    }

    const cycleNowMs = Date.now();
    updateNextWorkHints({
      nextDueAtMs: computeNextDueAtMs(allEndpoints, vendorEndpointCounts, cycleNowMs),
      nowMs: cycleNowMs,
    });
  } catch (error) {
    clearNextWorkHints();
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
  clearNextWorkHints();

  void runProbeCycle();

  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_INTERVAL_ID__ = setInterval(() => {
    void runProbeCycle();
  }, TICK_INTERVAL_MS);

  logger.info("[EndpointProbeScheduler] Started", {
    baseIntervalMs: BASE_INTERVAL_MS,
    singleVendorIntervalMs: SINGLE_VENDOR_INTERVAL_MS,
    timeoutOverrideIntervalMs: TIMEOUT_OVERRIDE_INTERVAL_MS,
    tickIntervalMs: TICK_INTERVAL_MS,
    idleDbPollIntervalMs: IDLE_DB_POLL_INTERVAL_MS,
    timeoutMs: TIMEOUT_MS,
    concurrency: CONCURRENCY,
    jitterMs: CYCLE_JITTER_MS,
    lockTtlMs: LOCK_TTL_MS,
  });
}

export function stopEndpointProbeScheduler(): void {
  schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_STOP_REQUESTED__ = true;
  clearNextWorkHints();

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
  idleDbPollIntervalMs: number;
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
    idleDbPollIntervalMs: IDLE_DB_POLL_INTERVAL_MS,
    timeoutMs: TIMEOUT_MS,
    concurrency: CONCURRENCY,
    jitterMs: CYCLE_JITTER_MS,
    lockTtlMs: LOCK_TTL_MS,
  };
}
