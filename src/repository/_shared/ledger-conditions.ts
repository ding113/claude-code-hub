import { sql } from "drizzle-orm";
import { usageLedger } from "@/drizzle/schema";

/**
 * 只统计未被阻断的请求。
 *
 * 说明：
 * - Warmup 行在触发器层面已过滤，不会进入 usage_ledger。
 * - 其他 blocked 请求默认也不会创建 usage_ledger 行；若请求后置被标记为 blocked，会将已有 ledger 行标记为 blocked。
 */
export const LEDGER_BILLING_CONDITION = sql`(${usageLedger.blockedBy} IS NULL)`;

/**
 * 非计费查询中排除被阻断请求的别名条件（语义更清晰）。
 */
export const LEDGER_ACTIVE_CONDITION = LEDGER_BILLING_CONDITION;
