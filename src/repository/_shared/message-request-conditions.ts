import { sql } from "drizzle-orm";
import { messageRequest } from "@/drizzle/schema";
import { NON_BILLING_ENDPOINTS } from "@/lib/utils/performance-formatter";

/**
 * Warmup 抢答请求只用于探测/预热：日志可见，但不计入任何聚合统计/限额计算。
 *
 * 统一的过滤条件：排除 blocked_by='warmup' 的记录。
 */
export const EXCLUDE_WARMUP_CONDITION = sql`(${messageRequest.blockedBy} IS NULL OR ${messageRequest.blockedBy} <> 'warmup')`;

/**
 * message_request 行级的「计费活动」条件，与 usage_ledger 的 LEDGER_BILLING_CONDITION 语义一致：
 * 未软删除、未被拦截、非 Replay、非计费豁免端点。
 *
 * usage_ledger 只投影已完成的请求；需要把进行中的请求也算进去的实时指标（例如最近 1 分钟请求数）
 * 使用此条件直接统计 message_request。
 */
export const MESSAGE_REQUEST_BILLABLE_ACTIVITY_CONDITION = sql`(
  ${messageRequest.deletedAt} IS NULL
  AND ${messageRequest.blockedBy} IS NULL
  AND ${messageRequest.isReplay} = false
  AND (
    ${messageRequest.endpoint} IS NULL
    OR LOWER(REGEXP_REPLACE(${messageRequest.endpoint}, '/+$', '')) NOT IN (
      ${sql.join(
        NON_BILLING_ENDPOINTS.map((endpoint) => sql`${endpoint}`),
        sql`, `
      )}
    )
  )
)`;
