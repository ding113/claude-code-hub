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
  updateKey,
} from "@/repository/key";
import { createUser, deleteUser, findUserById, findUserList, updateUser } from "@/repository/user";
import type { UserDisplay } from "@/types/user";
import type { ActionResult } from "./types";

/**
 * 验证过期时间的公共函数
 * @param expiresAt - 过期时间
 * @param tError - 翻译函数
 * @returns 验证结果,如果有错误返回错误信息和错误码
 */
async function validateExpiresAt(
  expiresAt: Date,
  tError: Awaited<ReturnType<typeof getTranslations<"errors">>>,
  options: { allowPast?: boolean } = {}
): Promise<{ error: string; errorCode: string } | null> {
  // 检查是否为有效日期
  if (Number.isNaN(expiresAt.getTime())) {
    return {
      error: tError("INVALID_FORMAT", { field: tError("EXPIRES_AT_FIELD") }),
      errorCode: ERROR_CODES.INVALID_FORMAT,
    };
  }

  // 拒绝过去或当前时间（可配置允许过去时间，用于立即让用户过期）
  const now = new Date();
  if (!options.allowPast && expiresAt <= now) {
    return {
      error: tError("EXPIRES_AT_MUST_BE_FUTURE"),
      errorCode: "EXPIRES_AT_MUST_BE_FUTURE",
    };
  }

  // 限制最大续期时长(10年)
  const maxExpiry = new Date(now);
  maxExpiry.setFullYear(maxExpiry.getFullYear() + 10);
  if (expiresAt > maxExpiry) {
    return {
      error: tError("EXPIRES_AT_TOO_FAR"),
      errorCode: "EXPIRES_AT_TOO_FAR",
    };
  }

  return null;
}

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
            isEnabled: user.isEnabled,
            expiresAt: user.expiresAt ?? null,
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
                providerGroup: key.providerGroup,
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
            isEnabled: user.isEnabled,
            expiresAt: user.expiresAt ?? null,
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
  isEnabled?: boolean;
  expiresAt?: Date | null;
}): Promise<
  ActionResult<{
    user: {
      id: number;
      name: string;
      note?: string;
      role: string;
      isEnabled: boolean;
      expiresAt: Date | null;
      rpm: number;
      dailyQuota: number;
      providerGroup?: string;
      tags: string[];
      limit5hUsd: number | null;
      limitWeeklyUsd: number | null;
      limitMonthlyUsd: number | null;
      limitTotalUsd: number | null;
      limitConcurrentSessions: number | null;
    };
    defaultKey: {
      id: number;
      name: string;
      key: string;
    };
  }>
> {
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
      isEnabled: data.isEnabled,
      expiresAt: data.expiresAt,
    });

    if (!validationResult.success) {
      const issue = validationResult.error.issues[0];
      const { code, params } = await import("@/lib/utils/error-messages").then((m) =>
        m.zodErrorToCode(issue.code, {
          minimum: "minimum" in issue ? issue.minimum : undefined,
          maximum: "maximum" in issue ? issue.maximum : undefined,
          type: "expected" in issue ? issue.expected : undefined,
          received: "received" in issue ? issue.received : undefined,
          validation: "validation" in issue ? issue.validation : undefined,
          path: issue.path,
          message: "message" in issue ? issue.message : undefined,
          params: "params" in issue ? issue.params : undefined,
        })
      );

      // For custom errors with nested field keys, translate them
      let translatedParams = params;
      if (issue.code === "custom" && params?.field && typeof params.field === "string") {
        try {
          translatedParams = {
            ...params,
            field: tError(params.field as string),
          };
        } catch {
          // Keep original if translation fails
        }
      }

      return {
        ok: false,
        error: formatZodError(validationResult.error),
        errorCode: code,
        errorParams: translatedParams,
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
      isEnabled: validatedData.isEnabled,
      expiresAt: validatedData.expiresAt ?? null,
    });

    // 为新用户创建默认密钥
    const generatedKey = `sk-${randomBytes(16).toString("hex")}`;
    const newKey = await createKey({
      user_id: newUser.id,
      name: "default",
      key: generatedKey,
      is_enabled: true,
      expires_at: undefined,
    });

    revalidatePath("/dashboard");
    return {
      ok: true,
      data: {
        user: {
          id: newUser.id,
          name: newUser.name,
          note: newUser.description || undefined,
          role: newUser.role,
          isEnabled: newUser.isEnabled,
          expiresAt: newUser.expiresAt ?? null,
          rpm: newUser.rpm,
          dailyQuota: newUser.dailyQuota,
          providerGroup: newUser.providerGroup || undefined,
          tags: newUser.tags || [],
          limit5hUsd: newUser.limit5hUsd ?? null,
          limitWeeklyUsd: newUser.limitWeeklyUsd ?? null,
          limitMonthlyUsd: newUser.limitMonthlyUsd ?? null,
          limitTotalUsd: newUser.limitTotalUsd ?? null,
          limitConcurrentSessions: newUser.limitConcurrentSessions ?? null,
        },
        defaultKey: {
          id: newKey.id,
          name: newKey.name,
          key: generatedKey, // 返回完整密钥（仅此一次）
        },
      },
    };
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
    isEnabled?: boolean;
    expiresAt?: Date | null;
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
      const issue = validationResult.error.issues[0];
      const { code, params } = await import("@/lib/utils/error-messages").then((m) =>
        m.zodErrorToCode(issue.code, {
          minimum: "minimum" in issue ? issue.minimum : undefined,
          maximum: "maximum" in issue ? issue.maximum : undefined,
          type: "expected" in issue ? issue.expected : undefined,
          received: "received" in issue ? issue.received : undefined,
          validation: "validation" in issue ? issue.validation : undefined,
          path: issue.path,
          message: "message" in issue ? issue.message : undefined,
          params: "params" in issue ? issue.params : undefined,
        })
      );

      // For custom errors with nested field keys, translate them
      let translatedParams = params;
      if (issue.code === "custom" && params?.field && typeof params.field === "string") {
        try {
          translatedParams = {
            ...params,
            field: tError(params.field as string),
          };
        } catch {
          // Keep original if translation fails
        }
      }

      return {
        ok: false,
        error: formatZodError(validationResult.error),
        errorCode: code,
        errorParams: translatedParams,
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

    // 在更新前获取旧用户数据（用于级联更新判断）
    const oldUserForCascade = data.providerGroup !== undefined ? await findUserById(userId) : null;

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
      isEnabled: validatedData.isEnabled,
      expiresAt: validatedData.expiresAt,
    });

    // 级联更新 KEY 的 providerGroup（仅针对减少场景）
    if (oldUserForCascade && data.providerGroup !== undefined) {
      // 只有在 providerGroup 真正变化时才级联更新
      if (oldUserForCascade.providerGroup !== data.providerGroup) {
        const oldUserGroups = oldUserForCascade.providerGroup
          ? oldUserForCascade.providerGroup
              .split(",")
              .map((g) => g.trim())
              .filter(Boolean)
          : [];

        const newUserGroups = data.providerGroup
          ? data.providerGroup
              .split(",")
              .map((g) => g.trim())
              .filter(Boolean)
          : [];

        // 计算被移除的分组
        const removedGroups = oldUserGroups.filter((g) => !newUserGroups.includes(g));

        // 如果没有移除分组（只新增），直接跳过
        if (removedGroups.length === 0) {
          logger.debug(`用户 ${userId} 的 providerGroup 只新增分组，无需级联更新 KEY`);
        } else {
          // 有移除分组，需要级联更新 KEY
          logger.info(
            `用户 ${userId} 移除了供应商分组: ${removedGroups.join(",")}，开始级联更新 KEY`
          );

          // 获取该用户的所有 KEY
          const userKeys = await findKeyList(userId);

          for (const key of userKeys) {
            if (!key.providerGroup) {
              // KEY 未设置 providerGroup，继承用户配置，无需更新
              continue;
            }

            // 解析 KEY 的分组列表
            const keyGroups = key.providerGroup
              .split(",")
              .map((g) => g.trim())
              .filter(Boolean);

            // 检查 KEY 是否包含被移除的分组
            const hasRemovedGroups = keyGroups.some((g) => removedGroups.includes(g));
            if (!hasRemovedGroups) {
              // KEY 不包含被移除的分组，无需更新
              continue;
            }

            // 过滤：只保留在用户新范围内的分组
            const filteredGroups = keyGroups.filter((g) => newUserGroups.includes(g));

            // 计算新值
            const newKeyProviderGroup = filteredGroups.length > 0 ? filteredGroups.join(",") : null;

            // 如果值发生变化，更新 KEY
            if (newKeyProviderGroup !== key.providerGroup) {
              await updateKey(key.id, {
                provider_group: newKeyProviderGroup,
              });

              logger.info(`级联更新 KEY ${key.id} 的 providerGroup`, {
                keyName: key.name,
                oldValue: key.providerGroup,
                newValue: newKeyProviderGroup,
                removedGroups: removedGroups.join(","),
                reason: "用户 providerGroup 减少",
              });
            }
          }
        }
      }
    }

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

/**
 * 续期用户（延长过期时间）
 */
export async function renewUser(
  userId: number,
  data: {
    expiresAt: string; // ISO 8601 string to avoid serialization issues
    enableUser?: boolean; // 是否同时启用用户
  }
): Promise<ActionResult> {
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

    // Parse and validate expiration date
    const expiresAt = new Date(data.expiresAt);

    // 验证过期时间
    const validationResult = await validateExpiresAt(expiresAt, tError);
    if (validationResult) {
      return {
        ok: false,
        error: validationResult.error,
        errorCode: validationResult.errorCode,
      };
    }

    // 检查用户是否存在
    const user = await findUserById(userId);
    if (!user) {
      return {
        ok: false,
        error: tError("USER_NOT_FOUND"),
        errorCode: ERROR_CODES.NOT_FOUND,
      };
    }

    // Update user expiration date and optionally enable user
    const updateData: {
      expiresAt: Date;
      isEnabled?: boolean;
    } = {
      expiresAt,
    };

    if (data.enableUser === true) {
      updateData.isEnabled = true;
    }

    const updated = await updateUser(userId, updateData);
    if (!updated) {
      return {
        ok: false,
        error: tError("USER_NOT_FOUND"),
        errorCode: ERROR_CODES.NOT_FOUND,
      };
    }

    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    logger.error("Failed to renew user:", error);
    const tError = await getTranslations("errors");
    const message = error instanceof Error ? error.message : tError("UPDATE_USER_FAILED");
    return {
      ok: false,
      error: message,
      errorCode: ERROR_CODES.UPDATE_FAILED,
    };
  }
}

/**
 * 切换用户启用/禁用状态
 */
export async function toggleUserEnabled(userId: number, enabled: boolean): Promise<ActionResult> {
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

    // Prevent disabling self
    if (session.user.id === userId && !enabled) {
      return {
        ok: false,
        error: tError("CANNOT_DISABLE_SELF"),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    await updateUser(userId, { isEnabled: enabled });

    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    logger.error("Failed to toggle user enabled status:", error);
    const tError = await getTranslations("errors");
    const message = error instanceof Error ? error.message : tError("UPDATE_USER_FAILED");
    return {
      ok: false,
      error: message,
      errorCode: ERROR_CODES.UPDATE_FAILED,
    };
  }
}
