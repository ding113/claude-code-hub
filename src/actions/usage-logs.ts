"use server";

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  findUsageLogsBatch,
  findUsageLogsStats,
  findUsageLogsWithDetails,
  getUsedEndpoints,
  getUsedModels,
  getUsedStatusCodes,
  type UsageLogBatchFilters,
  type UsageLogFilters,
  type UsageLogRow,
  type UsageLogSummary,
  type UsageLogsBatchResult,
  type UsageLogsResult,
} from "@/repository/usage-logs";
import type { ActionResult } from "./types";

/**
 * 筛选器选项缓存
 * 5 分钟 TTL，避免每次筛选器组件挂载时执行 3 次 DISTINCT 全表扫描
 */
const FILTER_OPTIONS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟
let filterOptionsCache: {
  models: string[];
  statusCodes: number[];
  endpoints: string[];
  expiresAt: number;
} | null = null;

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

/**
 * 筛选器选项数据类型
 */
export interface FilterOptions {
  models: string[];
  statusCodes: number[];
  endpoints: string[];
}

/**
 * 获取筛选器选项（带缓存）
 * 合并获取 models、statusCodes、endpoints，使用内存缓存减少 DISTINCT 全表扫描
 *
 * 优化效果：
 * - 首次加载：3 次 DISTINCT 查询
 * - 5 分钟内再次加载：0 次查询（命中缓存）
 */
export async function getFilterOptions(): Promise<ActionResult<FilterOptions>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    const now = Date.now();

    // 检查缓存是否有效
    if (filterOptionsCache && filterOptionsCache.expiresAt > now) {
      logger.debug("筛选器选项命中缓存");
      return {
        ok: true,
        data: {
          models: filterOptionsCache.models,
          statusCodes: filterOptionsCache.statusCodes,
          endpoints: filterOptionsCache.endpoints,
        },
      };
    }

    // 缓存过期或不存在，重新查询
    logger.debug("筛选器选项缓存未命中，执行 DISTINCT 查询");
    const [models, statusCodes, endpoints] = await Promise.all([
      getUsedModels(),
      getUsedStatusCodes(),
      getUsedEndpoints(),
    ]);

    // 更新缓存
    filterOptionsCache = {
      models,
      statusCodes,
      endpoints,
      expiresAt: now + FILTER_OPTIONS_CACHE_TTL_MS,
    };

    return {
      ok: true,
      data: { models, statusCodes, endpoints },
    };
  } catch (error) {
    logger.error("获取筛选器选项失败:", error);
    return { ok: false, error: "获取筛选器选项失败" };
  }
}

/**
 * 获取使用日志聚合统计（独立接口，用于可折叠面板按需加载）
 *
 * 优化效果：
 * - 分页时不再执行聚合查询
 * - 仅在用户展开统计面板时调用
 */
export async function getUsageLogsStats(
  filters: Omit<UsageLogFilters, "userId" | "page" | "pageSize">
): Promise<ActionResult<UsageLogSummary>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    // 如果不是 admin，强制过滤为当前用户
    const finalFilters: Omit<UsageLogFilters, "page" | "pageSize"> =
      session.user.role === "admin" ? filters : { ...filters, userId: session.user.id };

    const stats = await findUsageLogsStats(finalFilters);

    return { ok: true, data: stats };
  } catch (error) {
    logger.error("获取使用日志统计失败:", error);
    const message = error instanceof Error ? error.message : "获取使用日志统计失败";
    return { ok: false, error: message };
  }
}

/**
 * 获取使用日志批量数据（游标分页，用于无限滚动）
 *
 * 优化效果：
 * - 无 COUNT 查询，大数据集下性能恒定
 * - 使用 keyset pagination，避免 OFFSET 扫描
 * - 支持无限滚动/虚拟滚动场景
 */
export async function getUsageLogsBatch(
  filters: Omit<UsageLogBatchFilters, "userId">
): Promise<ActionResult<UsageLogsBatchResult>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    // 如果不是 admin，强制过滤为当前用户
    const finalFilters: UsageLogBatchFilters =
      session.user.role === "admin" ? filters : { ...filters, userId: session.user.id };

    const result = await findUsageLogsBatch(finalFilters);

    return { ok: true, data: result };
  } catch (error) {
    logger.error("获取使用日志批量数据失败:", error);
    const message = error instanceof Error ? error.message : "获取使用日志批量数据失败";
    return { ok: false, error: message };
  }
}
