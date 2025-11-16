"use server";

import { db } from "@/drizzle/db";
import { errorRules } from "@/drizzle/schema";
import { eq, desc, asc } from "drizzle-orm";

export interface ErrorRule {
  id: number;
  pattern: string;
  matchType: "regex" | "contains" | "exact";
  category: string;
  description: string | null;
  isEnabled: boolean;
  isDefault: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 获取所有启用的错误规则（用于缓存加载）
 */
export async function getActiveErrorRules(): Promise<ErrorRule[]> {
  const results = await db.query.errorRules.findMany({
    where: eq(errorRules.isEnabled, true),
    orderBy: [desc(errorRules.priority), asc(errorRules.createdAt)],
  });

  return results.map((r) => ({
    id: r.id,
    pattern: r.pattern,
    matchType: r.matchType,
    category: r.category,
    description: r.description,
    isEnabled: r.isEnabled,
    isDefault: r.isDefault,
    priority: r.priority ?? 0,
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  }));
}

/**
 * 获取所有错误规则（包括禁用的）
 */
export async function getAllErrorRules(): Promise<ErrorRule[]> {
  const results = await db.query.errorRules.findMany({
    orderBy: [desc(errorRules.createdAt)],
  });

  return results.map((r) => ({
    id: r.id,
    pattern: r.pattern,
    matchType: r.matchType,
    category: r.category,
    description: r.description,
    isEnabled: r.isEnabled,
    isDefault: r.isDefault,
    priority: r.priority ?? 0,
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  }));
}

/**
 * 创建错误规则
 */
export async function createErrorRule(data: {
  pattern: string;
  matchType: "regex" | "contains" | "exact";
  category: string;
  description?: string;
  isEnabled?: boolean;
  isDefault?: boolean;
  priority?: number;
}): Promise<ErrorRule> {
  const [result] = await db
    .insert(errorRules)
    .values({
      pattern: data.pattern,
      matchType: data.matchType,
      category: data.category,
      description: data.description,
      isEnabled: data.isEnabled ?? true,
      isDefault: data.isDefault ?? false,
      priority: data.priority ?? 0,
    })
    .returning();

  return {
    id: result.id,
    pattern: result.pattern,
    matchType: result.matchType,
    category: result.category,
    description: result.description,
    isEnabled: result.isEnabled,
    isDefault: result.isDefault,
    priority: result.priority ?? 0,
    createdAt: result.createdAt ?? new Date(),
    updatedAt: result.updatedAt ?? new Date(),
  };
}

/**
 * 更新错误规则
 */
export async function updateErrorRule(
  id: number,
  data: Partial<{
    pattern: string;
    matchType: "regex" | "contains" | "exact";
    category: string;
    description: string;
    isEnabled: boolean;
    isDefault: boolean;
    priority: number;
  }>
): Promise<ErrorRule | null> {
  const [result] = await db
    .update(errorRules)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(errorRules.id, id))
    .returning();

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    pattern: result.pattern,
    matchType: result.matchType,
    category: result.category,
    description: result.description,
    isEnabled: result.isEnabled,
    isDefault: result.isDefault,
    priority: result.priority ?? 0,
    createdAt: result.createdAt ?? new Date(),
    updatedAt: result.updatedAt ?? new Date(),
  };
}

/**
 * 删除错误规则
 */
export async function deleteErrorRule(id: number): Promise<boolean> {
  const result = await db.delete(errorRules).where(eq(errorRules.id, id)).returning();

  return result.length > 0;
}
