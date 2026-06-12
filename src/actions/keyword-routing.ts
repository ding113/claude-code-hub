"use server";

import { revalidatePath } from "next/cache";
import { emitActionAudit } from "@/lib/audit/emit";
import { getSession } from "@/lib/auth";
import { keywordRoutingEngine } from "@/lib/keyword-routing/engine";
import { logger } from "@/lib/logger";
import * as repo from "@/repository/keyword-routing-rules";
import type { ActionResult } from "./types";

const KEYWORD_MAX_LENGTH = 500;
const MODEL_MAX_LENGTH = 128;
const DESCRIPTION_MAX_LENGTH = 500;
// 与 KeywordRoutingRuleCreateSchema 中 priority 的 min/max 边界保持一致
const PRIORITY_ABS_LIMIT = 1000000;

/**
 * 校验创建/更新规则的字段，返回错误信息（合法时返回 null）
 */
function validateRuleFields(fields: {
  keyword?: string;
  sourceModel?: string | null;
  targetModel?: string;
  description?: string | null;
  priority?: number;
}): string | null {
  if (fields.keyword !== undefined) {
    const keyword = fields.keyword?.trim() ?? "";
    if (keyword.length === 0) {
      return "关键词不能为空";
    }
    if (keyword.length > KEYWORD_MAX_LENGTH) {
      return `关键词长度不能超过 ${KEYWORD_MAX_LENGTH} 个字符`;
    }
  }

  if (fields.targetModel !== undefined) {
    const targetModel = fields.targetModel?.trim() ?? "";
    if (targetModel.length === 0) {
      return "目标模型不能为空";
    }
    if (targetModel.length > MODEL_MAX_LENGTH) {
      return `目标模型长度不能超过 ${MODEL_MAX_LENGTH} 个字符`;
    }
  }

  if (fields.sourceModel != null && fields.sourceModel.trim().length > MODEL_MAX_LENGTH) {
    return `来源模型长度不能超过 ${MODEL_MAX_LENGTH} 个字符`;
  }

  if (fields.description != null && fields.description.length > DESCRIPTION_MAX_LENGTH) {
    return `描述长度不能超过 ${DESCRIPTION_MAX_LENGTH} 个字符`;
  }

  if (fields.priority !== undefined) {
    if (!Number.isInteger(fields.priority)) {
      return "优先级必须为整数";
    }
    if (fields.priority < -PRIORITY_ABS_LIMIT || fields.priority > PRIORITY_ABS_LIMIT) {
      return `优先级必须在 -${PRIORITY_ABS_LIMIT} 到 ${PRIORITY_ABS_LIMIT} 之间`;
    }
  }

  return null;
}

/**
 * 获取所有关键词路由规则列表
 */
export async function listKeywordRoutingRules(): Promise<repo.KeywordRoutingRule[]> {
  try {
    const session = await getSession();
    if (session?.user.role !== "admin") {
      logger.warn("[KeywordRoutingAction] Unauthorized access attempt");
      return [];
    }

    return await repo.getAllKeywordRoutingRules();
  } catch (error) {
    logger.error("[KeywordRoutingAction] Failed to list keyword routing rules:", error);
    return [];
  }
}

/**
 * 创建关键词路由规则
 */
export async function createKeywordRoutingRuleAction(data: {
  keyword: string;
  sourceModel?: string | null;
  targetModel: string;
  caseSensitive?: boolean;
  priority?: number;
  description?: string | null;
}): Promise<ActionResult<repo.KeywordRoutingRule>> {
  try {
    const session = await getSession();
    if (session?.user.role !== "admin") {
      return {
        ok: false,
        error: "权限不足",
      };
    }

    // 验证必填字段与长度限制
    const validationError = validateRuleFields({
      keyword: data.keyword ?? "",
      targetModel: data.targetModel ?? "",
      sourceModel: data.sourceModel,
      description: data.description,
      priority: data.priority,
    });
    if (validationError) {
      return {
        ok: false,
        error: validationError,
      };
    }

    const result = await repo.createKeywordRoutingRule(data);

    revalidatePath("/settings/keyword-routing");

    logger.info("[KeywordRoutingAction] Created keyword routing rule", {
      keyword: data.keyword,
      targetModel: data.targetModel,
      userId: session.user.id,
    });

    emitActionAudit({
      category: "keyword_routing_rule",
      action: "keyword_routing_rule.create",
      targetType: "keyword_routing_rule",
      targetId: String(result.id),
      targetName: result.keyword,
      after: {
        id: result.id,
        keyword: result.keyword,
        sourceModel: result.sourceModel,
        targetModel: result.targetModel,
        caseSensitive: result.caseSensitive,
        priority: result.priority,
        description: result.description,
        isEnabled: result.isEnabled,
      },
      success: true,
    });

    return {
      ok: true,
      data: result,
    };
  } catch (error) {
    logger.error("[KeywordRoutingAction] Failed to create keyword routing rule:", error);
    emitActionAudit({
      category: "keyword_routing_rule",
      action: "keyword_routing_rule.create",
      targetType: "keyword_routing_rule",
      targetName: data.keyword ?? null,
      success: false,
      errorMessage: "CREATE_FAILED",
    });
    return {
      ok: false,
      error: "创建关键词路由规则失败",
    };
  }
}

/**
 * 更新关键词路由规则
 */
export async function updateKeywordRoutingRuleAction(
  id: number,
  updates: Partial<{
    keyword: string;
    sourceModel: string | null;
    targetModel: string;
    caseSensitive: boolean;
    priority: number;
    description: string | null;
    isEnabled: boolean;
  }>
): Promise<ActionResult<repo.KeywordRoutingRule>> {
  try {
    const session = await getSession();
    if (session?.user.role !== "admin") {
      return {
        ok: false,
        error: "权限不足",
      };
    }

    // 仅校验本次提供的字段
    const validationError = validateRuleFields(updates);
    if (validationError) {
      return {
        ok: false,
        error: validationError,
      };
    }

    const result = await repo.updateKeywordRoutingRule(id, updates);

    if (!result) {
      return {
        ok: false,
        error: "关键词路由规则不存在",
      };
    }

    revalidatePath("/settings/keyword-routing");

    logger.info("[KeywordRoutingAction] Updated keyword routing rule", {
      id,
      updates,
      userId: session.user.id,
    });

    emitActionAudit({
      category: "keyword_routing_rule",
      action: "keyword_routing_rule.update",
      targetType: "keyword_routing_rule",
      targetId: String(id),
      targetName: result.keyword,
      after: {
        id: result.id,
        keyword: result.keyword,
        sourceModel: result.sourceModel,
        targetModel: result.targetModel,
        caseSensitive: result.caseSensitive,
        priority: result.priority,
        description: result.description,
        isEnabled: result.isEnabled,
      },
      success: true,
    });

    return {
      ok: true,
      data: result,
    };
  } catch (error) {
    logger.error("[KeywordRoutingAction] Failed to update keyword routing rule:", error);
    emitActionAudit({
      category: "keyword_routing_rule",
      action: "keyword_routing_rule.update",
      targetType: "keyword_routing_rule",
      targetId: String(id),
      success: false,
      errorMessage: "UPDATE_FAILED",
    });
    return {
      ok: false,
      error: "更新关键词路由规则失败",
    };
  }
}

/**
 * 删除关键词路由规则
 */
export async function deleteKeywordRoutingRuleAction(id: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (session?.user.role !== "admin") {
      return {
        ok: false,
        error: "权限不足",
      };
    }

    const deleted = await repo.deleteKeywordRoutingRule(id);

    if (!deleted) {
      return {
        ok: false,
        error: "关键词路由规则不存在",
      };
    }

    revalidatePath("/settings/keyword-routing");

    logger.info("[KeywordRoutingAction] Deleted keyword routing rule", {
      id,
      userId: session.user.id,
    });

    emitActionAudit({
      category: "keyword_routing_rule",
      action: "keyword_routing_rule.delete",
      targetType: "keyword_routing_rule",
      targetId: String(id),
      success: true,
    });

    return {
      ok: true,
    };
  } catch (error) {
    logger.error("[KeywordRoutingAction] Failed to delete keyword routing rule:", error);
    emitActionAudit({
      category: "keyword_routing_rule",
      action: "keyword_routing_rule.delete",
      targetType: "keyword_routing_rule",
      targetId: String(id),
      success: false,
      errorMessage: "DELETE_FAILED",
    });
    return {
      ok: false,
      error: "删除关键词路由规则失败",
    };
  }
}

/**
 * 手动刷新缓存
 */
export async function refreshKeywordRoutingCacheAction(): Promise<
  ActionResult<{ stats: ReturnType<typeof keywordRoutingEngine.getStats> }>
> {
  try {
    const session = await getSession();
    if (session?.user.role !== "admin") {
      return {
        ok: false,
        error: "权限不足",
      };
    }

    await keywordRoutingEngine.reload();

    const stats = keywordRoutingEngine.getStats();

    logger.info("[KeywordRoutingAction] Cache refreshed", {
      stats,
      userId: session.user.id,
    });

    return {
      ok: true,
      data: { stats },
    };
  } catch (error) {
    logger.error("[KeywordRoutingAction] Failed to refresh cache:", error);
    return {
      ok: false,
      error: "刷新缓存失败",
    };
  }
}

/**
 * 获取缓存统计信息
 */
export async function getKeywordRoutingCacheStats() {
  try {
    const session = await getSession();
    if (session?.user.role !== "admin") {
      return null;
    }

    return keywordRoutingEngine.getStats();
  } catch (error) {
    logger.error("[KeywordRoutingAction] Failed to get cache stats:", error);
    return null;
  }
}
