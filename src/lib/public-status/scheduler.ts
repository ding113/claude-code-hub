import { logger } from "@/lib/logger";
import {
  acquireLeaderLock,
  type LeaderLock,
  releaseLeaderLock,
  renewLeaderLock,
  startLeaderLockKeepAlive,
} from "@/lib/provider-endpoints/leader-lock";
import {
  collectEnabledPublicStatusGroups,
  parsePublicStatusDescription,
} from "@/lib/public-status/config";
import { refreshPublicStatusSnapshot } from "@/lib/public-status/service";
import { getRedisClient } from "@/lib/redis";
import { findAllProviderGroups } from "@/repository/provider-groups";
import { clearPublicStatusSnapshot } from "@/repository/public-status-snapshot";

const LOCK_KEY = "locks:public-status-scheduler";
const TICK_INTERVAL_MS = 30_000;
const LOCK_TTL_MS = 30_000;

const schedulerState = globalThis as unknown as {
  __CCH_PUBLIC_STATUS_SCHEDULER_STARTED__?: boolean;
  __CCH_PUBLIC_STATUS_SCHEDULER_INTERVAL_ID__?: ReturnType<typeof setInterval>;
  __CCH_PUBLIC_STATUS_SCHEDULER_RUNNING__?: boolean;
  __CCH_PUBLIC_STATUS_SCHEDULER_LOCK__?: LeaderLock;
  __CCH_PUBLIC_STATUS_SCHEDULER_STOP_REQUESTED__?: boolean;
};

async function ensureLeaderLock(): Promise<boolean> {
  const current = schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_LOCK__;
  if (current) {
    const ok = await renewLeaderLock(current, LOCK_TTL_MS);
    if (ok) {
      return true;
    }

    schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_LOCK__ = undefined;
    await releaseLeaderLock(current);
  }

  const acquired = await acquireLeaderLock(LOCK_KEY, LOCK_TTL_MS);
  if (!acquired) {
    return false;
  }

  schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_LOCK__ = acquired;
  return true;
}

async function runCycle(): Promise<void> {
  if (schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_RUNNING__) {
    return;
  }

  if (schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_STOP_REQUESTED__) {
    return;
  }

  schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_RUNNING__ = true;
  let stopKeepAlive: (() => void) | undefined;

  try {
    const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
    if (!redis || redis.status !== "ready") {
      logger.warn("[PublicStatusScheduler] Redis not ready, skipping cycle");
      return;
    }

    const isLeader = await ensureLeaderLock();
    if (!isLeader) {
      return;
    }

    stopKeepAlive = startLeaderLockKeepAlive({
      getLock: () => schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_LOCK__,
      clearLock: () => {
        schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_LOCK__ = undefined;
      },
      ttlMs: LOCK_TTL_MS,
      logTag: "PublicStatusScheduler",
      onLost: () => {
        logger.warn("[PublicStatusScheduler] Lost leader lock");
      },
    }).stop;

    const result = await refreshPublicStatusSnapshot();
    logger.info("[PublicStatusScheduler] Cycle finished", result);

    if (result.status === "disabled") {
      logger.info("[PublicStatusScheduler] No configured targets, stopping local scheduler");
      await stopPublicStatusScheduler();
    }
  } catch (error) {
    logger.warn("[PublicStatusScheduler] Cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    stopKeepAlive?.();
    schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_RUNNING__ = false;
  }
}

export function startPublicStatusScheduler(): void {
  if (schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_STARTED__) {
    return;
  }

  schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_STARTED__ = true;
  schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_STOP_REQUESTED__ = false;

  logger.info("[PublicStatusScheduler] Starting", {
    tickIntervalMs: TICK_INTERVAL_MS,
  });

  void runCycle();

  schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_INTERVAL_ID__ = setInterval(() => {
    void runCycle();
  }, TICK_INTERVAL_MS);

  const timer = schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_INTERVAL_ID__ as unknown as {
    unref?: () => void;
  };
  timer.unref?.();
}

export async function initializePublicStatusScheduler(): Promise<void> {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || redis.status !== "ready") {
    await stopPublicStatusScheduler();
    return;
  }

  const groups = await findAllProviderGroups();
  const enabledGroups = collectEnabledPublicStatusGroups(
    groups.map((group) => ({
      groupName: group.name,
      ...parsePublicStatusDescription(group.description),
    }))
  );

  if (enabledGroups.length === 0) {
    await clearPublicStatusSnapshot();
    await stopPublicStatusScheduler();
    return;
  }

  startPublicStatusScheduler();
}

export async function stopPublicStatusScheduler(): Promise<void> {
  schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_STOP_REQUESTED__ = true;

  const intervalId = schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_INTERVAL_ID__;
  if (intervalId) {
    clearInterval(intervalId);
  }

  const currentLock = schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_LOCK__;
  if (currentLock) {
    await releaseLeaderLock(currentLock);
  }

  schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_STARTED__ = false;
  schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_INTERVAL_ID__ = undefined;
  schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_RUNNING__ = false;
  schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_LOCK__ = undefined;
}

export function getPublicStatusSchedulerStatus() {
  return {
    started: schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_STARTED__ === true,
    running: schedulerState.__CCH_PUBLIC_STATUS_SCHEDULER_RUNNING__ === true,
    tickIntervalMs: TICK_INTERVAL_MS,
  };
}
