"use server";

import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys as keysTable, users } from "@/drizzle/schema";
import type { CreateUserData, UpdateUserData, User } from "@/types/user";
import { toUser } from "./_shared/transformers";

export interface UserListBatchFilters {
  /** Offset pagination cursor */
  cursor?: number;
  /** Page size */
  limit?: number;
  /** Search in username / note */
  searchTerm?: string;
  /** Filter by multiple tags (OR logic: users with ANY selected tag) */
  tagFilters?: string[];
  /** Filter by provider group (derived from keys) */
  keyGroupFilters?: string[];
  /** Filter by user status */
  statusFilter?: "all" | "active" | "expired" | "expiringSoon" | "enabled" | "disabled";
  /** Sort field */
  sortBy?:
    | "name"
    | "tags"
    | "expiresAt"
    | "limit5hUsd"
    | "limitDailyUsd"
    | "limitWeeklyUsd"
    | "limitMonthlyUsd"
    | "createdAt";
  /** Sort direction */
  sortOrder?: "asc" | "desc";
}

export interface UserListBatchResult {
  users: User[];
  nextCursor: number | null;
  hasMore: boolean;
}

export async function createUser(userData: CreateUserData): Promise<User> {
  const dbData = {
    name: userData.name,
    description: userData.description,
    rpmLimit: userData.rpm,
    dailyLimitUsd: userData.dailyQuota?.toString(),
    providerGroup: userData.providerGroup,
    tags: userData.tags ?? [],
    limit5hUsd: userData.limit5hUsd?.toString(),
    limitWeeklyUsd: userData.limitWeeklyUsd?.toString(),
    limitMonthlyUsd: userData.limitMonthlyUsd?.toString(),
    limitTotalUsd: userData.limitTotalUsd?.toString(),
    limitConcurrentSessions: userData.limitConcurrentSessions,
    dailyResetMode: userData.dailyResetMode ?? "fixed",
    dailyResetTime: userData.dailyResetTime ?? "00:00",
    isEnabled: userData.isEnabled ?? true,
    expiresAt: userData.expiresAt ?? null,
    allowedClients: userData.allowedClients ?? [],
    allowedModels: userData.allowedModels ?? [],
  };

  const [user] = await db.insert(users).values(dbData).returning({
    id: users.id,
    name: users.name,
    description: users.description,
    role: users.role,
    rpm: users.rpmLimit,
    dailyQuota: users.dailyLimitUsd,
    providerGroup: users.providerGroup,
    tags: users.tags,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
    deletedAt: users.deletedAt,
    limit5hUsd: users.limit5hUsd,
    limitWeeklyUsd: users.limitWeeklyUsd,
    limitMonthlyUsd: users.limitMonthlyUsd,
    limitTotalUsd: users.limitTotalUsd,
    limitConcurrentSessions: users.limitConcurrentSessions,
    dailyResetMode: users.dailyResetMode,
    dailyResetTime: users.dailyResetTime,
    isEnabled: users.isEnabled,
    expiresAt: users.expiresAt,
    allowedClients: users.allowedClients,
    allowedModels: users.allowedModels,
  });

  return toUser(user);
}

export async function findUserList(limit: number = 50, offset: number = 0): Promise<User[]> {
  const result = await db
    .select({
      id: users.id,
      name: users.name,
      description: users.description,
      role: users.role,
      rpm: users.rpmLimit,
      dailyQuota: users.dailyLimitUsd,
      providerGroup: users.providerGroup,
      tags: users.tags,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deletedAt: users.deletedAt,
      limit5hUsd: users.limit5hUsd,
      limitWeeklyUsd: users.limitWeeklyUsd,
      limitMonthlyUsd: users.limitMonthlyUsd,
      limitTotalUsd: users.limitTotalUsd,
      limitConcurrentSessions: users.limitConcurrentSessions,
      dailyResetMode: users.dailyResetMode,
      dailyResetTime: users.dailyResetTime,
      isEnabled: users.isEnabled,
      expiresAt: users.expiresAt,
      allowedClients: users.allowedClients,
      allowedModels: users.allowedModels,
    })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(sql`CASE WHEN ${users.role} = 'admin' THEN 0 ELSE 1 END`, users.id)
    .limit(limit)
    .offset(offset);

  return result.map(toUser);
}

export async function searchUsersForFilter(
  searchTerm?: string
): Promise<Array<{ id: number; name: string }>> {
  const conditions = [isNull(users.deletedAt)];

  const trimmedSearchTerm = searchTerm?.trim();
  if (trimmedSearchTerm) {
    const pattern = `%${trimmedSearchTerm}%`;
    conditions.push(sql`${users.name} ILIKE ${pattern}`);
  }

  return db
    .select({
      id: users.id,
      name: users.name,
    })
    .from(users)
    .where(and(...conditions))
    .orderBy(sql`CASE WHEN ${users.role} = 'admin' THEN 0 ELSE 1 END`, users.id);
}

/**
 * Offset-based pagination for user list.
 */
export async function findUserListBatch(
  filters: UserListBatchFilters
): Promise<UserListBatchResult> {
  const {
    cursor,
    limit = 50,
    searchTerm,
    tagFilters,
    keyGroupFilters,
    statusFilter,
    sortBy = "createdAt",
    sortOrder = "asc",
  } = filters;

  const conditions = [isNull(users.deletedAt)];

  const trimmedSearch = searchTerm?.trim();
  if (trimmedSearch) {
    const pattern = `%${trimmedSearch}%`;
    conditions.push(sql`(
      ${users.name} ILIKE ${pattern}
      OR ${users.description} ILIKE ${pattern}
      OR ${users.providerGroup} ILIKE ${pattern}
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(${users.tags}, '[]'::jsonb)) AS tag
        WHERE tag ILIKE ${pattern}
      )
      OR EXISTS (
        SELECT 1
        FROM ${keysTable}
        WHERE ${keysTable.userId} = ${users.id}
          AND ${keysTable.deletedAt} IS NULL
          AND (
            ${keysTable.name} ILIKE ${pattern}
            OR ${keysTable.key} ILIKE ${pattern}
            OR ${keysTable.providerGroup} ILIKE ${pattern}
          )
      )
    )`);
  }

  // Multi-tag filter with OR logic: users with ANY selected tag
  const normalizedTags = (tagFilters ?? []).map((tag) => tag.trim()).filter(Boolean);
  let tagFilterCondition: SQL | undefined;
  if (normalizedTags.length > 0) {
    const tagConditions = normalizedTags.map(
      (tag) => sql`${users.tags} @> ${JSON.stringify([tag])}::jsonb`
    );
    tagFilterCondition = sql`(${sql.join(tagConditions, sql` OR `)})`;
  }

  const trimmedGroups = (keyGroupFilters ?? []).map((group) => group.trim()).filter(Boolean);
  let keyGroupFilterCondition: SQL | undefined;
  if (trimmedGroups.length > 0) {
    const groupConditions = trimmedGroups.map(
      (group) =>
        sql`${group} = ANY(regexp_split_to_array(coalesce(${users.providerGroup}, ''), '\\s*,\\s*'))`
    );
    keyGroupFilterCondition = sql`(${sql.join(groupConditions, sql` OR `)})`;
  }

  if (tagFilterCondition && keyGroupFilterCondition) {
    conditions.push(sql`(${tagFilterCondition} OR ${keyGroupFilterCondition})`);
  } else if (tagFilterCondition) {
    conditions.push(tagFilterCondition);
  } else if (keyGroupFilterCondition) {
    conditions.push(keyGroupFilterCondition);
  }

  // Status filter
  if (statusFilter && statusFilter !== "all") {
    switch (statusFilter) {
      case "active":
        // User is enabled and either never expires or expires in the future
        conditions.push(
          sql`(${users.expiresAt} IS NULL OR ${users.expiresAt} >= NOW()) AND ${users.isEnabled} = true`
        );
        break;
      case "expired":
        // User has expired (expiresAt is in the past)
        conditions.push(sql`${users.expiresAt} < NOW()`);
        break;
      case "expiringSoon":
        // User expires within 7 days
        conditions.push(
          sql`${users.expiresAt} IS NOT NULL AND ${users.expiresAt} >= NOW() AND ${users.expiresAt} <= NOW() + INTERVAL '7 days'`
        );
        break;
      case "enabled":
        // User is enabled regardless of expiration
        conditions.push(sql`${users.isEnabled} = true`);
        break;
      case "disabled":
        // User is disabled
        conditions.push(sql`${users.isEnabled} = false`);
        break;
    }
  }

  const offset = Math.max(cursor ?? 0, 0);

  // Fetch limit + 1 to determine if there are more records
  const fetchLimit = limit + 1;

  // Build dynamic ORDER BY based on sortBy and sortOrder
  const sortColumn = {
    name: users.name,
    tags: users.tags,
    expiresAt: users.expiresAt,
    limit5hUsd: users.limit5hUsd,
    limitDailyUsd: users.dailyLimitUsd,
    limitWeeklyUsd: users.limitWeeklyUsd,
    limitMonthlyUsd: users.limitMonthlyUsd,
    createdAt: users.createdAt,
  }[sortBy];

  const orderByClause = sortOrder === "asc" ? asc(sortColumn) : sql`${sortColumn} DESC`;

  const results = await db
    .select({
      id: users.id,
      name: users.name,
      description: users.description,
      role: users.role,
      rpm: users.rpmLimit,
      dailyQuota: users.dailyLimitUsd,
      providerGroup: users.providerGroup,
      tags: users.tags,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deletedAt: users.deletedAt,
      limit5hUsd: users.limit5hUsd,
      limitWeeklyUsd: users.limitWeeklyUsd,
      limitMonthlyUsd: users.limitMonthlyUsd,
      limitTotalUsd: users.limitTotalUsd,
      limitConcurrentSessions: users.limitConcurrentSessions,
      dailyResetMode: users.dailyResetMode,
      dailyResetTime: users.dailyResetTime,
      isEnabled: users.isEnabled,
      expiresAt: users.expiresAt,
      allowedClients: users.allowedClients,
      allowedModels: users.allowedModels,
    })
    .from(users)
    .where(and(...conditions))
    .orderBy(orderByClause, asc(users.id))
    .limit(fetchLimit)
    .offset(offset);

  const hasMore = results.length > limit;
  const usersToReturn = hasMore ? results.slice(0, limit) : results;

  const nextCursor = hasMore ? offset + limit : null;

  return {
    users: usersToReturn.map(toUser),
    nextCursor,
    hasMore,
  };
}

export async function findUserById(id: number): Promise<User | null> {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      description: users.description,
      role: users.role,
      rpm: users.rpmLimit,
      dailyQuota: users.dailyLimitUsd,
      providerGroup: users.providerGroup,
      tags: users.tags,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deletedAt: users.deletedAt,
      limit5hUsd: users.limit5hUsd,
      limitWeeklyUsd: users.limitWeeklyUsd,
      limitMonthlyUsd: users.limitMonthlyUsd,
      limitTotalUsd: users.limitTotalUsd,
      limitConcurrentSessions: users.limitConcurrentSessions,
      dailyResetMode: users.dailyResetMode,
      dailyResetTime: users.dailyResetTime,
      isEnabled: users.isEnabled,
      expiresAt: users.expiresAt,
      allowedClients: users.allowedClients,
      allowedModels: users.allowedModels,
    })
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)));

  if (!user) return null;

  return toUser(user);
}

export async function updateUser(id: number, userData: UpdateUserData): Promise<User | null> {
  if (Object.keys(userData).length === 0) {
    return findUserById(id);
  }

  interface UpdateDbData {
    name?: string;
    description?: string;
    rpmLimit?: number;
    dailyLimitUsd?: string | null;
    providerGroup?: string | null;
    tags?: string[];
    updatedAt?: Date;
    limit5hUsd?: string | null;
    limitWeeklyUsd?: string | null;
    limitMonthlyUsd?: string | null;
    limitTotalUsd?: string | null;
    limitConcurrentSessions?: number | null;
    dailyResetMode?: "fixed" | "rolling";
    dailyResetTime?: string;
    isEnabled?: boolean;
    expiresAt?: Date | null;
    allowedClients?: string[];
    allowedModels?: string[];
  }

  const dbData: UpdateDbData = {
    updatedAt: new Date(),
  };
  if (userData.name !== undefined) dbData.name = userData.name;
  if (userData.description !== undefined) dbData.description = userData.description;
  if (userData.rpm !== undefined) dbData.rpmLimit = userData.rpm;
  if (userData.dailyQuota !== undefined)
    dbData.dailyLimitUsd = userData.dailyQuota === null ? null : userData.dailyQuota.toString();
  if (userData.providerGroup !== undefined) dbData.providerGroup = userData.providerGroup;
  if (userData.tags !== undefined) dbData.tags = userData.tags;
  if (userData.limit5hUsd !== undefined)
    dbData.limit5hUsd = userData.limit5hUsd === null ? null : userData.limit5hUsd.toString();
  if (userData.limitWeeklyUsd !== undefined)
    dbData.limitWeeklyUsd =
      userData.limitWeeklyUsd === null ? null : userData.limitWeeklyUsd.toString();
  if (userData.limitMonthlyUsd !== undefined)
    dbData.limitMonthlyUsd =
      userData.limitMonthlyUsd === null ? null : userData.limitMonthlyUsd.toString();
  if (userData.limitTotalUsd !== undefined)
    dbData.limitTotalUsd =
      userData.limitTotalUsd === null ? null : userData.limitTotalUsd.toString();
  if (userData.limitConcurrentSessions !== undefined)
    dbData.limitConcurrentSessions = userData.limitConcurrentSessions;
  if (userData.dailyResetMode !== undefined) dbData.dailyResetMode = userData.dailyResetMode;
  if (userData.dailyResetTime !== undefined) dbData.dailyResetTime = userData.dailyResetTime;
  if (userData.isEnabled !== undefined) dbData.isEnabled = userData.isEnabled;
  if (userData.expiresAt !== undefined) dbData.expiresAt = userData.expiresAt;
  if (userData.allowedClients !== undefined) dbData.allowedClients = userData.allowedClients;
  if (userData.allowedModels !== undefined) dbData.allowedModels = userData.allowedModels;

  const [user] = await db
    .update(users)
    .set(dbData)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning({
      id: users.id,
      name: users.name,
      description: users.description,
      role: users.role,
      rpm: users.rpmLimit,
      dailyQuota: users.dailyLimitUsd,
      providerGroup: users.providerGroup,
      tags: users.tags,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deletedAt: users.deletedAt,
      limit5hUsd: users.limit5hUsd,
      limitWeeklyUsd: users.limitWeeklyUsd,
      limitMonthlyUsd: users.limitMonthlyUsd,
      limitTotalUsd: users.limitTotalUsd,
      limitConcurrentSessions: users.limitConcurrentSessions,
      dailyResetMode: users.dailyResetMode,
      dailyResetTime: users.dailyResetTime,
      isEnabled: users.isEnabled,
      expiresAt: users.expiresAt,
      allowedClients: users.allowedClients,
      allowedModels: users.allowedModels,
    });

  if (!user) return null;

  return toUser(user);
}

export async function deleteUser(id: number): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ deletedAt: new Date() })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning({ id: users.id });

  return result.length > 0;
}

/**
 * Mark an expired user as disabled (idempotent operation)
 * Only updates if the user is currently enabled
 */
export async function markUserExpired(userId: number): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ isEnabled: false, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.isEnabled, true), isNull(users.deletedAt)))
    .returning({ id: users.id });

  return result.length > 0;
}

/**
 * Get all unique tags from all users (for tag filter dropdown)
 * Returns tags from all users regardless of current filters
 */
export async function getAllUserTags(): Promise<string[]> {
  const result = await db.select({ tags: users.tags }).from(users).where(isNull(users.deletedAt));

  const allTags = new Set<string>();
  for (const row of result) {
    if (row.tags && Array.isArray(row.tags)) {
      for (const tag of row.tags) {
        allTags.add(tag);
      }
    }
  }

  return Array.from(allTags).sort();
}

/**
 * Get all unique provider groups from users (for key group filter dropdown)
 * Returns groups from all users regardless of current filters
 */
export async function getAllUserProviderGroups(): Promise<string[]> {
  const result = await db
    .select({ providerGroup: users.providerGroup })
    .from(users)
    .where(isNull(users.deletedAt));

  const allGroups = new Set<string>();
  for (const row of result) {
    const groups = row.providerGroup
      ?.split(",")
      .map((group) => group.trim())
      .filter(Boolean);
    if (!groups || groups.length === 0) continue;
    for (const group of groups) {
      allGroups.add(group);
    }
  }

  return Array.from(allGroups).sort();
}
