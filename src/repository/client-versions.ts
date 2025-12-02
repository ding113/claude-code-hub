"use server";

import { and, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { messageRequest, users } from "@/drizzle/schema";
import { logger } from "@/lib/logger";

/**
 * 原始用户版本数据（从数据库查询）
 */
export interface RawUserVersion {
  userId: number;
  username: string;
  userAgent: string;
  lastSeen: Date;
}

/**
 * 查询过去 N 天内活跃用户的版本分布
 *
 * @param days - 活跃窗口天数（默认 7 天）
 * @returns 活跃用户的 UA 和最后活跃时间
 *
 * @example
 * ```typescript
 * const activeUsers = await getActiveUserVersions(7);
 * // [{ userId: 1, username: "张三", userAgent: "claude-cli/2.0.31 (...)", lastSeen: Date }]
 * ```
 */
export async function getActiveUserVersions(days = 7): Promise<RawUserVersion[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  try {
    const results = await db
      .select({
        userId: messageRequest.userId,
        username: users.name,
        userAgent: messageRequest.userAgent,
        lastSeen: sql<Date>`MAX(${messageRequest.createdAt})`.as("last_seen"),
      })
      .from(messageRequest)
      .leftJoin(users, and(sql`${messageRequest.userId} = ${users.id}`, isNull(users.deletedAt)))
      .where(
        and(gte(messageRequest.createdAt, cutoffDate), sql`${messageRequest.userAgent} IS NOT NULL`)
      )
      .groupBy(messageRequest.userId, users.name, messageRequest.userAgent)
      .orderBy(sql`MAX(${messageRequest.createdAt}) DESC`);

    return results.map((row) => ({
      userId: row.userId,
      username: row.username || `User ${row.userId}`,
      userAgent: row.userAgent || "",
      lastSeen: new Date(row.lastSeen),
    }));
  } catch (error) {
    // Fail Open: 查询失败返回空数组
    logger.error({ error }, "[ClientVersions] 查询活跃用户失败");
    return [];
  }
}
