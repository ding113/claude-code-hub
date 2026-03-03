import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys, messageRequest, providers, users } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import { maskKey } from "@/lib/utils/validation";
import type { ProxyStatusResponse } from "@/types/proxy-status";

type ActiveRequestRow = {
  requestId: number;
  userId: number;
  keyString: string;
  keyName: string | null;
  providerId: number;
  providerName: string | null;
  model: string | null;
  createdAt: Date | string | null;
};

type LastRequestRow = {
  userId: number;
  requestId: number;
  keyString: string;
  keyName: string | null;
  providerId: number;
  providerName: string | null;
  model: string | null;
  endTime: Date | string | null;
};

function toTimestamp(value: Date | string | number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

/**
 * 代理状态追踪器
 * 当前实现基于数据库数据聚合，确保多运行时环境下的一致性
 */
export class ProxyStatusTracker {
  private static instance: ProxyStatusTracker | null = null;

  static getInstance(): ProxyStatusTracker {
    if (!ProxyStatusTracker.instance) {
      ProxyStatusTracker.instance = new ProxyStatusTracker();
    }
    return ProxyStatusTracker.instance;
  }

  /**
   * @deprecated 已迁移为基于数据库聚合的实现（getAllUsersStatus）。保留仅为兼容既有调用点。
   */
  startRequest(params: {
    userId: number;
    userName: string;
    requestId: number;
    keyName: string;
    providerId: number;
    providerName: string;
    model: string;
  }): void {
    // no-op：当前实现基于数据库聚合（getAllUsersStatus），保留方法仅为兼容既有调用点
    void params;
  }

  /**
   * @deprecated 已迁移为基于数据库聚合的实现（getAllUsersStatus）。保留仅为兼容既有调用点。
   */
  endRequest(userId: number, requestId: number): void {
    // no-op：当前实现基于数据库聚合（getAllUsersStatus），保留方法仅为兼容既有调用点
    void userId;
    void requestId;
  }

  async getAllUsersStatus(): Promise<ProxyStatusResponse> {
    const now = Date.now();

    const [dbUsers, activeRequestRows, lastRequestRows] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
        })
        .from(users)
        .where(isNull(users.deletedAt)),
      this.loadActiveRequests(),
      this.loadLastRequests(),
    ]);

    const activeMap = new Map<number, ProxyStatusResponse["users"][number]["activeRequests"]>();
    for (const row of activeRequestRows) {
      const list = activeMap.get(row.userId) ?? [];
      const startTime = toTimestamp(row.createdAt) ?? now;
      list.push({
        requestId: row.requestId,
        keyName: row.keyName ?? maskKey(row.keyString),
        providerId: row.providerId,
        providerName: row.providerName || "unknown",
        model: row.model || "unknown",
        startTime,
        duration: now - startTime,
      });
      activeMap.set(row.userId, list);
    }

    // lastRequestRows 仅包含已结束请求（duration_ms IS NOT NULL）：
    // 若用户仅有进行中请求，则 lastRequest 会保持为 null，由 activeRequests 展示进行中状态。
    const lastMap = new Map<number, LastRequestRow>();
    for (const row of lastRequestRows) {
      if (!lastMap.has(row.userId)) {
        lastMap.set(row.userId, row);
      }
    }

    const usersStatus = dbUsers.map((dbUser) => {
      const activeRequests = activeMap.get(dbUser.id) ?? [];
      const lastRow = lastMap.get(dbUser.id);

      const lastRequest = lastRow
        ? (() => {
            const endTime = toTimestamp(lastRow.endTime) ?? now;
            return {
              requestId: lastRow.requestId,
              keyName: lastRow.keyName ?? maskKey(lastRow.keyString),
              providerId: lastRow.providerId,
              providerName: lastRow.providerName || "unknown",
              model: lastRow.model || "unknown",
              endTime,
              elapsed: now - endTime,
            };
          })()
        : null;

      return {
        userId: dbUser.id,
        userName: dbUser.name,
        activeCount: activeRequests.length,
        activeRequests,
        lastRequest,
      };
    });

    return { users: usersStatus };
  }

  private async loadActiveRequests(): Promise<ActiveRequestRow[]> {
    const limit = 1000;

    const rows = await db
      .select({
        requestId: messageRequest.id,
        userId: messageRequest.userId,
        keyString: messageRequest.key,
        keyName: keys.name,
        providerId: messageRequest.providerId,
        providerName: providers.name,
        model: messageRequest.model,
        createdAt: messageRequest.createdAt,
      })
      .from(messageRequest)
      .leftJoin(
        providers,
        and(eq(messageRequest.providerId, providers.id), isNull(providers.deletedAt))
      )
      .leftJoin(keys, and(eq(keys.key, messageRequest.key), isNull(keys.deletedAt)))
      .where(and(isNull(messageRequest.deletedAt), isNull(messageRequest.durationMs)))
      // 防御：异常情况下 durationMs 长期为空会导致“活跃请求”无限累积，进而撑爆查询与响应体。
      // 这里对返回明细做上限保护（监控用途不需要无穷列表）。
      .orderBy(desc(messageRequest.createdAt))
      .limit(limit);

    if (rows.length >= limit) {
      logger.warn(
        "[ProxyStatusTracker] Active requests query hit limit, results may be incomplete",
        {
          limit,
          rowCount: rows.length,
        }
      );
    }

    return rows as ActiveRequestRow[];
  }

  private async loadLastRequests(): Promise<LastRequestRow[]> {
    // 注意：该接口需要返回所有用户状态，因此整体复杂度与 users 数量线性相关。
    // 这里使用 LATERAL + 索引扫描来避免在 message_request 大表上做全表排序去重（DISTINCT ON），
    // 若未来用户规模显著增大（例如 1e4+），建议为该接口增加分页/按需查询，或引入专门的汇总表/物化视图。
    const query = sql<LastRequestRow>`
      SELECT
        u.id AS "userId",
        last.request_id AS "requestId",
        last.key_string AS "keyString",
        k.name AS "keyName",
        last.provider_id AS "providerId",
        last.provider_name AS "providerName",
        last.model AS "model",
        last.end_time AS "endTime"
      FROM users u
      -- 使用 LATERAL 为每个用户做一次“取最新请求”的索引扫描，避免在 message_request 大表上做 DISTINCT ON 全表排序去重。
      JOIN LATERAL (
         SELECT
           mr.id AS request_id,
           mr.key AS key_string,
           mr.provider_id AS provider_id,
           p.name AS provider_name,
           mr.model AS model,
           -- 使用 created_at + duration_ms 推导结束时间：避免 async 批量写入导致 updated_at 漂移而“看起来更近”。
           (mr.created_at + (mr.duration_ms * interval '1 millisecond')) AS end_time
         FROM message_request mr
         LEFT JOIN providers p ON mr.provider_id = p.id AND p.deleted_at IS NULL
         WHERE mr.user_id = u.id
          AND mr.deleted_at IS NULL
          -- lastRequest 仅统计已结束请求：activeRequests 已覆盖进行中请求，避免这里误选“请求中”的记录。
          AND mr.duration_ms IS NOT NULL
          AND (mr.blocked_by IS NULL OR mr.blocked_by <> 'warmup')
          -- 这里使用 created_at + id 排序以命中 idx_message_request_user_created_at_id_completed，避免孤儿积累时回溯过深。
        ORDER BY mr.created_at DESC, mr.id DESC
        LIMIT 1
      ) last ON true
      LEFT JOIN keys k ON k.key = last.key_string AND k.deleted_at IS NULL
      WHERE u.deleted_at IS NULL
    `;

    const result = await db.execute(query);
    return Array.from(result) as unknown as LastRequestRow[];
  }
}
