import "server-only";

import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/drizzle/db";
import { messageRequest, providers } from "@/drizzle/schema";
import { getSystemSettings } from "@/repository/system-config";
import type { ProviderType } from "@/types/provider";
import { EXCLUDE_WARMUP_CONDITION } from "./_shared/message-request-conditions";

export interface TimeRange {
  start: Date;
  end: Date;
}

export type CacheHitRateAlertWindowMode = "rolling" | "strict";

export interface CacheHitRateAlertQueryConfig {
  /**
   * rolling: 允许 prev request 落在 timeRange 之外（更适合滚动窗口）
   * strict: 仅当 prev request 也在 timeRange 内时才计 eligible
   */
  windowMode?: CacheHitRateAlertWindowMode;
  /** 2xx: 仅统计 2xx（推荐）；all: 不筛状态码 */
  statusCodeMode?: "2xx" | "all";
  /**
   * 当无法从 row（5m/1h 细分字段或 cacheTtlApplied）推断 TTL 时使用的 fallback。
   * 优先级：ttlFallbackSecondsByProviderType > ttlFallbackSecondsDefault
   */
  ttlFallbackSecondsByProviderType?: Partial<Record<ProviderType, number>>;
  ttlFallbackSecondsDefault?: number;
}

export interface ProviderModelCacheHitRateAlertMetric {
  providerId: number;
  providerType: ProviderType;
  model: string;

  totalRequests: number;
  cacheSignalRequests: number;
  cacheHitRequests: number;

  sumInputTokens: number;
  sumCacheCreationTokens: number;
  sumCacheReadTokens: number;
  denominatorTokens: number;

  /** 与排行榜一致：cache_read / (input + cache_creation + cache_read) */
  hitRateTokens: number;
  engagementRate: number;

  eligibleRequests: number;
  eligibleDenominatorTokens: number;
  eligibleCacheReadTokens: number;
  hitRateTokensEligible: number;
}

function clampRate01(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function normalizeTtlFallbackSeconds(config: CacheHitRateAlertQueryConfig): {
  defaultSeconds: number;
  byType: Record<ProviderType, number>;
} {
  const TTL_FALLBACK_DEFAULT_SECONDS = 3600;
  const TTL_FALLBACK_MAX_SECONDS = 2_147_483_647; // int4 max，避免异常配置导致 SQL 参数溢出/无穷大

  const toSafeTtlSeconds = (input: unknown, fallbackSeconds: number): number => {
    if (typeof input !== "number" || !Number.isFinite(input) || !Number.isInteger(input)) {
      return fallbackSeconds;
    }
    if (input < 0) return fallbackSeconds;
    return Math.min(input, TTL_FALLBACK_MAX_SECONDS);
  };

  const defaultSeconds = toSafeTtlSeconds(
    config.ttlFallbackSecondsDefault,
    TTL_FALLBACK_DEFAULT_SECONDS
  );
  const base: Record<ProviderType, number> = {
    claude: defaultSeconds,
    "claude-auth": defaultSeconds,
    codex: 6 * 3600,
    gemini: defaultSeconds,
    "gemini-cli": defaultSeconds,
    "openai-compatible": 6 * 3600,
  };
  const overrides = config.ttlFallbackSecondsByProviderType ?? {};
  const byType: Record<ProviderType, number> = { ...base };

  for (const [key, rawSeconds] of Object.entries(overrides)) {
    if (!Object.hasOwn(byType, key)) continue;
    const providerType = key as ProviderType;
    byType[providerType] = toSafeTtlSeconds(rawSeconds, byType[providerType]);
  }

  return {
    defaultSeconds,
    byType,
  };
}

function normalizeStatusCodeMode(config: CacheHitRateAlertQueryConfig): "2xx" | "all" {
  return config.statusCodeMode ?? "2xx";
}

function normalizeWindowMode(config: CacheHitRateAlertQueryConfig): CacheHitRateAlertWindowMode {
  return config.windowMode ?? "rolling";
}

export async function findProviderModelCacheHitRateMetricsForAlert(
  timeRange: TimeRange,
  providerType?: ProviderType,
  config: CacheHitRateAlertQueryConfig = {}
): Promise<ProviderModelCacheHitRateAlertMetric[]> {
  if (timeRange.start >= timeRange.end) {
    return [];
  }

  const statusCodeMode = normalizeStatusCodeMode(config);
  const windowMode = normalizeWindowMode(config);
  const ttlFallback = normalizeTtlFallbackSeconds(config);

  const systemSettings = await getSystemSettings();
  const billingModelSource = systemSettings.billingModelSource;

  const modelField =
    billingModelSource === "original"
      ? sql<string>`COALESCE(${messageRequest.originalModel}, ${messageRequest.model})`
      : sql<string>`COALESCE(${messageRequest.model}, ${messageRequest.originalModel})`;

  const prev = alias(messageRequest, "prev_message_request");
  const prevExcludeWarmupCondition = sql`(${prev.blockedBy} IS NULL OR ${prev.blockedBy} <> 'warmup')`;

  const cacheSignalCondition = sql`(
    COALESCE(${messageRequest.cacheCreationInputTokens}, 0) > 0
    OR COALESCE(${messageRequest.cacheReadInputTokens}, 0) > 0
  )`;
  const cacheHitCondition = sql`(COALESCE(${messageRequest.cacheReadInputTokens}, 0) > 0)`;

  const hasSessionIdCondition = sql`(
    ${messageRequest.sessionId} IS NOT NULL
    AND btrim(${messageRequest.sessionId}) <> ''
  )`;

  const gapToPrevSecondsExpr = sql<
    number | null
  >`EXTRACT(EPOCH FROM (${messageRequest.createdAt} - ${prev.createdAt}))::double precision`;

  // TTL fallback 映射只在 normalizeTtlFallbackSeconds() 维护一份；
  // 这里的 SQL CASE 直接由 ttlFallback.byType 生成，避免 TS/SQL 双份维护产生漂移。
  const ttlFallbackWhenClauses = (
    Object.entries(ttlFallback.byType) as Array<[ProviderType, number]>
  ).map(
    ([providerType, seconds]) =>
      sql`WHEN ${providers.providerType} = ${providerType} THEN ${seconds}`
  );

  const ttlFallbackSecondsExpr = sql<number>`CASE
    ${sql.join(ttlFallbackWhenClauses, sql` `)}
    ELSE ${ttlFallback.defaultSeconds}
  END`;

  // cache_ttl_applied 理论上应是短字符串（例如 5m/1h/3600s），但数据库字段可能被
  // 异常/恶意写入过大的数值，从而导致 ::int 或乘法溢出。本处对纯数字 TTL 做位数与范围
  // 护栏：无效值统一回退到 ttlFallbackSecondsExpr，避免查询直接失败。
  const ttlAppliedNumberTextExpr = sql<string>`substring(${messageRequest.cacheTtlApplied} from '^[0-9]+')`;
  const ttlAppliedNumberMaxDigits = 9;
  const ttlAppliedNumberMaxSeconds = 7 * 24 * 3600;
  const ttlAppliedNumberMaxHours = Math.floor(ttlAppliedNumberMaxSeconds / 3600);
  const ttlAppliedNumberMaxMinutes = Math.floor(ttlAppliedNumberMaxSeconds / 60);

  const ttlSecondsExpr = sql<number>`CASE
    WHEN COALESCE(${messageRequest.cacheCreation1hInputTokens}, 0) > 0 THEN 3600
    WHEN COALESCE(${messageRequest.cacheCreation5mInputTokens}, 0) > 0 THEN 300
    WHEN ${messageRequest.cacheTtlApplied} = '1h' THEN 3600
    WHEN ${messageRequest.cacheTtlApplied} = '5m' THEN 300
    WHEN ${messageRequest.cacheTtlApplied} = 'mixed' THEN 3600
    WHEN ${messageRequest.cacheTtlApplied} ~ '^[0-9]+h$' THEN (
      CASE
        WHEN char_length(${ttlAppliedNumberTextExpr}) > ${ttlAppliedNumberMaxDigits}
          THEN ${ttlFallbackSecondsExpr}
        WHEN (${ttlAppliedNumberTextExpr})::int > ${ttlAppliedNumberMaxHours}
          THEN ${ttlFallbackSecondsExpr}
        ELSE (${ttlAppliedNumberTextExpr})::int * 3600
      END
    )
    WHEN ${messageRequest.cacheTtlApplied} ~ '^[0-9]+m$' THEN (
      CASE
        WHEN char_length(${ttlAppliedNumberTextExpr}) > ${ttlAppliedNumberMaxDigits}
          THEN ${ttlFallbackSecondsExpr}
        WHEN (${ttlAppliedNumberTextExpr})::int > ${ttlAppliedNumberMaxMinutes}
          THEN ${ttlFallbackSecondsExpr}
        ELSE (${ttlAppliedNumberTextExpr})::int * 60
      END
    )
    WHEN ${messageRequest.cacheTtlApplied} ~ '^[0-9]+s$' THEN (
      CASE
        WHEN char_length(${ttlAppliedNumberTextExpr}) > ${ttlAppliedNumberMaxDigits}
          THEN ${ttlFallbackSecondsExpr}
        WHEN (${ttlAppliedNumberTextExpr})::int > ${ttlAppliedNumberMaxSeconds}
          THEN ${ttlFallbackSecondsExpr}
        ELSE (${ttlAppliedNumberTextExpr})::int
      END
    )
    ELSE ${ttlFallbackSecondsExpr}
  END`;

  const eligibleConditionsRaw = [
    hasSessionIdCondition,
    sql`${messageRequest.requestSequence} > 1`,
    sql`${prev.createdAt} IS NOT NULL`,
    windowMode === "strict"
      ? sql`(${prev.createdAt} >= ${timeRange.start} AND ${prev.createdAt} < ${timeRange.end})`
      : undefined,
    sql`${gapToPrevSecondsExpr} >= 0::double precision`,
    sql`${gapToPrevSecondsExpr} <= (${ttlSecondsExpr})::double precision`,
  ] as const;

  const eligibleConditions = eligibleConditionsRaw.filter(
    (c): c is NonNullable<(typeof eligibleConditionsRaw)[number]> => !!c
  );

  const eligibleCondition = and(...eligibleConditions);

  const denominatorTokensExpr = sql<number>`(
    COALESCE(${messageRequest.inputTokens}, 0)::double precision +
    COALESCE(${messageRequest.cacheCreationInputTokens}, 0)::double precision +
    COALESCE(${messageRequest.cacheReadInputTokens}, 0)::double precision
  )`;

  const totalRequestsExpr = sql<number>`count(*)::double precision`;
  const cacheSignalRequestsExpr = sql<number>`count(*) FILTER (WHERE ${cacheSignalCondition})::double precision`;
  const cacheHitRequestsExpr = sql<number>`count(*) FILTER (WHERE ${cacheHitCondition})::double precision`;

  const sumInputTokensExpr = sql<number>`COALESCE(sum(COALESCE(${messageRequest.inputTokens}, 0))::double precision, 0::double precision)`;
  const sumCacheCreationTokensExpr = sql<number>`COALESCE(sum(COALESCE(${messageRequest.cacheCreationInputTokens}, 0))::double precision, 0::double precision)`;
  const sumCacheReadTokensExpr = sql<number>`COALESCE(sum(COALESCE(${messageRequest.cacheReadInputTokens}, 0))::double precision, 0::double precision)`;
  const sumDenominatorTokensExpr = sql<number>`COALESCE(sum(${denominatorTokensExpr})::double precision, 0::double precision)`;

  const hitRateTokensExpr = sql<number>`COALESCE(
    ${sumCacheReadTokensExpr} / NULLIF(${sumDenominatorTokensExpr}, 0::double precision),
    0::double precision
  )`;

  const engagementRateExpr = sql<number>`COALESCE(
    ${cacheSignalRequestsExpr} / NULLIF(${totalRequestsExpr}, 0::double precision),
    0::double precision
  )`;

  const eligibleRequestsExpr = sql<number>`count(*) FILTER (WHERE ${eligibleCondition})::double precision`;
  const eligibleDenominatorTokensExpr = sql<number>`COALESCE(
    sum(${denominatorTokensExpr}) FILTER (WHERE ${eligibleCondition})::double precision,
    0::double precision
  )`;
  const eligibleCacheReadTokensExpr = sql<number>`COALESCE(
    sum(COALESCE(${messageRequest.cacheReadInputTokens}, 0)) FILTER (WHERE ${eligibleCondition})::double precision,
    0::double precision
  )`;
  const hitRateTokensEligibleExpr = sql<number>`COALESCE(
    ${eligibleCacheReadTokensExpr} / NULLIF(${eligibleDenominatorTokensExpr}, 0::double precision),
    0::double precision
  )`;

  const whereConditionsRaw = [
    isNull(messageRequest.deletedAt),
    EXCLUDE_WARMUP_CONDITION,
    gte(messageRequest.createdAt, timeRange.start),
    lt(messageRequest.createdAt, timeRange.end),
    providerType ? eq(providers.providerType, providerType) : undefined,
    statusCodeMode === "2xx" ? gte(messageRequest.statusCode, 200) : undefined,
    statusCodeMode === "2xx" ? lt(messageRequest.statusCode, 300) : undefined,
    sql`${modelField} IS NOT NULL AND btrim(${modelField}) <> ''`,
  ] as const;

  const whereConditions = whereConditionsRaw.filter(
    (c): c is NonNullable<(typeof whereConditionsRaw)[number]> => !!c
  );

  const rows = await db
    .select({
      providerId: messageRequest.providerId,
      providerType: providers.providerType,
      model: modelField,
      totalRequests: totalRequestsExpr,
      cacheSignalRequests: cacheSignalRequestsExpr,
      cacheHitRequests: cacheHitRequestsExpr,
      sumInputTokens: sumInputTokensExpr,
      sumCacheCreationTokens: sumCacheCreationTokensExpr,
      sumCacheReadTokens: sumCacheReadTokensExpr,
      denominatorTokens: sumDenominatorTokensExpr,
      hitRateTokens: hitRateTokensExpr,
      engagementRate: engagementRateExpr,
      eligibleRequests: eligibleRequestsExpr,
      eligibleDenominatorTokens: eligibleDenominatorTokensExpr,
      eligibleCacheReadTokens: eligibleCacheReadTokensExpr,
      hitRateTokensEligible: hitRateTokensEligibleExpr,
    })
    .from(messageRequest)
    .innerJoin(
      providers,
      and(eq(messageRequest.providerId, providers.id), isNull(providers.deletedAt))
    )
    .leftJoin(
      prev,
      and(
        eq(prev.sessionId, messageRequest.sessionId),
        eq(prev.requestSequence, sql<number>`(${messageRequest.requestSequence} - 1)`),
        isNull(prev.deletedAt),
        prevExcludeWarmupCondition
      )
    )
    .where(and(...whereConditions))
    .groupBy(messageRequest.providerId, providers.providerType, modelField)
    .orderBy(desc(totalRequestsExpr));

  return rows.map((row) => ({
    providerId: row.providerId,
    providerType: row.providerType,
    model: row.model,
    totalRequests: row.totalRequests,
    cacheSignalRequests: row.cacheSignalRequests,
    cacheHitRequests: row.cacheHitRequests,
    sumInputTokens: row.sumInputTokens,
    sumCacheCreationTokens: row.sumCacheCreationTokens,
    sumCacheReadTokens: row.sumCacheReadTokens,
    denominatorTokens: row.denominatorTokens,
    hitRateTokens: clampRate01(row.hitRateTokens),
    engagementRate: clampRate01(row.engagementRate),
    eligibleRequests: row.eligibleRequests,
    eligibleDenominatorTokens: row.eligibleDenominatorTokens,
    eligibleCacheReadTokens: row.eligibleCacheReadTokens,
    hitRateTokensEligible: clampRate01(row.hitRateTokensEligible),
  }));
}
