"use server";

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  findUsageLogsWithDetails,
  getUsedModels,
  getUsedStatusCodes,
  type UsageLogFilters,
  type UsageLogsResult,
} from "@/repository/usage-logs";
import type { ActionResult } from "./types";
import { getPrivacyContext } from "@/lib/utils/privacy-filter.server";

/**
 * 获取使用日志（根据权限过滤）
 */
export async function getUsageLogs(
  filters: Omit<UsageLogFilters, "userId">
): Promise<ActionResult<UsageLogsResult>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    // 如果不是 admin，强制过滤为当前用户
    const finalFilters: UsageLogFilters =
      session.user.role === "admin" ? filters : { ...filters, userId: session.user.id };

    // 获取隐私过滤上下文（决定金额计算方式）
    const privacyContext = await getPrivacyContext();

    const result = await findUsageLogsWithDetails(finalFilters, privacyContext);

    return { ok: true, data: result };
  } catch (error) {
    logger.error("获取使用日志失败:", error);
    const message = error instanceof Error ? error.message : "获取使用日志失败";
    return { ok: false, error: message };
  }
}

/**
 * 获取模型列表（用于筛选器）
 */
export async function getModelList(): Promise<ActionResult<string[]>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    const models = await getUsedModels();
    return { ok: true, data: models };
  } catch (error) {
    logger.error("获取模型列表失败:", error);
    return { ok: false, error: "获取模型列表失败" };
  }
}

/**
 * 获取状态码列表（用于筛选器）
 */
export async function getStatusCodeList(): Promise<ActionResult<number[]>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    const codes = await getUsedStatusCodes();
    return { ok: true, data: codes };
  } catch (error) {
    logger.error("获取状态码列表失败:", error);
    return { ok: false, error: "获取状态码列表失败" };
  }
}
