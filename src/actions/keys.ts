"use server";

import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { randomBytes } from "node:crypto";
import { KeyFormSchema } from "@/lib/validation/schemas";
import {
  createKey,
  updateKey,
  deleteKey,
  findActiveKeyByUserIdAndName,
  findKeyById,
  countActiveKeysByUser,
  findKeysWithStatistics,
  findKeyList,
} from "@/repository/key";
import { getSession } from "@/lib/auth";
import type { ActionResult } from "./types";
import type { KeyStatistics } from "@/repository/key";
import type { Key } from "@/types/key";

// 添加密钥
// 说明：为提升前端可控性，避免直接抛错，返回判别式结果。
export async function addKey(data: {
  userId: number;
  name: string;
  expiresAt?: string;
  canLoginWebUi?: boolean;
  limit5hUsd?: number | null;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitConcurrentSessions?: number;
}): Promise<ActionResult<{ generatedKey: string; name: string }>> {
  try {
    // 权限检查：用户只能给自己添加Key，管理员可以给所有人添加Key
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }
    if (session.user.role !== "admin" && session.user.id !== data.userId) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedData = KeyFormSchema.parse({
      name: data.name,
      expiresAt: data.expiresAt,
    });

    // 检查是否存在同名的生效key
    const existingKey = await findActiveKeyByUserIdAndName(data.userId, validatedData.name);
    if (existingKey) {
      return {
        ok: false,
        error: `名为"${validatedData.name}"的密钥已存在且正在生效中，请使用不同的名称`,
      };
    }

    const generatedKey = "sk-" + randomBytes(16).toString("hex");

    await createKey({
      user_id: data.userId,
      name: validatedData.name,
      key: generatedKey,
      is_enabled: true,
      expires_at: validatedData.expiresAt ? new Date(validatedData.expiresAt) : undefined,
      can_login_web_ui: validatedData.canLoginWebUi,
      limit_5h_usd: validatedData.limit5hUsd,
      limit_weekly_usd: validatedData.limitWeeklyUsd,
      limit_monthly_usd: validatedData.limitMonthlyUsd,
      limit_concurrent_sessions: validatedData.limitConcurrentSessions,
    });

    revalidatePath("/dashboard");

    // 返回生成的key供前端显示
    return { ok: true, data: { generatedKey, name: validatedData.name } };
  } catch (error) {
    logger.error("添加密钥失败:", error);
    const message = error instanceof Error ? error.message : "添加密钥失败，请稍后重试";
    return { ok: false, error: message };
  }
}

// 更新密钥
export async function editKey(
  keyId: number,
  data: {
    name: string;
    expiresAt?: string;
    canLoginWebUi?: boolean;
    limit5hUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitConcurrentSessions?: number;
  }
): Promise<ActionResult> {
  try {
    // 权限检查：用户只能编辑自己的Key，管理员可以编辑所有Key
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    const key = await findKeyById(keyId);
    if (!key) {
      return { ok: false, error: "密钥不存在" };
    }

    if (session.user.role !== "admin" && session.user.id !== key.userId) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedData = KeyFormSchema.parse(data);

    await updateKey(keyId, {
      name: validatedData.name,
      expires_at: validatedData.expiresAt ? new Date(validatedData.expiresAt) : undefined,
      can_login_web_ui: validatedData.canLoginWebUi,
      limit_5h_usd: validatedData.limit5hUsd,
      limit_weekly_usd: validatedData.limitWeeklyUsd,
      limit_monthly_usd: validatedData.limitMonthlyUsd,
      limit_concurrent_sessions: validatedData.limitConcurrentSessions,
    });

    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    logger.error("更新密钥失败:", error);
    const message = error instanceof Error ? error.message : "更新密钥失败，请稍后重试";
    return { ok: false, error: message };
  }
}

// 删除密钥
export async function removeKey(keyId: number): Promise<ActionResult> {
  try {
    // 权限检查：用户只能删除自己的Key，管理员可以删除所有Key
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    const key = await findKeyById(keyId);
    if (!key) {
      return { ok: false, error: "密钥不存在" };
    }

    if (session.user.role !== "admin" && session.user.id !== key.userId) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const activeKeyCount = await countActiveKeysByUser(key.userId);
    if (activeKeyCount <= 1) {
      return { ok: false, error: "该用户至少需要保留一个可用的密钥，无法删除最后一个密钥" };
    }

    await deleteKey(keyId);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    logger.error("删除密钥失败:", error);
    const message = error instanceof Error ? error.message : "删除密钥失败，请稍后重试";
    return { ok: false, error: message };
  }
}

// 获取用户的密钥列表
export async function getKeys(userId: number): Promise<ActionResult<Key[]>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    // 权限检查：用户只能获取自己的密钥，管理员可以获取任何用户的密钥
    if (session.user.role !== "admin" && session.user.id !== userId) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const keys = await findKeyList(userId);
    return { ok: true, data: keys };
  } catch (error) {
    logger.error("获取密钥列表失败:", error);
    return { ok: false, error: "获取密钥列表失败" };
  }
}

// 获取用户密钥的统计信息
export async function getKeysWithStatistics(
  userId: number
): Promise<ActionResult<KeyStatistics[]>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    // 权限检查：用户只能获取自己的统计，管理员可以获取任何用户的统计
    if (session.user.role !== "admin" && session.user.id !== userId) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const stats = await findKeysWithStatistics(userId);
    return { ok: true, data: stats };
  } catch (error) {
    logger.error("获取密钥统计失败:", error);
    return { ok: false, error: "获取密钥统计失败" };
  }
}

/**
 * 获取密钥的限额使用情况（实时数据）
 */
export async function getKeyLimitUsage(keyId: number): Promise<
  ActionResult<{
    cost5h: { current: number; limit: number | null };
    costWeekly: { current: number; limit: number | null };
    costMonthly: { current: number; limit: number | null };
    concurrentSessions: { current: number; limit: number };
  }>
> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    const key = await findKeyById(keyId);
    if (!key) {
      return { ok: false, error: "密钥不存在" };
    }

    // 权限检查
    if (session.user.role !== "admin" && session.user.id !== key.userId) {
      return { ok: false, error: "无权限执行此操作" };
    }

    // 动态导入 RateLimitService 避免循环依赖
    const { RateLimitService } = await import("@/lib/rate-limit");
    const { SessionTracker } = await import("@/lib/session-tracker");

    // 获取金额消费（优先 Redis，降级数据库）
    const [cost5h, costWeekly, costMonthly, concurrentSessions] = await Promise.all([
      RateLimitService.getCurrentCost(keyId, "key", "5h"),
      RateLimitService.getCurrentCost(keyId, "key", "weekly"),
      RateLimitService.getCurrentCost(keyId, "key", "monthly"),
      SessionTracker.getKeySessionCount(keyId),
    ]);

    return {
      ok: true,
      data: {
        cost5h: { current: cost5h, limit: key.limit5hUsd },
        costWeekly: { current: costWeekly, limit: key.limitWeeklyUsd },
        costMonthly: { current: costMonthly, limit: key.limitMonthlyUsd },
        concurrentSessions: {
          current: concurrentSessions,
          limit: key.limitConcurrentSessions || 0,
        },
      },
    };
  } catch (error) {
    logger.error("获取密钥限额使用情况失败:", error);
    return { ok: false, error: "获取限额使用情况失败" };
  }
}
