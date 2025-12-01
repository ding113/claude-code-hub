"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { sensitiveWordDetector } from "@/lib/sensitive-word-detector";
import * as repo from "@/repository/sensitive-words";
import type { ActionResult } from "./types";

/**
 * 获取所有敏感词列表
 */
export async function listSensitiveWords(): Promise<repo.SensitiveWord[]> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      logger.warn("[SensitiveWordsAction] Unauthorized access attempt");
      return [];
    }

    return await repo.getAllSensitiveWords();
  } catch (error) {
    logger.error("[SensitiveWordsAction] Failed to list sensitive words:", error);
    return [];
  }
}

/**
 * 创建敏感词
 */
export async function createSensitiveWordAction(data: {
  word: string;
  matchType: "contains" | "exact" | "regex";
  description?: string;
}): Promise<ActionResult<repo.SensitiveWord>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: "权限不足",
      };
    }

    // 验证必填字段
    if (!data.word || data.word.trim().length === 0) {
      return {
        ok: false,
        error: "敏感词不能为空",
      };
    }

    // 验证匹配类型
    if (!["contains", "exact", "regex"].includes(data.matchType)) {
      return {
        ok: false,
        error: "无效的匹配类型",
      };
    }

    // 验证正则表达式（如果是 regex 类型）
    if (data.matchType === "regex") {
      try {
        new RegExp(data.word);
      } catch {
        return {
          ok: false,
          error: "无效的正则表达式",
        };
      }
    }

    const result = await repo.createSensitiveWord(data);

    // 刷新缓存
    await sensitiveWordDetector.reload();

    revalidatePath("/settings/sensitive-words");

    logger.info("[SensitiveWordsAction] Created sensitive word", {
      word: data.word,
      matchType: data.matchType,
      userId: session.user.id,
    });

    return {
      ok: true,
      data: result,
    };
  } catch (error) {
    logger.error("[SensitiveWordsAction] Failed to create sensitive word:", error);
    return {
      ok: false,
      error: "创建敏感词失败",
    };
  }
}

/**
 * 更新敏感词
 */
export async function updateSensitiveWordAction(
  id: number,
  updates: Partial<{
    word: string;
    matchType: string;
    description: string;
    isEnabled: boolean;
  }>
): Promise<ActionResult<repo.SensitiveWord>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: "权限不足",
      };
    }

    // 验证正则表达式（如果更新了 word 且类型是 regex）
    if (updates.word && updates.matchType === "regex") {
      try {
        new RegExp(updates.word);
      } catch {
        return {
          ok: false,
          error: "无效的正则表达式",
        };
      }
    }

    const result = await repo.updateSensitiveWord(id, updates);

    if (!result) {
      return {
        ok: false,
        error: "敏感词不存在",
      };
    }

    // 刷新缓存
    await sensitiveWordDetector.reload();

    revalidatePath("/settings/sensitive-words");

    logger.info("[SensitiveWordsAction] Updated sensitive word", {
      id,
      updates,
      userId: session.user.id,
    });

    return {
      ok: true,
      data: result,
    };
  } catch (error) {
    logger.error("[SensitiveWordsAction] Failed to update sensitive word:", error);
    return {
      ok: false,
      error: "更新敏感词失败",
    };
  }
}

/**
 * 删除敏感词
 */
export async function deleteSensitiveWordAction(id: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: "权限不足",
      };
    }

    const deleted = await repo.deleteSensitiveWord(id);

    if (!deleted) {
      return {
        ok: false,
        error: "敏感词不存在",
      };
    }

    // 刷新缓存
    await sensitiveWordDetector.reload();

    revalidatePath("/settings/sensitive-words");

    logger.info("[SensitiveWordsAction] Deleted sensitive word", {
      id,
      userId: session.user.id,
    });

    return {
      ok: true,
    };
  } catch (error) {
    logger.error("[SensitiveWordsAction] Failed to delete sensitive word:", error);
    return {
      ok: false,
      error: "删除敏感词失败",
    };
  }
}

/**
 * 手动刷新缓存
 */
export async function refreshCacheAction(): Promise<
  ActionResult<{ stats: ReturnType<typeof sensitiveWordDetector.getStats> }>
> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: "权限不足",
      };
    }

    await sensitiveWordDetector.reload();

    const stats = sensitiveWordDetector.getStats();

    logger.info("[SensitiveWordsAction] Cache refreshed", {
      stats,
      userId: session.user.id,
    });

    return {
      ok: true,
      data: { stats },
    };
  } catch (error) {
    logger.error("[SensitiveWordsAction] Failed to refresh cache:", error);
    return {
      ok: false,
      error: "刷新缓存失败",
    };
  }
}

/**
 * 获取缓存统计信息
 */
export async function getCacheStats() {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return null;
    }

    return sensitiveWordDetector.getStats();
  } catch (error) {
    logger.error("[SensitiveWordsAction] Failed to get cache stats:", error);
    return null;
  }
}
