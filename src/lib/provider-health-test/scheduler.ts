import { logger } from "@/lib/logger";
import {
  acquireLeaderLock,
  type LeaderLock,
  releaseLeaderLock,
  renewLeaderLock,
  startLeaderLockKeepAlive,
} from "@/lib/provider-endpoints/leader-lock";
import {
  HEALTH_TEST_INTERVAL_MS,
  msUntilNextHealthTestBoundary,
  normalizeHealthTestIntervalSeconds,
  normalizeHealthTestTimeoutSeconds,
  SCHEDULED_HEALTH_TEST_TIMEOUT_MS,
} from "@/lib/provider-health-test/defaults";
import {
  getScheduledHealthTestInFlightCount,
  runDueScheduledHealthTests,
} from "@/lib/provider-health-test/run-test";

// rebalance imported dynamically inside cycle to keep startup light

const LOCK_KEY = "locks:provider-health-test-scheduler";

function parseIntWithDefault(value: string | undefined, fallback: number): number {
  const n = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

const INTERVAL_MS = Math.max(
  10_000,
  parseIntWithDefault(process.env.PROVIDER_HEALTH_TEST_INTERVAL_MS, HEALTH_TEST_INTERVAL_MS)
);
const LOCK_TTL_MS = Math.max(
  1,
  parseIntWithDefault(process.env.PROVIDER_HEALTH_TEST_LOCK_TTL_MS, 45_000)
);
const ENABLED = process.env.PROVIDER_HEALTH_TEST_SCHEDULER_ENABLED !== "false";

const schedulerState = globalThis as unknown as {
  __CCH_PROVIDER_HEALTH_TEST_STARTED__?: boolean;
  __CCH_PROVIDER_HEALTH_TEST_TIMEOUT_ID__?: ReturnType<typeof setTimeout>;
  __CCH_PROVIDER_HEALTH_TEST_INTERVAL_ID__?: ReturnType<typeof setInterval>;
  /** Short mutex only for due-list dispatch, not for waiting on probes. */
  __CCH_PROVIDER_HEALTH_TEST_DISPATCHING__?: boolean;
  __CCH_PROVIDER_HEALTH_TEST_LOCK__?: LeaderLock;
  __CCH_PROVIDER_HEALTH_TEST_STOP__?: boolean;
  __CCH_PROVIDER_HEALTH_TEST_CADENCE_WAKE_TIMERS__?: Set<ReturnType<typeof setTimeout>>;
};

const cadenceWakeTimers =
  schedulerState.__CCH_PROVIDER_HEALTH_TEST_CADENCE_WAKE_TIMERS__ ??
  (schedulerState.__CCH_PROVIDER_HEALTH_TEST_CADENCE_WAKE_TIMERS__ = new Set());

function scheduleCadenceWake(delayMs: number): void {
  if (schedulerState.__CCH_PROVIDER_HEALTH_TEST_STOP__) return;

  const normalizedDelayMs = Math.max(0, delayMs);
  let timer: ReturnType<typeof setTimeout>;
  timer = setTimeout(() => {
    cadenceWakeTimers.delete(timer);
    if (schedulerState.__CCH_PROVIDER_HEALTH_TEST_STOP__) return;
    void runCycle();
  }, normalizedDelayMs);
  cadenceWakeTimers.add(timer);
}

async function ensureLeaderLock(): Promise<boolean> {
  const current = schedulerState.__CCH_PROVIDER_HEALTH_TEST_LOCK__;
  if (current) {
    const ok = await renewLeaderLock(current, LOCK_TTL_MS);
    if (ok) return true;
    schedulerState.__CCH_PROVIDER_HEALTH_TEST_LOCK__ = undefined;
    await releaseLeaderLock(current);
  }

  const acquired = await acquireLeaderLock(LOCK_KEY, LOCK_TTL_MS);
  if (!acquired) return false;
  schedulerState.__CCH_PROVIDER_HEALTH_TEST_LOCK__ = acquired;
  return true;
}

/**
 * Poll/cadence tick: start any due providers that are not already in-flight.
 * Must NOT wait for slow providers — that used to skip the next cron tick globally.
 */
async function runCycle(): Promise<void> {
  if (schedulerState.__CCH_PROVIDER_HEALTH_TEST_DISPATCHING__) return;
  if (schedulerState.__CCH_PROVIDER_HEALTH_TEST_STOP__) return;

  schedulerState.__CCH_PROVIDER_HEALTH_TEST_DISPATCHING__ = true;
  let leadershipLost = false;
  let stopKeepAlive: (() => void) | undefined;
  let dueIntervalMs = INTERVAL_MS;
  let scheduledTimeoutMs = SCHEDULED_HEALTH_TEST_TIMEOUT_MS;

  try {
    const isLeader = await ensureLeaderLock();
    if (!isLeader) return;

    stopKeepAlive = startLeaderLockKeepAlive({
      getLock: () => schedulerState.__CCH_PROVIDER_HEALTH_TEST_LOCK__,
      clearLock: () => {
        schedulerState.__CCH_PROVIDER_HEALTH_TEST_LOCK__ = undefined;
      },
      ttlMs: LOCK_TTL_MS,
      logTag: "ProviderHealthTestScheduler",
      onLost: () => {
        leadershipLost = true;
      },
    }).stop;

    if (leadershipLost || schedulerState.__CCH_PROVIDER_HEALTH_TEST_STOP__) return;

    // Scheduled health-test policy is fixed to always-on: skip SLO rebalance
    // auto-disable and reopen peers previously closed by the old dynamic policy.
    try {
      const [{ getSystemSettings }, healthTestRepository] = await Promise.all([
        import("@/repository/system-config"),
        import("@/repository/provider-health-test"),
      ]);
      const settings = await getSystemSettings();
      dueIntervalMs = normalizeHealthTestIntervalSeconds(settings.healthTestIntervalSeconds) * 1000;
      scheduledTimeoutMs =
        normalizeHealthTestTimeoutSeconds(settings.healthTestTimeoutSeconds) * 1000;

      const reopened = await healthTestRepository.reopenSloAutoDisabledScheduledHealthTests();
      if (reopened.reopened > 0) {
        logger.info("[ProviderHealthTestScheduler] reopened SLO auto-disabled", {
          count: reopened.reopened,
          providerIds: reopened.providerIds,
        });
      }
    } catch (error) {
      logger.warn("[ProviderHealthTestScheduler] SLO rebalance failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (leadershipLost || schedulerState.__CCH_PROVIDER_HEALTH_TEST_STOP__) return;

    const result = await runDueScheduledHealthTests({
      intervalMs: dueIntervalMs,
      timeoutMs: scheduledTimeoutMs,
      onProviderFinished: () => scheduleCadenceWake(dueIntervalMs),
    });

    if (result.due > 0 || result.started > 0 || result.skippedInFlight > 0) {
      logger.info("[ProviderHealthTestScheduler] cycle dispatched", {
        ...result,
        dueIntervalMs,
        scheduledTimeoutMs,
        pollIntervalMs: INTERVAL_MS,
        mode: "per_provider_independent",
      });
    }
  } catch (error) {
    logger.warn("[ProviderHealthTestScheduler] cycle error", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    stopKeepAlive?.();
    schedulerState.__CCH_PROVIDER_HEALTH_TEST_DISPATCHING__ = false;
  }
}

export function startProviderHealthTestScheduler(): void {
  if (!ENABLED) {
    logger.info("[ProviderHealthTestScheduler] disabled by env");
    return;
  }
  if (schedulerState.__CCH_PROVIDER_HEALTH_TEST_STARTED__) return;

  schedulerState.__CCH_PROVIDER_HEALTH_TEST_STOP__ = false;
  schedulerState.__CCH_PROVIDER_HEALTH_TEST_STARTED__ = true;

  // Align first fire to the next wall-clock cron boundary (e.g. next :00/:30),
  // then keep a steady half-hour cadence so poll cycles land on cron slots.
  const delayMs = msUntilNextHealthTestBoundary(Date.now(), INTERVAL_MS);
  logger.info("[ProviderHealthTestScheduler] Started (wall-clock cron aligned)", {
    intervalMs: INTERVAL_MS,
    firstFireInMs: delayMs,
    mode: "per_provider_independent",
    lockTtlMs: LOCK_TTL_MS,
  });

  schedulerState.__CCH_PROVIDER_HEALTH_TEST_TIMEOUT_ID__ = setTimeout(() => {
    schedulerState.__CCH_PROVIDER_HEALTH_TEST_TIMEOUT_ID__ = undefined;
    if (schedulerState.__CCH_PROVIDER_HEALTH_TEST_STOP__) return;
    void runCycle();
    schedulerState.__CCH_PROVIDER_HEALTH_TEST_INTERVAL_ID__ = setInterval(() => {
      void runCycle();
    }, INTERVAL_MS);
  }, delayMs);
}

export function stopProviderHealthTestScheduler(): void {
  schedulerState.__CCH_PROVIDER_HEALTH_TEST_STOP__ = true;
  const timeoutId = schedulerState.__CCH_PROVIDER_HEALTH_TEST_TIMEOUT_ID__;
  if (timeoutId) clearTimeout(timeoutId);
  schedulerState.__CCH_PROVIDER_HEALTH_TEST_TIMEOUT_ID__ = undefined;
  const intervalId = schedulerState.__CCH_PROVIDER_HEALTH_TEST_INTERVAL_ID__;
  if (intervalId) clearInterval(intervalId);
  schedulerState.__CCH_PROVIDER_HEALTH_TEST_INTERVAL_ID__ = undefined;
  for (const timer of cadenceWakeTimers) clearTimeout(timer);
  cadenceWakeTimers.clear();
  schedulerState.__CCH_PROVIDER_HEALTH_TEST_STARTED__ = false;

  const lock = schedulerState.__CCH_PROVIDER_HEALTH_TEST_LOCK__;
  schedulerState.__CCH_PROVIDER_HEALTH_TEST_LOCK__ = undefined;
  if (lock) void releaseLeaderLock(lock);
}

export function getProviderHealthTestSchedulerStatus() {
  return {
    started: schedulerState.__CCH_PROVIDER_HEALTH_TEST_STARTED__ === true,
    dispatching: schedulerState.__CCH_PROVIDER_HEALTH_TEST_DISPATCHING__ === true,
    inFlight: getScheduledHealthTestInFlightCount(),
    enabled: ENABLED,
    intervalMs: INTERVAL_MS,
    wallClockAligned: true,
    mode: "per_provider_independent" as const,
    lockTtlMs: LOCK_TTL_MS,
  };
}
