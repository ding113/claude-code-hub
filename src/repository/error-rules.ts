"use server";

import { db } from "@/drizzle/db";
import { errorRules } from "@/drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { eventEmitter } from "@/lib/event-emitter";

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
 * 获取所有启用的错误规则（用于缓存加载和运行时检测）
 */
export async function getActiveErrorRules(): Promise<ErrorRule[]> {
  const results = await db.query.errorRules.findMany({
    where: eq(errorRules.isEnabled, true),
    orderBy: [errorRules.priority, errorRules.category],
  });

  return results.map((r) => ({
    id: r.id,
    pattern: r.pattern,
    matchType: r.matchType as "regex" | "contains" | "exact",
    category: r.category,
    description: r.description,
    isEnabled: r.isEnabled,
    isDefault: r.isDefault,
    priority: r.priority,
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
    matchType: r.matchType as "regex" | "contains" | "exact",
    category: r.category,
    description: r.description,
    isEnabled: r.isEnabled,
    isDefault: r.isDefault,
    priority: r.priority,
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
  priority?: number;
}): Promise<ErrorRule> {
  const [result] = await db
    .insert(errorRules)
    .values({
      pattern: data.pattern,
      matchType: data.matchType,
      category: data.category,
      description: data.description,
      priority: data.priority ?? 0,
    })
    .returning();

  return {
    id: result.id,
    pattern: result.pattern,
    matchType: result.matchType as "regex" | "contains" | "exact",
    category: result.category,
    description: result.description,
    isEnabled: result.isEnabled,
    isDefault: result.isDefault,
    priority: result.priority,
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
    matchType: result.matchType as "regex" | "contains" | "exact",
    category: result.category,
    description: result.description,
    isEnabled: result.isEnabled,
    isDefault: result.isDefault,
    priority: result.priority,
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

/**
 * 初始化默认错误规则
 *
 * 使用 ON CONFLICT DO NOTHING 确保幂等性，避免重复插入
 * 从 src/app/v1/_lib/proxy/errors.ts 中提取的 7 条默认规则
 */
export async function initializeDefaultErrorRules(): Promise<void> {
  const defaultRules = [
    {
      pattern: "prompt is too long.*maximum.*tokens",
      category: "prompt_limit",
      description: "Prompt token limit exceeded",
      matchType: "regex" as const,
      isDefault: true,
      isEnabled: true,
      priority: 100,
    },
    {
      pattern: "blocked by.*content filter",
      category: "content_filter",
      description: "Content blocked by safety filters",
      matchType: "regex" as const,
      isDefault: true,
      isEnabled: true,
      priority: 90,
    },
    {
      pattern: "PDF has too many pages.*maximum.*pages",
      category: "pdf_limit",
      description: "PDF page limit exceeded",
      matchType: "regex" as const,
      isDefault: true,
      isEnabled: true,
      priority: 80,
    },
    {
      pattern: "thinking.*format.*invalid|Expected.*thinking.*but found",
      category: "thinking_error",
      description: "Invalid thinking block format",
      matchType: "regex" as const,
      isDefault: true,
      isEnabled: true,
      priority: 70,
    },
    {
      pattern: "Missing required parameter|Extra inputs.*not permitted",
      category: "parameter_error",
      description: "Request parameter validation failed",
      matchType: "regex" as const,
      isDefault: true,
      isEnabled: true,
      priority: 60,
    },
    {
      pattern: "非法请求|illegal request|invalid request",
      category: "invalid_request",
      description: "Invalid request format",
      matchType: "regex" as const,
      isDefault: true,
      isEnabled: true,
      priority: 50,
    },
    {
      pattern: "cache_control.*limit.*blocks",
      category: "cache_limit",
      description: "Cache control limit exceeded",
      matchType: "regex" as const,
      isDefault: true,
      isEnabled: true,
      priority: 40,
    },
  ];

  // 使用事务批量插入，ON CONFLICT DO NOTHING 保证幂等性
  await db.transaction(async (tx) => {
    for (const rule of defaultRules) {
      await tx.insert(errorRules).values(rule).onConflictDoNothing({ target: errorRules.pattern });
    }
  });

  // 通知 ErrorRuleDetector 重新加载缓存
  // 这确保迁移完成后检测器能正确加载规则
  eventEmitter.emit("errorRulesUpdated");
}
