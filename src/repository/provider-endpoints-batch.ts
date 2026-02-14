import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerEndpoints } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import type { ProviderEndpointProbeLog, ProviderType } from "@/types/provider";

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return new Date();
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export type VendorTypeEndpointStats = {
  vendorId: number;
  total: number;
  enabled: number;
  healthy: number;
  unhealthy: number;
  unknown: number;
};

export async function findVendorTypeEndpointStatsBatch(input: {
  vendorIds: number[];
  providerType: ProviderType;
}): Promise<VendorTypeEndpointStats[]> {
  const vendorIds = Array.from(new Set(input.vendorIds));
  if (vendorIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      vendorId: providerEndpoints.vendorId,
      total: sql<number>`COUNT(*)::int`,
      enabled: sql<number>`(COUNT(*) FILTER (WHERE ${providerEndpoints.isEnabled} = true))::int`,
      healthy: sql<number>`(COUNT(*) FILTER (WHERE ${providerEndpoints.isEnabled} = true AND ${providerEndpoints.lastProbeOk} = true))::int`,
      unhealthy: sql<number>`(COUNT(*) FILTER (WHERE ${providerEndpoints.isEnabled} = true AND ${providerEndpoints.lastProbeOk} = false))::int`,
      unknown: sql<number>`(COUNT(*) FILTER (WHERE ${providerEndpoints.isEnabled} = true AND ${providerEndpoints.lastProbeOk} IS NULL))::int`,
    })
    .from(providerEndpoints)
    .where(
      and(
        inArray(providerEndpoints.vendorId, vendorIds),
        eq(providerEndpoints.providerType, input.providerType),
        isNull(providerEndpoints.deletedAt)
      )
    )
    .groupBy(providerEndpoints.vendorId);

  return rows.map((row) => ({
    vendorId: row.vendorId,
    total: Number(row.total),
    enabled: Number(row.enabled),
    healthy: Number(row.healthy),
    unhealthy: Number(row.unhealthy),
    unknown: Number(row.unknown),
  }));
}

export async function findProviderEndpointProbeLogsBatch(input: {
  endpointIds: number[];
  limitPerEndpoint: number;
}): Promise<Map<number, ProviderEndpointProbeLog[]>> {
  const endpointIds = Array.from(new Set(input.endpointIds)).filter((id) =>
    Number.isSafeInteger(id)
  );
  if (endpointIds.length === 0) {
    return new Map();
  }

  const limitPerEndpoint = Math.max(1, input.limitPerEndpoint);
  const idList = sql.join(
    endpointIds.map((endpointId) => sql`${endpointId}`),
    sql`, `
  );

  const query = sql`
    SELECT
      id,
      endpoint_id as "endpointId",
      source,
      ok,
      status_code as "statusCode",
      latency_ms as "latencyMs",
      error_type as "errorType",
      error_message as "errorMessage",
      created_at as "createdAt"
    FROM (
      SELECT
        id,
        endpoint_id,
        source,
        ok,
        status_code,
        latency_ms,
        error_type,
        error_message,
        created_at,
        ROW_NUMBER() OVER (PARTITION BY endpoint_id ORDER BY created_at DESC) AS row_num
      FROM provider_endpoint_probe_logs
      WHERE endpoint_id IN (${idList})
    ) ranked
    WHERE ranked.row_num <= ${limitPerEndpoint}
    ORDER BY ranked.endpoint_id ASC, ranked.created_at DESC
  `;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (await db.execute(query)) as any;
  const map = new Map<number, ProviderEndpointProbeLog[]>();

  for (const row of Array.from(result) as Array<Record<string, unknown>>) {
    const endpointId = Number(row.endpointId);
    if (!Number.isFinite(endpointId)) {
      continue;
    }

    const id = Number(row.id);
    if (!Number.isFinite(id)) {
      continue;
    }

    const log: ProviderEndpointProbeLog = {
      id,
      endpointId,
      source: row.source as ProviderEndpointProbeLog["source"],
      ok: Boolean(row.ok),
      statusCode: toNullableNumber(row.statusCode),
      latencyMs: toNullableNumber(row.latencyMs),
      errorType: (row.errorType as string | null) ?? null,
      errorMessage: (row.errorMessage as string | null) ?? null,
      createdAt: toDate(row.createdAt),
    };

    const existing = map.get(endpointId);
    if (existing) {
      existing.push(log);
    } else {
      map.set(endpointId, [log]);
    }
  }

  // Defensive: ensure per-endpoint limit, even if SQL changes or driver behavior differs.
  for (const [endpointId, logs] of map) {
    if (logs.length > limitPerEndpoint) {
      map.set(endpointId, logs.slice(0, limitPerEndpoint));
    }
  }

  if (map.size === 0) {
    logger.debug("[ProviderEndpointProbeLogsBatch] No logs found", {
      endpointCount: endpointIds.length,
      limitPerEndpoint,
    });
  }

  return map;
}
