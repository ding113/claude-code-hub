"use server";

import { db } from "@/drizzle/db";
import { messageRequest, users, keys as keysTable, providers } from "@/drizzle/schema";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import type { ProviderChainItem } from "@/types/message";
import { getEnvConfig } from "@/lib/config";
import type { PrivacyFilterContext } from "@/lib/utils/privacy-filter";

export interface UsageLogFilters {
  userId?: number;
  keyId?: number;
  providerId?: number;
  startDate?: Date;
  endDate?: Date;
  statusCode?: number;
  model?: string;
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
 * 构建条件化的金额聚合 SQL
 * 用于统计总成本
 */
function buildSumCostSQL(context: PrivacyFilterContext): string {
  // 管理员或不忽略倍率：SUM(cost_usd * cost_multiplier)
  if (context.isAdmin || !context.ignoreMultiplier) {
    return "COALESCE(SUM(message_request.cost_usd * COALESCE(message_request.cost_multiplier, 1.0)), 0)";
  }
  // 非管理员且忽略倍率：SUM(cost_usd)
  return "COALESCE(SUM(message_request.cost_usd), 0)";
}

/**
 * 查询使用日志（支持多种筛选条件和分页）
 *
 * @param filters 筛选条件
 * @param privacyContext 隐私过滤上下文（决定金额计算方式）
 */
export async function findUsageLogsWithDetails(
  filters: UsageLogFilters,
  privacyContext: PrivacyFilterContext
): Promise<UsageLogsResult> {
  const {
    userId,
    keyId,
    providerId,
    startDate,
    endDate,
    statusCode,
    model,
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
  // 将数据库的 timestamptz 转换为本地时区（Asia/Shanghai）后再与前端传来的本地时间比较
  const timezone = getEnvConfig().TZ;

  if (startDate) {
    // 从 Date 对象提取本地时间（不要用 toISOString，那会转换为 UTC）
    const year = startDate.getFullYear();
    const month = String(startDate.getMonth() + 1).padStart(2, "0");
    const day = String(startDate.getDate()).padStart(2, "0");
    const hours = String(startDate.getHours()).padStart(2, "0");
    const minutes = String(startDate.getMinutes()).padStart(2, "0");
    const seconds = String(startDate.getSeconds()).padStart(2, "0");
    const localTimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

    conditions.push(
      sql`(${messageRequest.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::timestamp >= ${localTimeStr}::timestamp`
    );
  }

  if (endDate) {
    const year = endDate.getFullYear();
    const month = String(endDate.getMonth() + 1).padStart(2, "0");
    const day = String(endDate.getDate()).padStart(2, "0");
    const hours = String(endDate.getHours()).padStart(2, "0");
    const minutes = String(endDate.getMinutes()).padStart(2, "0");
    const seconds = String(endDate.getSeconds()).padStart(2, "0");
    const localTimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

    conditions.push(
      sql`(${messageRequest.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::timestamp < ${localTimeStr}::timestamp`
    );
  }

  if (statusCode !== undefined) {
    conditions.push(eq(messageRequest.statusCode, statusCode));
  }

  if (model) {
    conditions.push(eq(messageRequest.model, model));
  }

  // 查询总数和统计数据
  const costSumSQL = buildSumCostSQL(privacyContext);

  const [summaryResult] = await db
    .select({
      totalRequests: sql<number>`count(*)::int`,
      totalCost: sql<string>`${sql.raw(costSumSQL)}`,
      totalInputTokens: sql<number>`COALESCE(sum(${messageRequest.inputTokens}), 0)::int`,
      totalOutputTokens: sql<number>`COALESCE(sum(${messageRequest.outputTokens}), 0)::int`,
      totalCacheCreationTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreationInputTokens}), 0)::int`,
      totalCacheReadTokens: sql<number>`COALESCE(sum(${messageRequest.cacheReadInputTokens}), 0)::int`,
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
