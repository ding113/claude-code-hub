import type { SQL } from "drizzle-orm";
import { eq, gte, lt, sql } from "drizzle-orm";
import { messageRequest } from "@/drizzle/schema";

export interface UsageLogFilterParams {
  sessionId?: string;
  startTime?: number;
  endTime?: number;
  statusCode?: number;
  excludeStatusCode200?: boolean;
  model?: string;
  endpoint?: string;
  minRetryCount?: number;
}

// 重试次数计算：
// - 对齐前端 getRetryCount/isActualRequest：只统计“实际请求”的次数，再 - 1 得到重试次数
// - Hedge Race（并发尝试）按 0 处理（并发不算顺序重试，且 UI 优先展示 Hedge Race）
// - provider_chain 为空/NULL 时按 0 处理
export const RETRY_COUNT_EXPR: SQL = sql`(
  SELECT
    CASE
      WHEN COALESCE(
        bool_or(
          (elem->>'reason') IN (
            'hedge_triggered',
            'hedge_launched',
            'hedge_winner',
            'hedge_loser_cancelled'
          )
        ),
        false
      )
      THEN 0
      ELSE GREATEST(
        COALESCE(
          sum(
            CASE
              WHEN (
                (elem->>'reason') IN (
                  'concurrent_limit_failed',
                  'retry_failed',
                  'system_error',
                  'resource_not_found',
                  'client_error_non_retryable',
                  'endpoint_pool_exhausted',
                  'vendor_type_all_timeout',
                  'client_abort',
                  'http2_fallback'
                )
                OR (
                  (elem->>'reason') IN ('request_success', 'retry_success')
                  AND (elem->>'statusCode') IS NOT NULL
                )
              )
              THEN 1
              ELSE 0
            END
          ),
          0
        ) - 1,
        0
      )
    END
  FROM jsonb_array_elements(COALESCE(${messageRequest.providerChain}, '[]'::jsonb)) AS elem
)`;

export function buildUsageLogConditions(filters: UsageLogFilterParams): SQL[] {
  const conditions: SQL[] = [];

  const trimmedSessionId = filters.sessionId?.trim();
  if (trimmedSessionId) {
    conditions.push(eq(messageRequest.sessionId, trimmedSessionId));
  }

  if (filters.startTime !== undefined) {
    const startDate = new Date(filters.startTime);
    conditions.push(gte(messageRequest.createdAt, startDate));
  }

  if (filters.endTime !== undefined) {
    const endDate = new Date(filters.endTime);
    conditions.push(lt(messageRequest.createdAt, endDate));
  }

  if (filters.statusCode !== undefined) {
    conditions.push(eq(messageRequest.statusCode, filters.statusCode));
  } else if (filters.excludeStatusCode200) {
    conditions.push(
      sql`(${messageRequest.statusCode} IS NULL OR ${messageRequest.statusCode} <> 200)`
    );
  }

  if (filters.model) {
    conditions.push(eq(messageRequest.model, filters.model));
  }

  if (filters.endpoint) {
    conditions.push(eq(messageRequest.endpoint, filters.endpoint));
  }

  const minRetryCount = filters.minRetryCount ?? 0;
  if (minRetryCount > 0) {
    conditions.push(sql`${RETRY_COUNT_EXPR} >= ${minRetryCount}`);
  }

  return conditions;
}
