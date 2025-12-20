"use server";

import { randomBytes } from "node:crypto";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { db } from "@/drizzle/db";
import { keys as keysTable } from "@/drizzle/schema";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import { KeyFormSchema } from "@/lib/validation/schemas";
import type { KeyStatistics } from "@/repository/key";
import {
  countActiveKeysByUser,
  createKey,
  deleteKey,
  findActiveKeyByUserIdAndName,
  findKeyById,
  findKeyList,
  findKeysWithStatistics,
  updateKey,
} from "@/repository/key";
import type { Key } from "@/types/key";
import type { ActionResult } from "./types";
import { type BatchUpdateResult, syncUserProviderGroupFromKeys } from "./users";

function normalizeProviderGroup(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const groups = value
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  if (groups.length === 0) return null;
  return Array.from(new Set(groups)).sort().join(",");
}

export interface BatchUpdateKeysParams {
  keyIds: number[];
  updates: {
    providerGroup?: string | null;
    limit5hUsd?: number | null;
    limitDailyUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    canLoginWebUi?: boolean;
    isEnabled?: boolean;
  };
}

class BatchUpdateError extends Error {
  readonly errorCode: string;

  constructor(message: string, errorCode: string) {
    super(message);
    this.name = "BatchUpdateError";
    this.errorCode = errorCode;
  }
}

// 添加密钥
// 说明：为提升前端可控性，避免直接抛错，返回判别式结果。
export async function addKey(data: {
  userId: number;
  name: string;
  expiresAt?: string;
  canLoginWebUi?: boolean;
  limit5hUsd?: number | null;
  limitDailyUsd?: number | null;
  dailyResetMode?: "fixed" | "rolling";
  dailyResetTime?: string;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number;
  providerGroup?: string | null;
  cacheTtlPreference?: "inherit" | "5m" | "1h";
}): Promise<ActionResult<{ generatedKey: string; name: string }>> {
  try {
    // providerGroup 安全模型：
    // - 非管理员创建 Key 时，providerGroup 必须是用户现有分组的子集（防止绕过分组隔离）
    // - 若用户有分组限制但未指定 providerGroup，则新 Key 继承用户的全部分组
    // - 若用户无分组限制，则新 Key 的 providerGroup 为空（可访问所有）

    const tError = await getTranslations("errors");

    // 权限检查：用户只能给自己添加Key，管理员可以给所有人添加Key
    const session = await getSession();
    if (!session) {
      return {
        ok: false,
        error: tError("UNAUTHORIZED"),
        errorCode: ERROR_CODES.UNAUTHORIZED,
      };
    }
    if (session.user.role !== "admin" && session.user.id !== data.userId) {
      return {
        ok: false,
        error: tError("PERMISSION_DENIED"),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const isAdmin = session.user.role === "admin";

    // 非 admin 创建 Key 时的分组验证：providerGroup 必须是用户现有分组的子集
    const { findUserById } = await import("@/repository/user");
    const user = await findUserById(data.userId);
    if (!user) {
      return { ok: false, error: "用户不存在" };
    }

    const userProviderGroup = normalizeProviderGroup(user.providerGroup);
    const requestedProviderGroup = normalizeProviderGroup(data.providerGroup);
    let providerGroupForKey = isAdmin ? requestedProviderGroup : null;

    if (!isAdmin) {
      const userGroups = userProviderGroup ? userProviderGroup.split(",") : [];

      if (userGroups.length > 0) {
        // 如果未指定分组，继承用户的全部分组
        if (!requestedProviderGroup) {
          providerGroupForKey = userProviderGroup;
        } else {
          // 验证请求的分组是用户分组的子集
          const userGroupSet = new Set(userGroups);
          const requestedGroups = requestedProviderGroup.split(",");
          const invalidGroups = requestedGroups.filter((g) => !userGroupSet.has(g));
          if (invalidGroups.length > 0) {
            return {
              ok: false,
              error: `无权使用以下分组: ${invalidGroups.join(", ")}`,
              errorCode: ERROR_CODES.PERMISSION_DENIED,
            };
          }
          providerGroupForKey = requestedProviderGroup;
        }
      }
    }

    const validatedData = KeyFormSchema.parse({
      name: data.name,
      expiresAt: data.expiresAt,
      canLoginWebUi: data.canLoginWebUi,
      limit5hUsd: data.limit5hUsd,
      limitDailyUsd: data.limitDailyUsd,
      dailyResetMode: data.dailyResetMode,
      dailyResetTime: data.dailyResetTime,
      limitWeeklyUsd: data.limitWeeklyUsd,
      limitMonthlyUsd: data.limitMonthlyUsd,
      limitTotalUsd: data.limitTotalUsd,
      limitConcurrentSessions: data.limitConcurrentSessions,
      providerGroup: providerGroupForKey,
      cacheTtlPreference: data.cacheTtlPreference,
    });

    // 检查是否存在同名的生效key
    const existingKey = await findActiveKeyByUserIdAndName(data.userId, validatedData.name);
    if (existingKey) {
      return {
        ok: false,
        error: `名为"${validatedData.name}"的密钥已存在且正在生效中，请使用不同的名称`,
      };
    }

    // 验证各个限额字段
    if (data.limit5hUsd && user.limit5hUsd && data.limit5hUsd > user.limit5hUsd) {
      return {
        ok: false,
        error: `Key的5小时消费上限（${data.limit5hUsd}）不能超过用户限额（${user.limit5hUsd}）`,
      };
    }

    if (data.limitDailyUsd && user.dailyQuota && data.limitDailyUsd > user.dailyQuota) {
      return {
        ok: false,
        error: `Key的日消费上限（${data.limitDailyUsd}）不能超过用户限额（${user.dailyQuota}）`,
      };
    }

    if (data.limitWeeklyUsd && user.limitWeeklyUsd && data.limitWeeklyUsd > user.limitWeeklyUsd) {
      return {
        ok: false,
        error: `Key的周消费上限（${data.limitWeeklyUsd}）不能超过用户限额（${user.limitWeeklyUsd}）`,
      };
    }

    if (
      data.limitMonthlyUsd &&
      user.limitMonthlyUsd &&
      data.limitMonthlyUsd > user.limitMonthlyUsd
    ) {
      return {
        ok: false,
        error: `Key的月消费上限（${data.limitMonthlyUsd}）不能超过用户限额（${user.limitMonthlyUsd}）`,
      };
    }

    if (
      validatedData.limitTotalUsd &&
      user.limitTotalUsd &&
      validatedData.limitTotalUsd > user.limitTotalUsd
    ) {
      return {
        ok: false,
        error: `Key的总消费上限（${validatedData.limitTotalUsd}）不能超过用户限额（${user.limitTotalUsd}）`,
      };
    }

    if (
      data.limitConcurrentSessions &&
      user.limitConcurrentSessions &&
      data.limitConcurrentSessions > user.limitConcurrentSessions
    ) {
      return {
        ok: false,
        error: `Key的并发Session上限（${data.limitConcurrentSessions}）不能超过用户限额（${user.limitConcurrentSessions}）`,
      };
    }

    const generatedKey = `sk-${randomBytes(16).toString("hex")}`;

    // 转换 expiresAt: undefined → null（永不过期），string → Date（设置日期）
    const expiresAt =
      validatedData.expiresAt === undefined ? null : new Date(validatedData.expiresAt);

    await createKey({
      user_id: data.userId,
      name: validatedData.name,
      key: generatedKey,
      is_enabled: true,
      expires_at: expiresAt,
      can_login_web_ui: validatedData.canLoginWebUi,
      limit_5h_usd: validatedData.limit5hUsd,
      limit_daily_usd: validatedData.limitDailyUsd,
      daily_reset_mode: validatedData.dailyResetMode,
      daily_reset_time: validatedData.dailyResetTime,
      limit_weekly_usd: validatedData.limitWeeklyUsd,
      limit_monthly_usd: validatedData.limitMonthlyUsd,
      limit_total_usd: validatedData.limitTotalUsd,
      limit_concurrent_sessions: validatedData.limitConcurrentSessions,
      provider_group: validatedData.providerGroup || null,
      cache_ttl_preference: validatedData.cacheTtlPreference,
    });

    // 自动同步用户分组（用户分组 = Key 分组并集）
    if (session.user.role === "admin" && validatedData.providerGroup) {
      await syncUserProviderGroupFromKeys(data.userId);
    }

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
    isEnabled?: boolean;
    limit5hUsd?: number | null;
    limitDailyUsd?: number | null;
    dailyResetMode?: "fixed" | "rolling";
    dailyResetTime?: string;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitTotalUsd?: number | null;
    limitConcurrentSessions?: number;
    providerGroup?: string | null;
    cacheTtlPreference?: "inherit" | "5m" | "1h";
  }
): Promise<ActionResult> {
  try {
    // providerGroup 为 admin-only 字段：
    // - 普通用户不能在 Key 上设置/修改 providerGroup（防止绕过分组隔离）
    // - 用户分组由 Key 分组自动计算（见 syncUserProviderGroupFromKeys）
    // - syncUserProviderGroupFromKeys 仅在 Key 变更时触发（create/edit/delete）

    const tError = await getTranslations("errors");

    // 权限检查：用户只能编辑自己的Key，管理员可以编辑所有Key
    const session = await getSession();
    if (!session) {
      return {
        ok: false,
        error: tError("UNAUTHORIZED"),
        errorCode: ERROR_CODES.UNAUTHORIZED,
      };
    }

    const key = await findKeyById(keyId);
    if (!key) {
      return { ok: false, error: "密钥不存在" };
    }

    if (session.user.role !== "admin" && session.user.id !== key.userId) {
      return {
        ok: false,
        error: tError("PERMISSION_DENIED"),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    // 普通用户禁止修改 providerGroup（即使是自己的 Key）。
    // 为保持兼容性：若客户端仍携带 providerGroup 但值未变化，则允许继续编辑其它字段。
    const providerGroupProvided = Object.hasOwn(data, "providerGroup");
    if (session.user.role !== "admin" && providerGroupProvided) {
      const currentGroup = normalizeProviderGroup(key.providerGroup);
      const requestedGroup = normalizeProviderGroup(data.providerGroup);
      if (currentGroup !== requestedGroup) {
        return {
          ok: false,
          error: tError("PERMISSION_DENIED"),
          errorCode: ERROR_CODES.PERMISSION_DENIED,
        };
      }
    }

    const validatedData = KeyFormSchema.parse(data);

    // 服务端验证：Key限额不能超过用户限额
    const { findUserById } = await import("@/repository/user");
    const user = await findUserById(key.userId);
    if (!user) {
      return { ok: false, error: "用户不存在" };
    }

    // 验证各个限额字段
    if (validatedData.limit5hUsd && user.limit5hUsd && validatedData.limit5hUsd > user.limit5hUsd) {
      return {
        ok: false,
        error: `Key的5小时消费上限（${validatedData.limit5hUsd}）不能超过用户限额（${user.limit5hUsd}）`,
      };
    }

    if (
      validatedData.limitDailyUsd &&
      user.dailyQuota &&
      validatedData.limitDailyUsd > user.dailyQuota
    ) {
      return {
        ok: false,
        error: `Key的日消费上限（${validatedData.limitDailyUsd}）不能超过用户限额（${user.dailyQuota}）`,
      };
    }

    if (
      validatedData.limitWeeklyUsd &&
      user.limitWeeklyUsd &&
      validatedData.limitWeeklyUsd > user.limitWeeklyUsd
    ) {
      return {
        ok: false,
        error: `Key的周消费上限（${validatedData.limitWeeklyUsd}）不能超过用户限额（${user.limitWeeklyUsd}）`,
      };
    }

    if (
      validatedData.limitMonthlyUsd &&
      user.limitMonthlyUsd &&
      validatedData.limitMonthlyUsd > user.limitMonthlyUsd
    ) {
      return {
        ok: false,
        error: `Key的月消费上限（${validatedData.limitMonthlyUsd}）不能超过用户限额（${user.limitMonthlyUsd}）`,
      };
    }

    if (
      validatedData.limitTotalUsd &&
      user.limitTotalUsd &&
      validatedData.limitTotalUsd > user.limitTotalUsd
    ) {
      return {
        ok: false,
        error: `Key的总消费上限（${validatedData.limitTotalUsd}）不能超过用户限额（${user.limitTotalUsd}）`,
      };
    }

    if (
      validatedData.limitConcurrentSessions &&
      user.limitConcurrentSessions &&
      validatedData.limitConcurrentSessions > user.limitConcurrentSessions
    ) {
      return {
        ok: false,
        error: `Key的并发Session上限（${validatedData.limitConcurrentSessions}）不能超过用户限额（${user.limitConcurrentSessions}）`,
      };
    }

    // 移除 providerGroup 子集校验（用户分组由 Key 分组自动计算）

    // 转换 expiresAt: undefined → null（清除日期），string → Date（设置日期）
    const expiresAt =
      validatedData.expiresAt === undefined ? null : new Date(validatedData.expiresAt);

    const isAdmin = session.user.role === "admin";
    const nextProviderGroup = isAdmin ? normalizeProviderGroup(validatedData.providerGroup) : null;
    const prevProviderGroup = normalizeProviderGroup(key.providerGroup);
    const providerGroupChanged = isAdmin && nextProviderGroup !== prevProviderGroup;

    await updateKey(keyId, {
      name: validatedData.name,
      expires_at: expiresAt,
      can_login_web_ui: validatedData.canLoginWebUi,
      ...(data.isEnabled !== undefined ? { is_enabled: data.isEnabled } : {}),
      limit_5h_usd: validatedData.limit5hUsd,
      limit_daily_usd: validatedData.limitDailyUsd,
      daily_reset_mode: validatedData.dailyResetMode,
      daily_reset_time: validatedData.dailyResetTime,
      limit_weekly_usd: validatedData.limitWeeklyUsd,
      limit_monthly_usd: validatedData.limitMonthlyUsd,
      limit_total_usd: validatedData.limitTotalUsd,
      limit_concurrent_sessions: validatedData.limitConcurrentSessions,
      // providerGroup 为 admin-only 字段：非管理员不允许更新该字段
      ...(isAdmin ? { provider_group: validatedData.providerGroup || null } : {}),
      cache_ttl_preference: validatedData.cacheTtlPreference,
    });

    // 自动同步用户分组（用户分组 = Key 分组并集）
    if (providerGroupChanged) {
      await syncUserProviderGroupFromKeys(key.userId);
    }

    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    logger.error("Failed to update key:", error);
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
      return {
        ok: false,
        error: "该用户至少需要保留一个可用的密钥，无法删除最后一个密钥",
      };
    }

    // 非 admin 删除时的额外检查：确保删除后用户仍有分组（防止分组被清空从而绕过限制）
    if (session.user.role !== "admin") {
      const userKeys = await findKeyList(key.userId);

      const remainingGroups = new Set<string>();
      for (const k of userKeys) {
        if (k.id === keyId) continue;
        if (!k.providerGroup) continue;
        k.providerGroup
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean)
          .forEach((g) => remainingGroups.add(g));
      }

      const { findUserById } = await import("@/repository/user");
      const user = await findUserById(key.userId);
      const currentGroups = (user?.providerGroup || "")
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);

      if (currentGroups.length > 0 && remainingGroups.size === 0) {
        return {
          ok: false,
          error:
            "无法删除此密钥：删除后您将没有任何可用的供应商分组。请先创建其他包含分组的密钥，或联系管理员。",
        };
      }
    }

    await deleteKey(keyId);

    // 自动同步用户分组（删除 Key 后用户分组可能变化）
    await syncUserProviderGroupFromKeys(key.userId);

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
    cost5h: { current: number; limit: number | null; resetAt?: Date };
    costDaily: { current: number; limit: number | null; resetAt?: Date };
    costWeekly: { current: number; limit: number | null; resetAt?: Date };
    costMonthly: { current: number; limit: number | null; resetAt?: Date };
    costTotal: { current: number; limit: number | null };
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
    const { getResetInfo, getResetInfoWithMode } = await import("@/lib/rate-limit/time-utils");
    const { sumKeyTotalCost } = await import("@/repository/statistics");

    // 获取金额消费（优先 Redis，降级数据库）
    const [cost5h, costDaily, costWeekly, costMonthly, totalCost, concurrentSessions] =
      await Promise.all([
        RateLimitService.getCurrentCost(keyId, "key", "5h"),
        RateLimitService.getCurrentCost(
          keyId,
          "key",
          "daily",
          key.dailyResetTime,
          key.dailyResetMode ?? "fixed"
        ),
        RateLimitService.getCurrentCost(keyId, "key", "weekly"),
        RateLimitService.getCurrentCost(keyId, "key", "monthly"),
        sumKeyTotalCost(key.key),
        SessionTracker.getKeySessionCount(keyId),
      ]);

    // 获取重置时间
    const resetInfo5h = getResetInfo("5h");
    const resetInfoDaily = getResetInfoWithMode(
      "daily",
      key.dailyResetTime,
      key.dailyResetMode ?? "fixed"
    );
    const resetInfoWeekly = getResetInfo("weekly");
    const resetInfoMonthly = getResetInfo("monthly");

    return {
      ok: true,
      data: {
        cost5h: {
          current: cost5h,
          limit: key.limit5hUsd,
          resetAt: resetInfo5h.resetAt, // 滚动窗口无 resetAt
        },
        costDaily: {
          current: costDaily,
          limit: key.limitDailyUsd,
          resetAt: resetInfoDaily.resetAt,
        },
        costWeekly: {
          current: costWeekly,
          limit: key.limitWeeklyUsd,
          resetAt: resetInfoWeekly.resetAt,
        },
        costMonthly: {
          current: costMonthly,
          limit: key.limitMonthlyUsd,
          resetAt: resetInfoMonthly.resetAt,
        },
        costTotal: {
          current: totalCost,
          limit: key.limitTotalUsd ?? null,
        },
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

/**
 * 切换密钥启用/禁用状态
 */
export async function toggleKeyEnabled(keyId: number, enabled: boolean): Promise<ActionResult> {
  try {
    const tError = await getTranslations("errors");

    const session = await getSession();
    if (!session) {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const key = await findKeyById(keyId);
    if (!key) {
      return { ok: false, error: tError("KEY_NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    // 权限检查：用户只能管理自己的Key，管理员可以管理所有Key
    if (session.user.role !== "admin" && session.user.id !== key.userId) {
      return {
        ok: false,
        error: tError("PERMISSION_DENIED"),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    // 检查是否是最后一个启用的密钥（防止禁用最后一个）
    if (!enabled) {
      const activeKeyCount = await countActiveKeysByUser(key.userId);
      if (activeKeyCount <= 1) {
        return {
          ok: false,
          error: tError("CANNOT_DISABLE_LAST_KEY") || "无法禁用最后一个可用密钥",
          errorCode: ERROR_CODES.OPERATION_FAILED,
        };
      }
    }

    await updateKey(keyId, { is_enabled: enabled });
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    logger.error("切换密钥状态失败:", error);
    const tError = await getTranslations("errors");
    const message = error instanceof Error ? error.message : tError("UPDATE_KEY_FAILED");
    return { ok: false, error: message, errorCode: ERROR_CODES.UPDATE_FAILED };
  }
}

/**
 * 批量更新 Key（事务保证原子性）
 *
 * 注意：仅管理员可用。
 */
export async function batchUpdateKeys(
  params: BatchUpdateKeysParams
): Promise<ActionResult<BatchUpdateResult>> {
  try {
    const tError = await getTranslations("errors");

    const session = await getSession();
    if (!session) {
      return {
        ok: false,
        error: tError("UNAUTHORIZED"),
        errorCode: ERROR_CODES.UNAUTHORIZED,
      };
    }
    if (session.user.role !== "admin") {
      return {
        ok: false,
        error: tError("PERMISSION_DENIED"),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const MAX_BATCH_SIZE = 500;
    const requestedIds = Array.from(new Set(params.keyIds)).filter((id) => Number.isInteger(id));
    if (requestedIds.length === 0) {
      return { ok: false, error: tError("REQUIRED_FIELD"), errorCode: ERROR_CODES.REQUIRED_FIELD };
    }
    if (requestedIds.length > MAX_BATCH_SIZE) {
      return {
        ok: false,
        error: tError("BATCH_SIZE_EXCEEDED", { max: MAX_BATCH_SIZE }),
        errorCode: ERROR_CODES.INVALID_FORMAT,
      };
    }

    const updates = params.updates ?? {};
    const hasAnyUpdate = Object.values(updates).some((v) => v !== undefined);
    if (!hasAnyUpdate) {
      return { ok: false, error: tError("EMPTY_UPDATE"), errorCode: ERROR_CODES.EMPTY_UPDATE };
    }

    const normalizedProviderGroup =
      updates.providerGroup === undefined
        ? undefined
        : normalizeProviderGroup(updates.providerGroup);

    let updatedIds: number[] = [];
    let affectedUserIds: number[] = [];

    await db.transaction(async (tx) => {
      const existingRows = await tx
        .select({ id: keysTable.id, userId: keysTable.userId })
        .from(keysTable)
        .where(and(inArray(keysTable.id, requestedIds), isNull(keysTable.deletedAt)));

      const existingSet = new Set(existingRows.map((r) => r.id));
      const missingIds = requestedIds.filter((id) => !existingSet.has(id));
      if (missingIds.length > 0) {
        throw new BatchUpdateError(
          `部分 Key 不存在: ${missingIds.join(", ")}`,
          ERROR_CODES.NOT_FOUND
        );
      }

      // 禁用 Key 时，确保每个用户至少保留一个启用的 Key
      if (updates.isEnabled === false) {
        // 获取当前启用状态
        const currentKeyStates = await tx
          .select({
            id: keysTable.id,
            userId: keysTable.userId,
            isEnabled: keysTable.isEnabled,
          })
          .from(keysTable)
          .where(and(inArray(keysTable.id, requestedIds), isNull(keysTable.deletedAt)));

        // 按用户分组，统计每个用户将被禁用的已启用 Key 数量
        const userDisableCounts = new Map<number, number>();
        for (const key of currentKeyStates) {
          if (key.isEnabled) {
            userDisableCounts.set(key.userId, (userDisableCounts.get(key.userId) ?? 0) + 1);
          }
        }

        // 获取所有受影响用户当前的启用 Key 数量
        const affectedUserIdsList = Array.from(userDisableCounts.keys());
        if (affectedUserIdsList.length > 0) {
          const enabledCountRows = await tx
            .select({
              userId: keysTable.userId,
              count: count(),
            })
            .from(keysTable)
            .where(
              and(
                inArray(keysTable.userId, affectedUserIdsList),
                eq(keysTable.isEnabled, true),
                isNull(keysTable.deletedAt)
              )
            )
            .groupBy(keysTable.userId);

          const userEnabledCounts = new Map<number, number>();
          for (const row of enabledCountRows) {
            userEnabledCounts.set(row.userId, Number(row.count));
          }

          // 检查每个用户禁用后是否还有至少一个启用的 Key
          for (const [userId, disableCount] of userDisableCounts) {
            const currentEnabledCount = userEnabledCounts.get(userId) ?? 0;
            if (currentEnabledCount - disableCount < 1) {
              throw new BatchUpdateError(
                tError("CANNOT_DISABLE_LAST_KEY") || "无法禁用最后一个可用密钥",
                ERROR_CODES.OPERATION_FAILED
              );
            }
          }
        }
      }

      affectedUserIds = Array.from(new Set(existingRows.map((r) => r.userId)));

      const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };

      if (updates.isEnabled !== undefined) dbUpdates.isEnabled = updates.isEnabled;
      if (updates.canLoginWebUi !== undefined) dbUpdates.canLoginWebUi = updates.canLoginWebUi;
      if (normalizedProviderGroup !== undefined) dbUpdates.providerGroup = normalizedProviderGroup;
      if (updates.limit5hUsd !== undefined)
        dbUpdates.limit5hUsd = updates.limit5hUsd === null ? null : updates.limit5hUsd.toString();
      if (updates.limitDailyUsd !== undefined)
        dbUpdates.limitDailyUsd =
          updates.limitDailyUsd === null ? null : updates.limitDailyUsd.toString();
      if (updates.limitWeeklyUsd !== undefined)
        dbUpdates.limitWeeklyUsd =
          updates.limitWeeklyUsd === null ? null : updates.limitWeeklyUsd.toString();
      if (updates.limitMonthlyUsd !== undefined)
        dbUpdates.limitMonthlyUsd =
          updates.limitMonthlyUsd === null ? null : updates.limitMonthlyUsd.toString();

      const updatedRows = await tx
        .update(keysTable)
        .set(dbUpdates)
        .where(and(inArray(keysTable.id, requestedIds), isNull(keysTable.deletedAt)))
        .returning({ id: keysTable.id });

      updatedIds = updatedRows.map((r) => r.id);

      if (updatedIds.length !== requestedIds.length) {
        throw new BatchUpdateError("批量更新失败：更新行数不匹配", ERROR_CODES.UPDATE_FAILED);
      }

      // CRITICAL: Post-update validation to prevent race conditions
      // Re-validate after update within the same transaction to ensure atomicity
      // If another concurrent transaction disabled keys, this check will fail and rollback
      if (updates.isEnabled === false) {
        for (const userId of affectedUserIds) {
          const [remainingEnabled] = await tx
            .select({ count: count() })
            .from(keysTable)
            .where(
              and(
                eq(keysTable.userId, userId),
                eq(keysTable.isEnabled, true),
                isNull(keysTable.deletedAt)
              )
            );

          if (Number(remainingEnabled?.count ?? 0) < 1) {
            throw new BatchUpdateError(
              tError("CANNOT_DISABLE_LAST_KEY") || "无法禁用最后一个可用密钥",
              ERROR_CODES.OPERATION_FAILED
            );
          }
        }
      }
    });

    // 同步用户分组（用户分组 = Key 分组并集）
    if (normalizedProviderGroup !== undefined && affectedUserIds.length > 0) {
      await Promise.all(affectedUserIds.map((userId) => syncUserProviderGroupFromKeys(userId)));
    }

    revalidatePath("/dashboard");
    return {
      ok: true,
      data: {
        requestedCount: requestedIds.length,
        updatedCount: updatedIds.length,
        updatedIds,
      },
    };
  } catch (error) {
    if (error instanceof BatchUpdateError) {
      return { ok: false, error: error.message, errorCode: error.errorCode };
    }

    logger.error("批量更新 Key 失败:", error);
    const message = error instanceof Error ? error.message : "批量更新 Key 失败";
    return { ok: false, error: message, errorCode: ERROR_CODES.UPDATE_FAILED };
  }
}
