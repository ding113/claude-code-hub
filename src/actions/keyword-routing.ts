"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { emitActionAudit } from "@/lib/audit/emit";
import { getSession } from "@/lib/auth";
import { keywordRoutingEngine } from "@/lib/keyword-routing/engine";
import { logger } from "@/lib/logger";
import {
  DESCRIPTION_MAX_LENGTH,
  KEYWORD_MAX_LENGTH,
  MODEL_MAX_LENGTH,
  PRIORITY_ABS_LIMIT,
} from "@/lib/validation/keyword-routing-constants";
import * as repo from "@/repository/keyword-routing-rules";
import type { ActionResult } from "./types";

type TranslationFunction = Awaited<
  ReturnType<typeof getTranslations<"settings.keywordRouting.validation">>
>;

/**
 * 校验创建/更新规则的字段，返回错误信息（合法时返回 null）
 *
 * 使用从 @/lib/validation/keyword-routing-constants 导入的共享常量，
 * 确保与 API 层 Zod schema 验证保持一致。
 */
async function validateRuleFields(
  fields: {
    keyword?: string;
    sourceModel?: string | null;
    targetModel?: string;
    description?: string | null;
    priority?: number;
  },
  t: TranslationFunction
): Promise<string | null> {
  if (fields.keyword !== undefined) {
    const keyword = fields.keyword?.trim() ?? "";
    if (keyword.length === 0) {
      return t("keywordRequired");
    }
    if (keyword.length > KEYWORD_MAX_LENGTH) {
      return t("keywordMaxLength", { max: KEYWORD_MAX_LENGTH });
    }
  }

  if (fields.targetModel !== undefined) {
    const targetModel = fields.targetModel?.trim() ?? "";
    if (targetModel.length === 0) {
      return t("targetModelRequired");
    }
    if (targetModel.length > MODEL_MAX_LENGTH) {
      return t("targetModelMaxLength", { max: MODEL_MAX_LENGTH });
    }
  }

  if (fields.sourceModel != null && fields.sourceModel.trim().length > MODEL_MAX_LENGTH) {
    return t("sourceModelMaxLength", { max: MODEL_MAX_LENGTH });
  }

  if (fields.description != null && fields.description.length > DESCRIPTION_MAX_LENGTH) {
    return t("descriptionMaxLength", { max: DESCRIPTION_MAX_LENGTH });
  }

  if (fields.priority !== undefined) {
    if (!Number.isInteger(fields.priority)) {
      return t("priorityInteger");
    }
    if (fields.priority < -PRIORITY_ABS_LIMIT || fields.priority > PRIORITY_ABS_LIMIT) {
      return t("priorityRange", { limit: PRIORITY_ABS_LIMIT });
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
    const t = await getTranslations("settings.keywordRouting.validation");
    const session = await getSession();
    if (session?.user.role !== "admin") {
      return {
        ok: false,
        error: t("permissionDenied"),
        errorCode: "PERMISSION_DENIED",
      };
    }

    // 验证必填字段与长度限制
    const validationError = await validateRuleFields(
      {
        keyword: data.keyword ?? "",
        targetModel: data.targetModel ?? "",
        sourceModel: data.sourceModel,
        description: data.description,
        priority: data.priority,
      },
      t
    );
    if (validationError) {
      return {
        ok: false,
        error: validationError,
        errorCode: "VALIDATION_ERROR",
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
    const t = await getTranslations("settings.keywordRouting.validation");
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
      error: t("createFailed"),
      errorCode: "OPERATION_FAILED",
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
    const t = await getTranslations("settings.keywordRouting.validation");
    const session = await getSession();
    if (session?.user.role !== "admin") {
      return {
        ok: false,
        error: t("permissionDenied"),
        errorCode: "PERMISSION_DENIED",
      };
    }

    // 仅校验本次提供的字段
    const validationError = await validateRuleFields(updates, t);
    if (validationError) {
      return {
        ok: false,
        error: validationError,
        errorCode: "VALIDATION_ERROR",
      };
    }

    const result = await repo.updateKeywordRoutingRule(id, updates);

    if (!result) {
      return {
        ok: false,
        error: t("ruleNotFound"),
        errorCode: "NOT_FOUND",
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
    const t = await getTranslations("settings.keywordRouting.validation");
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
      error: t("updateFailed"),
      errorCode: "OPERATION_FAILED",
    };
  }
}

/**
 * 删除关键词路由规则
 */
export async function deleteKeywordRoutingRuleAction(id: number): Promise<ActionResult> {
  try {
    const t = await getTranslations("settings.keywordRouting.validation");
    const session = await getSession();
    if (session?.user.role !== "admin") {
      return {
        ok: false,
        error: t("permissionDenied"),
        errorCode: "PERMISSION_DENIED",
      };
    }

    const deleted = await repo.deleteKeywordRoutingRule(id);

    if (!deleted) {
      return {
        ok: false,
        error: t("ruleNotFound"),
        errorCode: "NOT_FOUND",
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
    const t = await getTranslations("settings.keywordRouting.validation");
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
      error: t("deleteFailed"),
      errorCode: "OPERATION_FAILED",
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
    const t = await getTranslations("settings.keywordRouting.validation");
    const session = await getSession();
    if (session?.user.role !== "admin") {
      return {
        ok: false,
        error: t("permissionDenied"),
        errorCode: "PERMISSION_DENIED",
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
    const t = await getTranslations("settings.keywordRouting.validation");
    return {
      ok: false,
      error: t("refreshCacheFailed"),
      errorCode: "OPERATION_FAILED",
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
