"use server";

import { desc, eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { sensitiveWords } from "@/drizzle/schema";

export interface SensitiveWord {
  id: number;
  word: string;
  matchType: string;
  description: string | null;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 获取所有启用的敏感词（用于缓存加载）
 */
export async function getActiveSensitiveWords(): Promise<SensitiveWord[]> {
  const results = await db.query.sensitiveWords.findMany({
    where: eq(sensitiveWords.isEnabled, true),
    orderBy: [sensitiveWords.matchType, sensitiveWords.word],
  });

  return results.map((r) => ({
    id: r.id,
    word: r.word,
    matchType: r.matchType,
    description: r.description,
    isEnabled: r.isEnabled,
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  }));
}

/**
 * 获取所有敏感词（包括禁用的）
 */
export async function getAllSensitiveWords(): Promise<SensitiveWord[]> {
  const results = await db.query.sensitiveWords.findMany({
    orderBy: [desc(sensitiveWords.createdAt)],
  });

  return results.map((r) => ({
    id: r.id,
    word: r.word,
    matchType: r.matchType,
    description: r.description,
    isEnabled: r.isEnabled,
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  }));
}

/**
 * 创建敏感词
 */
export async function createSensitiveWord(data: {
  word: string;
  matchType: "contains" | "exact" | "regex";
  description?: string;
}): Promise<SensitiveWord> {
  const [result] = await db
    .insert(sensitiveWords)
    .values({
      word: data.word,
      matchType: data.matchType,
      description: data.description,
    })
    .returning();

  return {
    id: result.id,
    word: result.word,
    matchType: result.matchType,
    description: result.description,
    isEnabled: result.isEnabled,
    createdAt: result.createdAt ?? new Date(),
    updatedAt: result.updatedAt ?? new Date(),
  };
}

/**
 * 更新敏感词
 */
export async function updateSensitiveWord(
  id: number,
  data: Partial<{
    word: string;
    matchType: string;
    description: string;
    isEnabled: boolean;
  }>
): Promise<SensitiveWord | null> {
  const [result] = await db
    .update(sensitiveWords)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(sensitiveWords.id, id))
    .returning();

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    word: result.word,
    matchType: result.matchType,
    description: result.description,
    isEnabled: result.isEnabled,
    createdAt: result.createdAt ?? new Date(),
    updatedAt: result.updatedAt ?? new Date(),
  };
}

/**
 * 删除敏感词
 */
export async function deleteSensitiveWord(id: number): Promise<boolean> {
  const result = await db.delete(sensitiveWords).where(eq(sensitiveWords.id, id)).returning();

  return result.length > 0;
}
