"use server";

import { desc, eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { vendorBalanceChecks } from "@/drizzle/schema-v2";

export interface VendorBalanceCheck {
  id: number;
  vendorKeyId: number;
  vendorId: number | null;
  endpointId: number | null;
  checkedAt: Date;
  durationMs: number | null;
  statusCode: number | null;
  isSuccess: boolean;
  balanceUsd: number | null;
  rawResponse: unknown;
  errorMessage: string | null;
  createdAt: Date;
}

export interface CreateVendorBalanceCheckData {
  vendorKeyId: number;
  vendorId?: number | null;
  endpointId?: number | null;
  checkedAt?: Date;
  durationMs?: number | null;
  statusCode?: number | null;
  isSuccess?: boolean;
  balanceUsd?: number | null;
  rawResponse?: unknown;
  errorMessage?: string | null;
}

function toVendorBalanceCheck(dbRow: {
  id: number;
  vendorKeyId: number;
  vendorId: number | null;
  endpointId: number | null;
  checkedAt: Date | null;
  durationMs: number | null;
  statusCode: number | null;
  isSuccess: boolean;
  balanceUsd: string | null;
  rawResponse: unknown;
  errorMessage: string | null;
  createdAt: Date | null;
}): VendorBalanceCheck {
  return {
    ...dbRow,
    balanceUsd: dbRow.balanceUsd != null ? parseFloat(dbRow.balanceUsd) : null,
    checkedAt: dbRow.checkedAt ? new Date(dbRow.checkedAt) : new Date(),
    createdAt: dbRow.createdAt ? new Date(dbRow.createdAt) : new Date(),
  };
}

export async function createVendorBalanceCheck(
  data: CreateVendorBalanceCheckData
): Promise<VendorBalanceCheck> {
  const dbData = {
    vendorKeyId: data.vendorKeyId,
    vendorId: data.vendorId ?? null,
    endpointId: data.endpointId ?? null,
    ...(data.checkedAt ? { checkedAt: data.checkedAt } : {}),
    durationMs: data.durationMs ?? null,
    statusCode: data.statusCode ?? null,
    isSuccess: data.isSuccess ?? false,
    balanceUsd: data.balanceUsd != null ? data.balanceUsd.toString() : null,
    rawResponse: data.rawResponse ?? null,
    errorMessage: data.errorMessage ?? null,
  };

  const [row] = await db.insert(vendorBalanceChecks).values(dbData).returning({
    id: vendorBalanceChecks.id,
    vendorKeyId: vendorBalanceChecks.vendorKeyId,
    vendorId: vendorBalanceChecks.vendorId,
    endpointId: vendorBalanceChecks.endpointId,
    checkedAt: vendorBalanceChecks.checkedAt,
    durationMs: vendorBalanceChecks.durationMs,
    statusCode: vendorBalanceChecks.statusCode,
    isSuccess: vendorBalanceChecks.isSuccess,
    balanceUsd: vendorBalanceChecks.balanceUsd,
    rawResponse: vendorBalanceChecks.rawResponse,
    errorMessage: vendorBalanceChecks.errorMessage,
    createdAt: vendorBalanceChecks.createdAt,
  });

  return toVendorBalanceCheck(row);
}

export async function findLatestVendorBalanceCheckByKeyId(
  vendorKeyId: number
): Promise<VendorBalanceCheck | null> {
  const [row] = await db
    .select({
      id: vendorBalanceChecks.id,
      vendorKeyId: vendorBalanceChecks.vendorKeyId,
      vendorId: vendorBalanceChecks.vendorId,
      endpointId: vendorBalanceChecks.endpointId,
      checkedAt: vendorBalanceChecks.checkedAt,
      durationMs: vendorBalanceChecks.durationMs,
      statusCode: vendorBalanceChecks.statusCode,
      isSuccess: vendorBalanceChecks.isSuccess,
      balanceUsd: vendorBalanceChecks.balanceUsd,
      rawResponse: vendorBalanceChecks.rawResponse,
      errorMessage: vendorBalanceChecks.errorMessage,
      createdAt: vendorBalanceChecks.createdAt,
    })
    .from(vendorBalanceChecks)
    .where(eq(vendorBalanceChecks.vendorKeyId, vendorKeyId))
    .orderBy(desc(vendorBalanceChecks.checkedAt))
    .limit(1);

  if (!row) return null;
  return toVendorBalanceCheck(row);
}
