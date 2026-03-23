"use server";

import { getSession } from "@/lib/auth";
import {
  SESSION_ID_SUGGESTION_LIMIT,
  SESSION_ID_SUGGESTION_MAX_LEN,
  SESSION_ID_SUGGESTION_MIN_LEN,
} from "@/lib/constants/usage-logs.constants";
import { logger } from "@/lib/logger";
import { readLiveChainBatch } from "@/lib/redis/live-chain-store";
import { RedisKVStore } from "@/lib/redis/redis-kv-store";
import { getRetryCount } from "@/lib/utils/provider-chain-formatter";
import { isProviderFinalized } from "@/lib/utils/provider-display";
import {
  findUsageLogSessionIdSuggestions,
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

const USAGE_LOGS_EXPORT_BATCH_SIZE = 500;
const USAGE_LOGS_EXPORT_JOB_TTL_MS = 15 * 60 * 1000;
const USAGE_LOGS_EXPORT_JOB_TTL_SECONDS = Math.floor(USAGE_LOGS_EXPORT_JOB_TTL_MS / 1000);
const USAGE_LOGS_EXPORT_PROGRESS_UPDATE_INTERVAL_MS = 800;
const CSV_HEADERS = [
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
] as const;

type UsageLogsSession = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export interface UsageLogsExportStatus {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  processedRows: number;
  totalRows: number;
  progressPercent: number;
  error?: string;
}

interface UsageLogsExportJobRecord extends UsageLogsExportStatus {
  ownerUserId: number;
}

const usageLogsExportStatusStore = new RedisKVStore<UsageLogsExportJobRecord>({
  prefix: "cch:usage-logs:export:status:",
  defaultTtlSeconds: USAGE_LOGS_EXPORT_JOB_TTL_SECONDS,
});

const usageLogsExportCsvStore = new RedisKVStore<string>({
  prefix: "cch:usage-logs:export:csv:",
  defaultTtlSeconds: USAGE_LOGS_EXPORT_JOB_TTL_SECONDS,
});

function usageLogsExportCsvKey(jobId: string): string {
  return `${jobId}:csv`;
}

function resolveUsageLogFiltersForSession(
  session: UsageLogsSession,
  filters: Omit<UsageLogFilters, "userId" | "page" | "pageSize">
): Omit<UsageLogFilters, "page" | "pageSize"> {
  return session.user.role === "admin" ? filters : { ...filters, userId: session.user.id };
}

function toUsageLogsExportStatus(job: UsageLogsExportJobRecord): UsageLogsExportStatus {
  return {
    jobId: job.jobId,
    status: job.status,
    processedRows: job.processedRows,
    totalRows: job.totalRows,
    progressPercent: job.progressPercent,
    error: job.error,
  };
}

function getUsageLogsExportJob(
  session: UsageLogsSession,
  job: UsageLogsExportJobRecord | null,
  _jobId: string
): UsageLogsExportJobRecord | null {
  if (!job || job.ownerUserId !== session.user.id) {
    return null;
  }
  return job;
}

function buildCsvRows(logs: UsageLogRow[]): string[] {
  return logs.map((log) => {
    const retryCount = log.providerChain ? getRetryCount(log.providerChain) : 0;
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
    ].join(",");
  });
}

function buildUsageLogsExportProgress(
  processedRows: number,
  totalRows: number,
  hasMore: boolean
): Pick<UsageLogsExportStatus, "processedRows" | "totalRows" | "progressPercent"> {
  const effectiveTotalRows = Math.max(totalRows, hasMore ? processedRows + 1 : processedRows);
  const progressPercent =
    effectiveTotalRows <= 0
      ? 100
      : hasMore
        ? Math.min(99, Math.floor((processedRows / effectiveTotalRows) * 100))
        : 100;

  return {
    processedRows,
    totalRows: effectiveTotalRows,
    progressPercent,
  };
}

async function buildUsageLogsExportCsv(
  filters: Omit<UsageLogFilters, "page" | "pageSize">,
  onProgress?: (
    progress: Pick<UsageLogsExportStatus, "processedRows" | "totalRows" | "progressPercent">
  ) => Promise<void> | void
): Promise<string> {
  const initialResult = await findUsageLogsWithDetails({ ...filters, page: 1, pageSize: 1 });
  let estimatedTotalRows = initialResult.total;

  if (estimatedTotalRows === 0) {
    const stats = await findUsageLogsStats(filters);
    estimatedTotalRows = stats.totalRequests;
  }

  const csvLines = [CSV_HEADERS.join(",")];
  let cursor: UsageLogBatchFilters["cursor"] | undefined;
  let processedRows = 0;

  while (true) {
    const batch = await findUsageLogsBatch({
      ...filters,
      cursor,
      limit: USAGE_LOGS_EXPORT_BATCH_SIZE,
    });

    if (batch.logs.length > 0) {
      csvLines.push(...buildCsvRows(batch.logs));
      processedRows += batch.logs.length;
    }

    const progress = buildUsageLogsExportProgress(processedRows, estimatedTotalRows, batch.hasMore);
    estimatedTotalRows = progress.totalRows;
    await onProgress?.(progress);

    if (!batch.hasMore || !batch.nextCursor) {
      break;
    }

    cursor = batch.nextCursor;
  }

  return `\uFEFF${csvLines.join("\n")}`;
}

async function runUsageLogsExportJob(
  jobId: string,
  filters: Omit<UsageLogFilters, "page" | "pageSize">
): Promise<void> {
  const existingJob = await usageLogsExportStatusStore.get(jobId);
  if (!existingJob) {
    return;
  }

  await usageLogsExportStatusStore.set(jobId, {
    ...existingJob,
    status: "running",
    error: undefined,
  });

  try {
    let lastProgressUpdateAt = 0;
    const csv = await buildUsageLogsExportCsv(filters, async (progress) => {
      const now = Date.now();
      if (
        progress.progressPercent < 100 &&
        now - lastProgressUpdateAt < USAGE_LOGS_EXPORT_PROGRESS_UPDATE_INTERVAL_MS
      ) {
        return;
      }
      lastProgressUpdateAt = now;

      const currentJob = await usageLogsExportStatusStore.get(jobId);
      if (!currentJob) {
        return;
      }

      await usageLogsExportStatusStore.set(jobId, {
        ...currentJob,
        status: "running",
        ...progress,
      });
    });

    const currentJob = await usageLogsExportStatusStore.get(jobId);
    if (!currentJob) {
      return;
    }

    const csvStored = await usageLogsExportCsvStore.set(usageLogsExportCsvKey(jobId), csv);
    if (!csvStored) {
      await usageLogsExportStatusStore.set(jobId, {
        ...currentJob,
        status: "failed",
        progressPercent: 0,
        error: "Failed to persist CSV to Redis",
      });
      return;
    }

    await usageLogsExportStatusStore.set(jobId, {
      ...currentJob,
      status: "completed",
      progressPercent: 100,
      error: undefined,
    });
  } catch (error) {
    logger.error("Failed to run usage logs export job:", error);
    const currentJob = await usageLogsExportStatusStore.get(jobId);
    if (!currentJob) {
      return;
    }

    await usageLogsExportStatusStore.set(jobId, {
      ...currentJob,
      status: "failed",
      progressPercent: 0,
      error: error instanceof Error ? error.message : "Export failed",
    });
  }
}

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

    const finalFilters = resolveUsageLogFiltersForSession(session, filters);
    const csv = await buildUsageLogsExportCsv(finalFilters);

    return { ok: true, data: csv };
  } catch (error) {
    logger.error("导出使用日志失败:", error);
    const message = error instanceof Error ? error.message : "导出使用日志失败";
    return { ok: false, error: message };
  }
}

export async function startUsageLogsExport(
  filters: Omit<UsageLogFilters, "userId" | "page" | "pageSize">
): Promise<ActionResult<{ jobId: string }>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    const jobId = crypto.randomUUID();
    const finalFilters = resolveUsageLogFiltersForSession(session, filters);

    const stored = await usageLogsExportStatusStore.set(jobId, {
      jobId,
      ownerUserId: session.user.id,
      status: "queued",
      processedRows: 0,
      totalRows: 0,
      progressPercent: 0,
    });

    if (!stored) {
      return { ok: false, error: "Export job initialization failed" };
    }

    // Defer to next tick so the action returns the jobId immediately.
    // Safe for self-hosted Bun server (long-lived process); NOT suitable for serverless.
    setTimeout(() => {
      void runUsageLogsExportJob(jobId, finalFilters);
    }, 0);

    return { ok: true, data: { jobId } };
  } catch (error) {
    logger.error("Failed to start usage logs export:", error);
    const message = error instanceof Error ? error.message : "Failed to start export";
    return { ok: false, error: message };
  }
}

export async function getUsageLogsExportStatus(
  jobId: string
): Promise<ActionResult<UsageLogsExportStatus>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    const job = getUsageLogsExportJob(session, await usageLogsExportStatusStore.get(jobId), jobId);
    if (!job) {
      return { ok: false, error: "Export job not found or expired" };
    }

    return { ok: true, data: toUsageLogsExportStatus(job) };
  } catch (error) {
    logger.error("Failed to get usage logs export status:", error);
    const message = error instanceof Error ? error.message : "Failed to get export status";
    return { ok: false, error: message };
  }
}

export async function downloadUsageLogsExport(jobId: string): Promise<ActionResult<string>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    const job = getUsageLogsExportJob(session, await usageLogsExportStatusStore.get(jobId), jobId);
    if (!job) {
      return { ok: false, error: "Export job not found or expired" };
    }

    if (job.status === "failed") {
      return { ok: false, error: job.error || "Export failed" };
    }

    if (job.status !== "completed") {
      return { ok: false, error: "Export not yet completed" };
    }

    const csv = await usageLogsExportCsvStore.get(usageLogsExportCsvKey(jobId));
    if (!csv) {
      return { ok: false, error: "Export file not found or expired" };
    }

    return { ok: true, data: csv };
  } catch (error) {
    logger.error("Failed to download usage logs export:", error);
    const message = error instanceof Error ? error.message : "Failed to download export";
    return { ok: false, error: message };
  }
}

/**
 * 转义 CSV 字段（防止 CSV 公式注入攻击）
 */
function escapeCsvField(field: string): string {
  const dangerousChars = ["=", "+", "-", "@"];
  const trimmedField = field.trimStart();
  let safeField = field;
  if (trimmedField && dangerousChars.some((char) => trimmedField.startsWith(char))) {
    safeField = `'${field}`;
  }

  if (
    safeField.includes(",") ||
    safeField.includes('"') ||
    safeField.includes("\n") ||
    safeField.includes("\r")
  ) {
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

export interface UsageLogSessionIdSuggestionInput {
  term: string;
  userId?: number;
  keyId?: number;
  providerId?: number;
}

export async function getUsageLogSessionIdSuggestions(
  input: UsageLogSessionIdSuggestionInput
): Promise<ActionResult<string[]>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    const trimmedTerm = input.term.trim().slice(0, SESSION_ID_SUGGESTION_MAX_LEN);
    if (trimmedTerm.length < SESSION_ID_SUGGESTION_MIN_LEN) {
      return { ok: true, data: [] };
    }

    const finalFilters =
      session.user.role === "admin"
        ? {
            term: trimmedTerm,
            userId: input.userId,
            keyId: input.keyId,
            providerId: input.providerId,
            limit: SESSION_ID_SUGGESTION_LIMIT,
          }
        : {
            term: trimmedTerm,
            userId: session.user.id,
            keyId: input.keyId,
            providerId: input.providerId,
            limit: SESSION_ID_SUGGESTION_LIMIT,
          };

    const sessionIds = await findUsageLogSessionIdSuggestions(finalFilters);
    return { ok: true, data: sessionIds };
  } catch (error) {
    logger.error("获取 sessionId 联想失败:", error);
    const message = error instanceof Error ? error.message : "获取 sessionId 联想失败";
    return { ok: false, error: message };
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

    // Merge Redis live chain data for unfinalised rows
    const unfinalisedRows = result.logs.filter(
      (row) => !isProviderFinalized(row) && row.sessionId && row.requestSequence != null
    );

    if (unfinalisedRows.length > 0) {
      const liveData = await readLiveChainBatch(
        unfinalisedRows.map((r) => ({
          sessionId: r.sessionId!,
          requestSequence: r.requestSequence!,
        }))
      );

      for (const row of unfinalisedRows) {
        const key = `${row.sessionId}:${row.requestSequence}`;
        const snapshot = liveData.get(key);
        if (snapshot) {
          row._liveChain = snapshot;
        }
      }
    }

    return { ok: true, data: result };
  } catch (error) {
    logger.error("获取使用日志批量数据失败:", error);
    const message = error instanceof Error ? error.message : "获取使用日志批量数据失败";
    return { ok: false, error: message };
  }
}
