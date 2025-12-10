"use server";

import { revalidatePath } from "next/cache";
import safeRegex from "safe-regex";
import { getSession } from "@/lib/auth";
import { validateErrorOverrideResponse } from "@/lib/error-override-validator";
import { errorRuleDetector } from "@/lib/error-rule-detector";
import { logger } from "@/lib/logger";
import * as repo from "@/repository/error-rules";
import type { ActionResult } from "./types";

/** 覆写状态码最小值 */
const OVERRIDE_STATUS_CODE_MIN = 400;
/** 覆写状态码最大值 */
const OVERRIDE_STATUS_CODE_MAX = 599;

/**
 * 验证覆写状态码范围
 *
 * @param statusCode - 要验证的状态码
 * @returns 错误消息（如果验证失败）或 null（验证通过）
 */
function validateOverrideStatusCodeRange(statusCode: number | null | undefined): string | null {
  if (statusCode === null || statusCode === undefined) {
    return null;
  }

  if (
    !Number.isInteger(statusCode) ||
    statusCode < OVERRIDE_STATUS_CODE_MIN ||
    statusCode > OVERRIDE_STATUS_CODE_MAX
  ) {
    return `覆写状态码必须是 ${OVERRIDE_STATUS_CODE_MIN}-${OVERRIDE_STATUS_CODE_MAX} 范围内的整数`;
  }

  return null;
}

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
  /** 覆写响应体（JSON 格式，符合 Claude API 错误格式） */
  overrideResponse?: repo.ErrorOverrideResponse | null;
  /** 覆写状态码：null 表示透传上游状态码 */
  overrideStatusCode?: number | null;
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

    // 验证覆写响应体格式
    if (data.overrideResponse) {
      const validationError = validateErrorOverrideResponse(data.overrideResponse);
      if (validationError) {
        return {
          ok: false,
          error: validationError,
        };
      }
    }

    // 验证覆写状态码范围
    const statusCodeError = validateOverrideStatusCodeRange(data.overrideStatusCode);
    if (statusCodeError) {
      return {
        ok: false,
        error: statusCodeError,
      };
    }

    const result = await repo.createErrorRule({
      pattern: data.pattern,
      category: data.category,
      matchType,
      description: data.description,
      overrideResponse: data.overrideResponse ?? null,
      overrideStatusCode: data.overrideStatusCode ?? null,
    });

    // 刷新缓存（直接调用 reload，不再触发事件避免重复刷新）
    await errorRuleDetector.reload();

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
    /** 覆写响应体（JSON 格式），设为 null 可清除 */
    overrideResponse: repo.ErrorOverrideResponse | null;
    /** 覆写状态码：null 表示透传上游状态码 */
    overrideStatusCode: number | null;
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

    // 验证覆写响应体格式
    if (updates.overrideResponse !== undefined && updates.overrideResponse !== null) {
      const validationError = validateErrorOverrideResponse(updates.overrideResponse);
      if (validationError) {
        return {
          ok: false,
          error: validationError,
        };
      }
    }

    // 验证覆写状态码范围
    const statusCodeError = validateOverrideStatusCodeRange(updates.overrideStatusCode);
    if (statusCodeError) {
      return {
        ok: false,
        error: statusCodeError,
      };
    }

    // 复制 updates，以便在需要时调整 isDefault 字段
    const processedUpdates: typeof updates & { isDefault?: boolean } = {
      ...updates,
    };

    // 如果是默认规则，编辑时自动转换为自定义规则
    // 这样用户的修改不会被"同步规则"操作覆盖
    let convertedFromDefault = false;
    if (currentRule.isDefault) {
      processedUpdates.isDefault = false;
      convertedFromDefault = true;
    }

    const result = await repo.updateErrorRule(id, processedUpdates);

    // 注意：result 为 null 的情况已在上方 getErrorRuleById 检查时处理
    // 这里保留检查作为防御性编程，应对并发删除场景
    if (!result) {
      return {
        ok: false,
        error: "错误规则不存在或已被删除",
      };
    }

    // 刷新缓存（直接调用 reload，不再触发事件避免重复刷新）
    await errorRuleDetector.reload();

    revalidatePath("/settings/error-rules");

    if (convertedFromDefault) {
      logger.info("[ErrorRulesAction] Converted default rule to custom on edit", {
        id,
        userId: session.user.id,
      });
    }

    logger.info("[ErrorRulesAction] Updated error rule", {
      id,
      updates,
      convertedFromDefault,
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

    // 刷新缓存（直接调用 reload，不再触发事件避免重复刷新）
    await errorRuleDetector.reload();

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
 * 同时同步默认规则到数据库，采用"用户自定义优先"策略：
 * - pattern 不存在：插入新规则
 * - pattern 存在且 isDefault=true：更新为最新默认规则
 * - pattern 存在且 isDefault=false：跳过（保留用户的自定义版本）
 * - 不再存在于 DEFAULT_ERROR_RULES 中的默认规则：删除
 */
export async function refreshCacheAction(): Promise<
  ActionResult<{
    stats: ReturnType<typeof errorRuleDetector.getStats>;
    syncResult: { inserted: number; updated: number; skipped: number; deleted: number };
  }>
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
    const syncResult = await repo.syncDefaultErrorRules();

    // 2. 重新加载缓存
    await errorRuleDetector.reload();

    const stats = errorRuleDetector.getStats();

    logger.info("[ErrorRulesAction] Default rules synced and cache refreshed", {
      syncResult,
      stats,
      userId: session.user.id,
    });

    // 3. 刷新页面数据
    revalidatePath("/settings/error-rules");

    return {
      ok: true,
      data: { stats, syncResult },
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
 * 测试错误规则匹配
 *
 * 用于前端测试功能，模拟错误消息被系统处理后的结果：
 * - 是否命中错误规则
 * - 命中的规则详情
 * - 最终返回给用户的响应（考虑覆写，与运行时逻辑一致）
 *
 * 运行时处理逻辑（与 error-handler.ts 保持一致）：
 * 1. 验证覆写响应格式是否合法（isValidErrorOverrideResponse）
 * 2. 移除覆写中的 request_id（运行时会从上游注入）
 * 3. 验证状态码范围（400-599）
 * 4. message 为空时运行时会回退到原始错误消息
 */
export async function testErrorRuleAction(input: { message: string }): Promise<
  ActionResult<{
    matched: boolean;
    rule?: {
      category: string;
      pattern: string;
      matchType: "regex" | "contains" | "exact";
      overrideResponse: repo.ErrorOverrideResponse | null;
      overrideStatusCode: number | null;
    };
    /** 最终返回给用户的响应体（经过运行时验证处理） */
    finalResponse: repo.ErrorOverrideResponse | null;
    /** 最终返回的状态码（经过范围校验） */
    finalStatusCode: number | null;
    /** 警告信息（如果有配置问题） */
    warnings?: string[];
  }>
> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: "权限不足",
      };
    }

    const rawMessage = input.message ?? "";

    // 仅用 trim 做空值校验，检测时使用原始消息以保持与实际运行时一致
    if (!rawMessage.trim()) {
      return {
        ok: false,
        error: "测试消息不能为空",
      };
    }

    // 使用异步检测确保规则已加载
    // 注意：使用原始消息检测，与实际运行时逻辑保持一致
    const detection = await errorRuleDetector.detectAsync(rawMessage);

    // 验证 matchType 是有效值
    const validMatchTypes = ["regex", "contains", "exact"] as const;
    const matchType = validMatchTypes.includes(
      detection.matchType as (typeof validMatchTypes)[number]
    )
      ? (detection.matchType as "regex" | "contains" | "exact")
      : "regex";

    // 模拟运行时处理逻辑，确保测试结果与实际行为一致
    const warnings: string[] = [];
    let finalResponse: repo.ErrorOverrideResponse | null = null;
    let finalStatusCode: number | null = null;

    if (detection.matched) {
      // 1. 验证覆写响应格式（与 error-handler.ts 运行时逻辑一致）
      if (detection.overrideResponse) {
        const validationError = validateErrorOverrideResponse(detection.overrideResponse);
        if (validationError) {
          warnings.push(`${validationError}，运行时将跳过响应体覆写`);
        } else {
          // 2. 移除 request_id（运行时会从上游注入）
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { request_id: _ignoredRequestId, ...responseWithoutRequestId } =
            detection.overrideResponse as Record<string, unknown>;

          // 3. 处理 message 为空的情况（运行时会回退到原始错误消息）
          const overrideErrorObj = detection.overrideResponse.error as Record<string, unknown>;
          const overrideMessage =
            typeof overrideErrorObj?.message === "string" &&
            overrideErrorObj.message.trim().length > 0
              ? overrideErrorObj.message
              : rawMessage;

          if (overrideMessage === rawMessage) {
            warnings.push("覆写响应的 message 为空，运行时将回退到原始错误消息");
          }

          // 构建最终响应（与 error-handler.ts 构建逻辑一致）
          finalResponse = {
            ...responseWithoutRequestId,
            error: {
              ...overrideErrorObj,
              message: overrideMessage,
            },
          } as repo.ErrorOverrideResponse;
        }
      }

      // 4. 验证状态码范围（与 error-handler.ts 运行时逻辑一致）
      const statusCodeError = validateOverrideStatusCodeRange(detection.overrideStatusCode);
      if (
        !statusCodeError &&
        detection.overrideStatusCode !== undefined &&
        detection.overrideStatusCode !== null
      ) {
        finalStatusCode = detection.overrideStatusCode;
      } else if (statusCodeError) {
        warnings.push(
          `覆写状态码 ${detection.overrideStatusCode} 非整数或超出有效范围（${OVERRIDE_STATUS_CODE_MIN}-${OVERRIDE_STATUS_CODE_MAX}），运行时将使用上游状态码`
        );
      }
    }

    return {
      ok: true,
      data: {
        matched: detection.matched,
        rule: detection.matched
          ? {
              category: detection.category ?? "unknown",
              pattern: detection.pattern ?? "",
              matchType,
              overrideResponse: detection.overrideResponse ?? null,
              overrideStatusCode: detection.overrideStatusCode ?? null,
            }
          : undefined,
        finalResponse,
        finalStatusCode,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
  } catch (error) {
    logger.error("[ErrorRulesAction] Failed to test error rule:", error);
    return {
      ok: false,
      error: "测试错误规则失败",
    };
  }
}

/**
 * 获取缓存统计信息
 *
 * 注意：此函数会确保缓存已初始化（懒加载），
 * 避免在新的 worker 进程中返回空统计信息
 */
export async function getCacheStats() {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return null;
    }

    // 确保缓存已初始化（懒加载）
    // 解决重启后新 worker 进程中缓存为空的问题
    await errorRuleDetector.ensureInitialized();

    return errorRuleDetector.getStats();
  } catch (error) {
    logger.error("[ErrorRulesAction] Failed to get cache stats:", error);
    return null;
  }
}
