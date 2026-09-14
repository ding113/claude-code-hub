/**
 * Retention for the availability projection bookkeeping tables.
 *
 * outbox_events and proj_applied_requests receive one row per finalized request and were never
 * pruned. Published outbox rows are only needed for short-term debugging, and applied-request
 * rows only deduplicate late duplicate events, so both are deleted in bounded batches after a
 * configurable number of days.
 *
 * Deletes walk the primary key from the low end up to a boundary id (the first row that is still
 * inside the retention window), so a run that finds nothing to delete stays cheap instead of
 * scanning the whole table. This relies on ids growing with insertion time, which holds for both
 * tables because rows are only ever inserted with created_at/applied_at defaulting to now().
 * A row that violates the ordering is simply retained until a later run.
 */
import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import { withAdvisoryLock } from "@/lib/migrate";

const RETENTION_LOCK = "claude-code-hub:availability-projection-retention";
export const PROJECTION_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** First run shortly after startup so a long-lived backlog starts shrinking without a 6h wait. */
const FIRST_RUN_DELAY_MS = 60_000;
export const PROJECTION_RETENTION_BATCH_SIZE = 5_000;
const BATCH_SLEEP_MS = 100;
/** projection_meta key recording the applied-request retention cutoff (read by backfill). */
export const APPLIED_RETENTION_CUTOFF_META_KEY = "applied_retention_cutoff";

type RetentionState = {
  timeoutId?: ReturnType<typeof setTimeout>;
  running?: Promise<ProjectionRetentionResult | null>;
  stopRequested?: boolean;
};

export interface ProjectionRetentionResult {
  outboxDeleted: number;
  appliedDeleted: number;
}

const globalState = globalThis as typeof globalThis & {
  __CCH_AVAIL_PROJ_RETENTION__?: RetentionState;
};

function state(): RetentionState {
  if (!globalState.__CCH_AVAIL_PROJ_RETENTION__) {
    globalState.__CCH_AVAIL_PROJ_RETENTION__ = {};
  }
  return globalState.__CCH_AVAIL_PROJ_RETENTION__;
}

function countReturnedRows(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === "object" && Symbol.iterator in result) {
    return Array.from(result as Iterable<unknown>).length;
  }
  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });
}

async function deleteInBatches(
  table: "outbox_events" | "proj_applied_requests",
  deleteBatch: () => Promise<number>,
  batchSize: number
): Promise<number> {
  let total = 0;
  while (!state().stopRequested) {
    const deleted = await deleteBatch();
    total += deleted;
    if (deleted < batchSize) break;
    await sleep(BATCH_SLEEP_MS);
  }
  if (total > 0) {
    logger.info("[AvailProjectionRetention] deleted expired rows", { table, deleted: total });
  }
  return total;
}

async function deleteOutboxBatch(cutoffIso: string, batchSize: number): Promise<number> {
  const result = await db.execute(sql`
    WITH boundary AS (
      SELECT id FROM outbox_events
      WHERE created_at >= ${cutoffIso}::timestamptz
      ORDER BY id ASC
      LIMIT 1
    ),
    ids AS (
      SELECT id FROM outbox_events
      WHERE published_at IS NOT NULL
        AND published_at < ${cutoffIso}::timestamptz
        AND (NOT EXISTS (SELECT 1 FROM boundary) OR id < (SELECT id FROM boundary))
      ORDER BY id ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM outbox_events
    WHERE id IN (SELECT id FROM ids)
    RETURNING 1
  `);
  return countReturnedRows(result);
}

async function deleteAppliedBatch(cutoffIso: string, batchSize: number): Promise<number> {
  const result = await db.execute(sql`
    WITH boundary AS (
      SELECT request_id FROM proj_applied_requests
      WHERE applied_at >= ${cutoffIso}::timestamptz
      ORDER BY request_id ASC
      LIMIT 1
    ),
    ids AS (
      SELECT request_id FROM proj_applied_requests
      WHERE applied_at < ${cutoffIso}::timestamptz
        AND (
          NOT EXISTS (SELECT 1 FROM boundary)
          OR request_id < (SELECT request_id FROM boundary)
        )
      ORDER BY request_id ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM proj_applied_requests
    WHERE request_id IN (SELECT request_id FROM ids)
    RETURNING 1
  `);
  return countReturnedRows(result);
}

async function recordAppliedRetentionCutoff(cutoffIso: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO projection_meta (key, value, updated_at)
    VALUES (
      ${APPLIED_RETENTION_CUTOFF_META_KEY},
      jsonb_build_object('cutoff', ${cutoffIso}::text),
      now()
    )
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
}

/**
 * Delete expired projection bookkeeping rows once. Returns null when another instance holds the
 * retention lock.
 */
export async function runProjectionRetention(
  now: Date = new Date()
): Promise<ProjectionRetentionResult | null> {
  const env = getEnvConfig();
  const dayMs = 24 * 60 * 60 * 1000;
  const outboxCutoffIso = new Date(
    now.getTime() - env.PROJECTION_OUTBOX_RETENTION_DAYS * dayMs
  ).toISOString();
  const appliedCutoffIso = new Date(
    now.getTime() - env.PROJECTION_APPLIED_RETENTION_DAYS * dayMs
  ).toISOString();
  const batchSize = PROJECTION_RETENTION_BATCH_SIZE;

  const lockResult = await withAdvisoryLock(
    RETENTION_LOCK,
    async (): Promise<ProjectionRetentionResult> => {
      const outboxDeleted = await deleteInBatches(
        "outbox_events",
        () => deleteOutboxBatch(outboxCutoffIso, batchSize),
        batchSize
      );
      // Record the cutoff before deleting so a later backfill never re-enqueues requests whose
      // dedupe rows may already be gone.
      await recordAppliedRetentionCutoff(appliedCutoffIso);
      const appliedDeleted = await deleteInBatches(
        "proj_applied_requests",
        () => deleteAppliedBatch(appliedCutoffIso, batchSize),
        batchSize
      );
      return { outboxDeleted, appliedDeleted };
    },
    { skipIfLocked: true }
  );

  return lockResult.ran ? (lockResult.result ?? null) : null;
}

function scheduleNext(delayMs: number): void {
  const s = state();
  if (s.stopRequested) return;
  s.timeoutId = setTimeout(() => {
    s.timeoutId = undefined;
    s.running = runProjectionRetention()
      .catch((error: unknown) => {
        logger.warn("[AvailProjectionRetention] run failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      })
      .finally(() => {
        s.running = undefined;
        scheduleNext(PROJECTION_RETENTION_INTERVAL_MS);
      });
  }, delayMs);
  (s.timeoutId as { unref?: () => void }).unref?.();
}

export function startProjectionRetentionScheduler(): void {
  const s = state();
  if (s.timeoutId || s.running) return;
  s.stopRequested = false;
  scheduleNext(FIRST_RUN_DELAY_MS);
}

export async function stopProjectionRetentionScheduler(): Promise<void> {
  const s = state();
  s.stopRequested = true;
  if (s.timeoutId) {
    clearTimeout(s.timeoutId);
    s.timeoutId = undefined;
  }
  await s.running;
}

export const __test__ = {
  FIRST_RUN_DELAY_MS,
  resetState: () => {
    delete globalState.__CCH_AVAIL_PROJ_RETENTION__;
  },
};
