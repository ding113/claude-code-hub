"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { users } from "@/drizzle/schema";
import type { CreateUserData, UpdateUserData, User } from "@/types/user";
import { toUser } from "./_shared/transformers";

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
    })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(sql`CASE WHEN ${users.role} = 'admin' THEN 0 ELSE 1 END`, users.id)
    .limit(limit)
    .offset(offset);

  return result.map(toUser);
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
    dailyLimitUsd?: string;
    providerGroup?: string | null;
    tags?: string[];
    updatedAt?: Date;
    limit5hUsd?: string;
    limitWeeklyUsd?: string;
    limitMonthlyUsd?: string;
    limitTotalUsd?: string | null;
    limitConcurrentSessions?: number;
  }

  const dbData: UpdateDbData = {
    updatedAt: new Date(),
  };
  if (userData.name !== undefined) dbData.name = userData.name;
  if (userData.description !== undefined) dbData.description = userData.description;
  if (userData.rpm !== undefined) dbData.rpmLimit = userData.rpm;
  if (userData.dailyQuota !== undefined) dbData.dailyLimitUsd = userData.dailyQuota.toString();
  if (userData.providerGroup !== undefined) dbData.providerGroup = userData.providerGroup;
  if (userData.tags !== undefined) dbData.tags = userData.tags;
  if (userData.limit5hUsd !== undefined) dbData.limit5hUsd = userData.limit5hUsd.toString();
  if (userData.limitWeeklyUsd !== undefined)
    dbData.limitWeeklyUsd = userData.limitWeeklyUsd.toString();
  if (userData.limitMonthlyUsd !== undefined)
    dbData.limitMonthlyUsd = userData.limitMonthlyUsd.toString();
  if (userData.limitTotalUsd !== undefined)
    dbData.limitTotalUsd =
      userData.limitTotalUsd === null ? null : userData.limitTotalUsd.toString();
  if (userData.limitConcurrentSessions !== undefined)
    dbData.limitConcurrentSessions = userData.limitConcurrentSessions;

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
