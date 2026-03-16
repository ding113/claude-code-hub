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

// 重试次数计算：provider_chain 长度 - 2（排除 index 0 的 selection 记录 + index 1 的首次请求），并做下限 0 保护
export const RETRY_COUNT_EXPR: SQL = sql`GREATEST(COALESCE(jsonb_array_length(${messageRequest.providerChain}) - 2, 0), 0)`;

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
