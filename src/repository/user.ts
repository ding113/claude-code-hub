"use server";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys as keysTable, users } from "@/drizzle/schema";
import type { CreateUserData, UpdateUserData, User } from "@/types/user";
import { toUser } from "./_shared/transformers";

export interface UserListCursor {
  id: number;
  /** ISO string */
  createdAt: string;
}

export interface UserListBatchFilters {
  /** Keyset pagination cursor */
  cursor?: UserListCursor;
  /** Page size */
  limit?: number;
  /** Search in username / note */
  searchTerm?: string;
  /** Filter by a single tag */
  tagFilter?: string;
  /** Filter by provider group (derived from keys) */
  keyGroupFilter?: string;
}

export interface UserListBatchResult {
  users: User[];
  nextCursor: UserListCursor | null;
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

/**
 * Cursor-based pagination (keyset pagination) for user list.
 *
 * Cursor uses composite key (created_at, id) to ensure stable ordering.
 */
export async function findUserListBatch(
  filters: UserListBatchFilters
): Promise<UserListBatchResult> {
  const { cursor, limit = 50, searchTerm, tagFilter, keyGroupFilter } = filters;

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

  const trimmedTag = tagFilter?.trim();
  if (trimmedTag) {
    conditions.push(sql`${users.tags} @> ${JSON.stringify([trimmedTag])}::jsonb`);
  }

  const trimmedGroup = keyGroupFilter?.trim();
  if (trimmedGroup) {
    conditions.push(
      sql`${trimmedGroup} = ANY(regexp_split_to_array(coalesce(${users.providerGroup}, ''), '\\s*,\\s*'))`
    );
  }

  // Cursor-based pagination: WHERE (created_at, id) > (cursor_created_at, cursor_id)
  if (cursor) {
    const cursorDate = new Date(cursor.createdAt);
    conditions.push(
      sql`(${users.createdAt}, ${users.id}) > (${cursorDate.toISOString()}::timestamptz, ${cursor.id})`
    );
  }

  // Fetch limit + 1 to determine if there are more records
  const fetchLimit = limit + 1;

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
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(fetchLimit);

  const hasMore = results.length > limit;
  const usersToReturn = hasMore ? results.slice(0, limit) : results;

  const lastUser = usersToReturn[usersToReturn.length - 1];
  const nextCursor =
    hasMore && lastUser?.createdAt
      ? { createdAt: lastUser.createdAt.toISOString(), id: lastUser.id }
      : null;

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
