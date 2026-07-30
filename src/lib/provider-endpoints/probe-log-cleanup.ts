import { logger } from "@/lib/logger";
import { withAdvisoryLock } from "@/lib/migrate";
import { deleteProviderEndpointProbeLogsBeforeDateBatch } from "@/repository";

const LOCK_KEY = "claude-code-hub:endpoint-probe-log-cleanup";

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

const cleanupState = globalThis as unknown as {
  __CCH_ENDPOINT_PROBE_LOG_CLEANUP_STARTED__?: boolean;
  __CCH_ENDPOINT_PROBE_LOG_CLEANUP_INTERVAL_ID__?: ReturnType<typeof setInterval>;
  __CCH_ENDPOINT_PROBE_LOG_CLEANUP_RUNNING__?: boolean;
  __CCH_ENDPOINT_PROBE_LOG_CLEANUP_CURRENT_PROMISE__?: Promise<void>;
  __CCH_ENDPOINT_PROBE_LOG_CLEANUP_STOP_REQUESTED__?: boolean;
};

async function runCleanupOnce(): Promise<void> {
  if (cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_RUNNING__) {
    return;
  }
  if (cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_STOP_REQUESTED__) return;

  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_RUNNING__ = true;

  try {
    const locked = await withAdvisoryLock(
      LOCK_KEY,
      async () => {
        const now = Date.now();
        const retentionMs = Math.max(0, RETENTION_DAYS) * 24 * 60 * 60 * 1000;
        const beforeDate = new Date(now - retentionMs);

        let totalDeleted = 0;
        while (!cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_STOP_REQUESTED__) {
          const deleted = await deleteProviderEndpointProbeLogsBeforeDateBatch({
            beforeDate,
            batchSize: CLEANUP_BATCH_SIZE,
          });
          if (deleted <= 0) break;
          totalDeleted += deleted;
          if (deleted < CLEANUP_BATCH_SIZE) break;
        }
        return totalDeleted;
      },
      { skipIfLocked: true }
    );

    if (locked.ran && (locked.result ?? 0) > 0) {
      logger.info("[EndpointProbeLogCleanup] Completed", {
        retentionDays: RETENTION_DAYS,
        totalDeleted: locked.result,
      });
    }
  } catch (error) {
    logger.warn("[EndpointProbeLogCleanup] Failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_RUNNING__ = false;
  }
}

function launchCleanup(): void {
  if (cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_CURRENT_PROMISE__) return;
  const current = runCleanupOnce().finally(() => {
    if (cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_CURRENT_PROMISE__ === current) {
      cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_CURRENT_PROMISE__ = undefined;
    }
  });
  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_CURRENT_PROMISE__ = current;
}

export function startEndpointProbeLogCleanup(): void {
  if (process.env.CI === "true") {
    return;
  }

  if (cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_STARTED__) {
    return;
  }

  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_STARTED__ = true;
  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_STOP_REQUESTED__ = false;

  launchCleanup();

  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_INTERVAL_ID__ = setInterval(() => {
    launchCleanup();
  }, CLEANUP_INTERVAL_MS);
}

export async function stopEndpointProbeLogCleanup(): Promise<void> {
  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_STOP_REQUESTED__ = true;
  const intervalId = cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_INTERVAL_ID__;
  if (intervalId) {
    clearInterval(intervalId);
  }

  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_INTERVAL_ID__ = undefined;
  cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_STARTED__ = false;

  await cleanupState.__CCH_ENDPOINT_PROBE_LOG_CLEANUP_CURRENT_PROMISE__;
}
