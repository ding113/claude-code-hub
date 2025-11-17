"use server";

import { revalidatePath } from "next/cache";
import * as repo from "@/repository/error-rules";
import { errorRuleDetector } from "@/lib/error-rule-detector";
import { eventEmitter } from "@/lib/event-emitter";
import { logger } from "@/lib/logger";
import { getSession } from "@/lib/auth";
import safeRegex from "safe-regex";
import type { ActionResult } from "./types";

/**
 * 获取所有错误规则列表
 */
export async function listErrorRules(): Promise<repo.ErrorRule[]> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      logger.warn("[ErrorRulesAction] Unauthorized access attempt");
      return [];
    }

    return await repo.getAllErrorRules();
  } catch (error) {
    logger.error("[ErrorRulesAction] Failed to list error rules:", error);
    return [];
  }
}

/**
 * 创建错误规则
 */
export async function createErrorRuleAction(data: {
  pattern: string;
  category:
    | "client_error"
    | "server_error"
    | "network_error"
    | "rate_limit"
    | "authentication"
    | "other";
  matchType?: "contains" | "exact" | "regex";
  description?: string;
}): Promise<ActionResult<repo.ErrorRule>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: "权限不足",
      };
    }

    // 验证必填字段
    if (!data.pattern || data.pattern.trim().length === 0) {
      return {
        ok: false,
        error: "错误模式不能为空",
      };
    }

    if (!data.category) {
      return {
        ok: false,
        error: "错误类别不能为空",
      };
    }

    // 验证类别
    const validCategories = [
      "client_error",
      "server_error",
      "network_error",
      "rate_limit",
      "authentication",
      "other",
    ];
    if (!validCategories.includes(data.category)) {
      return {
        ok: false,
        error: "无效的错误类别",
      };
    }

    // 默认 matchType 为 regex
    const matchType = data.matchType || "regex";

    // 验证匹配类型
    if (!["contains", "exact", "regex"].includes(matchType)) {
      return {
        ok: false,
        error: "无效的匹配类型",
      };
    }

    // ReDoS (Regular Expression Denial of Service) 风险检测
    if (matchType === "regex") {
      if (!safeRegex(data.pattern)) {
        return {
          ok: false,
          error: "正则表达式存在 ReDoS 风险，请简化模式",
        };
      }

      // 验证正则表达式语法
      try {
        new RegExp(data.pattern);
      } catch {
        return {
          ok: false,
          error: "无效的正则表达式",
        };
      }
    }

    const result = await repo.createErrorRule({
      pattern: data.pattern,
      category: data.category,
      matchType,
      description: data.description,
    });

    // 刷新缓存
    await errorRuleDetector.reload();

    // 触发事件
    eventEmitter.emit("errorRulesUpdated");

    revalidatePath("/settings/error-rules");

    logger.info("[ErrorRulesAction] Created error rule", {
      pattern: data.pattern,
      category: data.category,
      matchType,
      userId: session.user.id,
    });

    return {
      ok: true,
      data: result,
    };
  } catch (error) {
    logger.error("[ErrorRulesAction] Failed to create error rule:", error);
    return {
      ok: false,
      error: "创建错误规则失败",
    };
  }
}

/**
 * 更新错误规则
 */
export async function updateErrorRuleAction(
  id: number,
  updates: Partial<{
    pattern: string;
    category: string;
    matchType: "regex" | "contains" | "exact";
    description: string;
    isEnabled: boolean;
    priority: number;
  }>
): Promise<ActionResult<repo.ErrorRule>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: "权限不足",
      };
    }

    // ReDoS (Regular Expression Denial of Service) 风险检测
    // 仅当更新了 pattern 且 matchType 是 regex 时检查
    if (updates.pattern) {
      const matchType = updates.matchType || "regex";
      if (matchType === "regex") {
        if (!safeRegex(updates.pattern)) {
          return {
            ok: false,
            error: "正则表达式存在 ReDoS 风险，请简化模式",
          };
        }

        // 验证正则表达式语法
        try {
          new RegExp(updates.pattern);
        } catch {
          return {
            ok: false,
            error: "无效的正则表达式",
          };
        }
      }
    }

    const result = await repo.updateErrorRule(id, updates);

    if (!result) {
      return {
        ok: false,
        error: "错误规则不存在",
      };
    }

    // 刷新缓存
    await errorRuleDetector.reload();

    // 触发事件
    eventEmitter.emit("errorRulesUpdated");

    revalidatePath("/settings/error-rules");

    logger.info("[ErrorRulesAction] Updated error rule", {
      id,
      updates,
      userId: session.user.id,
    });

    return {
      ok: true,
      data: result,
    };
  } catch (error) {
    logger.error("[ErrorRulesAction] Failed to update error rule:", error);
    return {
      ok: false,
      error: "更新错误规则失败",
    };
  }
}

/**
 * 删除错误规则
 */
export async function deleteErrorRuleAction(id: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: "权限不足",
      };
    }

    const deleted = await repo.deleteErrorRule(id);

    if (!deleted) {
      return {
        ok: false,
        error: "错误规则不存在",
      };
    }

    // 刷新缓存
    await errorRuleDetector.reload();

    // 触发事件
    eventEmitter.emit("errorRulesUpdated");

    revalidatePath("/settings/error-rules");

    logger.info("[ErrorRulesAction] Deleted error rule", {
      id,
      userId: session.user.id,
    });

    return {
      ok: true,
    };
  } catch (error) {
    logger.error("[ErrorRulesAction] Failed to delete error rule:", error);
    return {
      ok: false,
      error: "删除错误规则失败",
    };
  }
}

/**
 * 手动刷新缓存
 */
export async function refreshCacheAction(): Promise<
  ActionResult<{ stats: ReturnType<typeof errorRuleDetector.getStats> }>
> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: "权限不足",
      };
    }

    await errorRuleDetector.reload();

    const stats = errorRuleDetector.getStats();

    logger.info("[ErrorRulesAction] Cache refreshed", {
      stats,
      userId: session.user.id,
    });

    return {
      ok: true,
      data: { stats },
    };
  } catch (error) {
    logger.error("[ErrorRulesAction] Failed to refresh cache:", error);
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

    return errorRuleDetector.getStats();
  } catch (error) {
    logger.error("[ErrorRulesAction] Failed to get cache stats:", error);
    return null;
  }
}
