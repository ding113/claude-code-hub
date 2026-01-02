"use server";

import { randomBytes } from "node:crypto";
import { and, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/drizzle/db";
import { users as usersTable } from "@/drizzle/schema";
import { getSession } from "@/lib/auth";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { logger } from "@/lib/logger";
import { getUnauthorizedFields } from "@/lib/permissions/user-field-permissions";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import { normalizeProviderGroup } from "@/lib/utils/provider-group";
import { maskKey } from "@/lib/utils/validation";
import { formatZodError } from "@/lib/utils/zod-i18n";
import { CreateUserSchema, UpdateUserSchema } from "@/lib/validation/schemas";
import {
  createKey,
  findKeyList,
  findKeyListBatch,
  findKeysWithStatisticsBatch,
  findKeyUsageTodayBatch,
} from "@/repository/key";
import {
  createUser,
  deleteUser,
  findUserById,
  findUserList,
  findUserListBatch,
  getAllUserProviderGroups as getAllUserProviderGroupsRepository,
  getAllUserTags as getAllUserTagsRepository,
  searchUsersForFilter as searchUsersForFilterRepository,
  updateUser,
} from "@/repository/user";
import type { User, UserDisplay } from "@/types/user";
import type { ActionResult } from "./types";

export interface GetUsersBatchParams {
  cursor?: number;
  limit?: number;
  searchTerm?: string;
  tagFilters?: string[];
  keyGroupFilters?: string[];
  statusFilter?: "all" | "active" | "expired" | "expiringSoon" | "enabled" | "disabled";
  sortBy?:
    | "name"
    | "tags"
    | "expiresAt"
    | "rpm"
    | "limit5hUsd"
    | "limitDailyUsd"
    | "limitWeeklyUsd"
    | "limitMonthlyUsd"
    | "createdAt";
  sortOrder?: "asc" | "desc";
}

export interface GetUsersBatchResult {
  users: UserDisplay[];
  nextCursor: number | null;
  hasMore: boolean;
}

export interface BatchUpdateResult {
  requestedCount: number;
  updatedCount: number;
  updatedIds: number[];
}

export interface BatchUpdateUsersParams {
  userIds: number[];
  updates: {
    note?: string;
    tags?: string[];
    rpm?: number | null;
    dailyQuota?: number | null;
    limit5hUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
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

/**
 * 根据用户名下所有 Key 的分组自动同步用户分组
 * 用户分组 = Key 分组的并集
 * 注意：该同步仅在 Key 变更（新增/编辑/删除）时由 Key Actions 触发。
 * @param userId - 用户 ID
 */
export async function syncUserProviderGroupFromKeys(userId: number): Promise<void> {
  // Note: This function intentionally does NOT catch errors.
  // Callers (addKey, editKey, removeKey, batchUpdateKeys) have their own error handling
  // and should fail explicitly if provider group sync fails to maintain data consistency.
  const keys = await findKeyList(userId);
  const allGroups = new Set<string>();

  for (const key of keys) {
    // NOTE(#400): Key.providerGroup is now required (no more null semantics).
    // For backward compatibility, treat null/empty as "default".
    const group = key.providerGroup || PROVIDER_GROUP.DEFAULT;
    group
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean)
      .forEach((g) => allGroups.add(g));
  }

  const newProviderGroup =
    allGroups.size > 0 ? Array.from(allGroups).sort().join(",") : PROVIDER_GROUP.DEFAULT;
  await updateUser(userId, { providerGroup: newProviderGroup });
  logger.info(
    `[UserAction] Synced user provider group: userId=${userId}, groups=${newProviderGroup}`
  );
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

    // Treat any non-admin role as non-admin for safety.
    const isAdmin = session.user.role === "admin";

    // 非 admin 用户只能看到自己的数据（从 DB 获取完整用户信息）
    let users: User[] = [];
    if (isAdmin) {
      users = await findUserList(); // 管理员可以看到所有用户
    } else {
      const selfUser = await findUserById(session.user.id);
      users = selfUser ? [selfUser] : [];
    }

    if (users.length === 0) {
      return [];
    }

    // 管理员可以看到完整Key，普通用户只能看到自己的 Key

    // === Batch queries optimization ===
    // Instead of N*3 queries (one per user for keys, usage, statistics),
    // we now do 3 batch queries total
    const userIds = users.map((u) => u.id);
    const [keysMap, usageMap, statisticsMap] = await Promise.all([
      findKeyListBatch(userIds),
      findKeyUsageTodayBatch(userIds),
      findKeysWithStatisticsBatch(userIds),
    ]);

    const userDisplays: UserDisplay[] = users.map((user) => {
      try {
        const keys = keysMap.get(user.id) || [];
        const usageRecords = usageMap.get(user.id) || [];
        const keyStatistics = statisticsMap.get(user.id) || [];

        const usageLookup = new Map(usageRecords.map((item) => [item.keyId, item.totalCost ?? 0]));
        const statisticsLookup = new Map(keyStatistics.map((stat) => [stat.keyId, stat]));

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
          dailyResetMode: user.dailyResetMode,
          dailyResetTime: user.dailyResetTime,
          isEnabled: user.isEnabled,
          expiresAt: user.expiresAt ?? null,
          allowedClients: user.allowedClients || [],
          allowedModels: user.allowedModels ?? [],
          keys: keys.map((key) => {
            const stats = statisticsLookup.get(key.id);
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
              todayUsage: usageLookup.get(key.id) ?? 0,
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
        logger.error(`Failed to process keys for user ${user.id}:`, error);
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
          dailyResetMode: user.dailyResetMode,
          dailyResetTime: user.dailyResetTime,
          isEnabled: user.isEnabled,
          expiresAt: user.expiresAt ?? null,
          allowedClients: user.allowedClients || [],
          allowedModels: user.allowedModels ?? [],
          keys: [],
        };
      }
    });

    return userDisplays;
  } catch (error) {
    logger.error("Failed to fetch user data:", error);
    return [];
  }
}

export async function searchUsersForFilter(
  searchTerm?: string
): Promise<ActionResult<Array<{ id: number; name: string }>>> {
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

    const users = await searchUsersForFilterRepository(searchTerm);
    return { ok: true, data: users };
  } catch (error) {
    logger.error("Failed to search users for filter:", error);
    const message = error instanceof Error ? error.message : "Failed to search users for filter";
    return { ok: false, error: message, errorCode: ERROR_CODES.DATABASE_ERROR };
  }
}

/**
 * 获取所有用户标签（用于标签筛选下拉框）
 * 返回所有用户的标签，不受当前筛选条件影响
 *
 * 注意：仅管理员可用。
 */
export async function getAllUserTags(): Promise<ActionResult<string[]>> {
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

    const tags = await getAllUserTagsRepository();
    return { ok: true, data: tags };
  } catch (error) {
    logger.error("Failed to get all user tags:", error);
    const message = error instanceof Error ? error.message : "Failed to get all user tags";
    return { ok: false, error: message, errorCode: ERROR_CODES.DATABASE_ERROR };
  }
}

/**
 * 获取所有用户密钥分组（用于密钥分组筛选下拉框）
 * 返回所有用户的分组，不受当前筛选条件影响
 *
 * 注意：仅管理员可用。
 */
export async function getAllUserKeyGroups(): Promise<ActionResult<string[]>> {
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

    const groups = await getAllUserProviderGroupsRepository();
    return { ok: true, data: groups };
  } catch (error) {
    logger.error("Failed to get all user provider groups:", error);
    const message =
      error instanceof Error ? error.message : "Failed to get all user provider groups";
    return { ok: false, error: message, errorCode: ERROR_CODES.DATABASE_ERROR };
  }
}

/**
 * 游标分页获取用户列表（用于无限滚动）
 *
 * 注意：仅管理员可用。
 */
export async function getUsersBatch(
  params: GetUsersBatchParams
): Promise<ActionResult<GetUsersBatchResult>> {
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

    const locale = await getLocale();
    const t = await getTranslations("users");

    const { users, nextCursor, hasMore } = await findUserListBatch({
      cursor: params.cursor,
      limit: params.limit,
      searchTerm: params.searchTerm,
      tagFilters: params.tagFilters,
      keyGroupFilters: params.keyGroupFilters,
      statusFilter: params.statusFilter,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
    });

    if (users.length === 0) {
      return { ok: true, data: { users: [], nextCursor, hasMore } };
    }

    const userIds = users.map((u) => u.id);
    const [keysMap, usageMap, statisticsMap] = await Promise.all([
      findKeyListBatch(userIds),
      findKeyUsageTodayBatch(userIds),
      findKeysWithStatisticsBatch(userIds),
    ]);

    const userDisplays: UserDisplay[] = users.map((user) => {
      try {
        const keys = keysMap.get(user.id) || [];
        const usageRecords = usageMap.get(user.id) || [];
        const keyStatistics = statisticsMap.get(user.id) || [];

        const usageLookup = new Map(usageRecords.map((item) => [item.keyId, item.totalCost ?? 0]));
        const statisticsLookup = new Map(keyStatistics.map((stat) => [stat.keyId, stat]));

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
          dailyResetMode: user.dailyResetMode,
          dailyResetTime: user.dailyResetTime,
          isEnabled: user.isEnabled,
          expiresAt: user.expiresAt ?? null,
          allowedClients: user.allowedClients || [],
          allowedModels: user.allowedModels ?? [],
          keys: keys.map((key) => {
            const stats = statisticsLookup.get(key.id);
            return {
              id: key.id,
              name: key.name,
              maskedKey: maskKey(key.key),
              fullKey: key.key,
              canCopy: true,
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
              todayUsage: usageLookup.get(key.id) ?? 0,
              todayCallCount: stats?.todayCallCount ?? 0,
              lastUsedAt: stats?.lastUsedAt ?? null,
              lastProviderName: stats?.lastProviderName ?? null,
              modelStats: stats?.modelStats ?? [],
              canLoginWebUi: key.canLoginWebUi,
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
        logger.error(`Failed to process keys for user ${user.id}:`, error);
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
          dailyResetMode: user.dailyResetMode,
          dailyResetTime: user.dailyResetTime,
          isEnabled: user.isEnabled,
          expiresAt: user.expiresAt ?? null,
          allowedClients: user.allowedClients || [],
          allowedModels: user.allowedModels ?? [],
          keys: [],
        };
      }
    });

    return { ok: true, data: { users: userDisplays, nextCursor, hasMore } };
  } catch (error) {
    logger.error("Failed to fetch user batch data:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch user batch data";
    return { ok: false, error: message, errorCode: ERROR_CODES.INTERNAL_ERROR };
  }
}

/**
 * 批量更新用户（事务保证原子性）
 *
 * 注意：仅管理员可用。
 */
export async function batchUpdateUsers(
  params: BatchUpdateUsersParams
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
    const requestedIds = Array.from(new Set(params.userIds)).filter((id) => Number.isInteger(id));
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

    const updatesSchema = UpdateUserSchema.pick({
      note: true,
      tags: true,
      rpm: true,
      dailyQuota: true,
      limit5hUsd: true,
      limitWeeklyUsd: true,
      limitMonthlyUsd: true,
    });

    const validationResult = updatesSchema.safeParse(params.updates ?? {});
    if (!validationResult.success) {
      return {
        ok: false,
        error: formatZodError(validationResult.error),
        errorCode: ERROR_CODES.INVALID_FORMAT,
      };
    }

    const updates = validationResult.data;
    const hasAnyUpdate = Object.values(updates).some((v) => v !== undefined);
    if (!hasAnyUpdate) {
      return { ok: false, error: tError("EMPTY_UPDATE"), errorCode: ERROR_CODES.EMPTY_UPDATE };
    }

    let updatedIds: number[] = [];

    await db.transaction(async (tx) => {
      const existingRows = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(inArray(usersTable.id, requestedIds), isNull(usersTable.deletedAt)));

      const existingSet = new Set(existingRows.map((r) => r.id));
      const missingIds = requestedIds.filter((id) => !existingSet.has(id));
      if (missingIds.length > 0) {
        throw new BatchUpdateError(
          `部分用户不存在: ${missingIds.join(", ")}`,
          ERROR_CODES.NOT_FOUND
        );
      }

      const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };

      if (updates.note !== undefined) dbUpdates.description = updates.note;
      if (updates.tags !== undefined) dbUpdates.tags = updates.tags;
      if (updates.rpm !== undefined) dbUpdates.rpmLimit = updates.rpm;
      if (updates.dailyQuota !== undefined)
        dbUpdates.dailyLimitUsd =
          updates.dailyQuota === null ? null : updates.dailyQuota.toString();
      if (updates.limit5hUsd !== undefined)
        dbUpdates.limit5hUsd = updates.limit5hUsd === null ? null : updates.limit5hUsd.toString();
      if (updates.limitWeeklyUsd !== undefined)
        dbUpdates.limitWeeklyUsd =
          updates.limitWeeklyUsd === null ? null : updates.limitWeeklyUsd.toString();
      if (updates.limitMonthlyUsd !== undefined)
        dbUpdates.limitMonthlyUsd =
          updates.limitMonthlyUsd === null ? null : updates.limitMonthlyUsd.toString();

      const updatedRows = await tx
        .update(usersTable)
        .set(dbUpdates)
        .where(and(inArray(usersTable.id, requestedIds), isNull(usersTable.deletedAt)))
        .returning({ id: usersTable.id });

      updatedIds = updatedRows.map((r) => r.id);

      if (updatedIds.length !== requestedIds.length) {
        throw new BatchUpdateError("批量更新失败：更新行数不匹配", ERROR_CODES.UPDATE_FAILED);
      }
    });

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

    logger.error("批量更新用户失败:", error);
    const message = error instanceof Error ? error.message : "批量更新用户失败";
    return { ok: false, error: message, errorCode: ERROR_CODES.UPDATE_FAILED };
  }
}

// 添加用户
export async function addUser(data: {
  name: string;
  note?: string;
  providerGroup?: string | null;
  tags?: string[];
  rpm?: number | null;
  dailyQuota?: number | null;
  limit5hUsd?: number | null;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number | null;
  dailyResetMode?: "fixed" | "rolling";
  dailyResetTime?: string;
  isEnabled?: boolean;
  expiresAt?: Date | null;
  allowedClients?: string[];
  allowedModels?: string[];
}): Promise<
  ActionResult<{
    user: {
      id: number;
      name: string;
      note?: string;
      role: string;
      isEnabled: boolean;
      expiresAt: Date | null;
      rpm: number | null;
      dailyQuota: number | null;
      providerGroup?: string;
      tags: string[];
      limit5hUsd: number | null;
      limitWeeklyUsd: number | null;
      limitMonthlyUsd: number | null;
      limitTotalUsd: number | null;
      limitConcurrentSessions: number | null;
      allowedModels: string[];
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
      rpm: data.rpm ?? null,
      dailyQuota: data.dailyQuota ?? null,
      limit5hUsd: data.limit5hUsd,
      limitWeeklyUsd: data.limitWeeklyUsd,
      limitMonthlyUsd: data.limitMonthlyUsd,
      limitTotalUsd: data.limitTotalUsd,
      limitConcurrentSessions: data.limitConcurrentSessions,
      dailyResetMode: data.dailyResetMode,
      dailyResetTime: data.dailyResetTime,
      isEnabled: data.isEnabled,
      expiresAt: data.expiresAt,
      allowedClients: data.allowedClients || [],
      allowedModels: data.allowedModels || [],
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
    const providerGroup = normalizeProviderGroup(validatedData.providerGroup);

    const newUser = await createUser({
      name: validatedData.name,
      description: validatedData.note || "",
      providerGroup,
      tags: validatedData.tags,
      rpm: validatedData.rpm,
      dailyQuota: validatedData.dailyQuota ?? undefined,
      limit5hUsd: validatedData.limit5hUsd ?? undefined,
      limitWeeklyUsd: validatedData.limitWeeklyUsd ?? undefined,
      limitMonthlyUsd: validatedData.limitMonthlyUsd ?? undefined,
      limitTotalUsd: validatedData.limitTotalUsd ?? undefined,
      limitConcurrentSessions: validatedData.limitConcurrentSessions ?? undefined,
      dailyResetMode: validatedData.dailyResetMode,
      dailyResetTime: validatedData.dailyResetTime,
      isEnabled: validatedData.isEnabled,
      expiresAt: validatedData.expiresAt ?? null,
      allowedClients: validatedData.allowedClients ?? [],
      allowedModels: validatedData.allowedModels ?? [],
    });

    // 为新用户创建默认密钥
    const generatedKey = `sk-${randomBytes(16).toString("hex")}`;
    const newKey = await createKey({
      user_id: newUser.id,
      name: "default",
      key: generatedKey,
      is_enabled: true,
      expires_at: undefined,
      provider_group: providerGroup,
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
          allowedModels: newUser.allowedModels ?? [],
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

// Create user without default key (for unified edit dialog create mode)
export async function createUserOnly(data: {
  name: string;
  note?: string;
  providerGroup?: string | null;
  tags?: string[];
  rpm?: number | null;
  dailyQuota?: number | null;
  limit5hUsd?: number | null;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number | null;
  dailyResetMode?: "fixed" | "rolling";
  dailyResetTime?: string;
  isEnabled?: boolean;
  expiresAt?: Date | null;
  allowedClients?: string[];
  allowedModels?: string[];
}): Promise<
  ActionResult<{
    user: {
      id: number;
      name: string;
      note?: string;
      role: string;
      isEnabled: boolean;
      expiresAt: Date | null;
      rpm: number | null;
      dailyQuota: number | null;
      providerGroup?: string;
      tags: string[];
      limit5hUsd: number | null;
      limitWeeklyUsd: number | null;
      limitMonthlyUsd: number | null;
      limitTotalUsd: number | null;
      limitConcurrentSessions: number | null;
    };
  }>
> {
  try {
    const tError = await getTranslations("errors");

    // Permission check: only admin can add users
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
      rpm: data.rpm ?? null,
      dailyQuota: data.dailyQuota ?? null,
      limit5hUsd: data.limit5hUsd,
      limitWeeklyUsd: data.limitWeeklyUsd,
      limitMonthlyUsd: data.limitMonthlyUsd,
      limitTotalUsd: data.limitTotalUsd,
      limitConcurrentSessions: data.limitConcurrentSessions,
      dailyResetMode: data.dailyResetMode,
      dailyResetTime: data.dailyResetTime,
      isEnabled: data.isEnabled,
      expiresAt: data.expiresAt,
      allowedClients: data.allowedClients || [],
      allowedModels: data.allowedModels || [],
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
    const providerGroup = normalizeProviderGroup(validatedData.providerGroup);

    const newUser = await createUser({
      name: validatedData.name,
      description: validatedData.note || "",
      providerGroup,
      tags: validatedData.tags,
      rpm: validatedData.rpm,
      dailyQuota: validatedData.dailyQuota ?? undefined,
      limit5hUsd: validatedData.limit5hUsd ?? undefined,
      limitWeeklyUsd: validatedData.limitWeeklyUsd ?? undefined,
      limitMonthlyUsd: validatedData.limitMonthlyUsd ?? undefined,
      limitTotalUsd: validatedData.limitTotalUsd ?? undefined,
      limitConcurrentSessions: validatedData.limitConcurrentSessions ?? undefined,
      dailyResetMode: validatedData.dailyResetMode,
      dailyResetTime: validatedData.dailyResetTime,
      isEnabled: validatedData.isEnabled,
      expiresAt: validatedData.expiresAt ?? null,
      allowedClients: validatedData.allowedClients ?? [],
      allowedModels: validatedData.allowedModels ?? [],
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
    rpm?: number | null;
    dailyQuota?: number | null;
    limit5hUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitTotalUsd?: number | null;
    limitConcurrentSessions?: number | null;
    dailyResetMode?: "fixed" | "rolling";
    dailyResetTime?: string;
    isEnabled?: boolean;
    expiresAt?: Date | null;
    allowedClients?: string[];
    allowedModels?: string[];
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

    const nextProviderGroup =
      validatedData.providerGroup === undefined
        ? undefined
        : normalizeProviderGroup(validatedData.providerGroup);

    // Update user with validated data
    await updateUser(userId, {
      name: validatedData.name,
      description: validatedData.note,
      ...(nextProviderGroup !== undefined ? { providerGroup: nextProviderGroup } : {}),
      tags: validatedData.tags,
      rpm: validatedData.rpm,
      dailyQuota: validatedData.dailyQuota,
      limit5hUsd: validatedData.limit5hUsd,
      limitWeeklyUsd: validatedData.limitWeeklyUsd,
      limitMonthlyUsd: validatedData.limitMonthlyUsd,
      limitTotalUsd: validatedData.limitTotalUsd,
      limitConcurrentSessions: validatedData.limitConcurrentSessions,
      dailyResetMode: validatedData.dailyResetMode,
      dailyResetTime: validatedData.dailyResetTime,
      isEnabled: validatedData.isEnabled,
      expiresAt: validatedData.expiresAt,
      allowedClients: validatedData.allowedClients,
      allowedModels: validatedData.allowedModels,
    });

    // 用户分组由 Key 分组自动计算，不再需要级联更新 Key 的 providerGroup

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
    rpm: { current: number; limit: number | null; window: "per_minute" };
    dailyCost: { current: number; limit: number | null; resetAt?: Date };
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
    const { sumUserCostInTimeRange } = await import("@/repository/statistics");
    const { getResetInfoWithMode, getTimeRangeForPeriodWithMode } = await import(
      "@/lib/rate-limit/time-utils"
    );

    // 获取当前 RPM 使用情况（从 Redis）
    // 注意：RPM 是实时的滑动窗口，无法直接获取"当前值"，这里返回 0
    // 实际的 RPM 检查在请求时进行
    const rpmCurrent = 0; // RPM 是动态滑动窗口，此处无法精确获取

    // 获取每日消费（使用用户的 dailyResetTime 和 dailyResetMode 配置）
    const resetTime = user.dailyResetTime ?? "00:00";
    const resetMode = user.dailyResetMode ?? "fixed";
    const { startTime, endTime } = getTimeRangeForPeriodWithMode("daily", resetTime, resetMode);
    const dailyCost = await sumUserCostInTimeRange(userId, startTime, endTime);
    const resetInfo = getResetInfoWithMode("daily", resetTime, resetMode);
    const resetAt = resetInfo.resetAt;

    return {
      ok: true,
      data: {
        rpm: {
          current: rpmCurrent,
          limit: user.rpm,
          window: "per_minute",
        },
        dailyCost: {
          current: dailyCost,
          limit: user.dailyQuota,
          resetAt,
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

    revalidatePath("/dashboard/users");
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

/**
 * 获取用户所有限额使用情况（用于限额百分比显示）
 * 返回各时间周期的使用量和限额
 */
export async function getUserAllLimitUsage(userId: number): Promise<
  ActionResult<{
    limit5h: { usage: number; limit: number | null };
    limitDaily: { usage: number; limit: number | null };
    limitWeekly: { usage: number; limit: number | null };
    limitMonthly: { usage: number; limit: number | null };
    limitTotal: { usage: number; limit: number | null };
  }>
> {
  try {
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

    // 动态导入
    const { getTimeRangeForPeriod } = await import("@/lib/rate-limit/time-utils");
    const { sumUserCostInTimeRange, sumUserTotalCost } = await import("@/repository/statistics");

    // 获取各时间范围
    const range5h = getTimeRangeForPeriod("5h");
    const rangeDaily = getTimeRangeForPeriod("daily", user.dailyResetTime || "00:00");
    const rangeWeekly = getTimeRangeForPeriod("weekly");
    const rangeMonthly = getTimeRangeForPeriod("monthly");

    // 并行查询各时间范围的消费
    const [usage5h, usageDaily, usageWeekly, usageMonthly, usageTotal] = await Promise.all([
      sumUserCostInTimeRange(userId, range5h.startTime, range5h.endTime),
      sumUserCostInTimeRange(userId, rangeDaily.startTime, rangeDaily.endTime),
      sumUserCostInTimeRange(userId, rangeWeekly.startTime, rangeWeekly.endTime),
      sumUserCostInTimeRange(userId, rangeMonthly.startTime, rangeMonthly.endTime),
      sumUserTotalCost(userId),
    ]);

    return {
      ok: true,
      data: {
        limit5h: { usage: usage5h, limit: user.limit5hUsd ?? null },
        limitDaily: { usage: usageDaily, limit: user.dailyQuota ?? null },
        limitWeekly: { usage: usageWeekly, limit: user.limitWeeklyUsd ?? null },
        limitMonthly: { usage: usageMonthly, limit: user.limitMonthlyUsd ?? null },
        limitTotal: { usage: usageTotal, limit: user.limitTotalUsd ?? null },
      },
    };
  } catch (error) {
    logger.error("Failed to fetch user all limit usage:", error);
    const tError = await getTranslations("errors");
    const message = error instanceof Error ? error.message : tError("GET_USER_QUOTA_FAILED");
    return { ok: false, error: message, errorCode: ERROR_CODES.OPERATION_FAILED };
  }
}
