/**
 * 测试数据清理工具
 *
 * 用途：在测试后自动清理创建的测试数据
 */

import { and, isNull, like, or, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { users } from "@/drizzle/schema";

/**
 * 清理所有测试用户及其关联数据
 *
 * 匹配规则：
 * - 名称包含"测试用户"
 * - 名称包含"test"或"Test"
 * - 创建时间在最近 1 小时内（可选）
 */
export async function cleanupTestUsers(options?: {
  onlyRecent?: boolean; // 只清理最近创建的
  recentMinutes?: number; // 最近多少分钟（默认 60）
}) {
  const recentMinutes = options?.recentMinutes ?? 60;
  const cutoffTime = new Date(Date.now() - recentMinutes * 60 * 1000);

  try {
    // 1. 找到要删除的测试用户 ID
    const testUserConditions = [
      like(users.name, "测试用户%"),
      like(users.name, "%test%"),
      like(users.name, "Test%"),
    ];

    const whereConditions = [or(...testUserConditions), isNull(users.deletedAt)];

    if (options?.onlyRecent) {
      // 将 Date 转换为 ISO 字符串，避免 postgres 库报错
      whereConditions.push(sql`${users.createdAt} > ${cutoffTime.toISOString()}`);
    }

    const testUsers = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(...whereConditions));

    if (testUsers.length === 0) {
      console.log("✅ 没有找到测试用户");
      return { deletedUsers: 0, deletedKeys: 0 };
    }

    console.log(`🔍 找到 ${testUsers.length} 个测试用户`);

    const testUserIds = testUsers.map((u) => u.id);

    // 2. 软删除关联的 Keys
    const deletedKeys = await db.execute(sql`
      UPDATE keys
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE user_id = ANY(${testUserIds})
        AND deleted_at IS NULL
    `);

    // 3. 软删除测试用户
    const _deletedUsers = await db.execute(sql`
      UPDATE users
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = ANY(${testUserIds})
        AND deleted_at IS NULL
    `);

    console.log(`✅ 清理完成：删除 ${testUsers.length} 个用户和对应的 Keys`);

    return {
      deletedUsers: testUsers.length,
      deletedKeys: deletedKeys.count ?? 0,
      userNames: testUsers.map((u) => u.name),
    };
  } catch (error) {
    console.error("❌ 清理测试用户失败:", error);
    throw error;
  }
}

/**
 * 在测试中使用的清理函数
 */
export async function cleanupRecentTestData() {
  return cleanupTestUsers({ onlyRecent: true, recentMinutes: 10 });
}
