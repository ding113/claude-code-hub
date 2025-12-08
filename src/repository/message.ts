"use server";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys as keysTable, messageRequest, providers, users } from "@/drizzle/schema";
import { formatCostForStorage } from "@/lib/utils/currency";
import type { CreateMessageRequestData, MessageRequest } from "@/types/message";
import { toMessageRequest } from "./_shared/transformers";

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
    originalModel: data.original_model, // 原始模型（重定向前，用于计费和前端显示）
    durationMs: data.duration_ms,
    costUsd: formattedCost ?? undefined,
    costMultiplier: data.cost_multiplier?.toString() ?? undefined, // 供应商倍率（转为字符串）
    sessionId: data.session_id, // Session ID
    requestSequence: data.request_sequence, // Request Sequence（Session 内请求序号）
    userAgent: data.user_agent, // User-Agent
    endpoint: data.endpoint, // 请求端点（可为空）
    messagesCount: data.messages_count, // Messages 数量
    cacheTtlApplied: data.cache_ttl_applied,
    cacheCreationInputTokens: data.cache_creation_input_tokens,
    cacheCreation5mInputTokens: data.cache_creation_5m_input_tokens,
    cacheCreation1hInputTokens: data.cache_creation_1h_input_tokens,
    cacheReadInputTokens: data.cache_read_input_tokens,
  };

  const [result] = await db.insert(messageRequest).values(dbData).returning({
    id: messageRequest.id,
    providerId: messageRequest.providerId,
    userId: messageRequest.userId,
    key: messageRequest.key,
    model: messageRequest.model,
    originalModel: messageRequest.originalModel, // 原始模型（重定向前）
    durationMs: messageRequest.durationMs,
    costUsd: messageRequest.costUsd,
    costMultiplier: messageRequest.costMultiplier, // 新增
    sessionId: messageRequest.sessionId, // 新增
    requestSequence: messageRequest.requestSequence, // Request Sequence
    userAgent: messageRequest.userAgent, // 新增
    endpoint: messageRequest.endpoint, // 新增：返回端点
    messagesCount: messageRequest.messagesCount, // 新增
    cacheTtlApplied: messageRequest.cacheTtlApplied,
    cacheCreationInputTokens: messageRequest.cacheCreationInputTokens,
    cacheCreation5mInputTokens: messageRequest.cacheCreation5mInputTokens,
    cacheCreation1hInputTokens: messageRequest.cacheCreation1hInputTokens,
    cacheReadInputTokens: messageRequest.cacheReadInputTokens,
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
    cacheCreation5mInputTokens?: number;
    cacheCreation1hInputTokens?: number;
    cacheTtlApplied?: string | null;
    providerChain?: CreateMessageRequestData["provider_chain"];
    errorMessage?: string;
    model?: string; // ⭐ 新增：支持更新重定向后的模型名称
    providerId?: number; // ⭐ 新增：支持更新最终供应商ID（重试切换后）
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
  if (details.cacheCreation5mInputTokens !== undefined) {
    updateData.cacheCreation5mInputTokens = details.cacheCreation5mInputTokens;
  }
  if (details.cacheCreation1hInputTokens !== undefined) {
    updateData.cacheCreation1hInputTokens = details.cacheCreation1hInputTokens;
  }
  if (details.cacheTtlApplied !== undefined) {
    updateData.cacheTtlApplied = details.cacheTtlApplied;
  }
  if (details.providerChain !== undefined) {
    updateData.providerChain = details.providerChain;
  }
  if (details.errorMessage !== undefined) {
    updateData.errorMessage = details.errorMessage;
  }
  if (details.model !== undefined) {
    updateData.model = details.model;
  }
  if (details.providerId !== undefined) {
    updateData.providerId = details.providerId;
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
      cacheCreation5mInputTokens: messageRequest.cacheCreation5mInputTokens,
      cacheCreation1hInputTokens: messageRequest.cacheCreation1hInputTokens,
      cacheTtlApplied: messageRequest.cacheTtlApplied,
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
 * 聚合查询指定 session 的所有请求数据
 * 返回总成本、总 Token、请求次数、供应商列表等
 *
 * @param sessionId - Session ID
 * @returns 聚合统计数据，如果 session 不存在返回 null
 */
export async function aggregateSessionStats(sessionId: string): Promise<{
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
  cacheTtlApplied: string | null;
} | null> {
  // 1. 聚合统计
  const [stats] = await db
    .select({
      requestCount: sql<number>`count(*)::double precision`,
      totalCostUsd: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
      totalInputTokens: sql<number>`COALESCE(sum(${messageRequest.inputTokens})::double precision, 0::double precision)`,
      totalOutputTokens: sql<number>`COALESCE(sum(${messageRequest.outputTokens})::double precision, 0::double precision)`,
      totalCacheCreationTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreationInputTokens})::double precision, 0::double precision)`,
      totalCacheReadTokens: sql<number>`COALESCE(sum(${messageRequest.cacheReadInputTokens})::double precision, 0::double precision)`,
      totalDurationMs: sql<number>`COALESCE(sum(${messageRequest.durationMs})::double precision, 0::double precision)`,
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

  // 3.1 查询 Cache TTL 列表（去重，用于显示缓存时间信息）
  const cacheTtlList = await db
    .selectDistinct({ cacheTtl: messageRequest.cacheTtlApplied })
    .from(messageRequest)
    .where(
      and(
        eq(messageRequest.sessionId, sessionId),
        isNull(messageRequest.deletedAt),
        sql`${messageRequest.cacheTtlApplied} IS NOT NULL`
      )
    );

  // 聚合 Cache TTL：单一值直接返回，多值返回 "mixed"
  const uniqueCacheTtls = cacheTtlList.map((c) => c.cacheTtl).filter(Boolean) as string[];
  const cacheTtlApplied =
    uniqueCacheTtls.length === 0
      ? null
      : uniqueCacheTtls.length === 1
        ? uniqueCacheTtls[0]
        : "mixed";

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
    cacheTtlApplied,
  };
}

/**
 * 批量聚合多个 session 的统计数据（性能优化版本）
 *
 * 使用单次 SQL 查询获取所有 session 的聚合数据，避免 N+1 查询问题
 *
 * @param sessionIds - Session ID 列表
 * @returns 聚合统计数据数组
 */
export async function aggregateMultipleSessionStats(sessionIds: string[]): Promise<
  Array<{
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
    cacheTtlApplied: string | null;
  }>
> {
  if (sessionIds.length === 0) {
    return [];
  }

  // 1. 批量聚合统计（单次查询）
  const statsResults = await db
    .select({
      sessionId: messageRequest.sessionId,
      requestCount: sql<number>`count(*)::double precision`,
      totalCostUsd: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
      totalInputTokens: sql<number>`COALESCE(sum(${messageRequest.inputTokens})::double precision, 0::double precision)`,
      totalOutputTokens: sql<number>`COALESCE(sum(${messageRequest.outputTokens})::double precision, 0::double precision)`,
      totalCacheCreationTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreationInputTokens})::double precision, 0::double precision)`,
      totalCacheReadTokens: sql<number>`COALESCE(sum(${messageRequest.cacheReadInputTokens})::double precision, 0::double precision)`,
      totalDurationMs: sql<number>`COALESCE(sum(${messageRequest.durationMs})::double precision, 0::double precision)`,
      firstRequestAt: sql<Date>`min(${messageRequest.createdAt})`,
      lastRequestAt: sql<Date>`max(${messageRequest.createdAt})`,
    })
    .from(messageRequest)
    .where(and(inArray(messageRequest.sessionId, sessionIds), isNull(messageRequest.deletedAt)))
    .groupBy(messageRequest.sessionId);

  // 创建 sessionId → stats 的 Map
  const statsMap = new Map(statsResults.map((s) => [s.sessionId, s]));

  // 2. 批量查询供应商列表（按 session 分组）
  const providerResults = await db
    .selectDistinct({
      sessionId: messageRequest.sessionId,
      providerId: messageRequest.providerId,
      providerName: providers.name,
    })
    .from(messageRequest)
    .leftJoin(providers, eq(messageRequest.providerId, providers.id))
    .where(
      and(
        inArray(messageRequest.sessionId, sessionIds),
        isNull(messageRequest.deletedAt),
        sql`${messageRequest.providerId} IS NOT NULL`
      )
    );

  // 创建 sessionId → providers 的 Map
  const providersMap = new Map<string, Array<{ id: number; name: string }>>();
  for (const p of providerResults) {
    // 跳过 null sessionId（虽然 WHERE 条件已过滤，但需要满足 TypeScript 类型检查）
    if (!p.sessionId) continue;

    if (!providersMap.has(p.sessionId)) {
      providersMap.set(p.sessionId, []);
    }
    providersMap.get(p.sessionId)?.push({
      id: p.providerId!,
      name: p.providerName || "未知",
    });
  }

  // 3. 批量查询模型列表（按 session 分组）
  const modelResults = await db
    .selectDistinct({
      sessionId: messageRequest.sessionId,
      model: messageRequest.model,
    })
    .from(messageRequest)
    .where(
      and(
        inArray(messageRequest.sessionId, sessionIds),
        isNull(messageRequest.deletedAt),
        sql`${messageRequest.model} IS NOT NULL`
      )
    );

  // 创建 sessionId → models 的 Map
  const modelsMap = new Map<string, string[]>();
  for (const m of modelResults) {
    // 跳过 null sessionId（虽然 WHERE 条件已过滤，但需要满足 TypeScript 类型检查）
    if (!m.sessionId) continue;

    if (!modelsMap.has(m.sessionId)) {
      modelsMap.set(m.sessionId, []);
    }
    modelsMap.get(m.sessionId)?.push(m.model!);
  }

  // 3.1 批量查询 Cache TTL 列表（按 session 分组）
  const cacheTtlResults = await db
    .selectDistinct({
      sessionId: messageRequest.sessionId,
      cacheTtl: messageRequest.cacheTtlApplied,
    })
    .from(messageRequest)
    .where(
      and(
        inArray(messageRequest.sessionId, sessionIds),
        isNull(messageRequest.deletedAt),
        sql`${messageRequest.cacheTtlApplied} IS NOT NULL`
      )
    );

  // 创建 sessionId → cacheTtls 的 Map
  const cacheTtlMap = new Map<string, string[]>();
  for (const c of cacheTtlResults) {
    if (!c.sessionId) continue;

    if (!cacheTtlMap.has(c.sessionId)) {
      cacheTtlMap.set(c.sessionId, []);
    }
    if (c.cacheTtl) {
      cacheTtlMap.get(c.sessionId)?.push(c.cacheTtl);
    }
  }

  // 4. 批量获取用户信息（每个 session 的第一条请求）
  // 使用 DISTINCT ON + ORDER BY 优化
  const userInfoResults = await db
    .select({
      sessionId: messageRequest.sessionId,
      userName: users.name,
      userId: users.id,
      keyName: keysTable.name,
      keyId: keysTable.id,
      userAgent: messageRequest.userAgent,
      apiType: messageRequest.apiType,
      createdAt: messageRequest.createdAt,
    })
    .from(messageRequest)
    .innerJoin(users, eq(messageRequest.userId, users.id))
    .innerJoin(keysTable, eq(messageRequest.key, keysTable.key))
    .where(and(inArray(messageRequest.sessionId, sessionIds), isNull(messageRequest.deletedAt)))
    .orderBy(messageRequest.sessionId, messageRequest.createdAt);

  // 创建 sessionId → userInfo 的 Map（取每个 session 最早的记录）
  const userInfoMap = new Map<string, (typeof userInfoResults)[0]>();
  for (const info of userInfoResults) {
    // 跳过 null sessionId（虽然 WHERE 条件已过滤，但需要满足 TypeScript 类型检查）
    if (!info.sessionId) continue;

    if (!userInfoMap.has(info.sessionId)) {
      userInfoMap.set(info.sessionId, info);
    }
  }

  // 5. 组装最终结果
  const results: Awaited<ReturnType<typeof aggregateMultipleSessionStats>> = [];

  for (const sessionId of sessionIds) {
    const stats = statsMap.get(sessionId);
    const userInfo = userInfoMap.get(sessionId);

    // 跳过没有数据的 session
    if (!stats || !userInfo || stats.requestCount === 0) {
      continue;
    }

    results.push({
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
      providers: providersMap.get(sessionId) || [],
      models: modelsMap.get(sessionId) || [],
      userName: userInfo.userName,
      userId: userInfo.userId,
      keyName: userInfo.keyName,
      keyId: userInfo.keyId,
      userAgent: userInfo.userAgent,
      apiType: userInfo.apiType,
      cacheTtlApplied: (() => {
        const ttls = cacheTtlMap.get(sessionId) || [];
        if (ttls.length === 0) return null;
        if (ttls.length === 1) return ttls[0];
        return "mixed";
      })(),
    });
  }

  return results;
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

/**
 * 查询指定 Session 的所有请求记录（用于 Session 详情页的请求列表）
 *
 * @param sessionId - Session ID
 * @param options - 分页参数
 * @returns 请求列表和总数
 */
export async function findRequestsBySessionId(
  sessionId: string,
  options?: { limit?: number; offset?: number }
): Promise<{
  requests: Array<{
    id: number;
    sequence: number;
    model: string | null;
    statusCode: number | null;
    costUsd: string | null;
    createdAt: Date | null;
    inputTokens: number | null;
    outputTokens: number | null;
    errorMessage: string | null;
  }>;
  total: number;
}> {
  const { limit = 20, offset = 0 } = options || {};

  // 查询总数
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messageRequest)
    .where(and(eq(messageRequest.sessionId, sessionId), isNull(messageRequest.deletedAt)));

  const total = countResult?.count ?? 0;

  // 查询分页数据，按 requestSequence 排序
  const results = await db
    .select({
      id: messageRequest.id,
      sequence: messageRequest.requestSequence,
      model: messageRequest.model,
      statusCode: messageRequest.statusCode,
      costUsd: messageRequest.costUsd,
      createdAt: messageRequest.createdAt,
      inputTokens: messageRequest.inputTokens,
      outputTokens: messageRequest.outputTokens,
      errorMessage: messageRequest.errorMessage,
    })
    .from(messageRequest)
    .where(and(eq(messageRequest.sessionId, sessionId), isNull(messageRequest.deletedAt)))
    .orderBy(messageRequest.requestSequence)
    .limit(limit)
    .offset(offset);

  return {
    requests: results.map((r) => ({
      id: r.id,
      sequence: r.sequence ?? 1,
      model: r.model,
      statusCode: r.statusCode,
      costUsd: r.costUsd,
      createdAt: r.createdAt,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      errorMessage: r.errorMessage,
    })),
    total,
  };
}
