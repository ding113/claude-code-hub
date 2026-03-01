import { sql } from "drizzle-orm";
import { usageLedger } from "@/drizzle/schema";

/**
 * 只统计未被阻断的请求。
 * Warmup 行在触发器层面已过滤，不会进入 usage_ledger，
 * 因此此处只需排除 blocked_by IS NOT NULL 的记录。
 */
export const LEDGER_BILLING_CONDITION = sql`(${usageLedger.blockedBy} IS NULL)`;

/**
 * 非计费查询中排除被阻断请求的别名条件（语义更清晰）。
 */
export const LEDGER_ACTIVE_CONDITION = LEDGER_BILLING_CONDITION;
