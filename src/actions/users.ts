"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { USER_DEFAULTS } from "@/lib/constants/user.constants";
import { logger } from "@/lib/logger";
import { getUnauthorizedFields } from "@/lib/permissions/user-field-permissions";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import { maskKey } from "@/lib/utils/validation";
import { formatZodError } from "@/lib/utils/zod-i18n";
import { CreateUserSchema, UpdateUserSchema } from "@/lib/validation/schemas";
import {
  createKey,
  findKeyList,
  findKeysWithStatistics,
  findKeyUsageToday,
} from "@/repository/key";
import { createUser, deleteUser, findUserById, findUserList, updateUser } from "@/repository/user";
import type { UserDisplay } from "@/types/user";
import type { ActionResult } from "./types";

// 获取用户数据
export async function getUsers(): Promise<UserDisplay[]> {
  try {
    const session = await getSession();
    if (!session) {
      return [];
    }

    // Get current locale and translations
    const locale = await getLocale();
    const t = await getTranslations("users");

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
            tags: user.tags || [],
            limit5hUsd: user.limit5hUsd ?? null,
            limitWeeklyUsd: user.limitWeeklyUsd ?? null,
            limitMonthlyUsd: user.limitMonthlyUsd ?? null,
            limitTotalUsd: user.limitTotalUsd ?? null,
            limitConcurrentSessions: user.limitConcurrentSessions ?? null,
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
                expiresAt: key.expiresAt
                  ? key.expiresAt.toISOString().split("T")[0]
                  : t("neverExpires"),
                status: key.isEnabled ? "enabled" : ("disabled" as const),
                createdAt: key.createdAt,
                createdAtFormatted: key.createdAt.toLocaleString(locale, {
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
                // Web UI 登录权限控制
                canLoginWebUi: key.canLoginWebUi,
                // 限额配置
                limit5hUsd: key.limit5hUsd,
                limitDailyUsd: key.limitDailyUsd,
                dailyResetMode: key.dailyResetMode,
                dailyResetTime: key.dailyResetTime,
                limitWeeklyUsd: key.limitWeeklyUsd,
                limitMonthlyUsd: key.limitMonthlyUsd,
                limitTotalUsd: key.limitTotalUsd,
                limitConcurrentSessions: key.limitConcurrentSessions || 0,
              };
            }),
          };
        } catch (error) {
          logger.error(`Failed to fetch keys for user ${user.id}:`, error);
          return {
            id: user.id,
            name: user.name,
            note: user.description || undefined,
            role: user.role,
            rpm: user.rpm,
            dailyQuota: user.dailyQuota,
            providerGroup: user.providerGroup || undefined,
            tags: user.tags || [],
            limit5hUsd: user.limit5hUsd ?? null,
            limitWeeklyUsd: user.limitWeeklyUsd ?? null,
            limitMonthlyUsd: user.limitMonthlyUsd ?? null,
            limitTotalUsd: user.limitTotalUsd ?? null,
            limitConcurrentSessions: user.limitConcurrentSessions ?? null,
            keys: [],
          };
        }
      })
    );

    return userDisplays;
  } catch (error) {
    logger.error("Failed to fetch user data:", error);
    return [];
  }
}

// 添加用户
export async function addUser(data: {
  name: string;
  note?: string;
  providerGroup?: string | null;
  tags?: string[];
  rpm?: number;
  dailyQuota?: number;
  limit5hUsd?: number | null;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number | null;
}): Promise<ActionResult> {
  try {
    // Get translations for error messages
    const tError = await getTranslations("errors");

    // 权限检查：只有管理员可以添加用户
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: tError("PERMISSION_DENIED"),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    // Validate data with Zod
    const validationResult = CreateUserSchema.safeParse({
      name: data.name,
      note: data.note || "",
      providerGroup: data.providerGroup || "",
      tags: data.tags || [],
      rpm: data.rpm || USER_DEFAULTS.RPM,
      dailyQuota: data.dailyQuota || USER_DEFAULTS.DAILY_QUOTA,
      limit5hUsd: data.limit5hUsd,
      limitWeeklyUsd: data.limitWeeklyUsd,
      limitMonthlyUsd: data.limitMonthlyUsd,
      limitTotalUsd: data.limitTotalUsd,
      limitConcurrentSessions: data.limitConcurrentSessions,
    });

    if (!validationResult.success) {
      return {
        ok: false,
        error: formatZodError(validationResult.error),
        errorCode: ERROR_CODES.INVALID_FORMAT,
      };
    }

    const validatedData = validationResult.data;

    const newUser = await createUser({
      name: validatedData.name,
      description: validatedData.note || "",
      providerGroup: validatedData.providerGroup || null,
      tags: validatedData.tags,
      rpm: validatedData.rpm,
      dailyQuota: validatedData.dailyQuota,
      limit5hUsd: validatedData.limit5hUsd ?? undefined,
      limitWeeklyUsd: validatedData.limitWeeklyUsd ?? undefined,
      limitMonthlyUsd: validatedData.limitMonthlyUsd ?? undefined,
      limitTotalUsd: validatedData.limitTotalUsd ?? undefined,
      limitConcurrentSessions: validatedData.limitConcurrentSessions ?? undefined,
    });

    // 为新用户创建默认密钥
    const generatedKey = `sk-${randomBytes(16).toString("hex")}`;
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
    logger.error("Failed to create user:", error);
    const tError = await getTranslations("errors");
    const message = error instanceof Error ? error.message : tError("CREATE_USER_FAILED");
    return {
      ok: false,
      error: message,
      errorCode: ERROR_CODES.CREATE_FAILED,
    };
  }
}

// 更新用户
export async function editUser(
  userId: number,
  data: {
    name?: string;
    note?: string;
    providerGroup?: string | null;
    tags?: string[];
    rpm?: number;
    dailyQuota?: number;
    limit5hUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitTotalUsd?: number | null;
    limitConcurrentSessions?: number | null;
  }
): Promise<ActionResult> {
  try {
    // Get translations for error messages
    const tError = await getTranslations("errors");

    const session = await getSession();
    if (!session) {
      return {
        ok: false,
        error: tError("UNAUTHORIZED"),
        errorCode: ERROR_CODES.UNAUTHORIZED,
      };
    }

    // Validate data with Zod first
    const validationResult = UpdateUserSchema.safeParse(data);

    if (!validationResult.success) {
      return {
        ok: false,
        error: formatZodError(validationResult.error),
        errorCode: ERROR_CODES.INVALID_FORMAT,
      };
    }

    const validatedData = validationResult.data;

    // Permission check: Get unauthorized fields based on user role
    const unauthorizedFields = getUnauthorizedFields(validatedData, session.user.role);

    if (unauthorizedFields.length > 0) {
      return {
        ok: false,
        error: `${tError("PERMISSION_DENIED")}: ${unauthorizedFields.join(", ")}`,
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    // Additional check: Non-admin users can only modify their own data
    if (session.user.role !== "admin" && session.user.id !== userId) {
      return {
        ok: false,
        error: tError("PERMISSION_DENIED"),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    // Update user with validated data
    await updateUser(userId, {
      name: validatedData.name,
      description: validatedData.note,
      providerGroup: validatedData.providerGroup,
      tags: validatedData.tags,
      rpm: validatedData.rpm,
      dailyQuota: validatedData.dailyQuota,
      limit5hUsd: validatedData.limit5hUsd ?? undefined,
      limitWeeklyUsd: validatedData.limitWeeklyUsd ?? undefined,
      limitMonthlyUsd: validatedData.limitMonthlyUsd ?? undefined,
      limitTotalUsd: validatedData.limitTotalUsd ?? undefined,
      limitConcurrentSessions: validatedData.limitConcurrentSessions ?? undefined,
    });

    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    logger.error("Failed to update user:", error);
    const tError = await getTranslations("errors");
    const message = error instanceof Error ? error.message : tError("UPDATE_USER_FAILED");
    return {
      ok: false,
      error: message,
      errorCode: ERROR_CODES.UPDATE_FAILED,
    };
  }
}

// 删除用户
export async function removeUser(userId: number): Promise<ActionResult> {
  try {
    // Get translations for error messages
    const tError = await getTranslations("errors");

    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: tError("PERMISSION_DENIED"),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    await deleteUser(userId);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    logger.error("Failed to delete user:", error);
    const tError = await getTranslations("errors");
    const message = error instanceof Error ? error.message : tError("DELETE_USER_FAILED");
    return { ok: false, error: message, errorCode: ERROR_CODES.DELETE_FAILED };
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
    // Get translations for error messages
    const tError = await getTranslations("errors");

    const session = await getSession();
    if (!session) {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const user = await findUserById(userId);
    if (!user) {
      return { ok: false, error: tError("USER_NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    // 权限检查：用户只能查看自己，管理员可以查看所有人
    if (session.user.role !== "admin" && session.user.id !== userId) {
      return {
        ok: false,
        error: tError("PERMISSION_DENIED"),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
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
    logger.error("Failed to fetch user limit usage:", error);
    const tError = await getTranslations("errors");
    const message = error instanceof Error ? error.message : tError("GET_USER_QUOTA_FAILED");
    return { ok: false, error: message, errorCode: ERROR_CODES.OPERATION_FAILED };
  }
}
