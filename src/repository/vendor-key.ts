"use server";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { vendorKeys } from "@/drizzle/schema-v2";
import type { Context1mPreference } from "@/lib/special-attributes";
import type { CacheTtlPreference } from "@/types/cache";
import type { CodexInstructionsStrategy, McpPassthroughType, ProviderType } from "@/types/provider";
import type { VendorKey } from "@/types/vendor";
import { toVendorKey } from "./_shared/transformers";

export interface CreateVendorKeyData {
  vendorId: number;
  endpointId: number;

  isUserOverride?: boolean;
  balanceUsd?: number | null;
  balanceUpdatedAt?: Date | null;

  name: string;
  description?: string | null;
  url: string;
  key: string;
  isEnabled?: boolean;
  weight?: number;

  priority?: number;
  costMultiplier?: number | null;
  groupTag?: string | null;

  providerType?: ProviderType;
  preserveClientIp?: boolean;

  modelRedirects?: Record<string, string> | null;
  allowedModels?: string[] | null;
  joinClaudePool?: boolean;

  codexInstructionsStrategy?: CodexInstructionsStrategy;

  mcpPassthroughType?: McpPassthroughType;
  mcpPassthroughUrl?: string | null;

  limit5hUsd?: number | null;
  limitDailyUsd?: number | null;
  dailyResetMode?: "fixed" | "rolling";
  dailyResetTime?: string;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitConcurrentSessions?: number;

  maxRetryAttempts?: number | null;
  circuitBreakerFailureThreshold?: number;
  circuitBreakerOpenDuration?: number;
  circuitBreakerHalfOpenSuccessThreshold?: number;

  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;

  firstByteTimeoutStreamingMs?: number;
  streamingIdleTimeoutMs?: number;
  requestTimeoutNonStreamingMs?: number;

  websiteUrl?: string | null;
  faviconUrl?: string | null;
  cacheTtlPreference?: CacheTtlPreference | null;
  context1mPreference?: Context1mPreference | null;

  tpm?: number | null;
  rpm?: number | null;
  rpd?: number | null;
  cc?: number | null;
}

export interface UpdateVendorKeyData {
  vendorId?: number;
  endpointId?: number;

  isUserOverride?: boolean;
  balanceUsd?: number | null;
  balanceUpdatedAt?: Date | null;

  name?: string;
  description?: string | null;
  url?: string;
  key?: string;
  isEnabled?: boolean;
  weight?: number;

  priority?: number;
  costMultiplier?: number | null;
  groupTag?: string | null;

  providerType?: ProviderType;
  preserveClientIp?: boolean;

  modelRedirects?: Record<string, string> | null;
  allowedModels?: string[] | null;
  joinClaudePool?: boolean;

  codexInstructionsStrategy?: CodexInstructionsStrategy;

  mcpPassthroughType?: McpPassthroughType;
  mcpPassthroughUrl?: string | null;

  limit5hUsd?: number | null;
  limitDailyUsd?: number | null;
  dailyResetMode?: "fixed" | "rolling";
  dailyResetTime?: string;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitConcurrentSessions?: number;

  maxRetryAttempts?: number | null;
  circuitBreakerFailureThreshold?: number;
  circuitBreakerOpenDuration?: number;
  circuitBreakerHalfOpenSuccessThreshold?: number;

  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;

  firstByteTimeoutStreamingMs?: number;
  streamingIdleTimeoutMs?: number;
  requestTimeoutNonStreamingMs?: number;

  websiteUrl?: string | null;
  faviconUrl?: string | null;
  cacheTtlPreference?: CacheTtlPreference | null;
  context1mPreference?: Context1mPreference | null;

  tpm?: number | null;
  rpm?: number | null;
  rpd?: number | null;
  cc?: number | null;
}

const selectVendorKeyFields = {
  id: vendorKeys.id,
  vendorId: vendorKeys.vendorId,
  endpointId: vendorKeys.endpointId,
  isUserOverride: vendorKeys.isUserOverride,
  balanceUsd: vendorKeys.balanceUsd,
  balanceUpdatedAt: vendorKeys.balanceUpdatedAt,
  name: vendorKeys.name,
  description: vendorKeys.description,
  url: vendorKeys.url,
  key: vendorKeys.key,
  isEnabled: vendorKeys.isEnabled,
  weight: vendorKeys.weight,
  priority: vendorKeys.priority,
  costMultiplier: vendorKeys.costMultiplier,
  groupTag: vendorKeys.groupTag,
  providerType: vendorKeys.providerType,
  preserveClientIp: vendorKeys.preserveClientIp,
  modelRedirects: vendorKeys.modelRedirects,
  allowedModels: vendorKeys.allowedModels,
  joinClaudePool: vendorKeys.joinClaudePool,
  codexInstructionsStrategy: vendorKeys.codexInstructionsStrategy,
  mcpPassthroughType: vendorKeys.mcpPassthroughType,
  mcpPassthroughUrl: vendorKeys.mcpPassthroughUrl,
  limit5hUsd: vendorKeys.limit5hUsd,
  limitDailyUsd: vendorKeys.limitDailyUsd,
  dailyResetMode: vendorKeys.dailyResetMode,
  dailyResetTime: vendorKeys.dailyResetTime,
  limitWeeklyUsd: vendorKeys.limitWeeklyUsd,
  limitMonthlyUsd: vendorKeys.limitMonthlyUsd,
  limitConcurrentSessions: vendorKeys.limitConcurrentSessions,
  maxRetryAttempts: vendorKeys.maxRetryAttempts,
  circuitBreakerFailureThreshold: vendorKeys.circuitBreakerFailureThreshold,
  circuitBreakerOpenDuration: vendorKeys.circuitBreakerOpenDuration,
  circuitBreakerHalfOpenSuccessThreshold: vendorKeys.circuitBreakerHalfOpenSuccessThreshold,
  proxyUrl: vendorKeys.proxyUrl,
  proxyFallbackToDirect: vendorKeys.proxyFallbackToDirect,
  firstByteTimeoutStreamingMs: vendorKeys.firstByteTimeoutStreamingMs,
  streamingIdleTimeoutMs: vendorKeys.streamingIdleTimeoutMs,
  requestTimeoutNonStreamingMs: vendorKeys.requestTimeoutNonStreamingMs,
  websiteUrl: vendorKeys.websiteUrl,
  faviconUrl: vendorKeys.faviconUrl,
  cacheTtlPreference: vendorKeys.cacheTtlPreference,
  context1mPreference: vendorKeys.context1mPreference,
  tpm: vendorKeys.tpm,
  rpm: vendorKeys.rpm,
  rpd: vendorKeys.rpd,
  cc: vendorKeys.cc,
  createdAt: vendorKeys.createdAt,
  updatedAt: vendorKeys.updatedAt,
  deletedAt: vendorKeys.deletedAt,
} as const;

export async function createVendorKey(data: CreateVendorKeyData): Promise<VendorKey> {
  const dbData = {
    vendorId: data.vendorId,
    endpointId: data.endpointId,
    isUserOverride: data.isUserOverride ?? false,
    balanceUsd: data.balanceUsd != null ? data.balanceUsd.toString() : null,
    balanceUpdatedAt: data.balanceUpdatedAt ?? null,
    name: data.name,
    description: data.description ?? null,
    url: data.url,
    key: data.key,
    isEnabled: data.isEnabled ?? true,
    weight: data.weight ?? 1,
    priority: data.priority ?? 0,
    costMultiplier: data.costMultiplier != null ? data.costMultiplier.toString() : "1.0",
    groupTag: data.groupTag ?? null,
    providerType: data.providerType ?? "claude",
    preserveClientIp: data.preserveClientIp ?? false,
    modelRedirects: data.modelRedirects ?? null,
    allowedModels: data.allowedModels ?? null,
    joinClaudePool: data.joinClaudePool ?? false,
    codexInstructionsStrategy: data.codexInstructionsStrategy ?? "auto",
    mcpPassthroughType: data.mcpPassthroughType ?? "none",
    mcpPassthroughUrl: data.mcpPassthroughUrl ?? null,
    limit5hUsd: data.limit5hUsd != null ? data.limit5hUsd.toString() : null,
    limitDailyUsd: data.limitDailyUsd != null ? data.limitDailyUsd.toString() : null,
    dailyResetMode: data.dailyResetMode ?? "fixed",
    dailyResetTime: data.dailyResetTime ?? "00:00",
    limitWeeklyUsd: data.limitWeeklyUsd != null ? data.limitWeeklyUsd.toString() : null,
    limitMonthlyUsd: data.limitMonthlyUsd != null ? data.limitMonthlyUsd.toString() : null,
    limitConcurrentSessions: data.limitConcurrentSessions ?? 0,
    maxRetryAttempts: data.maxRetryAttempts ?? null,
    circuitBreakerFailureThreshold: data.circuitBreakerFailureThreshold ?? 5,
    circuitBreakerOpenDuration: data.circuitBreakerOpenDuration ?? 1800000,
    circuitBreakerHalfOpenSuccessThreshold: data.circuitBreakerHalfOpenSuccessThreshold ?? 2,
    proxyUrl: data.proxyUrl ?? null,
    proxyFallbackToDirect: data.proxyFallbackToDirect ?? false,
    firstByteTimeoutStreamingMs: data.firstByteTimeoutStreamingMs ?? 30000,
    streamingIdleTimeoutMs: data.streamingIdleTimeoutMs ?? 10000,
    requestTimeoutNonStreamingMs: data.requestTimeoutNonStreamingMs ?? 600000,
    websiteUrl: data.websiteUrl ?? null,
    faviconUrl: data.faviconUrl ?? null,
    cacheTtlPreference: data.cacheTtlPreference ?? null,
    context1mPreference: data.context1mPreference ?? null,
    tpm: data.tpm ?? null,
    rpm: data.rpm ?? null,
    rpd: data.rpd ?? null,
    cc: data.cc ?? null,
  };

  const [row] = await db.insert(vendorKeys).values(dbData).returning(selectVendorKeyFields);
  return toVendorKey(row);
}

export async function countVendorKeys(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vendorKeys)
    .where(isNull(vendorKeys.deletedAt));

  return row?.count ?? 0;
}

export async function findVendorKeyById(id: number): Promise<VendorKey | null> {
  const [row] = await db
    .select(selectVendorKeyFields)
    .from(vendorKeys)
    .where(and(eq(vendorKeys.id, id), isNull(vendorKeys.deletedAt)))
    .limit(1);

  if (!row) return null;
  return toVendorKey(row);
}

export async function findVendorKeysByVendorId(vendorId: number): Promise<VendorKey[]> {
  const rows = await db
    .select(selectVendorKeyFields)
    .from(vendorKeys)
    .where(and(eq(vendorKeys.vendorId, vendorId), isNull(vendorKeys.deletedAt)))
    .orderBy(asc(vendorKeys.id));

  return rows.map(toVendorKey);
}

export async function findVendorKeysByVendorAndEndpoint(
  vendorId: number,
  endpointId: number
): Promise<VendorKey[]> {
  const rows = await db
    .select(selectVendorKeyFields)
    .from(vendorKeys)
    .where(
      and(
        eq(vendorKeys.vendorId, vendorId),
        eq(vendorKeys.endpointId, endpointId),
        isNull(vendorKeys.deletedAt)
      )
    )
    .orderBy(asc(vendorKeys.id));

  return rows.map(toVendorKey);
}

export async function updateVendorKey(
  id: number,
  data: UpdateVendorKeyData
): Promise<VendorKey | null> {
  if (Object.keys(data).length === 0) {
    return findVendorKeyById(id);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbData: any = {
    updatedAt: new Date(),
  };

  if (data.vendorId !== undefined) dbData.vendorId = data.vendorId;
  if (data.endpointId !== undefined) dbData.endpointId = data.endpointId;
  if (data.isUserOverride !== undefined) dbData.isUserOverride = data.isUserOverride;
  if (data.balanceUsd !== undefined)
    dbData.balanceUsd = data.balanceUsd != null ? data.balanceUsd.toString() : null;
  if (data.balanceUpdatedAt !== undefined) dbData.balanceUpdatedAt = data.balanceUpdatedAt;
  if (data.name !== undefined) dbData.name = data.name;
  if (data.description !== undefined) dbData.description = data.description;
  if (data.url !== undefined) dbData.url = data.url;
  if (data.key !== undefined) dbData.key = data.key;
  if (data.isEnabled !== undefined) dbData.isEnabled = data.isEnabled;
  if (data.weight !== undefined) dbData.weight = data.weight;
  if (data.priority !== undefined) dbData.priority = data.priority;
  if (data.costMultiplier !== undefined)
    dbData.costMultiplier = data.costMultiplier != null ? data.costMultiplier.toString() : "1.0";
  if (data.groupTag !== undefined) dbData.groupTag = data.groupTag;
  if (data.providerType !== undefined) dbData.providerType = data.providerType;
  if (data.preserveClientIp !== undefined) dbData.preserveClientIp = data.preserveClientIp;
  if (data.modelRedirects !== undefined) dbData.modelRedirects = data.modelRedirects;
  if (data.allowedModels !== undefined) dbData.allowedModels = data.allowedModels;
  if (data.joinClaudePool !== undefined) dbData.joinClaudePool = data.joinClaudePool;
  if (data.codexInstructionsStrategy !== undefined)
    dbData.codexInstructionsStrategy = data.codexInstructionsStrategy;
  if (data.mcpPassthroughType !== undefined) dbData.mcpPassthroughType = data.mcpPassthroughType;
  if (data.mcpPassthroughUrl !== undefined) dbData.mcpPassthroughUrl = data.mcpPassthroughUrl;
  if (data.limit5hUsd !== undefined)
    dbData.limit5hUsd = data.limit5hUsd != null ? data.limit5hUsd.toString() : null;
  if (data.limitDailyUsd !== undefined)
    dbData.limitDailyUsd = data.limitDailyUsd != null ? data.limitDailyUsd.toString() : null;
  if (data.dailyResetMode !== undefined) dbData.dailyResetMode = data.dailyResetMode;
  if (data.dailyResetTime !== undefined) dbData.dailyResetTime = data.dailyResetTime;
  if (data.limitWeeklyUsd !== undefined)
    dbData.limitWeeklyUsd = data.limitWeeklyUsd != null ? data.limitWeeklyUsd.toString() : null;
  if (data.limitMonthlyUsd !== undefined)
    dbData.limitMonthlyUsd = data.limitMonthlyUsd != null ? data.limitMonthlyUsd.toString() : null;
  if (data.limitConcurrentSessions !== undefined)
    dbData.limitConcurrentSessions = data.limitConcurrentSessions;
  if (data.maxRetryAttempts !== undefined) dbData.maxRetryAttempts = data.maxRetryAttempts;
  if (data.circuitBreakerFailureThreshold !== undefined)
    dbData.circuitBreakerFailureThreshold = data.circuitBreakerFailureThreshold;
  if (data.circuitBreakerOpenDuration !== undefined)
    dbData.circuitBreakerOpenDuration = data.circuitBreakerOpenDuration;
  if (data.circuitBreakerHalfOpenSuccessThreshold !== undefined)
    dbData.circuitBreakerHalfOpenSuccessThreshold = data.circuitBreakerHalfOpenSuccessThreshold;
  if (data.proxyUrl !== undefined) dbData.proxyUrl = data.proxyUrl;
  if (data.proxyFallbackToDirect !== undefined)
    dbData.proxyFallbackToDirect = data.proxyFallbackToDirect;
  if (data.firstByteTimeoutStreamingMs !== undefined)
    dbData.firstByteTimeoutStreamingMs = data.firstByteTimeoutStreamingMs;
  if (data.streamingIdleTimeoutMs !== undefined)
    dbData.streamingIdleTimeoutMs = data.streamingIdleTimeoutMs;
  if (data.requestTimeoutNonStreamingMs !== undefined)
    dbData.requestTimeoutNonStreamingMs = data.requestTimeoutNonStreamingMs;
  if (data.websiteUrl !== undefined) dbData.websiteUrl = data.websiteUrl;
  if (data.faviconUrl !== undefined) dbData.faviconUrl = data.faviconUrl;
  if (data.cacheTtlPreference !== undefined) dbData.cacheTtlPreference = data.cacheTtlPreference;
  if (data.context1mPreference !== undefined) dbData.context1mPreference = data.context1mPreference;
  if (data.tpm !== undefined) dbData.tpm = data.tpm;
  if (data.rpm !== undefined) dbData.rpm = data.rpm;
  if (data.rpd !== undefined) dbData.rpd = data.rpd;
  if (data.cc !== undefined) dbData.cc = data.cc;

  const [row] = await db
    .update(vendorKeys)
    .set(dbData)
    .where(and(eq(vendorKeys.id, id), isNull(vendorKeys.deletedAt)))
    .returning(selectVendorKeyFields);

  if (!row) return null;
  return toVendorKey(row);
}

export async function deleteVendorKey(id: number): Promise<boolean> {
  const result = await db
    .update(vendorKeys)
    .set({ deletedAt: new Date() })
    .where(and(eq(vendorKeys.id, id), isNull(vendorKeys.deletedAt)))
    .returning({ id: vendorKeys.id });

  return result.length > 0;
}
