/**
 * In-process outbox consumer for availability projection buckets.
 * DB trigger on message_request writes outbox_events; this loop increments avail_bucket_1m.
 */
import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { CURRENT_PROVIDER_STATUS_WINDOW_MINUTES } from "@/lib/availability/availability-service";
import { logger } from "@/lib/logger";
import { withAdvisoryLock } from "@/lib/migrate";

const BATCH = 300;
const BUSY_MS = 10;
const TICK_MS = 200;
const BACKFILL_LOCK = "claude-code-hub:availability-projection-backfill";
/** Match MAX_AVAILABILITY_QUERY_RANGE_DAYS so historical ranges are not silently empty after upgrade. */
const BACKFILL_RANGE_DAYS = 100;
const BACKFILL_CHUNK_HOURS = 6;

type SchedulerState = {
  started?: boolean;
  stopRequested?: boolean;
  intervalId?: ReturnType<typeof setInterval>;
  currentPromise?: Promise<void>;
  bootstrapPromise?: Promise<void>;
};

const schedulerState = globalThis as typeof globalThis & {
  __CCH_AVAIL_PROJ_WORKER__?: SchedulerState;
};

function state(): SchedulerState {
  if (!schedulerState.__CCH_AVAIL_PROJ_WORKER__) {
    schedulerState.__CCH_AVAIL_PROJ_WORKER__ = {};
  }
  return schedulerState.__CCH_AVAIL_PROJ_WORKER__;
}

type ClaimedEvent = {
  id: number;
  event_id: string;
  payload: {
    request_id?: number | string;
    provider_id?: number | string;
    outcome?: string;
    occurred_at?: string;
    duration_ms?: number | string | null;
  };
};

export function asPayload(raw: unknown): ClaimedEvent["payload"] {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ClaimedEvent["payload"];
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") {
    return raw as ClaimedEvent["payload"];
  }
  return {};
}

async function enqueueBackfillChunk(fromIso: string, toIso: string): Promise<number> {
  const result = await db.execute(sql`
    WITH inserted AS (
      INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, occurred_at, payload)
      SELECT
        'request_finalized',
        'message_request',
        mr.id,
        mr.created_at,
        jsonb_build_object(
          'request_id', mr.id,
          'provider_id', mr.provider_id,
          'model', mr.model,
          'occurred_at', mr.created_at,
          'status_code', mr.status_code,
          'duration_ms', mr.duration_ms,
          'ttfb_ms', mr.ttfb_ms,
          'blocked_by', mr.blocked_by,
          'outcome', fn_compute_message_request_success_rate_outcome(
            mr.blocked_by, mr.status_code, mr.error_message, mr.provider_chain
          ),
          'group_tag', p.group_tag,
          'is_replay', COALESCE(mr.is_replay, false)
        )
      FROM message_request mr
      LEFT JOIN providers p ON p.id = mr.provider_id
      WHERE mr.status_code IS NOT NULL
        AND mr.created_at >= ${fromIso}::timestamptz
        AND mr.created_at < ${toIso}::timestamptz
        AND COALESCE(mr.is_replay, false) = false
        AND NOT EXISTS (SELECT 1 FROM proj_applied_requests a WHERE a.request_id = mr.id)
        AND fn_compute_message_request_success_rate_outcome(
              mr.blocked_by, mr.status_code, mr.error_message, mr.provider_chain
            ) IS NOT NULL
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM inserted
  `);
  const row = Array.from(result as Iterable<{ n?: number }>)[0];
  return Number(row?.n ?? 0);
}

async function bootstrapBackfill(): Promise<void> {
  const existing = await db.execute(sql`
    SELECT key FROM projection_meta WHERE key = 'backfill_done' LIMIT 1
  `);
  if (Array.from(existing as Iterable<unknown>).length > 0) {
    return;
  }

  const lockResult = await withAdvisoryLock(
    BACKFILL_LOCK,
    async () => {
      // Re-check under lock so concurrent instances do not double-enqueue.
      const again = await db.execute(sql`
        SELECT key FROM projection_meta WHERE key = 'backfill_done' LIMIT 1
      `);
      if (Array.from(again as Iterable<unknown>).length > 0) {
        return { skipped: true as const, inserted: 0 };
      }

      logger.info("[AvailProjection] starting backfill into outbox", {
        rangeDays: BACKFILL_RANGE_DAYS,
        chunkHours: BACKFILL_CHUNK_HOURS,
      });

      const endMs = Date.now();
      const startMs = endMs - BACKFILL_RANGE_DAYS * 24 * 60 * 60 * 1000;
      const chunkMs = BACKFILL_CHUNK_HOURS * 60 * 60 * 1000;
      let inserted = 0;

      for (let cursor = startMs; cursor < endMs; cursor += chunkMs) {
        if (state().stopRequested) {
          logger.warn("[AvailProjection] backfill interrupted by stop");
          break;
        }
        const fromIso = new Date(cursor).toISOString();
        const toIso = new Date(Math.min(cursor + chunkMs, endMs)).toISOString();
        inserted += await enqueueBackfillChunk(fromIso, toIso);
      }

      if (!state().stopRequested) {
        await db.execute(sql`
          INSERT INTO projection_meta (key, value, updated_at)
          VALUES (
            'backfill_done',
            jsonb_build_object(
              'at', now(),
              'note', 'availability backfill',
              'rangeDays', ${BACKFILL_RANGE_DAYS},
              'inserted', ${inserted}
            ),
            now()
          )
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        `);
        logger.info("[AvailProjection] backfill enqueue finished", { inserted });
      }

      return { skipped: false as const, inserted };
    },
    { skipIfLocked: true }
  );

  if (!lockResult.ran) {
    logger.info("[AvailProjection] backfill skipped; another instance holds the lock");
  }
}

async function recomputeAvailCurrent(tx: typeof db, providerIds: number[]): Promise<void> {
  if (providerIds.length === 0) return;

  // Stable ascending lock order across concurrent worker instances (avoids deadlocks).
  const sortedProviderIds = [...new Set(providerIds)].sort((a, b) => a - b);
  const providerIdList = sql.join(
    sortedProviderIds.map((id) => sql`${id}`),
    sql`, `
  );

  await tx.execute(sql`
    INSERT INTO avail_current AS c (
      provider_id, state, availability, request_count, last_request_at, updated_at
    )
    SELECT
      s.provider_id,
      s.state,
      s.availability,
      s.request_count,
      s.last_request_at,
      s.updated_at
    FROM (
      SELECT
        b.provider_id,
        CASE
          WHEN COALESCE(SUM(b.success_cnt), 0) + COALESCE(SUM(b.failure_cnt), 0) <= 0 THEN 'unknown'
          WHEN (COALESCE(SUM(b.success_cnt), 0)::float
            / (COALESCE(SUM(b.success_cnt), 0) + COALESCE(SUM(b.failure_cnt), 0))) >= 0.8 THEN 'green'
          WHEN (COALESCE(SUM(b.success_cnt), 0)::float
            / (COALESCE(SUM(b.success_cnt), 0) + COALESCE(SUM(b.failure_cnt), 0))) >= 0.5 THEN 'yellow'
          ELSE 'red'
        END AS state,
        CASE
          WHEN COALESCE(SUM(b.success_cnt), 0) + COALESCE(SUM(b.failure_cnt), 0) <= 0 THEN 0
          ELSE COALESCE(SUM(b.success_cnt), 0)::float
            / (COALESCE(SUM(b.success_cnt), 0) + COALESCE(SUM(b.failure_cnt), 0))
        END AS availability,
        (COALESCE(SUM(b.success_cnt), 0) + COALESCE(SUM(b.failure_cnt), 0))::int AS request_count,
        MAX(b.last_request_at) AS last_request_at,
        now() AS updated_at
      FROM avail_bucket_1m b
      WHERE b.provider_id IN (${providerIdList})
        AND b.bucket_start >= now() - (${sql.raw(String(CURRENT_PROVIDER_STATUS_WINDOW_MINUTES))} * INTERVAL '1 minute')
      GROUP BY b.provider_id
      ORDER BY b.provider_id ASC
    ) s
    ON CONFLICT (provider_id) DO UPDATE SET
      state = EXCLUDED.state,
      availability = EXCLUDED.availability,
      request_count = EXCLUDED.request_count,
      last_request_at = EXCLUDED.last_request_at,
      updated_at = now()
  `);

  // Providers with no traffic in the window become unknown (honest empty state).
  // Lock target rows in provider_id order before updating.
  await tx.execute(sql`
    WITH targets AS (
      SELECT c.provider_id
      FROM avail_current c
      WHERE c.provider_id IN (${providerIdList})
        AND NOT EXISTS (
          SELECT 1
          FROM avail_bucket_1m b
          WHERE b.provider_id = c.provider_id
            AND b.bucket_start >= now() - (${sql.raw(String(CURRENT_PROVIDER_STATUS_WINDOW_MINUTES))} * INTERVAL '1 minute')
            AND (b.success_cnt + b.failure_cnt) > 0
        )
      ORDER BY c.provider_id ASC
      FOR UPDATE OF c
    )
    UPDATE avail_current c
    SET
      state = 'unknown',
      availability = 0,
      request_count = 0,
      updated_at = now()
    FROM targets t
    WHERE c.provider_id = t.provider_id
  `);
}

export async function processBatch(): Promise<number> {
  return await db.transaction(async (tx) => {
    const claimedRows = await tx.execute(sql`
      SELECT id, event_id, payload
      FROM outbox_events
      WHERE published_at IS NULL
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH}
    `);

    const claimed = Array.from(claimedRows as Iterable<ClaimedEvent>);
    if (claimed.length === 0) {
      return 0;
    }

    let applied = 0;
    const touchedProviders = new Set<number>();
    const publishedIds: number[] = [];
    const invalidIds: number[] = [];

    // Bucket deltas aggregated in JS, then one upsert per distinct (provider, minute).
    type BucketKey = string;
    const bucketDeltas = new Map<
      BucketKey,
      {
        providerId: number;
        bucketStartIso: string;
        successCnt: number;
        failureCnt: number;
        excludedCnt: number;
        latencyCnt: number;
        latencySum: number;
        lastRequestAtIso: string;
      }
    >();

    for (const row of claimed) {
      const payload = asPayload(row.payload);
      const requestId = Number(payload.request_id);
      const providerId = Number(payload.provider_id);
      const outcome = String(payload.outcome || "excluded");
      const occurredAt = payload.occurred_at;
      if (!Number.isFinite(requestId) || !Number.isFinite(providerId) || !occurredAt) {
        invalidIds.push(row.id);
        continue;
      }

      const inserted = await tx.execute(sql`
        INSERT INTO proj_applied_requests (request_id, event_id)
        VALUES (${requestId}, ${row.event_id}::uuid)
        ON CONFLICT (request_id) DO NOTHING
        RETURNING request_id
      `);
      const isFresh = Array.from(inserted as Iterable<unknown>).length > 0;

      if (isFresh) {
        const durationMs =
          payload.duration_ms === null || payload.duration_ms === undefined
            ? null
            : Number(payload.duration_ms);
        const successCnt = outcome === "success" ? 1 : 0;
        const failureCnt = outcome === "failure" ? 1 : 0;
        const excludedCnt = outcome === "excluded" ? 1 : 0;
        const latencyCnt =
          (outcome === "success" || outcome === "failure") &&
          durationMs !== null &&
          Number.isFinite(durationMs)
            ? 1
            : 0;
        const latencySum =
          latencyCnt === 1 && durationMs !== null && Number.isFinite(durationMs)
            ? Math.trunc(durationMs)
            : 0;

        const occurred = new Date(occurredAt);
        const bucketStart = new Date(
          Date.UTC(
            occurred.getUTCFullYear(),
            occurred.getUTCMonth(),
            occurred.getUTCDate(),
            occurred.getUTCHours(),
            occurred.getUTCMinutes(),
            0,
            0
          )
        );
        const bucketStartIso = bucketStart.toISOString();
        const key = `${providerId}|${bucketStartIso}`;
        const prev = bucketDeltas.get(key);
        if (prev) {
          prev.successCnt += successCnt;
          prev.failureCnt += failureCnt;
          prev.excludedCnt += excludedCnt;
          prev.latencyCnt += latencyCnt;
          prev.latencySum += latencySum;
          if (occurredAt > prev.lastRequestAtIso) {
            prev.lastRequestAtIso = occurredAt;
          }
        } else {
          bucketDeltas.set(key, {
            providerId,
            bucketStartIso,
            successCnt,
            failureCnt,
            excludedCnt,
            latencyCnt,
            latencySum,
            lastRequestAtIso: occurredAt,
          });
        }
        touchedProviders.add(providerId);
        applied += 1;
      }

      publishedIds.push(row.id);
    }

    // Upsert buckets in (provider_id, bucket_start) order so concurrent workers take locks consistently.
    const sortedDeltas = Array.from(bucketDeltas.values()).sort((a, b) => {
      if (a.providerId !== b.providerId) return a.providerId - b.providerId;
      return a.bucketStartIso < b.bucketStartIso ? -1 : a.bucketStartIso > b.bucketStartIso ? 1 : 0;
    });
    for (const delta of sortedDeltas) {
      await tx.execute(sql`
        INSERT INTO avail_bucket_1m AS b (
          provider_id,
          bucket_start,
          success_cnt,
          failure_cnt,
          excluded_cnt,
          latency_cnt,
          latency_sum_ms,
          last_request_at
        ) VALUES (
          ${delta.providerId},
          ${delta.bucketStartIso}::timestamptz,
          ${delta.successCnt},
          ${delta.failureCnt},
          ${delta.excludedCnt},
          ${delta.latencyCnt},
          ${delta.latencySum},
          ${delta.lastRequestAtIso}::timestamptz
        )
        ON CONFLICT (provider_id, bucket_start) DO UPDATE SET
          success_cnt = b.success_cnt + EXCLUDED.success_cnt,
          failure_cnt = b.failure_cnt + EXCLUDED.failure_cnt,
          excluded_cnt = b.excluded_cnt + EXCLUDED.excluded_cnt,
          latency_cnt = b.latency_cnt + EXCLUDED.latency_cnt,
          latency_sum_ms = b.latency_sum_ms + EXCLUDED.latency_sum_ms,
          last_request_at = GREATEST(
            COALESCE(b.last_request_at, EXCLUDED.last_request_at),
            EXCLUDED.last_request_at
          )
      `);
    }

    if (publishedIds.length > 0) {
      const sortedPublishedIds = [...publishedIds].sort((a, b) => a - b);
      await tx.execute(sql`
        UPDATE outbox_events
        SET published_at = now(),
            attempts = attempts + 1,
            last_error = NULL
        WHERE id IN (${sql.join(
          sortedPublishedIds.map((id) => sql`${id}`),
          sql`, `
        )})
      `);
    }

    if (invalidIds.length > 0) {
      const sortedInvalidIds = [...invalidIds].sort((a, b) => a - b);
      await tx.execute(sql`
        UPDATE outbox_events
        SET published_at = now(),
            attempts = attempts + 1,
            last_error = 'invalid payload'
        WHERE id IN (${sql.join(
          sortedInvalidIds.map((id) => sql`${id}`),
          sql`, `
        )})
      `);
    }

    await recomputeAvailCurrent(tx as unknown as typeof db, Array.from(touchedProviders));

    return applied;
  });
}

async function runCycle(): Promise<void> {
  const s = state();
  if (s.stopRequested) return;
  if (s.currentPromise) return;

  let current!: Promise<void>;
  current = (async () => {
    try {
      let total = 0;
      for (let i = 0; i < 20; i++) {
        if (s.stopRequested) break;
        const n = await processBatch();
        total += n;
        if (n === 0) break;
        if (n < BATCH) break;
        await new Promise((r) => setTimeout(r, BUSY_MS));
      }
      if (total > 0) {
        logger.info("[AvailProjection] projected events", { count: total });
      }
    } catch (error) {
      logger.warn("[AvailProjection] cycle failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (s.currentPromise === current) {
        s.currentPromise = undefined;
      }
    }
  })();

  s.currentPromise = current;
  await current;
}

export function startAvailabilityProjectionWorker(): void {
  const s = state();
  if (s.started) return;

  s.stopRequested = false;
  s.started = true;

  s.bootstrapPromise = (async () => {
    try {
      await bootstrapBackfill();
    } catch (error) {
      logger.warn("[AvailProjection] backfill failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    void runCycle();
  })();

  s.intervalId = setInterval(() => {
    void runCycle();
  }, TICK_MS);
  (s.intervalId as { unref?: () => void } | undefined)?.unref?.();

  logger.info("[AvailProjection] worker started");
}

export async function stopAvailabilityProjectionWorker(): Promise<void> {
  const s = state();
  s.stopRequested = true;
  if (s.intervalId) {
    clearInterval(s.intervalId);
    s.intervalId = undefined;
  }
  await s.bootstrapPromise;
  await s.currentPromise;
  s.started = false;
  s.bootstrapPromise = undefined;
  logger.info("[AvailProjection] worker stopped");
}

export function getAvailabilityProjectionWorkerStatus() {
  const s = state();
  return {
    started: s.started === true,
    running: Boolean(s.currentPromise),
    bootstrapping: Boolean(s.bootstrapPromise),
    tickMs: TICK_MS,
  };
}

/** Test-only helpers */
export const __test__ = {
  bootstrapBackfill,
  recomputeAvailCurrent,
  BACKFILL_RANGE_DAYS,
  BATCH,
};
