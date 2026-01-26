import { logger } from "@/lib/logger";
import {
  acquireLeaderLock,
  type LeaderLock,
  releaseLeaderLock,
} from "@/lib/provider-endpoints/leader-lock";
import { deleteProviderEndpointProbeLogsBeforeDateBatch } from "@/repository";

const LOCK_KEY = "locks:endpoint-probe-log-cleanup";

function parseIntWithDefault(value: string | undefined, fallback: number): number {
  const n = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

const RETENTION_DAYS = Math.max(
  0,
  parseIntWithDefault(process.env.ENDPOINT_PROBE_LOG_RETENTION_DAYS, 1)
);
const CLEANUP_BATCH_SIZE = Math.max(
  1,
  parseIntWithDefault(process.env.ENDPOINT_PROBE_LOG_CLEANUP_BATCH_SIZE, 10_000)
);
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LOCK_TTL_MS = 5 * 60 * 1000;

const cleanupState = globalThis as unknown as {
  __CCH_ENDPOINT_PROBE_LOG_CLEANUP_STARTED__?: boolean;
  __CCH_ENDPOINT_PROBE_LOG_CLEANUP_INTERVAL_ID__?: ReturnType<typeof setInterval>;
  __CCH_ENDPOINT_PROBE_LOG_CLEANUP_LOCK__?: LeaderLock;
  __CCH_ENDPOINT_PROBE_LOG_CLEANUP_RUNNING__?: boolean;
};

async function runCleanupOnce(): Promise<void> {
  if (cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_RUNNING__) {
    return;
  }

  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_RUNNING__ = true;

  let lock: LeaderLock | null = null;

  try {
    lock = await acquireLeaderLock(LOCK_KEY, LOCK_TTL_MS);
    if (!lock) {
      return;
    }

    cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_LOCK__ = lock;

    const now = Date.now();
    const retentionMs = Math.max(0, RETENTION_DAYS) * 24 * 60 * 60 * 1000;
    const beforeDate = new Date(now - retentionMs);

    let totalDeleted = 0;
    while (true) {
      const deleted = await deleteProviderEndpointProbeLogsBeforeDateBatch({
        beforeDate,
        batchSize: CLEANUP_BATCH_SIZE,
      });

      if (deleted <= 0) {
        break;
      }

      totalDeleted += deleted;

      if (deleted < CLEANUP_BATCH_SIZE) {
        break;
      }
    }

    if (totalDeleted > 0) {
      logger.info("[EndpointProbeLogCleanup] Completed", {
        retentionDays: RETENTION_DAYS,
        totalDeleted,
      });
    }
  } catch (error) {
    logger.warn("[EndpointProbeLogCleanup] Failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_RUNNING__ = false;

    if (lock) {
      cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_LOCK__ = undefined;
      await releaseLeaderLock(lock);
    }
  }
}

export function startEndpointProbeLogCleanup(): void {
  if (process.env.CI === "true") {
    return;
  }

  if (cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_STARTED__) {
    return;
  }

  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_STARTED__ = true;

  void runCleanupOnce();

  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_INTERVAL_ID__ = setInterval(() => {
    void runCleanupOnce();
  }, CLEANUP_INTERVAL_MS);
}

export function stopEndpointProbeLogCleanup(): void {
  const intervalId = cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_INTERVAL_ID__;
  if (intervalId) {
    clearInterval(intervalId);
  }

  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_INTERVAL_ID__ = undefined;
  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_STARTED__ = false;
  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_RUNNING__ = false;

  const lock = cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_LOCK__;
  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_LOCK__ = undefined;
  if (lock) {
    void releaseLeaderLock(lock);
  }
}
