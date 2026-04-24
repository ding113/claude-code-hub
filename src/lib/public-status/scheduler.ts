import { logger } from "@/lib/logger";
import {
  acquireLeaderLock,
  type LeaderLock,
  releaseLeaderLock,
  renewLeaderLock,
  startLeaderLockKeepAlive,
} from "@/lib/provider-endpoints/leader-lock";
import { getRedisClient } from "@/lib/redis";
import { scanPattern } from "@/lib/redis/scan-helper";
import { readCurrentInternalPublicStatusConfigSnapshot } from "./config-snapshot";
import { rebuildPublicStatusProjection } from "./rebuild-worker";
import { buildPublicStatusManifestKey } from "./redis-contract";

const LOCK_KEY = "locks:public-status-rebuild-scheduler";
const TICK_INTERVAL_MS = 30_000;
const LOCK_TTL_MS = 30_000;
const REBUILD_HINT_PATTERN = "public-status:v1:rebuild-hint:*";

const schedulerState = globalThis as unknown as {
  __CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_STARTED__?: boolean;
  __CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_INTERVAL_ID__?: ReturnType<typeof setInterval>;
  __CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_RUNNING__?: boolean;
  __CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_LOCK__?: LeaderLock;
  __CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_STOP_REQUESTED__?: boolean;
};

function parseRebuildHintKey(
  key: string
): { hintKey: string; intervalMinutes: number; rangeHours: number } | null {
  const match = key.match(/rebuild-hint:(\d+)m:(\d+)h$/);
  if (!match) {
    return null;
  }

  return {
    hintKey: key,
    intervalMinutes: Number(match[1]),
    rangeHours: Number(match[2]),
  };
}

async function ensureLeaderLock(): Promise<boolean> {
  const current = schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_LOCK__;
  if (current) {
    const ok = await renewLeaderLock(current, LOCK_TTL_MS);
    if (ok) {
      return true;
    }

    schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_LOCK__ = undefined;
    await releaseLeaderLock(current);
  }

  const acquired = await acquireLeaderLock(LOCK_KEY, LOCK_TTL_MS);
  if (!acquired) {
    return false;
  }

  schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_LOCK__ = acquired;
  return true;
}

async function collectTargets(): Promise<
  Array<{ intervalMinutes: number; rangeHours: number; hintKey?: string }>
> {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || redis.status !== "ready") {
    return [];
  }

  const targets = new Map<
    string,
    { intervalMinutes: number; rangeHours: number; hintKey?: string }
  >();
  const configSnapshot = await readCurrentInternalPublicStatusConfigSnapshot({ redis });
  if (configSnapshot && configSnapshot.groups.length > 0) {
    const manifestKey = buildPublicStatusManifestKey({
      configVersion: "current",
      intervalMinutes: configSnapshot.defaultIntervalMinutes,
      rangeHours: configSnapshot.defaultRangeHours,
    });
    const manifestRaw = await redis.get(manifestKey);
    if (!manifestRaw) {
      const key = `${configSnapshot.defaultIntervalMinutes}:${configSnapshot.defaultRangeHours}`;
      targets.set(key, {
        intervalMinutes: configSnapshot.defaultIntervalMinutes,
        rangeHours: configSnapshot.defaultRangeHours,
      });
    } else {
      let manifest: {
        freshUntil?: string;
        configVersion?: string;
      } = {};
      try {
        manifest = JSON.parse(manifestRaw) as typeof manifest;
      } catch {
        // 视为 manifest 损坏，按缺失/过期处理。
      }
      if (
        manifest.configVersion !== configSnapshot.configVersion ||
        !manifest.freshUntil ||
        Date.now() >= Date.parse(manifest.freshUntil)
      ) {
        const key = `${configSnapshot.defaultIntervalMinutes}:${configSnapshot.defaultRangeHours}`;
        targets.set(key, {
          intervalMinutes: configSnapshot.defaultIntervalMinutes,
          rangeHours: configSnapshot.defaultRangeHours,
        });
      }
    }
  }

  const hintKeys = await scanPattern(redis, REBUILD_HINT_PATTERN, 100);
  for (const hintKey of hintKeys) {
    const parsed = parseRebuildHintKey(hintKey);
    if (!parsed) {
      continue;
    }

    targets.set(`${parsed.intervalMinutes}:${parsed.rangeHours}`, {
      intervalMinutes: parsed.intervalMinutes,
      rangeHours: parsed.rangeHours,
      hintKey: parsed.hintKey,
    });
  }

  return [...targets.values()];
}

async function runCycle(): Promise<void> {
  if (schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_RUNNING__) {
    return;
  }

  if (schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_STOP_REQUESTED__) {
    return;
  }

  schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_RUNNING__ = true;
  let stopKeepAlive: (() => void) | undefined;
  let leadershipLost = false;

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
      getLock: () => schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_LOCK__,
      clearLock: () => {
        schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_LOCK__ = undefined;
      },
      ttlMs: LOCK_TTL_MS,
      logTag: "PublicStatusScheduler",
      onLost: () => {
        leadershipLost = true;
        logger.warn("[PublicStatusScheduler] Lost leader lock");
      },
    }).stop;

    const targets = await collectTargets();
    for (const target of targets) {
      if (leadershipLost) {
        break;
      }
      const result = await rebuildPublicStatusProjection({
        intervalMinutes: target.intervalMinutes,
        rangeHours: target.rangeHours,
        redis,
      });
      if (result.status === "updated" && target.hintKey) {
        await redis.del(target.hintKey);
      }
    }
  } catch (error) {
    logger.warn("[PublicStatusScheduler] Cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    stopKeepAlive?.();
    schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_RUNNING__ = false;
  }
}

export function startPublicStatusRebuildScheduler(): void {
  if (schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_STARTED__) {
    return;
  }

  schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_STOP_REQUESTED__ = false;
  schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_STARTED__ = true;
  schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_INTERVAL_ID__ = setInterval(() => {
    void runCycle();
  }, TICK_INTERVAL_MS);

  const timer = schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_INTERVAL_ID__ as
    | { unref?: () => void }
    | undefined;
  timer?.unref?.();

  void runCycle();
}

export async function stopPublicStatusRebuildScheduler(): Promise<void> {
  schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_STOP_REQUESTED__ = true;

  const intervalId = schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_INTERVAL_ID__;
  if (intervalId) {
    clearInterval(intervalId);
  }

  const currentLock = schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_LOCK__;
  if (currentLock) {
    await releaseLeaderLock(currentLock);
  }

  schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_STARTED__ = false;
  schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_INTERVAL_ID__ = undefined;
  schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_RUNNING__ = false;
  schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_LOCK__ = undefined;
}

export function getPublicStatusRebuildSchedulerStatus() {
  return {
    started: schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_STARTED__ === true,
    running: schedulerState.__CCH_PUBLIC_STATUS_REBUILD_SCHEDULER_RUNNING__ === true,
    tickIntervalMs: TICK_INTERVAL_MS,
  };
}
