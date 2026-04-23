import "server-only";

import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys as keysTable, messageRequest, providers, usageLedger, users } from "@/drizzle/schema";
import { TTLMap } from "@/lib/cache/ttl-map";
import { isLedgerOnlyMode } from "@/lib/ledger-fallback";
import { extractAnthropicEffortFromSpecialSettings } from "@/lib/utils/anthropic-effort";
import { buildUnifiedSpecialSettings } from "@/lib/utils/special-settings";
import type { StoredCostBreakdown } from "@/types/cost-breakdown";
import type { ProviderChainItem } from "@/types/message";
import type { SpecialSetting } from "@/types/special-settings";
import { LEDGER_BILLING_CONDITION } from "./_shared/ledger-conditions";
import { escapeLike } from "./_shared/like";
import { EXCLUDE_WARMUP_CONDITION } from "./_shared/message-request-conditions";
import { buildUsageLogConditions, RETRY_COUNT_EXPR } from "./_shared/usage-log-filters";

export interface UsageLogFilters {
  userId?: number;
  keyId?: number;
  providerId?: number;
  /** Session ID（精确匹配；空字符串/空白视为不筛选） */
  sessionId?: string;
  /** 开始时间戳（毫秒），用于 >= 比较 */
  startTime?: number;
  /** 结束时间戳（毫秒），用于 < 比较 */
  endTime?: number;
  statusCode?: number;
  /** 排除 200 状态码（筛选所有非 200 的请求，包括 NULL） */
  excludeStatusCode200?: boolean;
  model?: string;
  endpoint?: string;
  /** 最低重试次数（按 provider_chain 中“实际请求”数量 - 1 计算；<= 0 视为不筛选） */
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
  actualResponseModel: string | null; // 上游响应实际返回的模型名(audit)
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
  groupCostMultiplier: string | null; // 分组倍率
  costBreakdown: StoredCostBreakdown | null; // 费用明细
  durationMs: number | null;
  ttfbMs: number | null;
  errorMessage: string | null;
  providerChain: ProviderChainItem[] | null;
  blockedBy: string | null; // 拦截类型（如 'sensitive_word'）
  blockedReason: string | null; // 拦截原因（JSON 字符串）
  userAgent: string | null; // User-Agent（客户端信息）
  clientIp: string | null; // 客户端 IP（IPv4/IPv6）
  messagesCount: number | null; // Messages 数量
  context1mApplied: boolean | null; // 是否应用了1M上下文窗口
  swapCacheTtlApplied: boolean | null; // 是否启用了swap cache TTL billing
  specialSettings: SpecialSetting[] | null; // 特殊设置（审计/展示）
  _liveChain?: { chain: ProviderChainItem[]; phase: string; updatedAt: number } | null;
  anthropicEffort?: string | null;
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

const EMPTY_USAGE_LOG_SUMMARY: UsageLogSummary = {
  totalRequests: 0,
  totalCost: 0,
  totalTokens: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheCreationTokens: 0,
  totalCacheReadTokens: 0,
  totalCacheCreation5mTokens: 0,
  totalCacheCreation1hTokens: 0,
};

export interface UsageLogsResult {
  logs: UsageLogRow[];
  total: number;
  summary: UsageLogSummary;
}

/**
 * 仅分页数据的返回类型（不含聚合统计）
 */
export interface UsageLogsPaginatedResult {
  logs: UsageLogRow[];
  total: number;
}

/**
 * Cursor-based pagination result (no total count, optimized for large datasets)
 */
export interface UsageLogsBatchResult {
  logs: UsageLogRow[];
  nextCursor: { createdAt: string; id: number } | null;
  hasMore: boolean;
}

/**
 * Cursor-based pagination filters
 */
export interface UsageLogBatchFilters extends Omit<UsageLogFilters, "page" | "pageSize"> {
  cursor?: { createdAt: string; id: number };
  limit?: number;
}

/**
 * Query usage logs with cursor-based pagination (keyset pagination)
 * Optimized for infinite scroll - no COUNT query, constant performance regardless of data size
 */
export async function findUsageLogsBatch(
  filters: UsageLogBatchFilters
): Promise<UsageLogsBatchResult> {
  const { userId, keyId, providerId, cursor, limit = 50 } = filters;
  const safeLimit = Math.min(100, Math.max(1, limit));

  // Build query conditions
  const conditions = [isNull(messageRequest.deletedAt)];

  if (userId !== undefined) {
    conditions.push(eq(messageRequest.userId, userId));
  }

  if (keyId !== undefined) {
    conditions.push(eq(keysTable.id, keyId));
  }

  if (providerId !== undefined) {
    conditions.push(eq(messageRequest.providerId, providerId));
  }

  conditions.push(...buildUsageLogConditions(filters));

  // Cursor-based pagination: WHERE (created_at, id) < (cursor_created_at, cursor_id)
  // Using row value comparison for efficient keyset pagination
  if (cursor) {
    conditions.push(
      sql`(${messageRequest.createdAt}, ${messageRequest.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id})`
    );
  }

  // Fetch limit + 1 to determine if there are more records
  const fetchLimit = safeLimit + 1;

  const results = await db
    .select({
      id: messageRequest.id,
      createdAt: messageRequest.createdAt,
      createdAtRaw: sql<string>`to_char(${messageRequest.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      sessionId: messageRequest.sessionId,
      requestSequence: messageRequest.requestSequence,
      userName: users.name,
      keyName: keysTable.name,
      providerName: providers.name,
      model: messageRequest.model,
      originalModel: messageRequest.originalModel,
      actualResponseModel: messageRequest.actualResponseModel,
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
      costMultiplier: messageRequest.costMultiplier,
      groupCostMultiplier: messageRequest.groupCostMultiplier,
      costBreakdown: messageRequest.costBreakdown,
      durationMs: messageRequest.durationMs,
      ttfbMs: messageRequest.ttfbMs,
      errorMessage: messageRequest.errorMessage,
      providerChain: messageRequest.providerChain,
      blockedBy: messageRequest.blockedBy,
      blockedReason: messageRequest.blockedReason,
      userAgent: messageRequest.userAgent,
      clientIp: messageRequest.clientIp,
      messagesCount: messageRequest.messagesCount,
      context1mApplied: messageRequest.context1mApplied,
      swapCacheTtlApplied: messageRequest.swapCacheTtlApplied,
      specialSettings: messageRequest.specialSettings,
    })
    .from(messageRequest)
    .innerJoin(users, eq(messageRequest.userId, users.id))
    .innerJoin(keysTable, eq(messageRequest.key, keysTable.key))
    .leftJoin(providers, eq(messageRequest.providerId, providers.id))
    .where(and(...conditions))
    .orderBy(desc(messageRequest.createdAt), desc(messageRequest.id))
    .limit(fetchLimit);

  // Determine if there are more records
  const hasMore = results.length > safeLimit;
  const logsToReturn = hasMore ? results.slice(0, safeLimit) : results;

  // Calculate next cursor from the last record
  const lastLog = logsToReturn[logsToReturn.length - 1];
  const nextCursor = buildNextCursorOrThrow(hasMore, lastLog, "findUsageLogsBatch");

  const logs: UsageLogRow[] = logsToReturn.map((row) => {
    const totalRowTokens =
      (row.inputTokens ?? 0) +
      (row.outputTokens ?? 0) +
      (row.cacheCreationInputTokens ?? 0) +
      (row.cacheReadInputTokens ?? 0);

    const existingSpecialSettings = Array.isArray(row.specialSettings)
      ? (row.specialSettings as SpecialSetting[])
      : null;

    const unifiedSpecialSettings = buildUnifiedSpecialSettings({
      existing: existingSpecialSettings,
      blockedBy: row.blockedBy,
      blockedReason: row.blockedReason,
      statusCode: row.statusCode,
      cacheTtlApplied: row.cacheTtlApplied,
      context1mApplied: row.context1mApplied,
    });
    const anthropicEffort = extractAnthropicEffortFromSpecialSettings(unifiedSpecialSettings);

    return {
      ...row,
      requestSequence: row.requestSequence ?? null,
      totalTokens: totalRowTokens,
      cacheCreation5mInputTokens: row.cacheCreation5mInputTokens,
      cacheCreation1hInputTokens: row.cacheCreation1hInputTokens,
      cacheTtlApplied: row.cacheTtlApplied,
      costUsd: row.costUsd?.toString() ?? null,
      groupCostMultiplier: row.groupCostMultiplier?.toString() ?? null,
      costBreakdown: (row.costBreakdown as StoredCostBreakdown) ?? null,
      providerChain: row.providerChain as ProviderChainItem[] | null,
      endpoint: row.endpoint,
      specialSettings: unifiedSpecialSettings,
      anthropicEffort,
    };
  });

  if (logs.length > 0) {
    return { logs, nextCursor, hasMore };
  }

  if (!(await isLedgerOnlyMode())) {
    return { logs, nextCursor, hasMore };
  }

  if (filters.minRetryCount !== undefined && filters.minRetryCount > 0) {
    return { logs: [], nextCursor: null, hasMore: false };
  }

  const ledgerConditions = [LEDGER_BILLING_CONDITION];

  if (userId !== undefined) {
    ledgerConditions.push(eq(usageLedger.userId, userId));
  }

  if (keyId !== undefined) {
    ledgerConditions.push(eq(keysTable.id, keyId));
  }

  if (providerId !== undefined) {
    ledgerConditions.push(eq(usageLedger.finalProviderId, providerId));
  }

  const trimmedSessionId = filters.sessionId?.trim();
  if (trimmedSessionId) {
    ledgerConditions.push(eq(usageLedger.sessionId, trimmedSessionId));
  }

  if (filters.startTime !== undefined) {
    ledgerConditions.push(gte(usageLedger.createdAt, new Date(filters.startTime)));
  }

  if (filters.endTime !== undefined) {
    ledgerConditions.push(lt(usageLedger.createdAt, new Date(filters.endTime)));
  }

  if (filters.statusCode !== undefined) {
    ledgerConditions.push(eq(usageLedger.statusCode, filters.statusCode));
  } else if (filters.excludeStatusCode200) {
    ledgerConditions.push(
      sql`(${usageLedger.statusCode} IS NULL OR ${usageLedger.statusCode} <> 200)`
    );
  }

  if (filters.model) {
    ledgerConditions.push(eq(usageLedger.model, filters.model));
  }

  if (filters.endpoint) {
    ledgerConditions.push(eq(usageLedger.endpoint, filters.endpoint));
  }

  if (cursor) {
    ledgerConditions.push(
      sql`(${usageLedger.createdAt}, ${usageLedger.requestId}) < (${cursor.createdAt}::timestamptz, ${cursor.id})`
    );
  }

  const ledgerResults = await db
    .select({
      id: usageLedger.requestId,
      createdAt: usageLedger.createdAt,
      createdAtRaw: sql<string>`to_char(${usageLedger.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      sessionId: usageLedger.sessionId,
      userId: usageLedger.userId,
      userName: users.name,
      key: usageLedger.key,
      keyName: keysTable.name,
      providerName: providers.name,
      model: usageLedger.model,
      originalModel: usageLedger.originalModel,
      actualResponseModel: usageLedger.actualResponseModel,
      endpoint: usageLedger.endpoint,
      statusCode: usageLedger.statusCode,
      inputTokens: usageLedger.inputTokens,
      outputTokens: usageLedger.outputTokens,
      cacheCreationInputTokens: usageLedger.cacheCreationInputTokens,
      cacheReadInputTokens: usageLedger.cacheReadInputTokens,
      cacheCreation5mInputTokens: usageLedger.cacheCreation5mInputTokens,
      cacheCreation1hInputTokens: usageLedger.cacheCreation1hInputTokens,
      cacheTtlApplied: usageLedger.cacheTtlApplied,
      costUsd: usageLedger.costUsd,
      costMultiplier: usageLedger.costMultiplier,
      groupCostMultiplier: usageLedger.groupCostMultiplier,
      durationMs: usageLedger.durationMs,
      ttfbMs: usageLedger.ttfbMs,
      clientIp: usageLedger.clientIp,
      context1mApplied: usageLedger.context1mApplied,
      swapCacheTtlApplied: usageLedger.swapCacheTtlApplied,
    })
    .from(usageLedger)
    .leftJoin(users, eq(usageLedger.userId, users.id))
    .leftJoin(keysTable, eq(usageLedger.key, keysTable.key))
    .leftJoin(providers, eq(usageLedger.finalProviderId, providers.id))
    .where(and(...ledgerConditions))
    .orderBy(desc(usageLedger.createdAt), desc(usageLedger.requestId))
    .limit(fetchLimit);

  const ledgerHasMore = ledgerResults.length > limit;
  const ledgerRowsToReturn = ledgerHasMore ? ledgerResults.slice(0, limit) : ledgerResults;
  const ledgerLastLog = ledgerRowsToReturn[ledgerRowsToReturn.length - 1];
  const ledgerNextCursor = buildNextCursorOrThrow(
    ledgerHasMore,
    ledgerLastLog,
    "findUsageLogsBatch ledger fallback"
  );

  const fallbackLogs: UsageLogRow[] = ledgerRowsToReturn.map((row) => {
    const totalRowTokens =
      (row.inputTokens ?? 0) +
      (row.outputTokens ?? 0) +
      (row.cacheCreationInputTokens ?? 0) +
      (row.cacheReadInputTokens ?? 0);

    return {
      id: row.id,
      createdAt: row.createdAt,
      sessionId: row.sessionId,
      requestSequence: null,
      userName: row.userName ?? `User #${row.userId}`,
      keyName: row.keyName ?? row.key,
      providerName: row.providerName,
      model: row.model,
      originalModel: row.originalModel,
      actualResponseModel: row.actualResponseModel,
      endpoint: row.endpoint,
      statusCode: row.statusCode,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheCreationInputTokens: row.cacheCreationInputTokens,
      cacheReadInputTokens: row.cacheReadInputTokens,
      cacheCreation5mInputTokens: row.cacheCreation5mInputTokens,
      cacheCreation1hInputTokens: row.cacheCreation1hInputTokens,
      cacheTtlApplied: row.cacheTtlApplied,
      totalTokens: totalRowTokens,
      costUsd: row.costUsd?.toString() ?? null,
      costMultiplier: row.costMultiplier?.toString() ?? null,
      groupCostMultiplier: row.groupCostMultiplier?.toString() ?? null,
      costBreakdown: null,
      durationMs: row.durationMs,
      ttfbMs: row.ttfbMs,
      errorMessage: null,
      providerChain: null,
      blockedBy: null,
      blockedReason: null,
      userAgent: null,
      clientIp: row.clientIp ?? null,
      messagesCount: null,
      context1mApplied: row.context1mApplied ?? null,
      swapCacheTtlApplied: row.swapCacheTtlApplied ?? null,
      specialSettings: null,
    };
  });

  return { logs: fallbackLogs, nextCursor: ledgerNextCursor, hasMore: ledgerHasMore };
}

interface UsageLogSlimFilters {
  keyString: string;
  /** Session ID（精确匹配；空字符串/空白视为不筛选） */
  sessionId?: string;
  /** 开始时间戳（毫秒），用于 >= 比较 */
  startTime?: number;
  /** 结束时间戳（毫秒），用于 < 比较 */
  endTime?: number;
  statusCode?: number;
  /** 排除 200 状态码（筛选所有非 200 的请求，包括 NULL） */
  excludeStatusCode200?: boolean;
  model?: string;
  endpoint?: string;
  /** 最低重试次数（按 provider_chain 中“实际请求”数量 - 1 计算；<= 0 视为不筛选） */
  minRetryCount?: number;
}

interface UsageLogSlimBatchFilters extends UsageLogSlimFilters {
  cursor?: { createdAt: string; id: number };
  limit?: number;
}

interface UsageLogSlimRow {
  id: number;
  createdAt: Date | null;
  model: string | null;
  originalModel: string | null;
  actualResponseModel: string | null;
  endpoint: string | null;
  statusCode: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  durationMs: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreation5mInputTokens: number | null;
  cacheCreation1hInputTokens: number | null;
  cacheTtlApplied: string | null;
  anthropicEffort?: string | null;
}

export interface UsageLogSlimBatchResult {
  logs: UsageLogSlimRow[];
  nextCursor: { createdAt: string; id: number } | null;
  hasMore: boolean;
}

const usageLogSlimTotalCache = new TTLMap<string, number>({ ttlMs: 10_000, maxSize: 1000 });
const MAX_LEGACY_USAGE_LOG_PAGES = 10;

export async function findUsageLogsForKeySlim(
  filters: UsageLogSlimFilters & { page?: number; pageSize?: number }
): Promise<{ logs: UsageLogSlimRow[]; total: number }> {
  const { keyString, page = 1, pageSize = 50 } = filters;
  const safePage = page > 0 ? page : 1;
  const safePageSize = Math.min(100, Math.max(1, pageSize));
  const totalCacheKey = [
    keyString,
    filters.sessionId?.trim() ?? "",
    filters.startTime ?? "",
    filters.endTime ?? "",
    filters.statusCode ?? "",
    filters.excludeStatusCode200 ? "1" : "0",
    filters.model ?? "",
    filters.endpoint ?? "",
    filters.minRetryCount ?? "",
  ].join("\u0001");
  const cachedTotal = usageLogSlimTotalCache.get(totalCacheKey);

  const resolveTotal = async (): Promise<number> => {
    if (cachedTotal !== undefined) {
      return cachedTotal;
    }

    const [messageTotal, ledgerTotal] = await Promise.all([
      countKeyScopedMessageRows(keyString, filters),
      countKeyScopedLedgerRows(keyString, filters),
    ]);
    const total = messageTotal + ledgerTotal;
    usageLogSlimTotalCache.set(totalCacheKey, total);
    return total;
  };

  if (safePage === 1) {
    const fetchLimit = safePageSize + 1;
    const [messageRows, ledgerRows, total] = await Promise.all([
      selectKeyScopedMessageSlimRows(keyString, filters, fetchLimit),
      selectKeyScopedLedgerSlimRows(keyString, filters, fetchLimit),
      resolveTotal(),
    ]);

    const mergedRows = mergeOrderedUsageLogs<KeyScopedSlimSourceRow>([
      ...messageRows,
      ...ledgerRows,
    ]);
    return {
      logs: mergedRows.slice(0, safePageSize),
      total,
    };
  }

  if (safePage > MAX_LEGACY_USAGE_LOG_PAGES) {
    return {
      logs: [],
      total: await resolveTotal(),
    };
  }

  let cursor: KeyScopedCursor | undefined;
  let currentPage = 1;
  let pageResult: UsageLogSlimBatchResult = {
    logs: [],
    nextCursor: null,
    hasMore: false,
  };

  while (currentPage <= safePage) {
    pageResult = await findUsageLogsForKeyBatch({
      ...filters,
      cursor,
      limit: safePageSize,
      keyString,
    });
    if (currentPage === safePage || !pageResult.hasMore) {
      break;
    }
    cursor = pageResult.nextCursor ?? undefined;
    currentPage += 1;
  }

  return {
    logs: currentPage === safePage ? pageResult.logs : [],
    total: await resolveTotal(),
  };
}

function buildNextCursorOrThrow(
  hasMore: boolean,
  lastRow:
    | {
        createdAtRaw?: string | null;
        id: number;
      }
    | undefined,
  context: string
): { createdAt: string; id: number } | null {
  if (!hasMore) return null;
  if (!lastRow?.createdAtRaw) {
    throw new Error(`${context}: expected next cursor when hasMore is true`);
  }
  return { createdAt: lastRow.createdAtRaw, id: lastRow.id };
}

function mapUsageLogSlimRow(row: {
  id: number;
  createdAt: Date | null;
  model: string | null;
  originalModel: string | null;
  actualResponseModel: string | null;
  endpoint: string | null;
  statusCode: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null | { toString(): string };
  durationMs: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreation5mInputTokens: number | null;
  cacheCreation1hInputTokens: number | null;
  cacheTtlApplied: string | null;
  specialSettings?: SpecialSetting[] | null;
}): UsageLogSlimRow {
  const { specialSettings, ...rest } = row;
  const unifiedSpecialSettings = buildUnifiedSpecialSettings({
    existing: Array.isArray(specialSettings) ? specialSettings : null,
    blockedBy: null,
    blockedReason: null,
    statusCode: rest.statusCode,
    cacheTtlApplied: rest.cacheTtlApplied,
    context1mApplied: null,
  });
  const anthropicEffort = extractAnthropicEffortFromSpecialSettings(unifiedSpecialSettings);

  return {
    ...rest,
    costUsd: rest.costUsd?.toString() ?? null,
    anthropicEffort,
  };
}

type KeyScopedCursor = { createdAt: string; id: number };

type KeyScopedSlimSourceRow = UsageLogSlimRow & {
  createdAtRaw?: string | null;
};

function compareUsageLogOrder(
  a: { createdAt: Date | null; id: number; createdAtRaw?: string | null },
  b: { createdAt: Date | null; id: number; createdAtRaw?: string | null }
): number {
  const aRaw = a.createdAtRaw ?? (a.createdAt ? a.createdAt.toISOString() : null);
  const bRaw = b.createdAtRaw ?? (b.createdAt ? b.createdAt.toISOString() : null);

  if (aRaw !== bRaw) {
    if (aRaw === null) return 1;
    if (bRaw === null) return -1;
    return bRaw.localeCompare(aRaw);
  }

  return b.id - a.id;
}

function mergeOrderedUsageLogs<
  T extends { createdAt: Date | null; id: number; createdAtRaw?: string | null },
>(rows: T[]): T[] {
  return rows.sort(compareUsageLogOrder);
}

function buildKeyMessageConditions(
  keyString: string,
  filters: UsageLogSlimFilters & { cursor?: KeyScopedCursor }
) {
  const conditions = [
    isNull(messageRequest.deletedAt),
    eq(messageRequest.key, keyString),
    EXCLUDE_WARMUP_CONDITION,
  ];

  conditions.push(...buildUsageLogConditions(filters));

  if (filters.cursor) {
    conditions.push(
      sql`(${messageRequest.createdAt}, ${messageRequest.id}) < (${filters.cursor.createdAt}::timestamptz, ${filters.cursor.id})`
    );
  }

  return conditions;
}

function buildKeyLedgerConditions(
  keyString: string,
  filters: UsageLogSlimFilters & { cursor?: KeyScopedCursor }
) {
  if (filters.minRetryCount !== undefined && filters.minRetryCount > 0) {
    return null;
  }

  const conditions = [
    LEDGER_BILLING_CONDITION,
    eq(usageLedger.key, keyString),
    sql`not exists (
      select 1
      from "message_request" as mr_active
      where mr_active.id = ${usageLedger.requestId}
        and mr_active.deleted_at is null
        and mr_active.key = ${usageLedger.key}
    )`,
  ];

  const trimmedSessionId = filters.sessionId?.trim();
  if (trimmedSessionId) {
    conditions.push(eq(usageLedger.sessionId, trimmedSessionId));
  }

  if (filters.startTime) {
    conditions.push(gte(usageLedger.createdAt, new Date(filters.startTime)));
  }

  if (filters.endTime) {
    conditions.push(lt(usageLedger.createdAt, new Date(filters.endTime)));
  }

  if (filters.statusCode !== undefined) {
    conditions.push(eq(usageLedger.statusCode, filters.statusCode));
  } else if (filters.excludeStatusCode200) {
    conditions.push(sql`(${usageLedger.statusCode} IS NULL OR ${usageLedger.statusCode} <> 200)`);
  }

  if (filters.model) {
    conditions.push(eq(usageLedger.model, filters.model));
  }

  if (filters.endpoint) {
    conditions.push(eq(usageLedger.endpoint, filters.endpoint));
  }

  if (filters.cursor) {
    conditions.push(
      sql`(${usageLedger.createdAt}, ${usageLedger.requestId}) < (${filters.cursor.createdAt}::timestamptz, ${filters.cursor.id})`
    );
  }

  return conditions;
}

async function selectKeyScopedMessageSlimRows(
  keyString: string,
  filters: UsageLogSlimFilters & { cursor?: KeyScopedCursor },
  limit: number,
  offset: number = 0
): Promise<KeyScopedSlimSourceRow[]> {
  const rows = await db
    .select({
      id: messageRequest.id,
      createdAt: messageRequest.createdAt,
      createdAtRaw: sql<string>`to_char(${messageRequest.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      model: messageRequest.model,
      originalModel: messageRequest.originalModel,
      actualResponseModel: messageRequest.actualResponseModel,
      endpoint: messageRequest.endpoint,
      statusCode: messageRequest.statusCode,
      inputTokens: messageRequest.inputTokens,
      outputTokens: messageRequest.outputTokens,
      costUsd: messageRequest.costUsd,
      durationMs: messageRequest.durationMs,
      cacheCreationInputTokens: messageRequest.cacheCreationInputTokens,
      cacheReadInputTokens: messageRequest.cacheReadInputTokens,
      cacheCreation5mInputTokens: messageRequest.cacheCreation5mInputTokens,
      cacheCreation1hInputTokens: messageRequest.cacheCreation1hInputTokens,
      cacheTtlApplied: messageRequest.cacheTtlApplied,
      specialSettings: messageRequest.specialSettings,
    })
    .from(messageRequest)
    .where(and(...buildKeyMessageConditions(keyString, filters)))
    .orderBy(desc(messageRequest.createdAt), desc(messageRequest.id))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    ...mapUsageLogSlimRow(row),
    createdAtRaw: row.createdAtRaw,
  }));
}

async function selectKeyScopedLedgerSlimRows(
  keyString: string,
  filters: UsageLogSlimFilters & { cursor?: KeyScopedCursor },
  limit: number,
  offset: number = 0
): Promise<KeyScopedSlimSourceRow[]> {
  const ledgerConditions = buildKeyLedgerConditions(keyString, filters);
  if (!ledgerConditions) {
    return [];
  }

  const rows = await db
    .select({
      id: usageLedger.requestId,
      createdAt: usageLedger.createdAt,
      createdAtRaw: sql<string>`to_char(${usageLedger.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      model: usageLedger.model,
      originalModel: usageLedger.originalModel,
      actualResponseModel: usageLedger.actualResponseModel,
      endpoint: usageLedger.endpoint,
      statusCode: usageLedger.statusCode,
      inputTokens: usageLedger.inputTokens,
      outputTokens: usageLedger.outputTokens,
      costUsd: usageLedger.costUsd,
      durationMs: usageLedger.durationMs,
      cacheCreationInputTokens: usageLedger.cacheCreationInputTokens,
      cacheReadInputTokens: usageLedger.cacheReadInputTokens,
      cacheCreation5mInputTokens: usageLedger.cacheCreation5mInputTokens,
      cacheCreation1hInputTokens: usageLedger.cacheCreation1hInputTokens,
      cacheTtlApplied: usageLedger.cacheTtlApplied,
    })
    .from(usageLedger)
    .where(and(...ledgerConditions))
    .orderBy(desc(usageLedger.createdAt), desc(usageLedger.requestId))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    createdAtRaw: row.createdAtRaw,
    model: row.model,
    originalModel: row.originalModel,
    actualResponseModel: row.actualResponseModel,
    endpoint: row.endpoint,
    statusCode: row.statusCode,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd?.toString() ?? null,
    durationMs: row.durationMs,
    cacheCreationInputTokens: row.cacheCreationInputTokens,
    cacheReadInputTokens: row.cacheReadInputTokens,
    cacheCreation5mInputTokens: row.cacheCreation5mInputTokens,
    cacheCreation1hInputTokens: row.cacheCreation1hInputTokens,
    cacheTtlApplied: row.cacheTtlApplied,
    anthropicEffort: null,
  }));
}

async function countKeyScopedMessageRows(
  keyString: string,
  filters: UsageLogSlimFilters
): Promise<number> {
  const [row] = await db
    .select({ totalRows: sql<number>`count(*)::int` })
    .from(messageRequest)
    .where(and(...buildKeyMessageConditions(keyString, filters)));

  return row?.totalRows ?? 0;
}

async function countKeyScopedLedgerRows(
  keyString: string,
  filters: UsageLogSlimFilters
): Promise<number> {
  const ledgerConditions = buildKeyLedgerConditions(keyString, filters);
  if (!ledgerConditions) {
    return 0;
  }

  const [row] = await db
    .select({ totalRows: sql<number>`count(*)::int` })
    .from(usageLedger)
    .where(and(...ledgerConditions));

  return row?.totalRows ?? 0;
}

export async function findUsageLogsForKeyBatch(
  filters: UsageLogSlimBatchFilters
): Promise<UsageLogSlimBatchResult> {
  const { keyString, limit = 20 } = filters;
  const safeLimit = Math.min(100, Math.max(1, limit));
  const fetchLimit = safeLimit + 1;
  const [messageRows, ledgerRows] = await Promise.all([
    selectKeyScopedMessageSlimRows(keyString, filters, fetchLimit, 0),
    selectKeyScopedLedgerSlimRows(keyString, filters, fetchLimit, 0),
  ]);

  const mergedRows = mergeOrderedUsageLogs<KeyScopedSlimSourceRow>([...messageRows, ...ledgerRows]);
  const rowsToReturn = mergedRows.slice(0, safeLimit);
  const hasMore = mergedRows.length > safeLimit;
  const nextCursor = buildNextCursorOrThrow(
    hasMore,
    rowsToReturn[rowsToReturn.length - 1],
    "findUsageLogsForKeyBatch"
  );

  return {
    logs: rowsToReturn,
    nextCursor,
    hasMore,
  };
}

const distinctModelsByKeyCache = new TTLMap<string, string[]>({
  ttlMs: 5 * 60 * 1000,
  maxSize: 200,
});
const distinctEndpointsByKeyCache = new TTLMap<string, string[]>({
  ttlMs: 5 * 60 * 1000,
  maxSize: 200,
});

export async function getTotalUsageForKey(keyString: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)` })
    .from(messageRequest)
    .where(
      and(
        eq(messageRequest.key, keyString),
        isNull(messageRequest.deletedAt),
        EXCLUDE_WARMUP_CONDITION
      )
    );

  return Number(row?.total ?? 0);
}

function mapUsageLogRowFromMessageResult(row: {
  id: number;
  createdAt: Date | null;
  sessionId: string | null;
  requestSequence: number | null;
  userName: string;
  keyName: string;
  providerName: string | null;
  model: string | null;
  originalModel: string | null;
  actualResponseModel: string | null;
  endpoint: string | null;
  statusCode: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreation5mInputTokens: number | null;
  cacheCreation1hInputTokens: number | null;
  cacheTtlApplied: string | null;
  costUsd: string | null | { toString(): string };
  costMultiplier: string | null | { toString(): string };
  groupCostMultiplier: string | null | { toString(): string };
  costBreakdown: StoredCostBreakdown | null;
  durationMs: number | null;
  ttfbMs: number | null;
  errorMessage: string | null;
  providerChain: ProviderChainItem[] | null;
  blockedBy: string | null;
  blockedReason: string | null;
  userAgent: string | null;
  clientIp: string | null;
  messagesCount: number | null;
  context1mApplied: boolean | null;
  swapCacheTtlApplied: boolean | null;
  specialSettings: SpecialSetting[] | null;
}) {
  const totalRowTokens =
    (row.inputTokens ?? 0) +
    (row.outputTokens ?? 0) +
    (row.cacheCreationInputTokens ?? 0) +
    (row.cacheReadInputTokens ?? 0);

  const unifiedSpecialSettings = buildUnifiedSpecialSettings({
    existing: Array.isArray(row.specialSettings) ? row.specialSettings : null,
    blockedBy: row.blockedBy,
    blockedReason: row.blockedReason,
    statusCode: row.statusCode,
    cacheTtlApplied: row.cacheTtlApplied,
    context1mApplied: row.context1mApplied,
  });
  const anthropicEffort = extractAnthropicEffortFromSpecialSettings(unifiedSpecialSettings);

  return {
    ...row,
    requestSequence: row.requestSequence ?? null,
    totalTokens: totalRowTokens,
    costUsd: row.costUsd?.toString() ?? null,
    costMultiplier: row.costMultiplier?.toString() ?? null,
    groupCostMultiplier: row.groupCostMultiplier?.toString() ?? null,
    costBreakdown: row.costBreakdown ?? null,
    providerChain: row.providerChain ?? null,
    specialSettings: unifiedSpecialSettings,
    anthropicEffort,
  } satisfies UsageLogRow;
}

function mapUsageLogRowFromLedgerResult(row: {
  id: number;
  createdAt: Date | null;
  sessionId: string | null;
  userId: number;
  userName: string | null;
  key: string;
  keyName: string | null;
  providerName: string | null;
  model: string | null;
  originalModel: string | null;
  actualResponseModel: string | null;
  endpoint: string | null;
  statusCode: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreation5mInputTokens: number | null;
  cacheCreation1hInputTokens: number | null;
  cacheTtlApplied: string | null;
  costUsd: string | null | { toString(): string };
  costMultiplier: string | null | { toString(): string };
  groupCostMultiplier: string | null | { toString(): string };
  durationMs: number | null;
  ttfbMs: number | null;
  clientIp: string | null;
  context1mApplied: boolean | null;
  swapCacheTtlApplied: boolean | null;
}) {
  const totalRowTokens =
    (row.inputTokens ?? 0) +
    (row.outputTokens ?? 0) +
    (row.cacheCreationInputTokens ?? 0) +
    (row.cacheReadInputTokens ?? 0);

  return {
    id: row.id,
    createdAt: row.createdAt,
    sessionId: row.sessionId,
    requestSequence: null,
    userName: row.userName ?? `User #${row.userId}`,
    keyName: row.keyName ?? row.key,
    providerName: row.providerName,
    model: row.model,
    originalModel: row.originalModel,
    actualResponseModel: row.actualResponseModel,
    endpoint: row.endpoint,
    statusCode: row.statusCode,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationInputTokens: row.cacheCreationInputTokens,
    cacheReadInputTokens: row.cacheReadInputTokens,
    cacheCreation5mInputTokens: row.cacheCreation5mInputTokens,
    cacheCreation1hInputTokens: row.cacheCreation1hInputTokens,
    cacheTtlApplied: row.cacheTtlApplied,
    totalTokens: totalRowTokens,
    costUsd: row.costUsd?.toString() ?? null,
    costMultiplier: row.costMultiplier?.toString() ?? null,
    groupCostMultiplier: row.groupCostMultiplier?.toString() ?? null,
    costBreakdown: null,
    durationMs: row.durationMs,
    ttfbMs: row.ttfbMs,
    errorMessage: null,
    providerChain: null,
    blockedBy: null,
    blockedReason: null,
    userAgent: null,
    clientIp: row.clientIp ?? null,
    messagesCount: null,
    context1mApplied: row.context1mApplied ?? null,
    swapCacheTtlApplied: row.swapCacheTtlApplied ?? null,
    specialSettings: null,
    anthropicEffort: null,
  } satisfies UsageLogRow;
}

export async function findReadonlyUsageLogsBatchForKey(
  filters: Omit<UsageLogBatchFilters, "userId" | "keyId" | "providerId"> & { keyString: string }
): Promise<UsageLogsBatchResult> {
  const { keyString, cursor, limit = 50 } = filters;
  const safeLimit = Math.min(100, Math.max(1, limit));
  const fetchLimit = safeLimit + 1;

  const messageConditions = buildKeyMessageConditions(keyString, { ...filters, cursor });
  const ledgerConditions = buildKeyLedgerConditions(keyString, { ...filters, cursor });

  const [messageRows, ledgerRows] = await Promise.all([
    db
      .select({
        id: messageRequest.id,
        createdAt: messageRequest.createdAt,
        createdAtRaw: sql<string>`to_char(${messageRequest.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        sessionId: messageRequest.sessionId,
        requestSequence: messageRequest.requestSequence,
        userName: users.name,
        keyName: keysTable.name,
        providerName: providers.name,
        model: messageRequest.model,
        originalModel: messageRequest.originalModel,
        actualResponseModel: messageRequest.actualResponseModel,
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
        costMultiplier: messageRequest.costMultiplier,
        groupCostMultiplier: messageRequest.groupCostMultiplier,
        costBreakdown: messageRequest.costBreakdown,
        durationMs: messageRequest.durationMs,
        ttfbMs: messageRequest.ttfbMs,
        errorMessage: messageRequest.errorMessage,
        providerChain: messageRequest.providerChain,
        blockedBy: messageRequest.blockedBy,
        blockedReason: messageRequest.blockedReason,
        userAgent: messageRequest.userAgent,
        clientIp: messageRequest.clientIp,
        messagesCount: messageRequest.messagesCount,
        context1mApplied: messageRequest.context1mApplied,
        swapCacheTtlApplied: messageRequest.swapCacheTtlApplied,
        specialSettings: messageRequest.specialSettings,
      })
      .from(messageRequest)
      .innerJoin(users, eq(messageRequest.userId, users.id))
      .innerJoin(keysTable, eq(messageRequest.key, keysTable.key))
      .leftJoin(providers, eq(messageRequest.providerId, providers.id))
      .where(and(...messageConditions))
      .orderBy(desc(messageRequest.createdAt), desc(messageRequest.id))
      .limit(fetchLimit),
    ledgerConditions
      ? db
          .select({
            id: usageLedger.requestId,
            createdAt: usageLedger.createdAt,
            createdAtRaw: sql<string>`to_char(${usageLedger.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
            sessionId: usageLedger.sessionId,
            userId: usageLedger.userId,
            userName: users.name,
            key: usageLedger.key,
            keyName: keysTable.name,
            providerName: providers.name,
            model: usageLedger.model,
            originalModel: usageLedger.originalModel,
            actualResponseModel: usageLedger.actualResponseModel,
            endpoint: usageLedger.endpoint,
            statusCode: usageLedger.statusCode,
            inputTokens: usageLedger.inputTokens,
            outputTokens: usageLedger.outputTokens,
            cacheCreationInputTokens: usageLedger.cacheCreationInputTokens,
            cacheReadInputTokens: usageLedger.cacheReadInputTokens,
            cacheCreation5mInputTokens: usageLedger.cacheCreation5mInputTokens,
            cacheCreation1hInputTokens: usageLedger.cacheCreation1hInputTokens,
            cacheTtlApplied: usageLedger.cacheTtlApplied,
            costUsd: usageLedger.costUsd,
            costMultiplier: usageLedger.costMultiplier,
            groupCostMultiplier: usageLedger.groupCostMultiplier,
            durationMs: usageLedger.durationMs,
            ttfbMs: usageLedger.ttfbMs,
            clientIp: usageLedger.clientIp,
            context1mApplied: usageLedger.context1mApplied,
            swapCacheTtlApplied: usageLedger.swapCacheTtlApplied,
          })
          .from(usageLedger)
          .leftJoin(users, eq(usageLedger.userId, users.id))
          .leftJoin(keysTable, eq(usageLedger.key, keysTable.key))
          .leftJoin(providers, eq(usageLedger.finalProviderId, providers.id))
          .where(and(...ledgerConditions))
          .orderBy(desc(usageLedger.createdAt), desc(usageLedger.requestId))
          .limit(fetchLimit)
      : Promise.resolve([]),
  ]);

  const mergedLogs = mergeOrderedUsageLogs<UsageLogRow & { createdAtRaw?: string | null }>([
    ...messageRows.map((row) => ({
      ...mapUsageLogRowFromMessageResult(row),
      createdAtRaw: row.createdAtRaw,
    })),
    ...ledgerRows.map((row) => ({
      ...mapUsageLogRowFromLedgerResult(row),
      createdAtRaw: row.createdAtRaw,
    })),
  ]);

  const pageRows = mergedLogs.slice(0, safeLimit);
  const hasMore = mergedLogs.length > safeLimit;
  const nextCursor = buildNextCursorOrThrow(
    hasMore,
    pageRows[pageRows.length - 1],
    "findReadonlyUsageLogsBatchForKey"
  );

  return {
    logs: pageRows.map(({ createdAtRaw: _createdAtRaw, ...log }) => log),
    nextCursor,
    hasMore,
  };
}

export async function getDistinctModelsForKey(keyString: string): Promise<string[]> {
  const cached = distinctModelsByKeyCache.get(keyString);
  if (cached !== undefined) return cached;

  const ledgerConditions = buildKeyLedgerConditions(keyString, { keyString });

  const [messageModels, ledgerModels] = await Promise.all([
    db.execute(
      sql`select distinct ${messageRequest.model} as model
          from ${messageRequest}
          where ${messageRequest.key} = ${keyString}
            and ${messageRequest.deletedAt} is null
            and (${EXCLUDE_WARMUP_CONDITION})
            and ${messageRequest.model} is not null`
    ),
    ledgerConditions
      ? db
          .selectDistinct({ model: usageLedger.model })
          .from(usageLedger)
          .where(and(...ledgerConditions, sql`${usageLedger.model} is not null`))
      : Promise.resolve([]),
  ]);

  const models = Array.from(
    new Set(
      [...Array.from(messageModels), ...Array.from(ledgerModels)]
        .map((row) => (row as { model?: string }).model)
        .filter((model): model is string => !!model && model.trim().length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  distinctModelsByKeyCache.set(keyString, models);
  return models;
}

export async function getDistinctEndpointsForKey(keyString: string): Promise<string[]> {
  const cached = distinctEndpointsByKeyCache.get(keyString);
  if (cached !== undefined) return cached;

  const ledgerConditions = buildKeyLedgerConditions(keyString, { keyString });

  const [messageEndpoints, ledgerEndpoints] = await Promise.all([
    db.execute(
      sql`select distinct ${messageRequest.endpoint} as endpoint
          from ${messageRequest}
          where ${messageRequest.key} = ${keyString}
            and ${messageRequest.deletedAt} is null
            and (${EXCLUDE_WARMUP_CONDITION})
            and ${messageRequest.endpoint} is not null`
    ),
    ledgerConditions
      ? db
          .selectDistinct({ endpoint: usageLedger.endpoint })
          .from(usageLedger)
          .where(and(...ledgerConditions, sql`${usageLedger.endpoint} is not null`))
      : Promise.resolve([]),
  ]);

  const endpoints = Array.from(
    new Set(
      [...Array.from(messageEndpoints), ...Array.from(ledgerEndpoints)]
        .map((row) => (row as { endpoint?: string }).endpoint)
        .filter((endpoint): endpoint is string => !!endpoint && endpoint.trim().length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  distinctEndpointsByKeyCache.set(keyString, endpoints);
  return endpoints;
}

/**
 * 查询使用日志（支持多种筛选条件和分页）
 */

export async function findUsageLogsWithDetails(filters: UsageLogFilters): Promise<UsageLogsResult> {
  const { userId, keyId, providerId, page = 1, pageSize = 50 } = filters;

  const safePage = page > 0 ? page : 1;
  const safePageSize = Math.min(200, Math.max(1, pageSize));

  const conditions = [isNull(messageRequest.deletedAt)];

  if (userId !== undefined) {
    conditions.push(eq(messageRequest.userId, userId));
  }

  if (keyId !== undefined) {
    conditions.push(eq(keysTable.id, keyId));
  }

  if (providerId !== undefined) {
    conditions.push(eq(messageRequest.providerId, providerId));
  }

  conditions.push(...buildUsageLogConditions(filters));

  const offset = (safePage - 1) * safePageSize;

  // 查询总数和统计数据（仅在需要 keyId 过滤时才 join keysTable，避免无效 join）
  const summaryQuery =
    keyId === undefined
      ? db
          .select({
            // total：用于分页/审计，必须包含 warmup
            totalRows: sql<number>`count(*)::double precision`,
            // summary：所有统计字段必须排除 warmup（不计入任何统计）
            totalRequests: sql<number>`count(*) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision`,
            totalCost: sql<string>`COALESCE(sum(${messageRequest.costUsd}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION}), 0)`,
            totalInputTokens: sql<number>`COALESCE(sum(${messageRequest.inputTokens}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision, 0::double precision)`,
            totalOutputTokens: sql<number>`COALESCE(sum(${messageRequest.outputTokens}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision, 0::double precision)`,
            totalCacheCreationTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreationInputTokens}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision, 0::double precision)`,
            totalCacheReadTokens: sql<number>`COALESCE(sum(${messageRequest.cacheReadInputTokens}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision, 0::double precision)`,
            totalCacheCreation5mTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreation5mInputTokens}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision, 0::double precision)`,
            totalCacheCreation1hTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreation1hInputTokens}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision, 0::double precision)`,
          })
          .from(messageRequest)
          .where(and(...conditions))
      : db
          .select({
            // total：用于分页/审计，必须包含 warmup
            totalRows: sql<number>`count(*)::double precision`,
            // summary：所有统计字段必须排除 warmup（不计入任何统计）
            totalRequests: sql<number>`count(*) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision`,
            totalCost: sql<string>`COALESCE(sum(${messageRequest.costUsd}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION}), 0)`,
            totalInputTokens: sql<number>`COALESCE(sum(${messageRequest.inputTokens}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision, 0::double precision)`,
            totalOutputTokens: sql<number>`COALESCE(sum(${messageRequest.outputTokens}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision, 0::double precision)`,
            totalCacheCreationTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreationInputTokens}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision, 0::double precision)`,
            totalCacheReadTokens: sql<number>`COALESCE(sum(${messageRequest.cacheReadInputTokens}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision, 0::double precision)`,
            totalCacheCreation5mTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreation5mInputTokens}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision, 0::double precision)`,
            totalCacheCreation1hTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreation1hInputTokens}) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})::double precision, 0::double precision)`,
          })
          .from(messageRequest)
          .innerJoin(keysTable, eq(messageRequest.key, keysTable.key))
          .where(and(...conditions));

  // 查询分页数据（使用 LEFT JOIN 以包含被拦截的请求）
  const logsQuery = db
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
      actualResponseModel: messageRequest.actualResponseModel, // 实际响应模型（audit）
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
      groupCostMultiplier: messageRequest.groupCostMultiplier, // 分组倍率
      costBreakdown: messageRequest.costBreakdown, // 费用明细
      durationMs: messageRequest.durationMs,
      ttfbMs: messageRequest.ttfbMs,
      errorMessage: messageRequest.errorMessage,
      providerChain: messageRequest.providerChain,
      blockedBy: messageRequest.blockedBy, // 拦截类型
      blockedReason: messageRequest.blockedReason, // 拦截原因
      userAgent: messageRequest.userAgent, // User-Agent
      clientIp: messageRequest.clientIp, // 客户端 IP
      messagesCount: messageRequest.messagesCount, // Messages 数量
      context1mApplied: messageRequest.context1mApplied, // 1M上下文窗口
      swapCacheTtlApplied: messageRequest.swapCacheTtlApplied, // swap cache TTL billing
      specialSettings: messageRequest.specialSettings, // 特殊设置（审计/展示）
    })
    .from(messageRequest)
    .innerJoin(users, eq(messageRequest.userId, users.id))
    .innerJoin(keysTable, eq(messageRequest.key, keysTable.key))
    .leftJoin(providers, eq(messageRequest.providerId, providers.id)) // 改为 leftJoin
    .where(and(...conditions))
    .orderBy(desc(messageRequest.createdAt), desc(messageRequest.id))
    .limit(safePageSize)
    .offset(offset);

  const [summaryRows, results] = await Promise.all([summaryQuery, logsQuery]);
  const summaryResult = summaryRows[0];

  const total = summaryResult?.totalRows ?? 0;
  const totalRequests = summaryResult?.totalRequests ?? 0;
  const totalCost = parseFloat(summaryResult?.totalCost ?? "0");
  const totalTokens =
    (summaryResult?.totalInputTokens ?? 0) +
    (summaryResult?.totalOutputTokens ?? 0) +
    (summaryResult?.totalCacheCreationTokens ?? 0) +
    (summaryResult?.totalCacheReadTokens ?? 0);

  const logs: UsageLogRow[] = results.map((row) => {
    const totalRowTokens =
      (row.inputTokens ?? 0) +
      (row.outputTokens ?? 0) +
      (row.cacheCreationInputTokens ?? 0) +
      (row.cacheReadInputTokens ?? 0);

    const existingSpecialSettings = Array.isArray(row.specialSettings)
      ? (row.specialSettings as SpecialSetting[])
      : null;

    const unifiedSpecialSettings = buildUnifiedSpecialSettings({
      existing: existingSpecialSettings,
      blockedBy: row.blockedBy,
      blockedReason: row.blockedReason,
      statusCode: row.statusCode,
      cacheTtlApplied: row.cacheTtlApplied,
      context1mApplied: row.context1mApplied,
    });
    const anthropicEffort = extractAnthropicEffortFromSpecialSettings(unifiedSpecialSettings);

    return {
      ...row,
      requestSequence: row.requestSequence ?? null,
      totalTokens: totalRowTokens,
      cacheCreation5mInputTokens: row.cacheCreation5mInputTokens,
      cacheCreation1hInputTokens: row.cacheCreation1hInputTokens,
      cacheTtlApplied: row.cacheTtlApplied,
      costUsd: row.costUsd?.toString() ?? null,
      groupCostMultiplier: row.groupCostMultiplier?.toString() ?? null,
      costBreakdown: (row.costBreakdown as StoredCostBreakdown) ?? null,
      providerChain: row.providerChain as ProviderChainItem[] | null,
      endpoint: row.endpoint,
      specialSettings: unifiedSpecialSettings,
      anthropicEffort,
    };
  });

  return {
    logs,
    total,
    summary: {
      totalRequests,
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

export interface UsageLogSessionIdSuggestionFilters {
  term: string;
  userId?: number;
  keyId?: number;
  providerId?: number;
  limit?: number;
}

export async function findUsageLogSessionIdSuggestions(
  filters: UsageLogSessionIdSuggestionFilters
): Promise<string[]> {
  const { term, userId, keyId, providerId } = filters;
  const limit = Math.min(50, Math.max(1, filters.limit ?? 20));
  const trimmedTerm = term.trim();
  if (!trimmedTerm) return [];

  const pattern = `${escapeLike(trimmedTerm)}%`;
  const conditions = [
    isNull(messageRequest.deletedAt),
    EXCLUDE_WARMUP_CONDITION,
    sql`${messageRequest.sessionId} IS NOT NULL`,
    sql`length(${messageRequest.sessionId}) > 0`,
    sql`${messageRequest.sessionId} LIKE ${pattern} ESCAPE '\\'`,
  ];

  if (userId !== undefined) {
    conditions.push(eq(messageRequest.userId, userId));
  }

  if (keyId !== undefined) {
    conditions.push(eq(keysTable.id, keyId));
  }

  if (providerId !== undefined) {
    conditions.push(eq(messageRequest.providerId, providerId));
  }

  const baseQuery = db
    .select({
      sessionId: messageRequest.sessionId,
      firstSeen: sql<Date>`min(${messageRequest.createdAt})`,
    })
    .from(messageRequest);

  const query =
    keyId !== undefined
      ? baseQuery.innerJoin(keysTable, eq(messageRequest.key, keysTable.key))
      : baseQuery;

  const results = await query
    .where(and(...conditions))
    .groupBy(messageRequest.sessionId)
    .orderBy(desc(sql`min(${messageRequest.createdAt})`))
    .limit(limit);

  return results.map((r) => r.sessionId).filter((id): id is string => Boolean(id));
}

/**
 * 独立获取使用日志聚合统计（用于可折叠面板按需加载）
 *
 * 优化效果：
 * - 分页时不再执行聚合查询
 * - 仅在用户展开统计面板时加载
 * - 筛选条件变更时需重新加载
 */
export async function findUsageLogsStats(
  filters: Omit<UsageLogFilters, "page" | "pageSize">
): Promise<UsageLogSummary> {
  const { userId, keyId, providerId } = filters;

  // 在 ledger-only 模式下，message_request 为空 —— 依赖它的筛选条件必须短路处理。
  const ledgerOnly = await isLedgerOnlyMode();
  const minRetryCount = filters.minRetryCount ?? 0;
  if (ledgerOnly && minRetryCount > 0) {
    return EMPTY_USAGE_LOG_SUMMARY;
  }

  const conditions = [LEDGER_BILLING_CONDITION];

  if (userId !== undefined) {
    conditions.push(eq(usageLedger.userId, userId));
  }

  if (keyId !== undefined) {
    conditions.push(eq(keysTable.id, keyId));
  }

  if (providerId !== undefined) {
    conditions.push(eq(usageLedger.finalProviderId, providerId));
  }

  const trimmedSessionId = filters.sessionId?.trim();
  if (trimmedSessionId) {
    conditions.push(eq(usageLedger.sessionId, trimmedSessionId));
  }

  if (filters.startTime !== undefined) {
    conditions.push(gte(usageLedger.createdAt, new Date(filters.startTime)));
  }

  if (filters.endTime !== undefined) {
    conditions.push(lt(usageLedger.createdAt, new Date(filters.endTime)));
  }

  if (filters.statusCode !== undefined) {
    conditions.push(eq(usageLedger.statusCode, filters.statusCode));
  } else if (filters.excludeStatusCode200) {
    conditions.push(sql`(${usageLedger.statusCode} IS NULL OR ${usageLedger.statusCode} <> 200)`);
  }

  if (filters.model) {
    conditions.push(eq(usageLedger.model, filters.model));
  }

  if (filters.endpoint) {
    conditions.push(eq(usageLedger.endpoint, filters.endpoint));
  }

  if (minRetryCount > 0 && !ledgerOnly) {
    conditions.push(sql`${RETRY_COUNT_EXPR} >= ${minRetryCount}`);
  }

  const baseQuery = db
    .select({
      totalRequests: sql<number>`count(*)::double precision`,
      totalCost: sql<string>`COALESCE(sum(${usageLedger.costUsd}), 0)`,
      totalInputTokens: sql<number>`COALESCE(sum(${usageLedger.inputTokens})::double precision, 0::double precision)`,
      totalOutputTokens: sql<number>`COALESCE(sum(${usageLedger.outputTokens})::double precision, 0::double precision)`,
      totalCacheCreationTokens: sql<number>`COALESCE(sum(${usageLedger.cacheCreationInputTokens})::double precision, 0::double precision)`,
      totalCacheReadTokens: sql<number>`COALESCE(sum(${usageLedger.cacheReadInputTokens})::double precision, 0::double precision)`,
      totalCacheCreation5mTokens: sql<number>`COALESCE(sum(${usageLedger.cacheCreation5mInputTokens})::double precision, 0::double precision)`,
      totalCacheCreation1hTokens: sql<number>`COALESCE(sum(${usageLedger.cacheCreation1hInputTokens})::double precision, 0::double precision)`,
    })
    .from(usageLedger);

  const queryByKey =
    keyId !== undefined
      ? baseQuery.innerJoin(keysTable, eq(usageLedger.key, keysTable.key))
      : baseQuery;

  const query =
    minRetryCount > 0 && !ledgerOnly
      ? queryByKey.innerJoin(messageRequest, eq(usageLedger.requestId, messageRequest.id))
      : queryByKey;

  const [summaryResult] = await query.where(and(...conditions));

  const totalRequests = summaryResult?.totalRequests ?? 0;
  const totalCost = parseFloat(summaryResult?.totalCost ?? "0");
  const totalTokens =
    (summaryResult?.totalInputTokens ?? 0) +
    (summaryResult?.totalOutputTokens ?? 0) +
    (summaryResult?.totalCacheCreationTokens ?? 0) +
    (summaryResult?.totalCacheReadTokens ?? 0);

  return {
    totalRequests,
    totalCost,
    totalTokens,
    totalInputTokens: summaryResult?.totalInputTokens ?? 0,
    totalOutputTokens: summaryResult?.totalOutputTokens ?? 0,
    totalCacheCreationTokens: summaryResult?.totalCacheCreationTokens ?? 0,
    totalCacheReadTokens: summaryResult?.totalCacheReadTokens ?? 0,
    totalCacheCreation5mTokens: summaryResult?.totalCacheCreation5mTokens ?? 0,
    totalCacheCreation1hTokens: summaryResult?.totalCacheCreation1hTokens ?? 0,
  };
}
