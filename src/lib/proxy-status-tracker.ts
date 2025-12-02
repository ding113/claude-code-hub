import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys, messageRequest, providers, users } from "@/drizzle/schema";
import type { ProxyStatusResponse } from "@/types/proxy-status";

type ActiveRequestRow = {
  requestId: number;
  userId: number;
  keyString: string;
  keyName: string | null;
  providerId: number;
  providerName: string;
  model: string | null;
  createdAt: Date | string | null;
};

type LastRequestRow = {
  userId: number;
  requestId: number;
  keyString: string;
  keyName: string | null;
  providerId: number;
  providerName: string;
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

  startRequest(params: {
    userId: number;
    userName: string;
    requestId: number;
    keyName: string;
    providerId: number;
    providerName: string;
    model: string;
  }): void {
    void params;
  }

  endRequest(userId: number, requestId: number): void {
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
        keyName: row.keyName || row.keyString,
        providerId: row.providerId,
        providerName: row.providerName,
        model: row.model || "unknown",
        startTime,
        duration: now - startTime,
      });
      activeMap.set(row.userId, list);
    }

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
              keyName: lastRow.keyName || lastRow.keyString,
              providerId: lastRow.providerId,
              providerName: lastRow.providerName,
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
    const rows = await db
      .select({
        requestId: messageRequest.id,
        userId: messageRequest.userId,
        keyString: messageRequest.key,
        keyName: keys.name,
        providerId: providers.id,
        providerName: providers.name,
        model: messageRequest.model,
        createdAt: messageRequest.createdAt,
      })
      .from(messageRequest)
      .innerJoin(providers, eq(messageRequest.providerId, providers.id))
      .leftJoin(keys, and(eq(keys.key, messageRequest.key), isNull(keys.deletedAt)))
      .where(
        and(
          isNull(messageRequest.deletedAt),
          isNull(messageRequest.durationMs),
          isNull(providers.deletedAt)
        )
      );

    return rows as ActiveRequestRow[];
  }

  private async loadLastRequests(): Promise<LastRequestRow[]> {
    const query = sql<LastRequestRow>`
      SELECT DISTINCT ON (mr.user_id)
        mr.user_id AS "userId",
        mr.id AS "requestId",
        mr.key AS "keyString",
        k.name AS "keyName",
        mr.provider_id AS "providerId",
        p.name AS "providerName",
        mr.model AS "model",
        mr.updated_at AS "endTime"
      FROM message_request mr
      JOIN providers p ON mr.provider_id = p.id AND p.deleted_at IS NULL
      LEFT JOIN keys k ON k.key = mr.key AND k.deleted_at IS NULL
      WHERE mr.deleted_at IS NULL
      ORDER BY mr.user_id, mr.updated_at DESC
    `;

    const result = await db.execute(query);
    return Array.from(result) as unknown as LastRequestRow[];
  }
}
