import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { logger } from "@/lib/logger";

/**
 * F3b 缓存效果窗口聚合（仿 ledger-backfill：事务级 advisory lock 防多副本重复跑）。
 *
 * 按 {最终 providerId, model, cacheTtlBucket} 把 message_request 上的缓存模拟列
 * 聚合成 provider_cache_effectiveness 历史行。定点整数（万分比 bp），禁浮点：
 *
 *   rawBp          = clamp(observed * 10000 / theoretical, 0, 10000)
 *   sampleFactorBp = eligible>=100 -> 10000 | >=30 -> 6000 | >=5 -> 3000 | 否则 1000
 *   observableBp   = eligible * 10000 / sample
 *   confidenceBp   = observableBp * sampleFactorBp / 10000
 *   effectivenessBp= rawBp * confidenceBp / 10000
 *
 * 仅指标展示：结果不参与路由排序、不调价格系数（获批计划明确约束）。
 */

const LOCK_KEY = 20260722;
const TASK_KEY = "cache-effectiveness";
/**
 * 终态迟到缓冲：窗口终点留 15 分钟余量，避免统计到未完成结算的行。
 * message_request.updated_at 无 $onUpdate 自动更新语义，只能按 created_at 过滤；
 * 超过 15 分钟才终态的流仍会漏计，展示级指标可接受。
 */
const WINDOW_SAFETY_LAG_MS = 15 * 60 * 1000;
/** 首次运行回看窗口 */
const INITIAL_LOOKBACK_MS = 60 * 60 * 1000;

export interface CacheEffectivenessSummary {
  windowStart: Date | null;
  windowEnd: Date | null;
  groupsWritten: number;
  durationMs: number;
  skipped: boolean;
}

export async function aggregateCacheEffectiveness(
  signal?: AbortSignal
): Promise<CacheEffectivenessSummary> {
  const startTime = Date.now();
  signal?.throwIfAborted();

  return await db.transaction(async (tx) => {
    signal?.throwIfAborted();
    const lockResult = await tx.execute(sql`
      SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS acquired
    `);
    const acquired = (lockResult as unknown as Array<{ acquired: boolean }>)[0]?.acquired;
    if (!acquired) {
      return {
        windowStart: null,
        windowEnd: null,
        groupsWritten: 0,
        durationMs: Date.now() - startTime,
        skipped: true,
      };
    }

    const now = Date.now();
    const windowEnd = new Date(now - WINDOW_SAFETY_LAG_MS);
    const initialCursor = new Date(now - INITIAL_LOOKBACK_MS);
    await tx.execute(sql`
      INSERT INTO background_task_cursor (task_key, cursor_at, updated_at)
      VALUES (${TASK_KEY}, ${initialCursor}, NOW())
      ON CONFLICT (task_key) DO NOTHING
    `);
    const cursorResult = await tx.execute(sql`
      SELECT cursor_at
      FROM background_task_cursor
      WHERE task_key = ${TASK_KEY}
      FOR UPDATE
    `);
    const cursorAt = (cursorResult as unknown as Array<{ cursor_at: string | Date }>)[0]?.cursor_at;
    const windowStart = cursorAt ? new Date(cursorAt) : initialCursor;

    if (windowStart >= windowEnd) {
      return {
        windowStart,
        windowEnd,
        groupsWritten: 0,
        durationMs: Date.now() - startTime,
        skipped: true,
      };
    }

    signal?.throwIfAborted();
    // 单条 SQL 完成分组聚合 + 定点数学 + 写入（全整数运算）
    const inserted = await tx.execute(sql`
      WITH grouped AS (
        SELECT
          mr.provider_id,
          COALESCE(mr.model, '') AS model,
          COALESCE(mr.cache_ttl_bucket, '5m') AS cache_ttl_bucket,
          COUNT(*)::bigint AS sample_count,
          COUNT(*) FILTER (WHERE mr.cache_score_eligible)::bigint AS eligible_count,
          COALESCE(SUM(mr.theoretical_cache_tokens) FILTER (WHERE mr.cache_score_eligible), 0)::bigint AS theoretical_tokens,
          COALESCE(SUM(mr.cache_read_input_tokens) FILTER (WHERE mr.cache_score_eligible), 0)::bigint AS observed_tokens
        FROM message_request mr
        WHERE mr.cache_compatibility_key IS NOT NULL
          AND mr.deleted_at IS NULL
          AND mr.provider_id > 0
          AND mr.created_at >= ${windowStart}
          AND mr.created_at < ${windowEnd}
        GROUP BY mr.provider_id, COALESCE(mr.model, ''), COALESCE(mr.cache_ttl_bucket, '5m')
      ),
      scored AS (
        SELECT
          g.*,
          CASE
            WHEN g.theoretical_tokens > 0
            THEN LEAST((g.observed_tokens * 10000) / g.theoretical_tokens, 10000)::int
            ELSE 0
          END AS raw_bp,
          CASE
            WHEN g.eligible_count >= 100 THEN 10000
            WHEN g.eligible_count >= 30 THEN 6000
            WHEN g.eligible_count >= 5 THEN 3000
            ELSE 1000
          END AS sample_factor_bp,
          CASE
            WHEN g.sample_count > 0
            THEN ((g.eligible_count * 10000) / g.sample_count)::int
            ELSE 0
          END AS observable_bp
        FROM grouped g
      )
      INSERT INTO provider_cache_effectiveness (
        provider_id, model, cache_ttl_bucket, window_start, window_end,
        sample_count, eligible_count, theoretical_cache_tokens, observed_cache_read_tokens,
        raw_effectiveness_bp, confidence_bp, effectiveness_bp
      )
      SELECT
        s.provider_id,
        s.model,
        s.cache_ttl_bucket,
        ${windowStart},
        ${windowEnd},
        s.sample_count,
        s.eligible_count,
        s.theoretical_tokens,
        s.observed_tokens,
        s.raw_bp,
        ((s.observable_bp * s.sample_factor_bp) / 10000)::int,
        ((s.raw_bp * ((s.observable_bp * s.sample_factor_bp) / 10000)) / 10000)::int
      FROM scored s
      ON CONFLICT (provider_id, model, cache_ttl_bucket, window_start, window_end)
      DO UPDATE SET
        sample_count = EXCLUDED.sample_count,
        eligible_count = EXCLUDED.eligible_count,
        theoretical_cache_tokens = EXCLUDED.theoretical_cache_tokens,
        observed_cache_read_tokens = EXCLUDED.observed_cache_read_tokens,
        raw_effectiveness_bp = EXCLUDED.raw_effectiveness_bp,
        confidence_bp = EXCLUDED.confidence_bp,
        effectiveness_bp = EXCLUDED.effectiveness_bp
      RETURNING id
    `);

    const groupsWritten = Array.isArray(inserted) ? inserted.length : 0;
    await tx.execute(sql`
      UPDATE background_task_cursor
      SET cursor_at = ${windowEnd}, updated_at = NOW()
      WHERE task_key = ${TASK_KEY}
    `);
    if (groupsWritten > 0) {
      logger.info("[CacheEffectiveness] window aggregated", {
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        groupsWritten,
      });
    }
    return {
      windowStart,
      windowEnd,
      groupsWritten,
      durationMs: Date.now() - startTime,
      skipped: false,
    };
  });
}
