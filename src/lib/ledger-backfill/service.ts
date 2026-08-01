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

export async function backfillUsageLedger(
  signal?: AbortSignal
): Promise<BackfillUsageLedgerSummary> {
  const startTime = Date.now();
  const LOCK_KEY = 20260101;
  signal?.throwIfAborted();

  // Use pg_try_advisory_xact_lock (transaction-scoped) so lock/unlock always happen
  // on the same connection — safe with connection pools.
  return await db.transaction(async (tx) => {
    signal?.throwIfAborted();
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
      let totalAlreadyExisted = 0;
      let lastId = 0;

      while (true) {
        signal?.throwIfAborted();
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
            mr.actual_response_model,
            mr.endpoint,
            mr.api_type,
            mr.session_id,
            mr.session_identity,
            mr.session_identity_kind,
            mr.affinity_scope_tag,
            mr.affinity_fingerprint,
            mr.affinity_fingerprint_chain,
            mr.is_replay,
            mr.replay_source_request_id,
            mr.status_code,
            fn_compute_message_request_success_rate_outcome(
              mr.blocked_by,
              mr.status_code,
              mr.error_message,
              mr.provider_chain
            ) AS success_rate_outcome,
            (mr.error_message IS NULL OR mr.error_message = '')
              AND (mr.status_code IS NULL OR mr.status_code < 400) AS is_success,
            mr.blocked_by,
            CASE WHEN mr.is_replay THEN 0 ELSE mr.cost_usd END AS cost_usd,
            mr.cost_multiplier,
            mr.group_cost_multiplier,
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
            mr.first_byte_ms,
            mr.client_ip,
            mr.created_at,
            ul.request_id AS existing_request_id
          FROM message_request mr
          LEFT JOIN usage_ledger ul ON ul.request_id = mr.id
          WHERE mr.id > ${lastId}
            AND mr.blocked_by IS DISTINCT FROM 'warmup'
            AND (
              mr.endpoint IS NULL
              OR LOWER(REGEXP_REPLACE(mr.endpoint, '/+$', '')) NOT IN (
                '/v1/messages/count_tokens',
                '/v1/responses/compact'
              )
            )
            AND (
              ul.request_id IS NULL
              OR ul.success_rate_outcome IS NULL
              OR ul.session_identity IS DISTINCT FROM mr.session_identity
              OR ul.session_identity_kind IS DISTINCT FROM mr.session_identity_kind
              OR ul.affinity_scope_tag IS DISTINCT FROM mr.affinity_scope_tag
              OR ul.affinity_fingerprint IS DISTINCT FROM mr.affinity_fingerprint
              OR ul.affinity_fingerprint_chain IS DISTINCT FROM mr.affinity_fingerprint_chain
              OR ul.is_replay IS DISTINCT FROM mr.is_replay
              OR ul.replay_source_request_id IS DISTINCT FROM mr.replay_source_request_id
              OR (mr.is_replay AND ul.cost_usd IS DISTINCT FROM 0)
              OR ul.group_cost_multiplier IS DISTINCT FROM mr.group_cost_multiplier
              OR ul.client_ip IS DISTINCT FROM mr.client_ip
            )
          ORDER BY mr.id ASC
          LIMIT 10000
        ),
        inserted_rows AS (
          INSERT INTO usage_ledger (
            request_id, user_id, key, provider_id, final_provider_id,
            model, original_model, actual_response_model, endpoint, api_type, session_id,
            session_identity, session_identity_kind, affinity_scope_tag,
            affinity_fingerprint, affinity_fingerprint_chain, is_replay, replay_source_request_id,
            status_code, is_success, success_rate_outcome, blocked_by,
            cost_usd, cost_multiplier, group_cost_multiplier,
            input_tokens, output_tokens,
            cache_creation_input_tokens, cache_read_input_tokens,
            cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
            cache_ttl_applied, context_1m_applied, swap_cache_ttl_applied,
            duration_ms, ttfb_ms, first_byte_ms, client_ip, created_at
          )
          SELECT
            batch.id,
            batch.user_id,
            batch.key,
            batch.provider_id,
            batch.final_provider_id,
            batch.model,
            batch.original_model,
            batch.actual_response_model,
            batch.endpoint,
            batch.api_type,
            batch.session_id,
            batch.session_identity,
            batch.session_identity_kind,
            batch.affinity_scope_tag,
            batch.affinity_fingerprint,
            batch.affinity_fingerprint_chain,
            batch.is_replay,
            batch.replay_source_request_id,
            batch.status_code,
            batch.is_success,
            batch.success_rate_outcome,
            batch.blocked_by,
            batch.cost_usd,
            batch.cost_multiplier,
            batch.group_cost_multiplier,
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
            batch.first_byte_ms,
            batch.client_ip,
            batch.created_at
          FROM batch
          ON CONFLICT (request_id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            key = EXCLUDED.key,
            provider_id = EXCLUDED.provider_id,
            final_provider_id = EXCLUDED.final_provider_id,
            model = EXCLUDED.model,
            original_model = EXCLUDED.original_model,
            actual_response_model = EXCLUDED.actual_response_model,
            endpoint = EXCLUDED.endpoint,
            api_type = EXCLUDED.api_type,
            session_id = EXCLUDED.session_id,
            session_identity = EXCLUDED.session_identity,
            session_identity_kind = EXCLUDED.session_identity_kind,
            affinity_scope_tag = EXCLUDED.affinity_scope_tag,
            affinity_fingerprint = EXCLUDED.affinity_fingerprint,
            affinity_fingerprint_chain = EXCLUDED.affinity_fingerprint_chain,
            is_replay = EXCLUDED.is_replay,
            replay_source_request_id = EXCLUDED.replay_source_request_id,
            status_code = EXCLUDED.status_code,
            is_success = EXCLUDED.is_success,
            success_rate_outcome = EXCLUDED.success_rate_outcome,
            blocked_by = EXCLUDED.blocked_by,
            cost_usd = EXCLUDED.cost_usd,
            cost_multiplier = EXCLUDED.cost_multiplier,
            group_cost_multiplier = EXCLUDED.group_cost_multiplier,
            input_tokens = EXCLUDED.input_tokens,
            output_tokens = EXCLUDED.output_tokens,
            cache_creation_input_tokens = EXCLUDED.cache_creation_input_tokens,
            cache_read_input_tokens = EXCLUDED.cache_read_input_tokens,
            cache_creation_5m_input_tokens = EXCLUDED.cache_creation_5m_input_tokens,
            cache_creation_1h_input_tokens = EXCLUDED.cache_creation_1h_input_tokens,
            cache_ttl_applied = EXCLUDED.cache_ttl_applied,
            context_1m_applied = EXCLUDED.context_1m_applied,
            swap_cache_ttl_applied = EXCLUDED.swap_cache_ttl_applied,
            duration_ms = EXCLUDED.duration_ms,
            ttfb_ms = EXCLUDED.ttfb_ms,
            first_byte_ms = EXCLUDED.first_byte_ms,
            client_ip = EXCLUDED.client_ip
          RETURNING request_id
        )
        SELECT
          COALESCE((SELECT COUNT(*) FROM batch), 0)::integer AS processed,
          COALESCE(
            (
              SELECT COUNT(*)
              FROM inserted_rows ir
              JOIN batch b ON b.id = ir.request_id
              WHERE b.existing_request_id IS NULL
            ),
            0
          )::integer AS inserted,
          COALESCE(
            (
              SELECT COUNT(*)
              FROM inserted_rows ir
              JOIN batch b ON b.id = ir.request_id
              WHERE b.existing_request_id IS NOT NULL
            ),
            0
          )::integer AS updated,
          COALESCE((SELECT MAX(id) FROM batch), 0)::integer AS max_id
      `);

        const batchRow = (
          batchResult as unknown as Array<{
            processed?: number | string;
            inserted?: number | string;
            updated?: number | string;
            max_id?: number | string;
          }>
        )[0];

        const processed = Number(batchRow?.processed ?? 0);
        const inserted = Number(batchRow?.inserted ?? 0);
        const updated = Number(batchRow?.updated ?? 0);
        const maxId = Number(batchRow?.max_id ?? 0);
        signal?.throwIfAborted();

        if (processed === 0) {
          break;
        }

        totalProcessed += processed;
        totalInserted += inserted;
        totalAlreadyExisted += updated;
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
        alreadyExisted: totalAlreadyExisted,
      };
    } finally {
      // pg_try_advisory_xact_lock is automatically released when the transaction ends
    }
  });
}
