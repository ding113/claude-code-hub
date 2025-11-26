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
 * 根据 ID 获取单个错误规则
 */
export async function getErrorRuleById(id: number): Promise<ErrorRule | null> {
  const result = await db.query.errorRules.findFirst({
    where: eq(errorRules.id, id),
  });

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
 * 默认错误规则定义
 */
const DEFAULT_ERROR_RULES = [
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
    pattern: "PDF has too many pages|maximum of.*PDF pages",
    category: "pdf_limit",
    description: "PDF page limit exceeded",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 80,
  },
  {
    pattern:
      "thinking.*format.*invalid|Expected.*thinking.*but found|clear_thinking.*requires.*thinking.*enabled",
    category: "thinking_error",
    description: "Invalid thinking block format or configuration",
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
    pattern: "(cache_control.*(limit|maximum).*blocks|(maximum|limit).*blocks.*cache_control)",
    category: "cache_limit",
    description: "Cache control limit exceeded",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 40,
  },
  {
    pattern: "image exceeds.*maximum.*bytes",
    category: "invalid_request",
    description: "Image size exceeds maximum limit",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 35,
  },
];

/**
 * 同步默认错误规则（推荐使用）
 *
 * 将代码中的默认规则同步到数据库：
 * - 删除所有已有的默认规则（isDefault=true）
 * - 重新插入最新的 DEFAULT_ERROR_RULES
 * - 用户自定义规则（isDefault=false）保持不变
 *
 * 使用场景：
 * 1. 系统启动时自动同步（instrumentation.ts）
 * 2. 用户点击"刷新缓存"按钮时手动同步
 *
 * @returns 同步的规则数量
 */
export async function syncDefaultErrorRules(): Promise<number> {
  await db.transaction(async (tx) => {
    // 1. 删除所有默认规则
    await tx.delete(errorRules).where(eq(errorRules.isDefault, true));

    // 2. 重新插入最新的默认规则
    for (const rule of DEFAULT_ERROR_RULES) {
      await tx.insert(errorRules).values(rule);
    }
  });

  // 通知 ErrorRuleDetector 重新加载缓存
  eventEmitter.emit("errorRulesUpdated");

  return DEFAULT_ERROR_RULES.length;
}

/**
 * 初始化默认错误规则
 *
 * @deprecated 请使用 syncDefaultErrorRules() 替代
 *
 * 此函数使用 ON CONFLICT DO NOTHING，只能插入新规则，无法更新已存在的规则。
 * 当 DEFAULT_ERROR_RULES 更新时，数据库中的旧规则不会被同步。
 *
 * syncDefaultErrorRules() 会删除所有预置规则并重新插入，确保每次都同步最新版本。
 */
export async function initializeDefaultErrorRules(): Promise<void> {
  // 使用事务批量插入，ON CONFLICT DO NOTHING 保证幂等性
  await db.transaction(async (tx) => {
    for (const rule of DEFAULT_ERROR_RULES) {
      await tx.insert(errorRules).values(rule).onConflictDoNothing({ target: errorRules.pattern });
    }
  });

  // 通知 ErrorRuleDetector 重新加载缓存
  // 这确保迁移完成后检测器能正确加载规则
  eventEmitter.emit("errorRulesUpdated");
}
