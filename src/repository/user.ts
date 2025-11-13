"use server";

import { db } from "@/drizzle/db";
import { users } from "@/drizzle/schema";
import { eq, isNull, and, sql } from "drizzle-orm";
import type { User, CreateUserData, UpdateUserData } from "@/types/user";
import { toUser } from "./_shared/transformers";

export async function createUser(userData: CreateUserData): Promise<User> {
  const dbData = {
    name: userData.name,
    description: userData.description,
    rpmLimit: userData.rpm,
    dailyLimitUsd: userData.dailyQuota?.toString(),
    providerGroup: userData.providerGroup,
    tags: userData.tags,
  };

  const [user] = await db.insert(users).values(dbData).returning({
    id: users.id,
    name: users.name,
    description: users.description,
    role: users.role,
    rpm: users.rpmLimit,
    dailyQuota: users.dailyLimitUsd,
    providerGroup: users.providerGroup,
    providerGroups: users.providerGroups,
    tags: users.tags,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
    deletedAt: users.deletedAt,
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
      providerGroups: users.providerGroups,
      tags: users.tags,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deletedAt: users.deletedAt,
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
      providerGroups: users.providerGroups,
      tags: users.tags,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deletedAt: users.deletedAt,
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
    tags?: string[] | null;
    updatedAt?: Date;
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
      providerGroups: users.providerGroups,
      tags: users.tags,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deletedAt: users.deletedAt,
    });

  if (!user) return null;

  return toUser(user);
}

/**
 * 根据标签筛选用户
 * 查询包含指定标签的用户（使用 JSONB 包含操作符 @>）
 * @param tags 标签数组
 * @returns 匹配的用户列表
 */
export async function findUsersByTags(tags: string[]): Promise<User[]> {
  // 处理空数组情况
  if (!tags || tags.length === 0) {
    return [];
  }

  // 使用 PostgreSQL JSONB 包含操作符 @> 查询
  // tags @> ["tag1", "tag2"] 表示 tags 字段包含所有指定的标签
  const result = await db
    .select({
      id: users.id,
      name: users.name,
      description: users.description,
      role: users.role,
      rpm: users.rpmLimit,
      dailyQuota: users.dailyLimitUsd,
      providerGroup: users.providerGroup,
      providerGroups: users.providerGroups,
      tags: users.tags,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(and(isNull(users.deletedAt), sql`${users.tags} @> ${JSON.stringify(tags)}::jsonb`))
    .orderBy(sql`CASE WHEN ${users.role} = 'admin' THEN 0 ELSE 1 END`, users.id);

  return result.map(toUser);
}

export async function deleteUser(id: number): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ deletedAt: new Date() })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning({ id: users.id });

  return result.length > 0;
}
