/**
 * In-process outbox consumer for availability projection buckets.
 * DB trigger on message_request writes outbox_events; this loop increments avail_bucket_1m.
 */
import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { logger } from "@/lib/logger";

const BATCH = 300;
const BUSY_MS = 10;
const TICK_MS = 200;

type SchedulerState = {
  started?: boolean;
  stopRequested?: boolean;
  intervalId?: ReturnType<typeof setInterval>;
  currentPromise?: Promise<void>;
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

async function bootstrapBackfill(): Promise<void> {
  const existing = await db.execute(sql`
    SELECT key FROM projection_meta WHERE key = 'backfill_done' LIMIT 1
  `);
  if (Array.from(existing as Iterable<unknown>).length > 0) {
    return;
  }

  logger.info("[AvailProjection] starting backfill (last 48h) into outbox");
  await db.execute(sql`
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
      AND mr.created_at >= now() - interval '48 hours'
      AND COALESCE(mr.is_replay, false) = false
      AND NOT EXISTS (SELECT 1 FROM proj_applied_requests a WHERE a.request_id = mr.id)
      AND fn_compute_message_request_success_rate_outcome(
            mr.blocked_by, mr.status_code, mr.error_message, mr.provider_chain
          ) IS NOT NULL
  `);

  await db.execute(sql`
    INSERT INTO projection_meta (key, value, updated_at)
    VALUES (
      'backfill_done',
      jsonb_build_object('at', now(), 'note', 'availability backfill'),
      now()
    )
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);

  logger.info("[AvailProjection] backfill enqueue finished");
}

function asPayload(raw: unknown): ClaimedEvent["payload"] {
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

async function processBatch(): Promise<number> {
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

    for (const row of claimed) {
      const payload = asPayload(row.payload);
      const requestId = Number(payload.request_id);
      const providerId = Number(payload.provider_id);
      const outcome = String(payload.outcome || "excluded");
      const occurredAt = payload.occurred_at;
      if (!Number.isFinite(requestId) || !Number.isFinite(providerId) || !occurredAt) {
        await tx.execute(sql`
          UPDATE outbox_events
          SET published_at = now(),
              attempts = attempts + 1,
              last_error = 'invalid payload'
          WHERE id = ${row.id}
        `);
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
            ${providerId},
            date_trunc('minute', ${occurredAt}::timestamptz),
            ${successCnt},
            ${failureCnt},
            ${excludedCnt},
            ${latencyCnt},
            ${latencySum},
            ${occurredAt}::timestamptz
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
        touchedProviders.add(providerId);
        applied += 1;
      }

      await tx.execute(sql`
        UPDATE outbox_events
        SET published_at = now(),
            attempts = attempts + 1,
            last_error = NULL
        WHERE id = ${row.id}
      `);
    }

    for (const providerId of touchedProviders) {
      await tx.execute(sql`
        INSERT INTO avail_current AS c (
          provider_id, state, availability, request_count, last_request_at, updated_at
        )
        SELECT
          ${providerId},
          CASE
            WHEN COALESCE(SUM(b.success_cnt), 0) + COALESCE(SUM(b.failure_cnt), 0) <= 0 THEN 'unknown'
            WHEN (COALESCE(SUM(b.success_cnt), 0)::float
              / (COALESCE(SUM(b.success_cnt), 0) + COALESCE(SUM(b.failure_cnt), 0))) >= 0.8 THEN 'green'
            WHEN (COALESCE(SUM(b.success_cnt), 0)::float
              / (COALESCE(SUM(b.success_cnt), 0) + COALESCE(SUM(b.failure_cnt), 0))) >= 0.5 THEN 'yellow'
            ELSE 'red'
          END,
          CASE
            WHEN COALESCE(SUM(b.success_cnt), 0) + COALESCE(SUM(b.failure_cnt), 0) <= 0 THEN 0
            ELSE COALESCE(SUM(b.success_cnt), 0)::float
              / (COALESCE(SUM(b.success_cnt), 0) + COALESCE(SUM(b.failure_cnt), 0))
          END,
          (COALESCE(SUM(b.success_cnt), 0) + COALESCE(SUM(b.failure_cnt), 0))::int,
          MAX(b.last_request_at),
          now()
        FROM avail_bucket_1m b
        WHERE b.provider_id = ${providerId}
          AND b.bucket_start >= now() - interval '5 minutes'
        ON CONFLICT (provider_id) DO UPDATE SET
          state = EXCLUDED.state,
          availability = EXCLUDED.availability,
          request_count = EXCLUDED.request_count,
          last_request_at = EXCLUDED.last_request_at,
          updated_at = now()
      `);
    }

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

  void (async () => {
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
  await s.currentPromise;
  s.started = false;
  logger.info("[AvailProjection] worker stopped");
}

export function getAvailabilityProjectionWorkerStatus() {
  const s = state();
  return {
    started: s.started === true,
    running: Boolean(s.currentPromise),
    tickMs: TICK_MS,
  };
}
