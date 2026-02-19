import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/drizzle/db";

export async function backfillUsageLedger(): Promise<{ inserted: number }> {
  const LOCK_KEY = 20260101;

  const result = await db.execute(sql`
    SELECT pg_try_advisory_lock(${LOCK_KEY}) AS acquired
  `);

  const acquired = (result as unknown as Array<{ acquired: boolean }>)[0]?.acquired;
  if (!acquired) {
    return { inserted: 0 };
  }

  try {
    const insertResult = await db.execute(sql`
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
        ),
        mr.model,
        mr.original_model,
        mr.endpoint,
        mr.api_type,
        mr.session_id,
        mr.status_code,
        (mr.error_message IS NULL OR mr.error_message = ''),
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
      WHERE mr.blocked_by IS DISTINCT FROM 'warmup'
      ON CONFLICT (request_id) DO NOTHING
    `);

    const inserted = Number((insertResult as unknown as { rowCount?: number }).rowCount ?? 0);
    return { inserted };
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`);
  }
}
