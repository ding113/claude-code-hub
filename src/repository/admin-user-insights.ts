"use server";

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providers, usageLedger } from "@/drizzle/schema";
import { LEDGER_BILLING_CONDITION } from "./_shared/ledger-conditions";
import { getSystemSettings } from "./system-config";

export interface AdminUserModelBreakdownItem {
  model: string | null;
  requests: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Get model-level usage breakdown for a specific user.
 * Groups by the billingModelSource-resolved model field and orders by cost DESC.
 */
export interface AdminUserProviderBreakdownItem {
  providerId: number;
  providerName: string | null;
  requests: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Get model-level usage breakdown for a specific user.
 * Groups by the billingModelSource-resolved model field and orders by cost DESC.
 */
export async function getUserModelBreakdown(
  userId: number,
  startDate?: string,
  endDate?: string,
  filters?: { keyId?: number; providerId?: number }
): Promise<AdminUserModelBreakdownItem[]> {
  const systemSettings = await getSystemSettings();
  const billingModelSource = systemSettings.billingModelSource;

  const rawModelField =
    billingModelSource === "original"
      ? sql<string>`COALESCE(${usageLedger.originalModel}, ${usageLedger.model})`
      : sql<string>`COALESCE(${usageLedger.model}, ${usageLedger.originalModel})`;
  const modelField = sql<string>`NULLIF(TRIM(${rawModelField}), '')`;

  const conditions = [LEDGER_BILLING_CONDITION, eq(usageLedger.userId, userId)];

  if (startDate) {
    conditions.push(gte(usageLedger.createdAt, sql`${startDate}::date`));
  }

  if (endDate) {
    conditions.push(lt(usageLedger.createdAt, sql`(${endDate}::date + INTERVAL '1 day')`));
  }

  if (filters?.keyId) {
    conditions.push(
      sql`${usageLedger.key} = (SELECT k."key" FROM "keys" k WHERE k."id" = ${filters.keyId})`
    );
  }

  if (filters?.providerId) {
    conditions.push(eq(usageLedger.finalProviderId, filters.providerId));
  }

  const rows = await db
    .select({
      model: modelField,
      requests: sql<number>`count(*)::int`,
      cost: sql<number>`COALESCE(sum(${usageLedger.costUsd})::double precision, 0)`,
      inputTokens: sql<number>`COALESCE(sum(${usageLedger.inputTokens})::double precision, 0)`,
      outputTokens: sql<number>`COALESCE(sum(${usageLedger.outputTokens})::double precision, 0)`,
      cacheCreationTokens: sql<number>`COALESCE(sum(${usageLedger.cacheCreationInputTokens})::double precision, 0)`,
      cacheReadTokens: sql<number>`COALESCE(sum(${usageLedger.cacheReadInputTokens})::double precision, 0)`,
    })
    .from(usageLedger)
    .where(and(...conditions))
    .groupBy(modelField)
    .orderBy(desc(sql`sum(${usageLedger.costUsd})`));

  return rows;
}

/**
 * Get provider-level usage breakdown for a specific user.
 * JOINs usageLedger with providers table and groups by provider.
 */
export async function getUserProviderBreakdown(
  userId: number,
  startDate?: string,
  endDate?: string,
  filters?: { keyId?: number; model?: string }
): Promise<AdminUserProviderBreakdownItem[]> {
  const conditions = [LEDGER_BILLING_CONDITION, eq(usageLedger.userId, userId)];

  if (startDate) {
    conditions.push(gte(usageLedger.createdAt, sql`${startDate}::date`));
  }

  if (endDate) {
    conditions.push(lt(usageLedger.createdAt, sql`(${endDate}::date + INTERVAL '1 day')`));
  }

  if (filters?.keyId) {
    conditions.push(
      sql`${usageLedger.key} = (SELECT k."key" FROM "keys" k WHERE k."id" = ${filters.keyId})`
    );
  }

  if (filters?.model) {
    conditions.push(
      sql`(${usageLedger.model} ILIKE ${filters.model} OR ${usageLedger.originalModel} ILIKE ${filters.model})`
    );
  }

  const rows = await db
    .select({
      providerId: providers.id,
      providerName: providers.name,
      requests: sql<number>`count(*)::int`,
      cost: sql<number>`COALESCE(sum(${usageLedger.costUsd})::double precision, 0)`,
      inputTokens: sql<number>`COALESCE(sum(${usageLedger.inputTokens})::double precision, 0)`,
      outputTokens: sql<number>`COALESCE(sum(${usageLedger.outputTokens})::double precision, 0)`,
      cacheCreationTokens: sql<number>`COALESCE(sum(${usageLedger.cacheCreationInputTokens})::double precision, 0)`,
      cacheReadTokens: sql<number>`COALESCE(sum(${usageLedger.cacheReadInputTokens})::double precision, 0)`,
    })
    .from(usageLedger)
    .innerJoin(providers, eq(usageLedger.finalProviderId, providers.id))
    .where(and(...conditions))
    .groupBy(providers.id, providers.name)
    .orderBy(desc(sql`sum(${usageLedger.costUsd})`));

  return rows;
}
