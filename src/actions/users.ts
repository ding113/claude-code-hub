"use server";

import { findUserList, createUser, updateUser, deleteUser, findUserById } from "@/repository/user";
import { logger } from "@/lib/logger";
import { findKeyList, findKeyUsageToday, findKeysWithStatistics } from "@/repository/key";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { type UserDisplay } from "@/types/user";
import { maskKey } from "@/lib/utils/validation";
import { CreateUserSchema, UpdateUserSchema } from "@/lib/validation/schemas";
import { USER_DEFAULTS } from "@/lib/constants/user.constants";
import { createKey } from "@/repository/key";
import { getSession } from "@/lib/auth";
import type { ActionResult } from "./types";

// 获取用户数据
export async function getUsers(): Promise<UserDisplay[]> {
  try {
    const session = await getSession();
    if (!session) {
      return [];
    }

    // 普通用户只能看到自己的数据
    let users;
    if (session.user.role === "user") {
      users = [session.user]; // 只返回当前用户
    } else {
      users = await findUserList(); // 管理员可以看到所有用户
    }

    if (users.length === 0) {
      return [];
    }

    // 管理员可以看到完整Key，普通用户只能看到掩码
    const isAdmin = session.user.role === "admin";

    const userDisplays: UserDisplay[] = await Promise.all(
      users.map(async (user) => {
        try {
          const [keys, usageRecords, keyStatistics] = await Promise.all([
            findKeyList(user.id),
            findKeyUsageToday(user.id),
            findKeysWithStatistics(user.id),
          ]);

          const usageMap = new Map(usageRecords.map((item) => [item.keyId, item.totalCost ?? 0]));

          const statisticsMap = new Map(keyStatistics.map((stat) => [stat.keyId, stat]));

          return {
            id: user.id,
            name: user.name,
            note: user.description || undefined,
            role: user.role,
            rpm: user.rpm,
            dailyQuota: user.dailyQuota,
            providerGroup: user.providerGroup || undefined,
            keys: keys.map((key) => {
              const stats = statisticsMap.get(key.id);
              // 用户可以查看和复制自己的密钥，管理员可以查看和复制所有密钥
              const canUserManageKey = isAdmin || session.user.id === user.id;
              return {
                id: key.id,
                name: key.name,
                maskedKey: maskKey(key.key),
                fullKey: canUserManageKey ? key.key : undefined,
                canCopy: canUserManageKey,
                expiresAt: key.expiresAt ? key.expiresAt.toISOString().split("T")[0] : "永不过期",
                status: key.isEnabled ? "enabled" : ("disabled" as const),
                createdAt: key.createdAt,
                createdAtFormatted: key.createdAt.toLocaleString("zh-CN", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }),
                todayUsage: usageMap.get(key.id) ?? 0,
                todayCallCount: stats?.todayCallCount ?? 0,
                lastUsedAt: stats?.lastUsedAt ?? null,
                lastProviderName: stats?.lastProviderName ?? null,
                modelStats: stats?.modelStats ?? [],
                // 限额配置
                limit5hUsd: key.limit5hUsd,
                limitWeeklyUsd: key.limitWeeklyUsd,
                limitMonthlyUsd: key.limitMonthlyUsd,
                limitConcurrentSessions: key.limitConcurrentSessions || 0,
              };
            }),
          };
        } catch (error) {
          logger.error(`获取用户 ${user.id} 的密钥失败:`, error);
          return {
            id: user.id,
            name: user.name,
            note: user.description || undefined,
            role: user.role,
            rpm: user.rpm,
            dailyQuota: user.dailyQuota,
            providerGroup: user.providerGroup || undefined,
            keys: [],
          };
        }
      })
    );

    return userDisplays;
  } catch (error) {
    logger.error("获取用户数据失败:", error);
    return [];
  }
}

// 添加用户
export async function addUser(data: {
  name: string;
  note?: string;
  providerGroup?: string | null;
  rpm?: number;
  dailyQuota?: number;
}): Promise<ActionResult> {
  try {
    // 权限检查：只有管理员可以添加用户
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" } as const;
    }

    const validatedData = CreateUserSchema.parse({
      name: data.name,
      note: data.note || "",
      providerGroup: data.providerGroup || "",
      rpm: data.rpm || USER_DEFAULTS.RPM,
      dailyQuota: data.dailyQuota || USER_DEFAULTS.DAILY_QUOTA,
    });

    const newUser = await createUser({
      name: validatedData.name,
      description: validatedData.note || "",
      providerGroup: validatedData.providerGroup || null,
      rpm: validatedData.rpm,
      dailyQuota: validatedData.dailyQuota,
    });

    // 为新用户创建默认密钥
    const generatedKey = "sk-" + randomBytes(16).toString("hex");
    await createKey({
      user_id: newUser.id,
      name: "default",
      key: generatedKey,
      is_enabled: true,
      expires_at: undefined,
    });

    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    logger.error("添加用户失败:", error);
    const message = error instanceof Error ? error.message : "添加用户失败，请稍后重试";
    return { ok: false, error: message };
  }
}

// 更新用户
export async function editUser(
  userId: number,
  data: {
    name?: string;
    note?: string;
    providerGroup?: string | null;
    rpm?: number;
    dailyQuota?: number;
  }
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedData = UpdateUserSchema.parse(data);

    await updateUser(userId, {
      name: validatedData.name,
      description: validatedData.note,
      providerGroup: validatedData.providerGroup,
      rpm: validatedData.rpm,
      dailyQuota: validatedData.dailyQuota,
    });

    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    logger.error("更新用户失败:", error);
    const message = error instanceof Error ? error.message : "更新用户失败，请稍后重试";
    return { ok: false, error: message };
  }
}

// 删除用户
export async function removeUser(userId: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    await deleteUser(userId);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    logger.error("删除用户失败:", error);
    const message = error instanceof Error ? error.message : "删除用户失败，请稍后重试";
    return { ok: false, error: message };
  }
}

/**
 * 获取用户限额使用情况
 */
export async function getUserLimitUsage(userId: number): Promise<
  ActionResult<{
    rpm: { current: number; limit: number; window: "per_minute" };
    dailyCost: { current: number; limit: number; resetAt: Date };
  }>
> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    const user = await findUserById(userId);
    if (!user) {
      return { ok: false, error: "用户不存在" };
    }

    // 权限检查：用户只能查看自己，管理员可以查看所有人
    if (session.user.role !== "admin" && session.user.id !== userId) {
      return { ok: false, error: "无权限执行此操作" };
    }

    // 动态导入避免循环依赖
    const { sumUserCostToday } = await import("@/repository/statistics");
    const { getDailyResetTime } = await import("@/lib/rate-limit/time-utils");

    // 获取当前 RPM 使用情况（从 Redis）
    // 注意：RPM 是实时的滑动窗口，无法直接获取"当前值"，这里返回 0
    // 实际的 RPM 检查在请求时进行
    const rpmCurrent = 0; // RPM 是动态滑动窗口，此处无法精确获取

    // 获取每日消费（直接查询数据库）
    const dailyCost = await sumUserCostToday(userId);

    return {
      ok: true,
      data: {
        rpm: {
          current: rpmCurrent,
          limit: user.rpm || 60,
          window: "per_minute",
        },
        dailyCost: {
          current: dailyCost,
          limit: user.dailyQuota || 100,
          resetAt: getDailyResetTime(),
        },
      },
    };
  } catch (error) {
    logger.error("获取用户限额使用情况失败:", error);
    const message = error instanceof Error ? error.message : "获取用户限额使用情况失败";
    return { ok: false, error: message };
  }
}
