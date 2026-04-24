import { sql } from "drizzle-orm";
import { usageLedger } from "@/drizzle/schema";
import { NON_BILLING_ENDPOINTS } from "@/lib/utils/performance-formatter";

const NON_BILLING_LEDGER_ENDPOINT_CONDITION = sql`(
  ${usageLedger.endpoint} IS NULL
  OR LOWER(REGEXP_REPLACE(${usageLedger.endpoint}, '/+$', '')) NOT IN (
    ${sql.join(
      NON_BILLING_ENDPOINTS.map((endpoint) => sql`${endpoint}`),
      sql`, `
    )}
  )
)`;

/**
 * 只统计未被阻断的请求。
 * Warmup 行在触发器层面已过滤，不会进入 usage_ledger，
 * 此外 count_tokens / compact 虽写 message_request，但不得进入 billable ledger。
 */
export const LEDGER_BILLING_CONDITION = sql`(${usageLedger.blockedBy} IS NULL AND ${NON_BILLING_LEDGER_ENDPOINT_CONDITION})`;

/**
 * 非计费查询中排除被阻断请求的别名条件（语义更清晰）。
 */
export const LEDGER_ACTIVE_CONDITION = LEDGER_BILLING_CONDITION;

/**
 * successRate / availability 相关统计只统计已明确属于上游 success/failure 的请求。
 */
export const LEDGER_SUCCESS_RATE_COUNTABLE_CONDITION = sql`${usageLedger.successRateOutcome} IN ('success', 'failure')`;

/**
 * successRate 分子条件：只统计明确的 success outcome。
 */
export const LEDGER_SUCCESS_RATE_SUCCESS_CONDITION = sql`${usageLedger.successRateOutcome} = 'success'`;
