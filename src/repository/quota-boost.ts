import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { quotaBoostGrants } from "@/drizzle/schema";

export type BoostWindow = "5h" | "daily" | "weekly" | "monthly" | "total";

export type QuotaBoostGrantRow = typeof quotaBoostGrants.$inferSelect;

export interface CreateQuotaBoostGrantInput {
  userId: number;
  modelGroupId: number;
  window: BoostWindow;
  amountUsd: number;
  validFrom: Date;
  validTo: Date;
  note?: string | null;
  createdBy?: number | null;
}

export async function createQuotaBoostGrant(
  input: CreateQuotaBoostGrantInput
): Promise<QuotaBoostGrantRow> {
  const [row] = await db
    .insert(quotaBoostGrants)
    .values({
      userId: input.userId,
      modelGroupId: input.modelGroupId,
      window: input.window,
      amountUsd: String(input.amountUsd),
      validFrom: input.validFrom,
      validTo: input.validTo,
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();

  return row;
}

export async function deleteQuotaBoostGrant(id: number): Promise<void> {
  await db.delete(quotaBoostGrants).where(eq(quotaBoostGrants.id, id));
}

export async function listQuotaBoostGrants(filter: {
  userId?: number;
  modelGroupId?: number;
}): Promise<QuotaBoostGrantRow[]> {
  const conditions = [];

  if (filter.userId !== undefined) {
    conditions.push(eq(quotaBoostGrants.userId, filter.userId));
  }
  if (filter.modelGroupId !== undefined) {
    conditions.push(eq(quotaBoostGrants.modelGroupId, filter.modelGroupId));
  }

  return db.query.quotaBoostGrants.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [quotaBoostGrants.createdAt],
  });
}

export async function listActiveAndFutureGrantsByUser(
  userId: number
): Promise<QuotaBoostGrantRow[]> {
  return db.query.quotaBoostGrants.findMany({
    where: and(eq(quotaBoostGrants.userId, userId), gt(quotaBoostGrants.validTo, new Date())),
    orderBy: [quotaBoostGrants.validFrom],
  });
}

/**
 * All grants that are still active or scheduled for the future (validTo > now),
 * across every user. Feeds the resolution snapshot (cache.ts); the per-request
 * `validFrom <= now < validTo` check is applied in-memory by the resolver (F2).
 */
export async function listAllActiveAndFutureGrants(now?: Date): Promise<QuotaBoostGrantRow[]> {
  return db.query.quotaBoostGrants.findMany({
    where: gt(quotaBoostGrants.validTo, now ?? new Date()),
    orderBy: [quotaBoostGrants.validFrom],
  });
}

export async function deleteExpiredQuotaBoostGrants(now?: Date): Promise<number> {
  const cutoff = now ?? new Date();
  const deleted = await db
    .delete(quotaBoostGrants)
    .where(sql`${quotaBoostGrants.validTo} <= ${cutoff}`)
    .returning({ id: quotaBoostGrants.id });

  return deleted.length;
}
