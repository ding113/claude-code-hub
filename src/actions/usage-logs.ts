"use server";

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  findUsageLogsWithDetails,
  getUsedEndpoints,
  getUsedModels,
  getUsedStatusCodes,
  type UsageLogFilters,
  type UsageLogRow,
  type UsageLogsResult,
} from "@/repository/usage-logs";
import type { ActionResult } from "./types";

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

    const result = await findUsageLogsWithDetails(finalFilters);

    return { ok: true, data: result };
  } catch (error) {
    logger.error("获取使用日志失败:", error);
    const message = error instanceof Error ? error.message : "获取使用日志失败";
    return { ok: false, error: message };
  }
}

/**
 * 导出使用日志为 CSV 格式
 */
export async function exportUsageLogs(
  filters: Omit<UsageLogFilters, "userId" | "page" | "pageSize">
): Promise<ActionResult<string>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    // 如果不是 admin，强制过滤为当前用户
    const finalFilters: UsageLogFilters =
      session.user.role === "admin"
        ? { ...filters, page: 1, pageSize: 10000 }
        : { ...filters, userId: session.user.id, page: 1, pageSize: 10000 };

    const result = await findUsageLogsWithDetails(finalFilters);

    // 生成 CSV
    const csv = generateCsv(result.logs);

    return { ok: true, data: csv };
  } catch (error) {
    logger.error("导出使用日志失败:", error);
    const message = error instanceof Error ? error.message : "导出使用日志失败";
    return { ok: false, error: message };
  }
}

/**
 * 生成 CSV 字符串
 */
function generateCsv(logs: UsageLogRow[]): string {
  const headers = [
    "Time",
    "User",
    "Key",
    "Provider",
    "Model",
    "Original Model",
    "Endpoint",
    "Status Code",
    "Input Tokens",
    "Output Tokens",
    "Cache Write 5m",
    "Cache Write 1h",
    "Cache Read",
    "Total Tokens",
    "Cost (USD)",
    "Duration (ms)",
    "Session ID",
    "Retry Count",
  ];

  const rows = logs.map((log) => {
    const retryCount = log.providerChain ? Math.max(0, log.providerChain.length - 1) : 0;
    return [
      log.createdAt ? new Date(log.createdAt).toISOString() : "",
      escapeCsvField(log.userName),
      escapeCsvField(log.keyName),
      escapeCsvField(log.providerName ?? ""),
      escapeCsvField(log.model ?? ""),
      escapeCsvField(log.originalModel ?? ""),
      escapeCsvField(log.endpoint ?? ""),
      log.statusCode?.toString() ?? "",
      log.inputTokens?.toString() ?? "0",
      log.outputTokens?.toString() ?? "0",
      log.cacheCreation5mInputTokens?.toString() ?? "0",
      log.cacheCreation1hInputTokens?.toString() ?? "0",
      log.cacheReadInputTokens?.toString() ?? "0",
      log.totalTokens.toString(),
      log.costUsd ?? "0",
      log.durationMs?.toString() ?? "",
      escapeCsvField(log.sessionId ?? ""),
      retryCount.toString(),
    ];
  });

  // 添加 BOM 以支持 Excel 正确识别 UTF-8
  const bom = "\uFEFF";
  const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

  return bom + csvContent;
}

/**
 * 转义 CSV 字段（防止 CSV 公式注入攻击）
 */
function escapeCsvField(field: string): string {
  // Prevent CSV formula injection by prefixing dangerous characters
  const dangerousChars = ["=", "+", "-", "@", "\t", "\r"];
  let safeField = field;
  if (dangerousChars.some((char) => field.startsWith(char))) {
    safeField = `'${field}`; // Prefix with single quote to prevent formula execution
  }

  if (safeField.includes(",") || safeField.includes('"') || safeField.includes("\n")) {
    return `"${safeField.replace(/"/g, '""')}"`;
  }
  return safeField;
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

/**
 * 获取 Endpoint 列表（用于筛选器）
 */
export async function getEndpointList(): Promise<ActionResult<string[]>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    const endpoints = await getUsedEndpoints();
    return { ok: true, data: endpoints };
  } catch (error) {
    logger.error("获取 Endpoint 列表失败:", error);
    return { ok: false, error: "获取 Endpoint 列表失败" };
  }
}
