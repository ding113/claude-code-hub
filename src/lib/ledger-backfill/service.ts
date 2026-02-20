import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { logger } from "@/lib/logger";

export interface BackfillUsageLedgerSummary {
  totalProcessed: number;
  totalInserted: number;
  durationMs: number;
  alreadyExisted: number;
}

export async function backfillUsageLedger(): Promise<BackfillUsageLedgerSummary> {
  const startTime = Date.now();
  const LOCK_KEY = 20260101;

  // Use pg_try_advisory_xact_lock (transaction-scoped) so lock/unlock always happen
  // on the same connection — safe with connection pools.
  return await db.transaction(async (tx) => {
    const lockResult = await tx.execute(sql`
      SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS acquired
    `);

    const acquired = (lockResult as unknown as Array<{ acquired: boolean }>)[0]?.acquired;
    if (!acquired) {
      return {
        totalProcessed: 0,
        totalInserted: 0,
        durationMs: Date.now() - startTime,
        alreadyExisted: 0,
      };
    }

    try {
      let totalProcessed = 0;
      let totalInserted = 0;
      let lastId = 0;

      while (true) {
        const batchResult = await tx.execute(sql`
        WITH batch AS (
          SELECT
            mr.id,
            mr.user_id,
            mr.key,
            mr.provider_id,
            COALESCE(
              CASE
                WHEN mr.provider_chain IS NOT NULL
                  AND jsonb_typeof(mr.provider_chain) = 'array'
                  AND jsonb_array_length(mr.provider_chain) > 0
                  AND jsonb_typeof(mr.provider_chain -> -1) = 'object'
                  AND (mr.provider_chain -> -1 ? 'id')
                  AND (mr.provider_chain -> -1 ->> 'id') ~ '^[0-9]+$'
                THEN (mr.provider_chain -> -1 ->> 'id')::integer
              END,
              mr.provider_id
            ) AS final_provider_id,
            mr.model,
            mr.original_model,
            mr.endpoint,
            mr.api_type,
            mr.session_id,
            mr.status_code,
            (mr.error_message IS NULL OR mr.error_message = '') AS is_success,
            mr.blocked_by,
            mr.cost_usd,
            mr.cost_multiplier,
            mr.input_tokens,
            mr.output_tokens,
            mr.cache_creation_input_tokens,
            mr.cache_read_input_tokens,
            mr.cache_creation_5m_input_tokens,
            mr.cache_creation_1h_input_tokens,
            mr.cache_ttl_applied,
            mr.context_1m_applied,
            mr.swap_cache_ttl_applied,
            mr.duration_ms,
            mr.ttfb_ms,
            mr.created_at
          FROM message_request mr
          WHERE mr.id > ${lastId}
            AND mr.blocked_by IS DISTINCT FROM 'warmup'
          ORDER BY mr.id ASC
          LIMIT 10000
        ),
        inserted_rows AS (
          INSERT INTO usage_ledger (
            request_id, user_id, key, provider_id, final_provider_id,
            model, original_model, endpoint, api_type, session_id,
            status_code, is_success, blocked_by,
            cost_usd, cost_multiplier,
            input_tokens, output_tokens,
            cache_creation_input_tokens, cache_read_input_tokens,
            cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
            cache_ttl_applied, context_1m_applied, swap_cache_ttl_applied,
            duration_ms, ttfb_ms, created_at
          )
          SELECT
            batch.id,
            batch.user_id,
            batch.key,
            batch.provider_id,
            batch.final_provider_id,
            batch.model,
            batch.original_model,
            batch.endpoint,
            batch.api_type,
            batch.session_id,
            batch.status_code,
            batch.is_success,
            batch.blocked_by,
            batch.cost_usd,
            batch.cost_multiplier,
            batch.input_tokens,
            batch.output_tokens,
            batch.cache_creation_input_tokens,
            batch.cache_read_input_tokens,
            batch.cache_creation_5m_input_tokens,
            batch.cache_creation_1h_input_tokens,
            batch.cache_ttl_applied,
            batch.context_1m_applied,
            batch.swap_cache_ttl_applied,
            batch.duration_ms,
            batch.ttfb_ms,
            batch.created_at
          FROM batch
          ON CONFLICT (request_id) DO NOTHING
          RETURNING request_id
        )
        SELECT
          COALESCE((SELECT COUNT(*) FROM batch), 0)::integer AS processed,
          COALESCE((SELECT COUNT(*) FROM inserted_rows), 0)::integer AS inserted,
          COALESCE((SELECT MAX(id) FROM batch), 0)::integer AS max_id
      `);

        const batchRow = (
          batchResult as unknown as Array<{
            processed?: number | string;
            inserted?: number | string;
            max_id?: number | string;
          }>
        )[0];

        const processed = Number(batchRow?.processed ?? 0);
        const inserted = Number(batchRow?.inserted ?? 0);
        const maxId = Number(batchRow?.max_id ?? 0);

        if (processed === 0) {
          break;
        }

        totalProcessed += processed;
        totalInserted += inserted;
        lastId = maxId;

        logger.info("Backfill progress", {
          processed: totalProcessed,
          inserted: totalInserted,
          elapsed: Date.now() - startTime,
        });
      }

      const durationMs = Date.now() - startTime;
      return {
        totalProcessed,
        totalInserted,
        durationMs,
        alreadyExisted: totalProcessed - totalInserted,
      };
    } finally {
      // pg_try_advisory_xact_lock is automatically released when the transaction ends
    }
  });
}
