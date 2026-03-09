"use server";

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { usageLedger } from "@/drizzle/schema";
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
export async function getUserModelBreakdown(
  userId: number,
  startDate?: string,
  endDate?: string
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
