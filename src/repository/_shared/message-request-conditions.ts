import { sql } from "drizzle-orm";
import { messageRequest } from "@/drizzle/schema";

/**
 * Warmup 抢答请求只用于探测/预热：日志可见，但不计入任何聚合统计/限额计算。
 *
 * 统一的过滤条件：排除 blocked_by='warmup' 的记录。
 */
export const EXCLUDE_WARMUP_CONDITION = sql`(${messageRequest.blockedBy} IS NULL OR ${messageRequest.blockedBy} <> 'warmup')`;
