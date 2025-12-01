"use server";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys as keysTable, messageRequest, providers, users } from "@/drizzle/schema";
import { getEnvConfig } from "@/lib/config";
import type { ProviderChainItem } from "@/types/message";

export interface UsageLogFilters {
  userId?: number;
  keyId?: number;
  providerId?: number;
  /** 本地时间字符串，格式: "YYYY-MM-DD HH:mm:ss" 或 "YYYY-MM-DDTHH:mm" */
  startDateLocal?: string;
  /** 本地时间字符串，格式: "YYYY-MM-DD HH:mm:ss" 或 "YYYY-MM-DDTHH:mm" */
  endDateLocal?: string;
  statusCode?: number;
  /** 排除 200 状态码（筛选所有非 200 的请求，包括 NULL） */
  excludeStatusCode200?: boolean;
  model?: string;
  endpoint?: string;
  /** 最低重试次数（provider_chain 长度 - 1） */
  minRetryCount?: number;
  page?: number;
  pageSize?: number;
}

export interface UsageLogRow {
  id: number;
  createdAt: Date | null;
  sessionId: string | null; // Session ID
  userName: string;
  keyName: string;
  providerName: string | null; // 改为可选：被拦截的请求没有 provider
  model: string | null;
  originalModel: string | null; // 原始模型（重定向前）
  endpoint: string | null;
  statusCode: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  totalTokens: number;
  costUsd: string | null;
  costMultiplier: string | null; // 供应商倍率
  durationMs: number | null;
  errorMessage: string | null;
  providerChain: ProviderChainItem[] | null;
  blockedBy: string | null; // 拦截类型（如 'sensitive_word'）
  blockedReason: string | null; // 拦截原因（JSON 字符串）
  userAgent: string | null; // User-Agent（客户端信息）
  messagesCount: number | null; // Messages 数量
}

export interface UsageLogSummary {
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
}

export interface UsageLogsResult {
  logs: UsageLogRow[];
  total: number;
  summary: UsageLogSummary;
}

/**
 * 查询使用日志（支持多种筛选条件和分页）
 */
/**
 * 将本地时间字符串标准化为 "YYYY-MM-DD HH:mm:ss" 格式
 * 支持输入格式: "YYYY-MM-DDTHH:mm" 或 "YYYY-MM-DD HH:mm:ss"
 */
function normalizeLocalTimeStr(input: string): string {
  // 处理 datetime-local 格式: "2025-11-26T00:00" → "2025-11-26 00:00:00"
  const normalized = input.replace("T", " ");
  // 如果没有秒数，补充 ":00"
  if (normalized.length === 16) {
    return `${normalized}:00`;
  }
  return normalized;
}

export async function findUsageLogsWithDetails(filters: UsageLogFilters): Promise<UsageLogsResult> {
  const {
    userId,
    keyId,
    providerId,
    startDateLocal,
    endDateLocal,
    statusCode,
    excludeStatusCode200,
    model,
    endpoint,
    minRetryCount,
    page = 1,
    pageSize = 50,
  } = filters;

  // 构建查询条件
  const conditions = [isNull(messageRequest.deletedAt)];

  if (userId !== undefined) {
    conditions.push(eq(messageRequest.userId, userId));
  }

  if (keyId !== undefined) {
    // 通过 key ID 查找对应的 key 值
    const keyResult = await db
      .select({ key: keysTable.key })
      .from(keysTable)
      .where(and(eq(keysTable.id, keyId), isNull(keysTable.deletedAt)))
      .limit(1);

    if (keyResult.length > 0) {
      conditions.push(eq(messageRequest.key, keyResult[0].key));
    } else {
      // key 不存在，返回空结果
      return {
        logs: [],
        total: 0,
        summary: {
          totalRequests: 0,
          totalCost: 0,
          totalTokens: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheCreationTokens: 0,
          totalCacheReadTokens: 0,
        },
      };
    }
  }

  if (providerId !== undefined) {
    conditions.push(eq(messageRequest.providerId, providerId));
  }

  // 时区感知的时间比较
  // 将数据库的 timestamptz 转换为配置的时区后，与前端传来的本地时间字符串比较
  // 注意：前端直接传递用户选择的本地时间字符串，避免 Date 序列化导致的时区问题
  const timezone = getEnvConfig().TZ;

  if (startDateLocal) {
    const localTimeStr = normalizeLocalTimeStr(startDateLocal);
    conditions.push(
      sql`(${messageRequest.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::timestamp >= ${localTimeStr}::timestamp`
    );
  }

  if (endDateLocal) {
    const localTimeStr = normalizeLocalTimeStr(endDateLocal);
    conditions.push(
      sql`(${messageRequest.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::timestamp < ${localTimeStr}::timestamp`
    );
  }

  if (statusCode !== undefined) {
    conditions.push(eq(messageRequest.statusCode, statusCode));
  } else if (excludeStatusCode200) {
    // 包含 status_code 为空或非 200 的请求
    conditions.push(
      sql`(${messageRequest.statusCode} IS NULL OR ${messageRequest.statusCode} <> 200)`
    );
  }

  if (model) {
    conditions.push(eq(messageRequest.model, model));
  }

  if (endpoint) {
    conditions.push(eq(messageRequest.endpoint, endpoint));
  }

  if (minRetryCount !== undefined) {
    // 重试次数 = provider_chain 长度 - 1（最小为 0）
    conditions.push(
      sql`GREATEST(COALESCE(jsonb_array_length(${messageRequest.providerChain}) - 1, 0), 0) >= ${minRetryCount}`
    );
  }

  // 查询总数和统计数据
  const [summaryResult] = await db
    .select({
      totalRequests: sql<number>`count(*)::double precision`,
      totalCost: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
      totalInputTokens: sql<number>`COALESCE(sum(${messageRequest.inputTokens})::double precision, 0::double precision)`,
      totalOutputTokens: sql<number>`COALESCE(sum(${messageRequest.outputTokens})::double precision, 0::double precision)`,
      totalCacheCreationTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreationInputTokens})::double precision, 0::double precision)`,
      totalCacheReadTokens: sql<number>`COALESCE(sum(${messageRequest.cacheReadInputTokens})::double precision, 0::double precision)`,
    })
    .from(messageRequest)
    .where(and(...conditions));

  const total = summaryResult?.totalRequests ?? 0;
  const totalCost = parseFloat(summaryResult?.totalCost ?? "0");
  const totalTokens =
    (summaryResult?.totalInputTokens ?? 0) +
    (summaryResult?.totalOutputTokens ?? 0) +
    (summaryResult?.totalCacheCreationTokens ?? 0) +
    (summaryResult?.totalCacheReadTokens ?? 0);

  // 查询分页数据（使用 LEFT JOIN 以包含被拦截的请求）
  const offset = (page - 1) * pageSize;
  const results = await db
    .select({
      id: messageRequest.id,
      createdAt: messageRequest.createdAt,
      sessionId: messageRequest.sessionId, // Session ID
      userName: users.name,
      keyName: keysTable.name,
      providerName: providers.name, // 被拦截的请求为 null
      model: messageRequest.model,
      originalModel: messageRequest.originalModel, // 原始模型（重定向前）
      endpoint: messageRequest.endpoint,
      statusCode: messageRequest.statusCode,
      inputTokens: messageRequest.inputTokens,
      outputTokens: messageRequest.outputTokens,
      cacheCreationInputTokens: messageRequest.cacheCreationInputTokens,
      cacheReadInputTokens: messageRequest.cacheReadInputTokens,
      costUsd: messageRequest.costUsd,
      costMultiplier: messageRequest.costMultiplier, // 供应商倍率
      durationMs: messageRequest.durationMs,
      errorMessage: messageRequest.errorMessage,
      providerChain: messageRequest.providerChain,
      blockedBy: messageRequest.blockedBy, // 拦截类型
      blockedReason: messageRequest.blockedReason, // 拦截原因
      userAgent: messageRequest.userAgent, // User-Agent
      messagesCount: messageRequest.messagesCount, // Messages 数量
    })
    .from(messageRequest)
    .innerJoin(users, eq(messageRequest.userId, users.id))
    .innerJoin(keysTable, eq(messageRequest.key, keysTable.key))
    .leftJoin(providers, eq(messageRequest.providerId, providers.id)) // 改为 leftJoin
    .where(and(...conditions))
    .orderBy(desc(messageRequest.createdAt))
    .limit(pageSize)
    .offset(offset);

  const logs: UsageLogRow[] = results.map((row) => {
    const totalRowTokens =
      (row.inputTokens ?? 0) +
      (row.outputTokens ?? 0) +
      (row.cacheCreationInputTokens ?? 0) +
      (row.cacheReadInputTokens ?? 0);

    return {
      ...row,
      totalTokens: totalRowTokens,
      costUsd: row.costUsd?.toString() ?? null,
      providerChain: row.providerChain as ProviderChainItem[] | null,
      endpoint: row.endpoint,
    };
  });

  return {
    logs,
    total,
    summary: {
      totalRequests: total,
      totalCost,
      totalTokens,
      totalInputTokens: summaryResult?.totalInputTokens ?? 0,
      totalOutputTokens: summaryResult?.totalOutputTokens ?? 0,
      totalCacheCreationTokens: summaryResult?.totalCacheCreationTokens ?? 0,
      totalCacheReadTokens: summaryResult?.totalCacheReadTokens ?? 0,
    },
  };
}

/**
 * 获取所有使用过的模型列表（用于筛选器）
 */
export async function getUsedModels(): Promise<string[]> {
  const results = await db
    .selectDistinct({ model: messageRequest.model })
    .from(messageRequest)
    .where(and(isNull(messageRequest.deletedAt), sql`${messageRequest.model} IS NOT NULL`))
    .orderBy(messageRequest.model);

  return results.map((r) => r.model).filter((m): m is string => m !== null);
}

/**
 * 获取所有使用过的状态码列表（用于筛选器）
 */
export async function getUsedStatusCodes(): Promise<number[]> {
  const results = await db
    .selectDistinct({ statusCode: messageRequest.statusCode })
    .from(messageRequest)
    .where(and(isNull(messageRequest.deletedAt), sql`${messageRequest.statusCode} IS NOT NULL`))
    .orderBy(messageRequest.statusCode);

  return results.map((r) => r.statusCode).filter((c): c is number => c !== null);
}

/**
 * 获取所有使用过的 Endpoint 列表（用于筛选器）
 */
export async function getUsedEndpoints(): Promise<string[]> {
  const results = await db
    .selectDistinct({ endpoint: messageRequest.endpoint })
    .from(messageRequest)
    .where(and(isNull(messageRequest.deletedAt), sql`${messageRequest.endpoint} IS NOT NULL`))
    .orderBy(messageRequest.endpoint);

  return results.map((r) => r.endpoint).filter((e): e is string => e !== null);
}
