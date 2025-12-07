"use server";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys as keysTable, messageRequest, providers, users } from "@/drizzle/schema";
import type { ProviderChainItem } from "@/types/message";

export interface UsageLogFilters {
  userId?: number;
  keyId?: number;
  providerId?: number;
  /** 开始时间戳（毫秒），用于 >= 比较 */
  startTime?: number;
  /** 结束时间戳（毫秒），用于 < 比较 */
  endTime?: number;
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
  requestSequence: number | null; // Request Sequence（Session 内请求序号）
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
  cacheCreation5mInputTokens: number | null;
  cacheCreation1hInputTokens: number | null;
  cacheTtlApplied: string | null;
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
  totalCacheCreation5mTokens: number;
  totalCacheCreation1hTokens: number;
}

export interface UsageLogsResult {
  logs: UsageLogRow[];
  total: number;
  summary: UsageLogSummary;
}

export async function getTotalUsageForKey(keyString: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)` })
    .from(messageRequest)
    .where(and(eq(messageRequest.key, keyString), isNull(messageRequest.deletedAt)));

  return Number(row?.total ?? 0);
}

export async function getDistinctModelsForKey(keyString: string): Promise<string[]> {
  const result = await db.execute(
    sql`select distinct coalesce(${messageRequest.originalModel}, ${messageRequest.model}) as model
        from ${messageRequest}
        where ${messageRequest.key} = ${keyString}
          and ${messageRequest.deletedAt} is null
        order by model asc`
  );

  return Array.from(result)
    .map((row) => (row as { model?: string }).model)
    .filter((model): model is string => !!model && model.trim().length > 0);
}

export async function getDistinctEndpointsForKey(keyString: string): Promise<string[]> {
  const result = await db.execute(
    sql`select distinct ${messageRequest.endpoint} as endpoint
        from ${messageRequest}
        where ${messageRequest.key} = ${keyString}
          and ${messageRequest.deletedAt} is null
          and ${messageRequest.endpoint} is not null
        order by endpoint asc`
  );

  return Array.from(result)
    .map((row) => (row as { endpoint?: string }).endpoint)
    .filter((endpoint): endpoint is string => !!endpoint && endpoint.trim().length > 0);
}

/**
 * 查询使用日志（支持多种筛选条件和分页）
 */

export async function findUsageLogsWithDetails(filters: UsageLogFilters): Promise<UsageLogsResult> {
  const {
    userId,
    keyId,
    providerId,
    startTime,
    endTime,
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
          totalCacheCreation5mTokens: 0,
          totalCacheCreation1hTokens: 0,
        },
      };
    }
  }

  if (providerId !== undefined) {
    conditions.push(eq(messageRequest.providerId, providerId));
  }

  // 使用毫秒时间戳进行时间比较
  // 前端传递的是浏览器本地时区的毫秒时间戳，直接与数据库的 timestamptz 比较
  // PostgreSQL 会自动处理时区转换
  if (startTime !== undefined) {
    const startDate = new Date(startTime);
    conditions.push(sql`${messageRequest.createdAt} >= ${startDate.toISOString()}::timestamptz`);
  }

  if (endTime !== undefined) {
    const endDate = new Date(endTime);
    conditions.push(sql`${messageRequest.createdAt} < ${endDate.toISOString()}::timestamptz`);
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
      totalCacheCreation5mTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreation5mInputTokens})::double precision, 0::double precision)`,
      totalCacheCreation1hTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreation1hInputTokens})::double precision, 0::double precision)`,
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
      requestSequence: messageRequest.requestSequence, // Request Sequence
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
      cacheCreation5mInputTokens: messageRequest.cacheCreation5mInputTokens,
      cacheCreation1hInputTokens: messageRequest.cacheCreation1hInputTokens,
      cacheTtlApplied: messageRequest.cacheTtlApplied,
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
      requestSequence: row.requestSequence ?? null,
      totalTokens: totalRowTokens,
      cacheCreation5mInputTokens: row.cacheCreation5mInputTokens,
      cacheCreation1hInputTokens: row.cacheCreation1hInputTokens,
      cacheTtlApplied: row.cacheTtlApplied,
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
      totalCacheCreation5mTokens: summaryResult?.totalCacheCreation5mTokens ?? 0,
      totalCacheCreation1hTokens: summaryResult?.totalCacheCreation1hTokens ?? 0,
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
