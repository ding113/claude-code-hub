"use server";

import { eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keywordRoutingRules } from "@/drizzle/schema";
import { emitKeywordRoutingRulesUpdated } from "@/lib/emit-event";

export interface KeywordRoutingRule {
  id: number;
  keyword: string;
  sourceModel: string | null;
  targetModel: string;
  caseSensitive: boolean;
  priority: number;
  description: string | null;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 将空字符串的来源模型归一化为 null（null 表示匹配任意请求模型）
 */
function normalizeSourceModel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapRow(row: typeof keywordRoutingRules.$inferSelect): KeywordRoutingRule {
  return {
    id: row.id,
    keyword: row.keyword,
    sourceModel: row.sourceModel,
    targetModel: row.targetModel,
    caseSensitive: row.caseSensitive,
    priority: row.priority,
    description: row.description,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt ?? new Date(),
    updatedAt: row.updatedAt ?? new Date(),
  };
}

/**
 * 获取所有启用的关键词路由规则（用于缓存加载，按优先级升序排列）
 */
export async function getActiveKeywordRoutingRules(): Promise<KeywordRoutingRule[]> {
  const results = await db.query.keywordRoutingRules.findMany({
    where: eq(keywordRoutingRules.isEnabled, true),
    orderBy: [keywordRoutingRules.priority, keywordRoutingRules.id],
  });

  return results.map(mapRow);
}

/**
 * 获取所有关键词路由规则（包括禁用的，按评估顺序排列）
 */
export async function getAllKeywordRoutingRules(): Promise<KeywordRoutingRule[]> {
  const results = await db.query.keywordRoutingRules.findMany({
    orderBy: [keywordRoutingRules.priority, keywordRoutingRules.id],
  });

  return results.map(mapRow);
}

/**
 * 创建关键词路由规则
 */
export async function createKeywordRoutingRule(data: {
  keyword: string;
  sourceModel?: string | null;
  targetModel: string;
  caseSensitive?: boolean;
  priority?: number;
  description?: string | null;
}): Promise<KeywordRoutingRule> {
  const [result] = await db
    .insert(keywordRoutingRules)
    .values({
      keyword: data.keyword.trim(),
      sourceModel: normalizeSourceModel(data.sourceModel),
      targetModel: data.targetModel.trim(),
      caseSensitive: data.caseSensitive,
      priority: data.priority,
      description: data.description,
    })
    .returning();

  await emitKeywordRoutingRulesUpdated();

  return mapRow(result);
}

/**
 * 更新关键词路由规则
 */
export async function updateKeywordRoutingRule(
  id: number,
  data: Partial<{
    keyword: string;
    sourceModel: string | null;
    targetModel: string;
    caseSensitive: boolean;
    priority: number;
    description: string | null;
    isEnabled: boolean;
  }>
): Promise<KeywordRoutingRule | null> {
  const updates = { ...data };
  if (updates.keyword !== undefined) {
    updates.keyword = updates.keyword.trim();
  }
  if (updates.targetModel !== undefined) {
    updates.targetModel = updates.targetModel.trim();
  }
  if (updates.sourceModel !== undefined) {
    updates.sourceModel = normalizeSourceModel(updates.sourceModel);
  }

  const [result] = await db
    .update(keywordRoutingRules)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(keywordRoutingRules.id, id))
    .returning();

  if (!result) {
    return null;
  }

  await emitKeywordRoutingRulesUpdated();

  return mapRow(result);
}

/**
 * 删除关键词路由规则
 */
export async function deleteKeywordRoutingRule(id: number): Promise<boolean> {
  const result = await db
    .delete(keywordRoutingRules)
    .where(eq(keywordRoutingRules.id, id))
    .returning();

  if (result.length === 0) return false;

  await emitKeywordRoutingRulesUpdated();
  return true;
}
