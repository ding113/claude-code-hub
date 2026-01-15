import { logger } from "@/lib/logger";
import {
  acquireLeaderLock,
  type LeaderLock,
  releaseLeaderLock,
  renewLeaderLock,
} from "@/lib/provider-endpoints/leader-lock";
import { probeProviderEndpointAndRecordByEndpoint } from "@/lib/provider-endpoints/probe";
import { findEnabledProviderEndpointsForProbing } from "@/repository";

const LOCK_KEY = "locks:endpoint-probe-scheduler";

function parseIntWithDefault(value: string | undefined, fallback: number): number {
  const n = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

const INTERVAL_MS = Math.max(
  1,
  parseIntWithDefault(process.env.ENDPOINT_PROBE_INTERVAL_MS, 10_000)
);
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

    const endpoints = await findEnabledProviderEndpointsForProbing();
    if (endpoints.length === 0) {
      return;
    }

    const concurrency = Math.max(1, Math.min(CONCURRENCY, endpoints.length));
    const minBatches = Math.ceil(endpoints.length / concurrency);
    const expectedFloorMs = minBatches * Math.max(0, TIMEOUT_MS);
    if (expectedFloorMs > INTERVAL_MS) {
      logger.warn("[EndpointProbeScheduler] Probe capacity may be insufficient", {
        endpointsCount: endpoints.length,
        intervalMs: INTERVAL_MS,
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
  }, INTERVAL_MS);

  logger.info("[EndpointProbeScheduler] Started", {
    intervalMs: INTERVAL_MS,
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
  intervalMs: number;
  timeoutMs: number;
  concurrency: number;
  jitterMs: number;
  lockTtlMs: number;
} {
  return {
    started: schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_STARTED__ === true,
    running: schedulerState.__CCH_ENDPOINT_PROBE_SCHEDULER_RUNNING__ === true,
    intervalMs: INTERVAL_MS,
    timeoutMs: TIMEOUT_MS,
    concurrency: CONCURRENCY,
    jitterMs: CYCLE_JITTER_MS,
    lockTtlMs: LOCK_TTL_MS,
  };
}
