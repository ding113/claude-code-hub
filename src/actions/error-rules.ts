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
    | "prompt_limit"
    | "content_filter"
    | "pdf_limit"
    | "thinking_error"
    | "parameter_error"
    | "invalid_request"
    | "cache_limit";
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
      "prompt_limit",
      "content_filter",
      "pdf_limit",
      "thinking_error",
      "parameter_error",
      "invalid_request",
      "cache_limit",
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

    // 获取当前规则以确定最终的 matchType 和 pattern
    const currentRule = await repo.getErrorRuleById(id);
    if (!currentRule) {
      return {
        ok: false,
        error: "错误规则不存在",
      };
    }

    // 计算最终的 pattern 和 matchType
    const finalPattern = updates.pattern ?? currentRule.pattern;
    const finalMatchType = updates.matchType ?? currentRule.matchType;

    // ReDoS (Regular Expression Denial of Service) 风险检测
    // 当最终结果是 regex 类型时，需要检查 pattern 安全性
    // 这覆盖了两种情况：
    // 1. 更新 pattern 到一个 regex 规则
    // 2. 将 matchType 从 contains/exact 改为 regex
    if (finalMatchType === "regex") {
      if (!safeRegex(finalPattern)) {
        return {
          ok: false,
          error: "正则表达式存在 ReDoS 风险，请简化模式",
        };
      }

      // 验证正则表达式语法
      try {
        new RegExp(finalPattern);
      } catch {
        return {
          ok: false,
          error: "无效的正则表达式",
        };
      }
    }

    const result = await repo.updateErrorRule(id, updates);

    // 注意：result 为 null 的情况已在上方 getErrorRuleById 检查时处理
    // 这里保留检查作为防御性编程，应对并发删除场景
    if (!result) {
      return {
        ok: false,
        error: "错误规则不存在或已被删除",
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
 *
 * 同时同步默认规则到数据库：
 * - 删除所有已有的默认规则（isDefault=true）
 * - 重新插入最新的默认规则
 * - 用户自定义规则（isDefault=false）保持不变
 */
export async function refreshCacheAction(): Promise<
  ActionResult<{ stats: ReturnType<typeof errorRuleDetector.getStats>; syncedCount: number }>
> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: "权限不足",
      };
    }

    // 1. 同步默认规则到数据库
    const syncedCount = await repo.syncDefaultErrorRules();

    // 2. 重新加载缓存（syncDefaultErrorRules 已经触发了 eventEmitter，但显式调用确保同步）
    await errorRuleDetector.reload();

    const stats = errorRuleDetector.getStats();

    logger.info("[ErrorRulesAction] Default rules synced and cache refreshed", {
      syncedCount,
      stats,
      userId: session.user.id,
    });

    // 3. 刷新页面数据
    revalidatePath("/settings/error-rules");

    return {
      ok: true,
      data: { stats, syncedCount },
    };
  } catch (error) {
    logger.error("[ErrorRulesAction] Failed to sync rules and refresh cache:", error);
    return {
      ok: false,
      error: "同步规则失败",
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
