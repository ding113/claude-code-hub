import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerEndpointProbeLogs, providerEndpoints } from "@/drizzle/schema";
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

  const rawLimit = Number(input.limitPerEndpoint);
  const limitPerEndpoint = Number.isFinite(rawLimit) ? Math.max(1, Math.trunc(rawLimit)) : 1;

  // 性能：避免 `ROW_NUMBER() OVER (PARTITION BY ...)` 在单个端点 logs 很多时退化为更重的扫描/排序。
  // 改为 LATERAL + LIMIT：每个 endpoint_id 仅取最新 N 条，能更好利用 (endpoint_id, created_at desc) 索引。
  // 安全：VALUES 列表使用 drizzle sql 参数化占位符拼接（不会把 endpointId 作为 raw 字符串注入）。
  const endpointValues = sql.join(
    endpointIds.map((id) => sql`(${id}::integer)`),
    sql`, `
  );

  const query = sql`
    WITH endpoint_ids(endpoint_id) AS (
      VALUES ${endpointValues}
    )
    SELECT
      l.id,
      l.endpoint_id as "endpointId",
      l.source,
      l.ok,
      l.status_code as "statusCode",
      l.latency_ms as "latencyMs",
      l.error_type as "errorType",
      l.error_message as "errorMessage",
      l.created_at as "createdAt"
    FROM endpoint_ids e
    CROSS JOIN LATERAL (
      SELECT
        id,
        endpoint_id,
        source,
        ok,
        status_code,
        latency_ms,
        error_type,
        error_message,
        created_at
      FROM ${providerEndpointProbeLogs}
      WHERE endpoint_id = e.endpoint_id
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT ${limitPerEndpoint}
    ) l
    ORDER BY l.endpoint_id ASC, l.created_at DESC NULLS LAST, l.id DESC
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
