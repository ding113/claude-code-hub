import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys as keysTable, modelGroupLimits } from "@/drizzle/schema";
import type { DailyResetMode } from "@/lib/rate-limit/time-utils";

export type LimitSubjectType = "user" | "key" | "user_group";

export type ModelGroupLimitRow = typeof modelGroupLimits.$inferSelect;

/** Numeric-normalized caps for a single (subject, group) limit row. */
export interface ModelGroupLimitCaps {
  rpmLimit: number | null;
  limit5hUsd: number | null;
  limit5hResetMode: DailyResetMode;
  dailyLimitUsd: number | null;
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  limitTotalUsd: number | null;
  limit5hCostResetAt: Date | null;
}

export interface ModelGroupLimitRecord extends ModelGroupLimitCaps {
  id: number;
  subjectType: LimitSubjectType;
  subjectId: number;
  modelGroupId: number;
  keyPreview?: string | null;
}

/** Mutable fields; omitted = unchanged on update, null = clear (unlimited). */
export interface ModelGroupLimitInput {
  rpmLimit?: number | null;
  limit5hUsd?: number | null;
  limit5hResetMode?: DailyResetMode;
  dailyLimitUsd?: number | null;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitTotalUsd?: number | null;
  limit5hCostResetAt?: Date | null;
}

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUsdString(value: number | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
}

function transformRow(row: ModelGroupLimitRow): ModelGroupLimitRecord {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    modelGroupId: row.modelGroupId,
    rpmLimit: row.rpmLimit ?? null,
    limit5hUsd: toNumber(row.limit5hUsd),
    limit5hResetMode: row.limit5hResetMode,
    dailyLimitUsd: toNumber(row.dailyLimitUsd),
    limitWeeklyUsd: toNumber(row.limitWeeklyUsd),
    limitMonthlyUsd: toNumber(row.limitMonthlyUsd),
    limitTotalUsd: toNumber(row.limitTotalUsd),
    limit5hCostResetAt: row.limit5hCostResetAt ?? null,
  };
}

function buildWriteValues(input: ModelGroupLimitInput) {
  return {
    rpmLimit: input.rpmLimit,
    limit5hUsd: toUsdString(input.limit5hUsd),
    limit5hResetMode: input.limit5hResetMode,
    dailyLimitUsd: toUsdString(input.dailyLimitUsd),
    limitWeeklyUsd: toUsdString(input.limitWeeklyUsd),
    limitMonthlyUsd: toUsdString(input.limitMonthlyUsd),
    limitTotalUsd: toUsdString(input.limitTotalUsd),
    limit5hCostResetAt: input.limit5hCostResetAt,
    updatedAt: new Date(),
  };
}

/** Full-table snapshot read used by the resolution cache (admin-low-frequency). */
export async function listAllModelGroupLimits(): Promise<ModelGroupLimitRecord[]> {
  const rows = await db.select().from(modelGroupLimits);
  return rows.map(transformRow);
}

export async function listModelGroupLimits(filter: {
  subjectType?: LimitSubjectType;
  subjectId?: number;
  modelGroupId?: number;
}): Promise<ModelGroupLimitRecord[]> {
  const conditions = [];
  if (filter.subjectType !== undefined) {
    conditions.push(eq(modelGroupLimits.subjectType, filter.subjectType));
  }
  if (filter.subjectId !== undefined) {
    conditions.push(eq(modelGroupLimits.subjectId, filter.subjectId));
  }
  if (filter.modelGroupId !== undefined) {
    conditions.push(eq(modelGroupLimits.modelGroupId, filter.modelGroupId));
  }

  const whereClause =
    conditions.length > 0
      ? conditions.length === 1
        ? conditions[0]
        : and(...conditions)
      : undefined;

  const rows = await db
    .select({ limit: modelGroupLimits, keyValue: keysTable.key })
    .from(modelGroupLimits)
    .leftJoin(
      keysTable,
      and(
        eq(modelGroupLimits.subjectType, "key" as LimitSubjectType),
        eq(modelGroupLimits.subjectId, keysTable.id)
      )
    )
    .where(whereClause);

  return rows.map(({ limit, keyValue }) => ({
    ...transformRow(limit),
    keyPreview: keyValue
      ? keyValue.length > 12
        ? `${keyValue.slice(0, 8)}...${keyValue.slice(-4)}`
        : `${keyValue.slice(0, 4)}...`
      : null,
  }));
}

export async function getModelGroupLimit(
  subjectType: LimitSubjectType,
  subjectId: number,
  modelGroupId: number
): Promise<ModelGroupLimitRecord | null> {
  const rows = await db
    .select()
    .from(modelGroupLimits)
    .where(
      and(
        eq(modelGroupLimits.subjectType, subjectType),
        eq(modelGroupLimits.subjectId, subjectId),
        eq(modelGroupLimits.modelGroupId, modelGroupId)
      )
    )
    .limit(1);

  return rows[0] ? transformRow(rows[0]) : null;
}

export async function upsertModelGroupLimit(
  subjectType: LimitSubjectType,
  subjectId: number,
  modelGroupId: number,
  input: ModelGroupLimitInput
): Promise<ModelGroupLimitRecord> {
  const values = buildWriteValues(input);
  const [row] = await db
    .insert(modelGroupLimits)
    .values({ subjectType, subjectId, modelGroupId, ...values })
    .onConflictDoUpdate({
      target: [
        modelGroupLimits.subjectType,
        modelGroupLimits.subjectId,
        modelGroupLimits.modelGroupId,
      ],
      set: values,
    })
    .returning();

  return transformRow(row);
}

export async function deleteModelGroupLimit(id: number): Promise<void> {
  await db.delete(modelGroupLimits).where(eq(modelGroupLimits.id, id));
}
