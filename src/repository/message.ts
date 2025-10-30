"use server";

import { db } from "@/drizzle/db";
import { messageRequest, users, keys as keysTable, providers } from "@/drizzle/schema";
import { eq, isNull, and, desc, sql } from "drizzle-orm";
import type { MessageRequest, CreateMessageRequestData } from "@/types/message";
import { toMessageRequest } from "./_shared/transformers";
import { formatCostForStorage } from "@/lib/utils/currency";
import type { PrivacyFilterContext } from "@/lib/utils/privacy-filter";

/**
 * 创建消息请求记录
 */
export async function createMessageRequest(
  data: CreateMessageRequestData
): Promise<MessageRequest> {
  const formattedCost = formatCostForStorage(data.cost_usd);
  const dbData = {
    providerId: data.provider_id,
    userId: data.user_id,
    key: data.key,
    model: data.model,
    durationMs: data.duration_ms,
    costUsd: formattedCost ?? undefined,
    costMultiplier: data.cost_multiplier?.toString() ?? undefined, // 供应商倍率（转为字符串）
    sessionId: data.session_id, // Session ID
    userAgent: data.user_agent, // User-Agent
    messagesCount: data.messages_count, // Messages 数量
  };

  const [result] = await db.insert(messageRequest).values(dbData).returning({
    id: messageRequest.id,
    providerId: messageRequest.providerId,
    userId: messageRequest.userId,
    key: messageRequest.key,
    model: messageRequest.model,
    durationMs: messageRequest.durationMs,
    costUsd: messageRequest.costUsd,
    costMultiplier: messageRequest.costMultiplier, // 新增
    sessionId: messageRequest.sessionId, // 新增
    userAgent: messageRequest.userAgent, // 新增
    messagesCount: messageRequest.messagesCount, // 新增
    createdAt: messageRequest.createdAt,
    updatedAt: messageRequest.updatedAt,
    deletedAt: messageRequest.deletedAt,
  });

  return toMessageRequest(result);
}

/**
 * 更新消息请求的耗时
 */
export async function updateMessageRequestDuration(id: number, durationMs: number): Promise<void> {
  await db
    .update(messageRequest)
    .set({
      durationMs: durationMs,
      updatedAt: new Date(),
    })
    .where(eq(messageRequest.id, id));
}

/**
 * 更新消息请求的费用
 */
export async function updateMessageRequestCost(
  id: number,
  costUsd: CreateMessageRequestData["cost_usd"]
): Promise<void> {
  const formattedCost = formatCostForStorage(costUsd);
  if (!formattedCost) {
    return;
  }

  await db
    .update(messageRequest)
    .set({
      costUsd: formattedCost,
      updatedAt: new Date(),
    })
    .where(eq(messageRequest.id, id));
}

/**
 * 更新消息请求的扩展信息（status code, tokens, provider chain, error）
 */
export async function updateMessageRequestDetails(
  id: number,
  details: {
    statusCode?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    providerChain?: CreateMessageRequestData["provider_chain"];
    errorMessage?: string;
  }
): Promise<void> {
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (details.statusCode !== undefined) {
    updateData.statusCode = details.statusCode;
  }
  if (details.inputTokens !== undefined) {
    updateData.inputTokens = details.inputTokens;
  }
  if (details.outputTokens !== undefined) {
    updateData.outputTokens = details.outputTokens;
  }
  if (details.cacheCreationInputTokens !== undefined) {
    updateData.cacheCreationInputTokens = details.cacheCreationInputTokens;
  }
  if (details.cacheReadInputTokens !== undefined) {
    updateData.cacheReadInputTokens = details.cacheReadInputTokens;
  }
  if (details.providerChain !== undefined) {
    updateData.providerChain = details.providerChain;
  }
  if (details.errorMessage !== undefined) {
    updateData.errorMessage = details.errorMessage;
  }

  await db.update(messageRequest).set(updateData).where(eq(messageRequest.id, id));
}

/**
 * 根据用户ID查询消息请求记录（分页）
 */
export async function findLatestMessageRequestByKey(key: string): Promise<MessageRequest | null> {
  const [result] = await db
    .select({
      id: messageRequest.id,
      providerId: messageRequest.providerId,
      userId: messageRequest.userId,
      key: messageRequest.key,
      durationMs: messageRequest.durationMs,
      costUsd: messageRequest.costUsd,
      createdAt: messageRequest.createdAt,
      updatedAt: messageRequest.updatedAt,
      deletedAt: messageRequest.deletedAt,
    })
    .from(messageRequest)
    .where(and(eq(messageRequest.key, key), isNull(messageRequest.deletedAt)))
    .orderBy(desc(messageRequest.createdAt))
    .limit(1);

  if (!result) return null;
  return toMessageRequest(result);
}

/**
 * 根据 session ID 查询消息请求记录（用于获取完整元数据）
 * 返回该 session 的最后一条记录（最新的）
 */
export async function findMessageRequestBySessionId(
  sessionId: string
): Promise<MessageRequest | null> {
  const [result] = await db
    .select({
      id: messageRequest.id,
      providerId: messageRequest.providerId,
      userId: messageRequest.userId,
      key: messageRequest.key,
      model: messageRequest.model,
      originalModel: messageRequest.originalModel,
      durationMs: messageRequest.durationMs,
      costUsd: messageRequest.costUsd,
      costMultiplier: messageRequest.costMultiplier,
      sessionId: messageRequest.sessionId,
      userAgent: messageRequest.userAgent,
      messagesCount: messageRequest.messagesCount,
      statusCode: messageRequest.statusCode,
      inputTokens: messageRequest.inputTokens,
      outputTokens: messageRequest.outputTokens,
      cacheCreationInputTokens: messageRequest.cacheCreationInputTokens,
      cacheReadInputTokens: messageRequest.cacheReadInputTokens,
      errorMessage: messageRequest.errorMessage,
      providerChain: messageRequest.providerChain,
      blockedBy: messageRequest.blockedBy,
      blockedReason: messageRequest.blockedReason,
      createdAt: messageRequest.createdAt,
      updatedAt: messageRequest.updatedAt,
      deletedAt: messageRequest.deletedAt,
    })
    .from(messageRequest)
    .where(and(eq(messageRequest.sessionId, sessionId), isNull(messageRequest.deletedAt)))
    .orderBy(desc(messageRequest.createdAt))
    .limit(1);

  if (!result) return null;
  return toMessageRequest(result);
}

/**
 * 构建条件化的金额聚合表达式
 * 用于 session 统计
 */
function buildSumCostExpression(context: PrivacyFilterContext) {
  // 管理员或不忽略倍率：SUM(cost_usd * cost_multiplier)
  if (context.isAdmin || !context.ignoreMultiplier) {
    return sql<string>`COALESCE(SUM(${messageRequest.costUsd} * COALESCE(${messageRequest.costMultiplier}, 1.0)), 0)`;
  }
  // 非管理员且忽略倍率：SUM(cost_usd)
  return sql<string>`COALESCE(SUM(${messageRequest.costUsd}), 0)`;
}

/**
 * 聚合查询指定 session 的所有请求数据
 * 返回总成本、总 Token、请求次数、供应商列表等
 *
 * @param sessionId - Session ID
 * @param privacyContext 隐私过滤上下文（决定金额计算方式）
 * @returns 聚合统计数据，如果 session 不存在返回 null
 */
export async function aggregateSessionStats(
  sessionId: string,
  privacyContext: PrivacyFilterContext
): Promise<{
  sessionId: string;
  requestCount: number;
  totalCostUsd: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalDurationMs: number;
  firstRequestAt: Date | null;
  lastRequestAt: Date | null;
  providers: Array<{ id: number; name: string }>;
  models: string[];
  userName: string;
  userId: number;
  keyName: string;
  keyId: number;
  userAgent: string | null;
  apiType: string | null;
} | null> {
  // 1. 聚合统计
  const costExpression = buildSumCostExpression(privacyContext);

  const [stats] = await db
    .select({
      requestCount: sql<number>`count(*)::int`,
      totalCostUsd: costExpression,
      totalInputTokens: sql<number>`COALESCE(sum(${messageRequest.inputTokens}), 0)::int`,
      totalOutputTokens: sql<number>`COALESCE(sum(${messageRequest.outputTokens}), 0)::int`,
      totalCacheCreationTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreationInputTokens}), 0)::int`,
      totalCacheReadTokens: sql<number>`COALESCE(sum(${messageRequest.cacheReadInputTokens}), 0)::int`,
      totalDurationMs: sql<number>`COALESCE(sum(${messageRequest.durationMs}), 0)::int`,
      firstRequestAt: sql<Date>`min(${messageRequest.createdAt})`,
      lastRequestAt: sql<Date>`max(${messageRequest.createdAt})`,
    })
    .from(messageRequest)
    .where(and(eq(messageRequest.sessionId, sessionId), isNull(messageRequest.deletedAt)));

  if (!stats || stats.requestCount === 0) {
    return null;
  }

  // 2. 查询供应商列表（去重）
  const providerList = await db
    .selectDistinct({
      providerId: messageRequest.providerId,
      providerName: providers.name,
    })
    .from(messageRequest)
    .leftJoin(providers, eq(messageRequest.providerId, providers.id))
    .where(
      and(
        eq(messageRequest.sessionId, sessionId),
        isNull(messageRequest.deletedAt),
        sql`${messageRequest.providerId} IS NOT NULL`
      )
    );

  // 3. 查询模型列表（去重）
  const modelList = await db
    .selectDistinct({ model: messageRequest.model })
    .from(messageRequest)
    .where(
      and(
        eq(messageRequest.sessionId, sessionId),
        isNull(messageRequest.deletedAt),
        sql`${messageRequest.model} IS NOT NULL`
      )
    );

  // 4. 获取用户信息（第一条请求）
  const [userInfo] = await db
    .select({
      userName: users.name,
      userId: users.id,
      keyName: keysTable.name,
      keyId: keysTable.id,
      userAgent: messageRequest.userAgent,
      apiType: messageRequest.apiType,
    })
    .from(messageRequest)
    .innerJoin(users, eq(messageRequest.userId, users.id))
    .innerJoin(keysTable, eq(messageRequest.key, keysTable.key))
    .where(and(eq(messageRequest.sessionId, sessionId), isNull(messageRequest.deletedAt)))
    .orderBy(messageRequest.createdAt)
    .limit(1);

  if (!userInfo) {
    return null;
  }

  return {
    sessionId,
    requestCount: stats.requestCount,
    totalCostUsd: stats.totalCostUsd,
    totalInputTokens: stats.totalInputTokens,
    totalOutputTokens: stats.totalOutputTokens,
    totalCacheCreationTokens: stats.totalCacheCreationTokens,
    totalCacheReadTokens: stats.totalCacheReadTokens,
    totalDurationMs: stats.totalDurationMs,
    firstRequestAt: stats.firstRequestAt,
    lastRequestAt: stats.lastRequestAt,
    providers: providerList.map((p) => ({
      id: p.providerId!,
      name: p.providerName || "未知",
    })),
    models: modelList.map((m) => m.model!),
    userName: userInfo.userName,
    userId: userInfo.userId,
    keyName: userInfo.keyName,
    keyId: userInfo.keyId,
    userAgent: userInfo.userAgent,
    apiType: userInfo.apiType,
  };
}

/**
 * 查询使用日志（支持分页、时间筛选、模型筛选）
 */
export async function findUsageLogs(params: {
  userId?: number;
  startDate?: Date;
  endDate?: Date;
  model?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ logs: MessageRequest[]; total: number }> {
  const { userId, startDate, endDate, model, page = 1, pageSize = 50 } = params;

  const conditions = [isNull(messageRequest.deletedAt)];

  if (userId !== undefined) {
    conditions.push(eq(messageRequest.userId, userId));
  }

  if (startDate) {
    conditions.push(sql`${messageRequest.createdAt} >= ${startDate}`);
  }

  if (endDate) {
    conditions.push(sql`${messageRequest.createdAt} <= ${endDate}`);
  }

  if (model) {
    conditions.push(eq(messageRequest.model, model));
  }

  // 查询总数
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messageRequest)
    .where(and(...conditions));

  const total = countResult?.count ?? 0;

  // 查询分页数据
  const offset = (page - 1) * pageSize;
  const results = await db
    .select()
    .from(messageRequest)
    .where(and(...conditions))
    .orderBy(desc(messageRequest.createdAt))
    .limit(pageSize)
    .offset(offset);

  const logs = results.map(toMessageRequest);

  return { logs, total };
}
