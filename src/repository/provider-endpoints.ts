"use server";

import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import {
  providerEndpointProbeLogs,
  providerEndpoints,
  providers,
  providerVendors,
} from "@/drizzle/schema";
import { resetEndpointCircuit } from "@/lib/endpoint-circuit-breaker";
import { logger } from "@/lib/logger";
import {
  PROVIDER_ENDPOINT_CONFLICT_CODE,
  PROVIDER_ENDPOINT_WRITE_READ_INCONSISTENCY_CODE,
} from "@/lib/provider-endpoint-error-codes";
import type {
  ProviderEndpoint,
  ProviderEndpointProbeLog,
  ProviderEndpointProbeSource,
  ProviderType,
  ProviderVendor,
} from "@/types/provider";

type TransactionExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];
type QueryExecutor = Pick<
  TransactionExecutor,
  "select" | "insert" | "update" | "delete" | "execute"
>;

const providerEndpointsConflictTarget = [
  providerEndpoints.vendorId,
  providerEndpoints.providerType,
  providerEndpoints.url,
];
const providerEndpointsConflictWhere = sql`${providerEndpoints.deletedAt} IS NULL`;

function isUniqueViolationError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };

  if (candidate.code === "23505") {
    return true;
  }

  if (typeof candidate.message === "string" && candidate.message.includes("duplicate key value")) {
    return true;
  }

  if (candidate.cause?.code === "23505") {
    return true;
  }

  return (
    typeof candidate.cause?.message === "string" &&
    candidate.cause.message.includes("duplicate key value")
  );
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return new Date();
}

function toNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return toDate(value);
}

function normalizeWebsiteDomainFromUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  const candidates = [trimmed];
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) {
    candidates.push(`https://${trimmed}`);
  }

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      const hostname = parsed.hostname?.toLowerCase();
      if (!hostname) continue;
      return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
    } catch (error) {
      logger.debug("[ProviderVendor] Failed to parse URL", {
        candidateLength: candidate.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

/**
 * Normalize URL to host:port format for vendor key when websiteUrl is empty.
 * - IPv6 addresses are formatted as [ipv6]:port
 * - Default ports: http=80, https=443
 * - URLs without scheme are assumed to be https
 */
function normalizeHostWithPort(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Add https:// if no scheme present
  let urlString = trimmed;
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) {
    urlString = `https://${trimmed}`;
  }

  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname?.toLowerCase();
    if (!hostname) return null;

    // Strip www. prefix
    const normalizedHostname = hostname.startsWith("www.") ? hostname.slice(4) : hostname;

    // Determine port
    let port: string;
    if (parsed.port) {
      port = parsed.port;
    } else {
      // Use protocol default port
      port = parsed.protocol === "http:" ? "80" : "443";
    }

    // IPv6 addresses already have brackets from URL parser (e.g., "[::1]")
    // Just append the port directly
    return `${normalizedHostname}:${port}`;
  } catch (error) {
    logger.debug("[ProviderVendor] Failed to parse URL for host:port", {
      urlLength: rawUrl.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Compute vendor clustering key based on URLs.
 *
 * Rules:
 * - If websiteUrl is non-empty: key = normalized hostname (strip www, lowercase), ignore port
 * - If websiteUrl is empty: key = host:port
 *   - IPv6 format: [ipv6]:port
 *   - Missing port: use protocol default (http=80, https=443)
 *   - No scheme: assume https
 */
export async function computeVendorKey(input: {
  providerUrl: string;
  websiteUrl?: string | null;
}): Promise<string | null> {
  const { providerUrl, websiteUrl } = input;

  // Case 1: websiteUrl is non-empty - use hostname only (existing behavior)
  if (websiteUrl?.trim()) {
    return normalizeWebsiteDomainFromUrl(websiteUrl);
  }

  // Case 2: websiteUrl is empty - use host:port as key
  return normalizeHostWithPort(providerUrl);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toProviderVendor(row: any): ProviderVendor {
  return {
    id: row.id,
    websiteDomain: row.websiteDomain,
    displayName: row.displayName ?? null,
    websiteUrl: row.websiteUrl ?? null,
    faviconUrl: row.faviconUrl ?? null,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toProviderEndpoint(row: any): ProviderEndpoint {
  return {
    id: row.id,
    vendorId: row.vendorId,
    providerType: (row.providerType ?? "claude") as ProviderEndpoint["providerType"],
    url: row.url,
    label: row.label ?? null,
    sortOrder: row.sortOrder ?? 0,
    isEnabled: row.isEnabled ?? true,
    lastProbedAt: toNullableDate(row.lastProbedAt),
    lastProbeOk: row.lastProbeOk ?? null,
    lastProbeStatusCode: row.lastProbeStatusCode ?? null,
    lastProbeLatencyMs: row.lastProbeLatencyMs ?? null,
    lastProbeErrorType: row.lastProbeErrorType ?? null,
    lastProbeErrorMessage: row.lastProbeErrorMessage ?? null,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toNullableDate(row.deletedAt),
  };
}

const providerEndpointSelectFields = {
  id: providerEndpoints.id,
  vendorId: providerEndpoints.vendorId,
  providerType: providerEndpoints.providerType,
  url: providerEndpoints.url,
  label: providerEndpoints.label,
  sortOrder: providerEndpoints.sortOrder,
  isEnabled: providerEndpoints.isEnabled,
  lastProbedAt: providerEndpoints.lastProbedAt,
  lastProbeOk: providerEndpoints.lastProbeOk,
  lastProbeStatusCode: providerEndpoints.lastProbeStatusCode,
  lastProbeLatencyMs: providerEndpoints.lastProbeLatencyMs,
  lastProbeErrorType: providerEndpoints.lastProbeErrorType,
  lastProbeErrorMessage: providerEndpoints.lastProbeErrorMessage,
  createdAt: providerEndpoints.createdAt,
  updatedAt: providerEndpoints.updatedAt,
  deletedAt: providerEndpoints.deletedAt,
};

type EditableEndpointFields = Pick<ProviderEndpoint, "url" | "label" | "sortOrder" | "isEnabled">;

function pickEditableFieldExpectations(payload: {
  url?: string;
  label?: string | null;
  sortOrder?: number;
  isEnabled?: boolean;
}): Partial<EditableEndpointFields> {
  const expected: Partial<EditableEndpointFields> = {};

  if (payload.url !== undefined) {
    expected.url = payload.url.trim();
  }
  if (payload.label !== undefined) {
    expected.label = payload.label;
  }
  if (payload.sortOrder !== undefined) {
    expected.sortOrder = payload.sortOrder;
  }
  if (payload.isEnabled !== undefined) {
    expected.isEnabled = payload.isEnabled;
  }

  return expected;
}

function matchesEditableFieldExpectations(
  endpoint: ProviderEndpoint,
  expected: Partial<EditableEndpointFields>
): boolean {
  if (expected.url !== undefined && endpoint.url !== expected.url) {
    return false;
  }
  if (expected.label !== undefined && endpoint.label !== expected.label) {
    return false;
  }
  if (expected.sortOrder !== undefined && endpoint.sortOrder !== expected.sortOrder) {
    return false;
  }
  if (expected.isEnabled !== undefined && endpoint.isEnabled !== expected.isEnabled) {
    return false;
  }
  return true;
}

async function findActiveProviderEndpointById(
  endpointId: number
): Promise<ProviderEndpoint | null> {
  const rows = await db
    .select(providerEndpointSelectFields)
    .from(providerEndpoints)
    .where(and(eq(providerEndpoints.id, endpointId), isNull(providerEndpoints.deletedAt)))
    .limit(1);

  return rows[0] ? toProviderEndpoint(rows[0]) : null;
}

async function readConsistentProviderEndpointAfterWrite(input: {
  endpointId: number;
  expected: Partial<EditableEndpointFields>;
}): Promise<ProviderEndpoint | null> {
  const current = await findActiveProviderEndpointById(input.endpointId);
  if (!current) {
    return null;
  }

  return matchesEditableFieldExpectations(current, input.expected) ? current : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toProviderEndpointProbeLog(row: any): ProviderEndpointProbeLog {
  return {
    id: row.id,
    endpointId: row.endpointId,
    source: row.source,
    ok: row.ok,
    statusCode: row.statusCode ?? null,
    latencyMs: row.latencyMs ?? null,
    errorType: row.errorType ?? null,
    errorMessage: row.errorMessage ?? null,
    createdAt: toDate(row.createdAt),
  };
}

export type ProviderEndpointProbeTarget = Pick<
  ProviderEndpoint,
  "id" | "url" | "vendorId" | "lastProbedAt" | "lastProbeOk" | "lastProbeErrorType"
>;

export async function findEnabledProviderEndpointsForProbing(): Promise<
  ProviderEndpointProbeTarget[]
> {
  const rows = await db
    .select({
      id: providerEndpoints.id,
      url: providerEndpoints.url,
      vendorId: providerEndpoints.vendorId,
      lastProbedAt: providerEndpoints.lastProbedAt,
      lastProbeOk: providerEndpoints.lastProbeOk,
      lastProbeErrorType: providerEndpoints.lastProbeErrorType,
    })
    .from(providerEndpoints)
    .where(and(eq(providerEndpoints.isEnabled, true), isNull(providerEndpoints.deletedAt)))
    .orderBy(asc(providerEndpoints.id));

  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    vendorId: row.vendorId,
    lastProbedAt: toNullableDate(row.lastProbedAt),
    lastProbeOk: row.lastProbeOk ?? null,
    lastProbeErrorType: row.lastProbeErrorType ?? null,
  }));
}

export async function updateProviderEndpointProbeSnapshot(input: {
  endpointId: number;
  ok: boolean;
  statusCode?: number | null;
  latencyMs?: number | null;
  errorType?: string | null;
  errorMessage?: string | null;
  probedAt?: Date;
}): Promise<void> {
  const probedAt = input.probedAt ?? new Date();

  await db
    .update(providerEndpoints)
    .set({
      lastProbedAt: probedAt,
      lastProbeOk: input.ok,
      lastProbeStatusCode: input.statusCode ?? null,
      lastProbeLatencyMs: input.latencyMs ?? null,
      lastProbeErrorType: input.ok ? null : (input.errorType ?? null),
      lastProbeErrorMessage: input.ok ? null : (input.errorMessage ?? null),
      updatedAt: new Date(),
    })
    .where(and(eq(providerEndpoints.id, input.endpointId), isNull(providerEndpoints.deletedAt)));
}

export async function deleteProviderEndpointProbeLogsBeforeDateBatch(input: {
  beforeDate: Date;
  batchSize?: number;
}): Promise<number> {
  const batchSize = input.batchSize ?? 10_000;
  // Note: 兼容性：某些运行时/驱动组合会把 Date 参数序列化成
  // "Mon Feb ... GMT+0800 (China Standard Time)" 这类字符串，Postgres 无法解析（time zone not recognized）。
  // 统一转为 ISO-8601，并显式 cast 为 timestamptz，避免清理任务异常导致日志堆积。
  const beforeDateIso = input.beforeDate.toISOString();

  const result = await db.execute(sql`
    WITH ids_to_delete AS (
      SELECT id FROM provider_endpoint_probe_logs
      WHERE created_at < CAST(${beforeDateIso} AS timestamptz)
      ORDER BY created_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM provider_endpoint_probe_logs
    WHERE id IN (SELECT id FROM ids_to_delete)
  `);

  const rowCount = (result as { rowCount?: number }).rowCount;
  return typeof rowCount === "number" ? rowCount : 0;
}

export async function getOrCreateProviderVendorIdFromUrls(
  input: {
    providerUrl: string;
    websiteUrl?: string | null;
    faviconUrl?: string | null;
    displayName?: string | null;
  },
  options?: { tx?: QueryExecutor }
): Promise<number> {
  const executor = options?.tx ?? db;

  // Use new computeVendorKey for consistent vendor key calculation
  const websiteDomain = await computeVendorKey({
    providerUrl: input.providerUrl,
    websiteUrl: input.websiteUrl,
  });
  if (!websiteDomain) {
    throw new Error("Failed to resolve provider vendor domain");
  }

  const existing = await executor
    .select({ id: providerVendors.id })
    .from(providerVendors)
    .where(eq(providerVendors.websiteDomain, websiteDomain))
    .limit(1);
  if (existing[0]) {
    return existing[0].id;
  }

  const now = new Date();
  const inserted = await executor
    .insert(providerVendors)
    .values({
      websiteDomain,
      displayName: input.displayName ?? null,
      websiteUrl: input.websiteUrl ?? null,
      faviconUrl: input.faviconUrl ?? null,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: providerVendors.websiteDomain })
    .returning({ id: providerVendors.id });

  if (inserted[0]) {
    return inserted[0].id;
  }

  const fallback = await executor
    .select({ id: providerVendors.id })
    .from(providerVendors)
    .where(eq(providerVendors.websiteDomain, websiteDomain))
    .limit(1);
  if (!fallback[0]) {
    throw new Error("Failed to create provider vendor");
  }
  return fallback[0].id;
}

/**
 * 从域名派生显示名称（直接使用域名的中间部分）
 * 例如: anthropic.com -> Anthropic, api.openai.com -> OpenAI
 */
export async function deriveDisplayNameFromDomain(domain: string): Promise<string> {
  const parts = domain
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) {
    const name = parts[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  const apiPrefixes = new Set(["api", "v1", "v2", "v3", "www"]);
  let name = parts[parts.length - 2];
  if (apiPrefixes.has(name) && parts.length >= 3) {
    name = parts[parts.length - 3];
  }
  if (apiPrefixes.has(name) && parts.length >= 4) {
    name = parts[parts.length - 4];
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * 为所有 provider_vendor_id 为 NULL 或 0 的 providers 创建 vendor
 * 按照 website_url（优先）或 url 的域名进行自动聚合
 */
export async function backfillProviderVendorsFromProviders(): Promise<{
  processed: number;
  providersUpdated: number;
  vendorsCreated: Set<number>;
  skippedInvalidUrl: number;
  skippedError: number;
}> {
  const stats = {
    processed: 0,
    providersUpdated: 0,
    vendorsCreated: new Set<number>(),
    skippedInvalidUrl: 0,
    skippedError: 0,
  };

  const PAGE_SIZE = 100;
  let lastId = 0;

  while (true) {
    const rows = await db
      .select({
        id: providers.id,
        name: providers.name,
        url: providers.url,
        websiteUrl: providers.websiteUrl,
        faviconUrl: providers.faviconUrl,
        providerVendorId: providers.providerVendorId,
      })
      .from(providers)
      .where(
        and(
          isNull(providers.deletedAt),
          gt(providers.id, lastId),
          or(isNull(providers.providerVendorId), eq(providers.providerVendorId, 0))
        )
      )
      .orderBy(asc(providers.id))
      .limit(PAGE_SIZE);

    if (rows.length === 0) break;

    for (const row of rows) {
      stats.processed++;

      // Use new computeVendorKey for consistent vendor key calculation
      const vendorKey = await computeVendorKey({
        providerUrl: row.url,
        websiteUrl: row.websiteUrl,
      });

      if (!vendorKey) {
        logger.warn("[backfillVendors] Invalid URL for provider", {
          providerId: row.id,
          url: row.url,
        });
        stats.skippedInvalidUrl++;
        lastId = Math.max(lastId, row.id);
        continue;
      }

      try {
        // For displayName, extract domain part (remove port if present)
        const domainForDisplayName = vendorKey.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
        const displayName = await deriveDisplayNameFromDomain(domainForDisplayName);
        const vendorId = await getOrCreateProviderVendorIdFromUrls({
          providerUrl: row.url,
          websiteUrl: row.websiteUrl ?? null,
          faviconUrl: row.faviconUrl ?? null,
          displayName,
        });

        stats.vendorsCreated.add(vendorId);

        await db
          .update(providers)
          .set({ providerVendorId: vendorId, updatedAt: new Date() })
          .where(eq(providers.id, row.id));

        stats.providersUpdated++;
        lastId = Math.max(lastId, row.id);
      } catch (error) {
        logger.error("[backfillVendors] Failed to process provider", {
          providerId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
        stats.skippedError++;
        lastId = Math.max(lastId, row.id);
      }
    }
  }

  const { vendorsCreated, ...logStats } = stats;
  logger.info("[backfillVendors] Backfill completed", {
    ...logStats,
    vendorsCreatedCount: vendorsCreated.size,
  });

  return stats;
}

export async function findProviderVendors(
  limit: number = 50,
  offset: number = 0
): Promise<ProviderVendor[]> {
  const rows = await db
    .select({
      id: providerVendors.id,
      websiteDomain: providerVendors.websiteDomain,
      displayName: providerVendors.displayName,
      websiteUrl: providerVendors.websiteUrl,
      faviconUrl: providerVendors.faviconUrl,
      createdAt: providerVendors.createdAt,
      updatedAt: providerVendors.updatedAt,
    })
    .from(providerVendors)
    .orderBy(desc(providerVendors.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map(toProviderVendor);
}

export async function findProviderVendorById(vendorId: number): Promise<ProviderVendor | null> {
  const rows = await db
    .select({
      id: providerVendors.id,
      websiteDomain: providerVendors.websiteDomain,
      displayName: providerVendors.displayName,
      websiteUrl: providerVendors.websiteUrl,
      faviconUrl: providerVendors.faviconUrl,
      createdAt: providerVendors.createdAt,
      updatedAt: providerVendors.updatedAt,
    })
    .from(providerVendors)
    .where(eq(providerVendors.id, vendorId))
    .limit(1);

  return rows[0] ? toProviderVendor(rows[0]) : null;
}

export async function findProviderEndpointById(
  endpointId: number
): Promise<ProviderEndpoint | null> {
  const rows = await db
    .select({
      id: providerEndpoints.id,
      vendorId: providerEndpoints.vendorId,
      providerType: providerEndpoints.providerType,
      url: providerEndpoints.url,
      label: providerEndpoints.label,
      sortOrder: providerEndpoints.sortOrder,
      isEnabled: providerEndpoints.isEnabled,
      lastProbedAt: providerEndpoints.lastProbedAt,
      lastProbeOk: providerEndpoints.lastProbeOk,
      lastProbeStatusCode: providerEndpoints.lastProbeStatusCode,
      lastProbeLatencyMs: providerEndpoints.lastProbeLatencyMs,
      lastProbeErrorType: providerEndpoints.lastProbeErrorType,
      lastProbeErrorMessage: providerEndpoints.lastProbeErrorMessage,
      createdAt: providerEndpoints.createdAt,
      updatedAt: providerEndpoints.updatedAt,
      deletedAt: providerEndpoints.deletedAt,
    })
    .from(providerEndpoints)
    .where(and(eq(providerEndpoints.id, endpointId), isNull(providerEndpoints.deletedAt)))
    .limit(1);

  return rows[0] ? toProviderEndpoint(rows[0]) : null;
}

export async function updateProviderVendor(
  vendorId: number,
  payload: {
    displayName?: string | null;
    websiteUrl?: string | null;
    faviconUrl?: string | null;
  }
): Promise<ProviderVendor | null> {
  if (Object.keys(payload).length === 0) {
    return findProviderVendorById(vendorId);
  }

  const now = new Date();
  const updates: Partial<typeof providerVendors.$inferInsert> = { updatedAt: now };
  if (payload.displayName !== undefined) updates.displayName = payload.displayName;
  if (payload.websiteUrl !== undefined) updates.websiteUrl = payload.websiteUrl;
  if (payload.faviconUrl !== undefined) updates.faviconUrl = payload.faviconUrl;

  const rows = await db
    .update(providerVendors)
    .set(updates)
    .where(eq(providerVendors.id, vendorId))
    .returning({
      id: providerVendors.id,
      websiteDomain: providerVendors.websiteDomain,
      displayName: providerVendors.displayName,
      websiteUrl: providerVendors.websiteUrl,
      faviconUrl: providerVendors.faviconUrl,
      createdAt: providerVendors.createdAt,
      updatedAt: providerVendors.updatedAt,
    });

  return rows[0] ? toProviderVendor(rows[0]) : null;
}

export async function deleteProviderVendor(vendorId: number): Promise<boolean> {
  const deleted = await db.transaction(async (tx) => {
    // 1. Delete endpoints (cascade would handle this, but manual is safe)
    await tx.delete(providerEndpoints).where(eq(providerEndpoints.vendorId, vendorId));
    // 2. Delete providers (keys) - explicit delete required due to 'restrict'
    await tx.delete(providers).where(eq(providers.providerVendorId, vendorId));
    // 3. Delete vendor
    const result = await tx
      .delete(providerVendors)
      .where(eq(providerVendors.id, vendorId))
      .returning({ id: providerVendors.id });

    return result.length > 0;
  });

  return deleted;
}

export async function tryDeleteProviderVendorIfEmpty(
  vendorId: number,
  options?: { tx?: QueryExecutor }
): Promise<boolean> {
  const runInTx = async (tx: QueryExecutor): Promise<boolean> => {
    // 1) Must have no active providers (soft-deleted rows still exist but should not block).
    const [activeProvider] = await tx
      .select({ id: providers.id })
      .from(providers)
      .where(and(eq(providers.providerVendorId, vendorId), isNull(providers.deletedAt)))
      .limit(1);

    if (activeProvider) {
      return false;
    }

    // 2) Must have no active endpoints.
    const [activeEndpoint] = await tx
      .select({ id: providerEndpoints.id })
      .from(providerEndpoints)
      .where(and(eq(providerEndpoints.vendorId, vendorId), isNull(providerEndpoints.deletedAt)))
      .limit(1);

    if (activeEndpoint) {
      return false;
    }

    // 3) Hard delete soft-deleted providers to satisfy FK `onDelete: restrict`.
    await tx
      .delete(providers)
      .where(and(eq(providers.providerVendorId, vendorId), isNotNull(providers.deletedAt)));

    // 4) Delete vendor. Endpoints will be physically removed by FK cascade.
    const deleted = await tx
      .delete(providerVendors)
      .where(
        and(
          eq(providerVendors.id, vendorId),
          sql`NOT EXISTS (SELECT 1 FROM providers p WHERE p.provider_vendor_id = ${vendorId} AND p.deleted_at IS NULL)`,
          sql`NOT EXISTS (SELECT 1 FROM provider_endpoints e WHERE e.vendor_id = ${vendorId} AND e.deleted_at IS NULL)`
        )
      )
      .returning({ id: providerVendors.id });

    return deleted.length > 0;
  };

  if (options?.tx) {
    return await runInTx(options.tx);
  }

  return await db.transaction(async (tx) => runInTx(tx));
}

export async function findProviderEndpointsByVendorAndType(
  vendorId: number,
  providerType: ProviderType
): Promise<ProviderEndpoint[]> {
  const rows = await db
    .select({
      id: providerEndpoints.id,
      vendorId: providerEndpoints.vendorId,
      providerType: providerEndpoints.providerType,
      url: providerEndpoints.url,
      label: providerEndpoints.label,
      sortOrder: providerEndpoints.sortOrder,
      isEnabled: providerEndpoints.isEnabled,
      lastProbedAt: providerEndpoints.lastProbedAt,
      lastProbeOk: providerEndpoints.lastProbeOk,
      lastProbeStatusCode: providerEndpoints.lastProbeStatusCode,
      lastProbeLatencyMs: providerEndpoints.lastProbeLatencyMs,
      lastProbeErrorType: providerEndpoints.lastProbeErrorType,
      lastProbeErrorMessage: providerEndpoints.lastProbeErrorMessage,
      createdAt: providerEndpoints.createdAt,
      updatedAt: providerEndpoints.updatedAt,
      deletedAt: providerEndpoints.deletedAt,
    })
    .from(providerEndpoints)
    .where(
      and(
        eq(providerEndpoints.vendorId, vendorId),
        eq(providerEndpoints.providerType, providerType),
        isNull(providerEndpoints.deletedAt)
      )
    )
    .orderBy(asc(providerEndpoints.sortOrder), asc(providerEndpoints.id));

  return rows.map(toProviderEndpoint);
}

export async function findProviderEndpointsByVendor(vendorId: number): Promise<ProviderEndpoint[]> {
  const rows = await db
    .select({
      id: providerEndpoints.id,
      vendorId: providerEndpoints.vendorId,
      providerType: providerEndpoints.providerType,
      url: providerEndpoints.url,
      label: providerEndpoints.label,
      sortOrder: providerEndpoints.sortOrder,
      isEnabled: providerEndpoints.isEnabled,
      lastProbedAt: providerEndpoints.lastProbedAt,
      lastProbeOk: providerEndpoints.lastProbeOk,
      lastProbeStatusCode: providerEndpoints.lastProbeStatusCode,
      lastProbeLatencyMs: providerEndpoints.lastProbeLatencyMs,
      lastProbeErrorType: providerEndpoints.lastProbeErrorType,
      lastProbeErrorMessage: providerEndpoints.lastProbeErrorMessage,
      createdAt: providerEndpoints.createdAt,
      updatedAt: providerEndpoints.updatedAt,
      deletedAt: providerEndpoints.deletedAt,
    })
    .from(providerEndpoints)
    .where(and(eq(providerEndpoints.vendorId, vendorId), isNull(providerEndpoints.deletedAt)))
    .orderBy(asc(providerEndpoints.sortOrder), asc(providerEndpoints.id));

  return rows.map(toProviderEndpoint);
}

export async function createProviderEndpoint(payload: {
  vendorId: number;
  providerType: ProviderType;
  url: string;
  label?: string | null;
  sortOrder?: number;
  isEnabled?: boolean;
}): Promise<ProviderEndpoint> {
  const now = new Date();
  const [row] = await db
    .insert(providerEndpoints)
    .values({
      vendorId: payload.vendorId,
      providerType: payload.providerType,
      url: payload.url,
      label: payload.label ?? null,
      sortOrder: payload.sortOrder ?? 0,
      isEnabled: payload.isEnabled ?? true,
      updatedAt: now,
    })
    .returning({
      id: providerEndpoints.id,
      vendorId: providerEndpoints.vendorId,
      providerType: providerEndpoints.providerType,
      url: providerEndpoints.url,
      label: providerEndpoints.label,
      sortOrder: providerEndpoints.sortOrder,
      isEnabled: providerEndpoints.isEnabled,
      lastProbedAt: providerEndpoints.lastProbedAt,
      lastProbeOk: providerEndpoints.lastProbeOk,
      lastProbeStatusCode: providerEndpoints.lastProbeStatusCode,
      lastProbeLatencyMs: providerEndpoints.lastProbeLatencyMs,
      lastProbeErrorType: providerEndpoints.lastProbeErrorType,
      lastProbeErrorMessage: providerEndpoints.lastProbeErrorMessage,
      createdAt: providerEndpoints.createdAt,
      updatedAt: providerEndpoints.updatedAt,
      deletedAt: providerEndpoints.deletedAt,
    });

  return toProviderEndpoint(row);
}

export async function ensureProviderEndpointExistsForUrl(
  input: {
    vendorId: number;
    providerType: ProviderType;
    url: string;
    label?: string | null;
  },
  options?: { tx?: QueryExecutor }
): Promise<boolean> {
  const executor = options?.tx ?? db;

  const trimmedUrl = input.url.trim();
  if (!trimmedUrl) {
    throw new Error("[ProviderEndpointEnsure] url is required");
  }

  try {
    // eslint-disable-next-line no-new
    new URL(trimmedUrl);
  } catch {
    throw new Error("[ProviderEndpointEnsure] url must be a valid URL");
  }

  const now = new Date();
  const inserted = await executor
    .insert(providerEndpoints)
    .values({
      vendorId: input.vendorId,
      providerType: input.providerType,
      url: trimmedUrl,
      label: input.label ?? null,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: providerEndpointsConflictTarget,
      where: providerEndpointsConflictWhere,
    })
    .returning({ id: providerEndpoints.id });

  return inserted.length > 0;
}

export interface SyncProviderEndpointOnProviderEditInput {
  providerId: number;
  vendorId: number;
  providerType: ProviderType;
  previousVendorId?: number | null;
  previousProviderType?: ProviderType | null;
  previousUrl: string;
  nextUrl: string;
  keepPreviousWhenReferenced?: boolean;
}

type ProviderEndpointSyncAction =
  | "noop"
  | "created-next"
  | "revived-next"
  | "updated-previous-in-place"
  | "kept-previous-and-created-next"
  | "kept-previous-and-revived-next"
  | "kept-previous-and-kept-next"
  | "soft-deleted-previous-and-kept-next"
  | "soft-deleted-previous-and-revived-next";

export interface SyncProviderEndpointOnProviderEditResult {
  action: ProviderEndpointSyncAction;
  resetCircuitEndpointId?: number;
}

export async function syncProviderEndpointOnProviderEdit(
  input: SyncProviderEndpointOnProviderEditInput,
  options?: { tx?: QueryExecutor }
): Promise<SyncProviderEndpointOnProviderEditResult> {
  const previousUrl = input.previousUrl.trim();
  const nextUrl = input.nextUrl.trim();

  if (!nextUrl) {
    throw new Error("[ProviderEndpointSync] nextUrl is required");
  }

  try {
    // eslint-disable-next-line no-new
    new URL(nextUrl);
  } catch {
    throw new Error("[ProviderEndpointSync] nextUrl must be a valid URL");
  }

  const previousVendorId = input.previousVendorId ?? input.vendorId;
  const previousProviderType = input.previousProviderType ?? input.providerType;
  const keepPreviousWhenReferenced = input.keepPreviousWhenReferenced !== false;

  const runInTx = async (tx: QueryExecutor): Promise<SyncProviderEndpointOnProviderEditResult> => {
    const now = new Date();

    const loadEndpoint = async (args: {
      vendorId: number;
      providerType: ProviderType;
      url: string;
    }): Promise<{ id: number; deletedAt: Date | null; isEnabled: boolean } | null> => {
      const [row] = await tx
        .select({
          id: providerEndpoints.id,
          deletedAt: providerEndpoints.deletedAt,
          isEnabled: providerEndpoints.isEnabled,
        })
        .from(providerEndpoints)
        .where(
          and(
            eq(providerEndpoints.vendorId, args.vendorId),
            eq(providerEndpoints.providerType, args.providerType),
            eq(providerEndpoints.url, args.url)
          )
        )
        .limit(1);

      return row
        ? {
            id: row.id,
            deletedAt: row.deletedAt,
            isEnabled: row.isEnabled,
          }
        : null;
    };

    const hasActiveReferencesOnPreviousUrl = async (): Promise<boolean> => {
      const [activeReference] = await tx
        .select({ id: providers.id })
        .from(providers)
        .where(
          and(
            eq(providers.providerVendorId, previousVendorId),
            eq(providers.providerType, previousProviderType),
            eq(providers.url, previousUrl),
            isNull(providers.deletedAt),
            ne(providers.id, input.providerId)
          )
        )
        .limit(1);

      return Boolean(activeReference);
    };

    const ensureNextEndpointActive = async (options?: {
      reactivateDisabled?: boolean;
    }): Promise<"created-next" | "revived-next" | "noop"> => {
      const reactivateDisabled = options?.reactivateDisabled ?? true;
      const nextEndpoint = await loadEndpoint({
        vendorId: input.vendorId,
        providerType: input.providerType,
        url: nextUrl,
      });

      if (!nextEndpoint) {
        const inserted = await tx
          .insert(providerEndpoints)
          .values({
            vendorId: input.vendorId,
            providerType: input.providerType,
            url: nextUrl,
            label: null,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: providerEndpointsConflictTarget,
            where: providerEndpointsConflictWhere,
          })
          .returning({ id: providerEndpoints.id });

        if (inserted[0]) {
          return "created-next";
        }

        const concurrentEndpoint = await loadEndpoint({
          vendorId: input.vendorId,
          providerType: input.providerType,
          url: nextUrl,
        });

        if (!concurrentEndpoint) {
          throw new Error("[ProviderEndpointSync] failed to load next endpoint after conflict");
        }

        if (concurrentEndpoint.deletedAt !== null) {
          await tx
            .update(providerEndpoints)
            .set({
              deletedAt: null,
              isEnabled: true,
              updatedAt: now,
            })
            .where(eq(providerEndpoints.id, concurrentEndpoint.id));

          return "revived-next";
        }

        if (reactivateDisabled && !concurrentEndpoint.isEnabled) {
          await tx
            .update(providerEndpoints)
            .set({
              isEnabled: true,
              updatedAt: now,
            })
            .where(eq(providerEndpoints.id, concurrentEndpoint.id));

          return "revived-next";
        }

        return "noop";
      }

      if (nextEndpoint.deletedAt !== null) {
        await tx
          .update(providerEndpoints)
          .set({
            deletedAt: null,
            isEnabled: true,
            updatedAt: now,
          })
          .where(eq(providerEndpoints.id, nextEndpoint.id));

        return "revived-next";
      }

      if (reactivateDisabled && !nextEndpoint.isEnabled) {
        await tx
          .update(providerEndpoints)
          .set({
            isEnabled: true,
            updatedAt: now,
          })
          .where(eq(providerEndpoints.id, nextEndpoint.id));

        return "revived-next";
      }

      return "noop";
    };

    const mapEnsureResultToKeptAction = (
      ensureResult: "created-next" | "revived-next" | "noop"
    ): ProviderEndpointSyncAction => {
      return ensureResult === "created-next"
        ? "kept-previous-and-created-next"
        : ensureResult === "revived-next"
          ? "kept-previous-and-revived-next"
          : "kept-previous-and-kept-next";
    };

    const previousKeyEqualsNextKey =
      previousVendorId === input.vendorId &&
      previousProviderType === input.providerType &&
      previousUrl === nextUrl;

    if (previousKeyEqualsNextKey) {
      const ensureResult = await ensureNextEndpointActive({
        reactivateDisabled: false,
      });
      return { action: ensureResult === "noop" ? "noop" : ensureResult };
    }

    const previousEndpoint = await loadEndpoint({
      vendorId: previousVendorId,
      providerType: previousProviderType,
      url: previousUrl,
    });

    const nextEndpoint = await loadEndpoint({
      vendorId: input.vendorId,
      providerType: input.providerType,
      url: nextUrl,
    });

    if (previousEndpoint && !nextEndpoint) {
      const previousIsReferenced =
        keepPreviousWhenReferenced && (await hasActiveReferencesOnPreviousUrl());

      if (!previousIsReferenced) {
        const updatePreviousEndpointInPlace = async (executor: QueryExecutor): Promise<void> => {
          await executor
            .update(providerEndpoints)
            .set({
              vendorId: input.vendorId,
              providerType: input.providerType,
              url: nextUrl,
              deletedAt: null,
              isEnabled: true,
              lastProbedAt: null,
              lastProbeOk: null,
              lastProbeStatusCode: null,
              lastProbeLatencyMs: null,
              lastProbeErrorType: null,
              lastProbeErrorMessage: null,
              updatedAt: now,
            })
            .where(eq(providerEndpoints.id, previousEndpoint.id));
        };

        let movedInPlace = false;
        const executorWithSavepoint = tx as QueryExecutor & {
          transaction?: <T>(runInTx: (nestedTx: TransactionExecutor) => Promise<T>) => Promise<T>;
        };

        if (typeof executorWithSavepoint.transaction === "function") {
          try {
            await executorWithSavepoint.transaction(async (nestedTx) => {
              await updatePreviousEndpointInPlace(nestedTx);
            });
            movedInPlace = true;
          } catch (error) {
            if (!isUniqueViolationError(error)) {
              throw error;
            }
          }
        } else {
          // No savepoint support means we cannot safely continue after unique violations.
          await updatePreviousEndpointInPlace(tx);
          movedInPlace = true;
        }

        if (movedInPlace) {
          return {
            action: "updated-previous-in-place",
            // Reset is an external side-effect and must run only after transaction commit.
            resetCircuitEndpointId: previousEndpoint.id,
          };
        }

        const ensureResult = await ensureNextEndpointActive();

        if (keepPreviousWhenReferenced) {
          return {
            action: mapEnsureResultToKeptAction(ensureResult),
          };
        }

        await tx
          .update(providerEndpoints)
          .set({
            deletedAt: now,
            isEnabled: false,
            updatedAt: now,
          })
          .where(
            and(eq(providerEndpoints.id, previousEndpoint.id), isNull(providerEndpoints.deletedAt))
          );

        return {
          action:
            ensureResult === "revived-next"
              ? "soft-deleted-previous-and-revived-next"
              : "soft-deleted-previous-and-kept-next",
        };
      }

      const ensureResult = await ensureNextEndpointActive();
      return {
        action: mapEnsureResultToKeptAction(ensureResult),
      };
    }

    const ensureResult = await ensureNextEndpointActive();

    if (
      previousEndpoint &&
      nextEndpoint &&
      previousEndpoint.id !== nextEndpoint.id &&
      previousEndpoint.deletedAt === null
    ) {
      const previousIsReferenced =
        keepPreviousWhenReferenced && (await hasActiveReferencesOnPreviousUrl());

      if (!previousIsReferenced) {
        if (keepPreviousWhenReferenced) {
          return {
            action: mapEnsureResultToKeptAction(ensureResult),
          };
        }

        await tx
          .update(providerEndpoints)
          .set({
            deletedAt: now,
            isEnabled: false,
            updatedAt: now,
          })
          .where(
            and(eq(providerEndpoints.id, previousEndpoint.id), isNull(providerEndpoints.deletedAt))
          );

        return {
          action:
            ensureResult === "revived-next"
              ? "soft-deleted-previous-and-revived-next"
              : "soft-deleted-previous-and-kept-next",
        };
      }
    }

    return { action: ensureResult === "noop" ? "noop" : ensureResult };
  };

  if (options?.tx) {
    return await runInTx(options.tx);
  }

  const result = await db.transaction(async (tx) => runInTx(tx));

  if (result.resetCircuitEndpointId != null) {
    try {
      await resetEndpointCircuit(result.resetCircuitEndpointId);
    } catch (error) {
      logger.warn("syncProviderEndpointOnProviderEdit:reset_endpoint_circuit_failed", {
        endpointId: result.resetCircuitEndpointId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { action: result.action };
  }

  return result;
}

type BackfillProviderEndpointCandidate = {
  key: string;
  providerId: number;
  vendorId: number;
  providerType: ProviderType;
  url: string;
};

type BackfillProviderEndpointRisk =
  | "deterministic-safe-insert"
  | "historical-ambiguous-report-only"
  | "invalid-provider-row";

type BackfillProviderEndpointReason =
  | "missing-active-endpoint"
  | "historical-soft-deleted-endpoint-present"
  | "active-provider-vendor-id-invalid"
  | "active-provider-url-empty"
  | "active-provider-url-invalid";

export interface BackfillProviderEndpointSample {
  providerId: number | null;
  vendorId: number | null;
  providerType: ProviderType | null;
  url: string;
  key: string | null;
  risk: BackfillProviderEndpointRisk;
  reason: BackfillProviderEndpointReason;
}

export interface BackfillProviderEndpointsFromProvidersOptions {
  mode?: "dry-run" | "apply";
  sampleLimit?: number;
  vendorIds?: number[];
}

export interface BackfillProviderEndpointsFromProvidersSummary {
  inserted: number;
  uniqueCandidates: number;
  skippedInvalid: number;
}

export interface BackfillProviderEndpointsFromProvidersReport
  extends BackfillProviderEndpointsFromProvidersSummary {
  mode: "dry-run" | "apply";
  repaired: number;
  scannedProviders: number;
  missingActiveEndpoints: number;
  deterministicCandidates: number;
  reportOnlyHistoricalCandidates: number;
  reportOnlyTotal: number;
  sampleLimit: number;
  riskSummary: {
    deterministicSafeInsert: number;
    reportOnlyHistoricalAmbiguous: number;
    reportOnlyInvalidProvider: number;
  };
  samples: {
    deterministic: BackfillProviderEndpointSample[];
    reportOnlyHistorical: BackfillProviderEndpointSample[];
    invalid: BackfillProviderEndpointSample[];
  };
}

function toProviderEndpointCandidateKey(input: {
  vendorId: number;
  providerType: ProviderType;
  url: string;
}): string {
  return `${input.vendorId}|${input.providerType}|${input.url}`;
}

function clampSampleLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return 20;
  }
  return Math.min(Math.trunc(value ?? 20), 2000);
}

function sanitizeBackfillVendorScope(vendorIds: number[] | undefined): number[] {
  if (!vendorIds || vendorIds.length === 0) {
    return [];
  }

  const unique = new Set<number>();
  for (const vendorId of vendorIds) {
    if (Number.isInteger(vendorId) && vendorId > 0) {
      unique.add(vendorId);
    }
  }

  return [...unique].sort((left, right) => left - right);
}

function pushBackfillSample(
  samples: BackfillProviderEndpointSample[],
  sample: BackfillProviderEndpointSample,
  sampleLimit: number
): void {
  if (samples.length < sampleLimit) {
    samples.push(sample);
  }
}

function compareBackfillCandidates(
  left: BackfillProviderEndpointCandidate,
  right: BackfillProviderEndpointCandidate
): number {
  if (left.vendorId !== right.vendorId) {
    return left.vendorId - right.vendorId;
  }
  if (left.providerType !== right.providerType) {
    return left.providerType.localeCompare(right.providerType);
  }
  return left.url.localeCompare(right.url);
}

export async function backfillProviderEndpointsFromProviders(): Promise<BackfillProviderEndpointsFromProvidersSummary>;
export async function backfillProviderEndpointsFromProviders(
  options: BackfillProviderEndpointsFromProvidersOptions
): Promise<BackfillProviderEndpointsFromProvidersReport>;
export async function backfillProviderEndpointsFromProviders(
  options?: BackfillProviderEndpointsFromProvidersOptions
): Promise<
  BackfillProviderEndpointsFromProvidersSummary | BackfillProviderEndpointsFromProvidersReport
> {
  const mode = options?.mode ?? "apply";
  const pageSize = 1000;
  const insertBatchSize = 500;
  const sampleLimit = clampSampleLimit(options?.sampleLimit);
  const scopedVendorIds = sanitizeBackfillVendorScope(options?.vendorIds);

  let lastProviderId = 0;
  let scannedProviders = 0;
  let skippedInvalid = 0;

  const candidatesByKey = new Map<string, BackfillProviderEndpointCandidate>();
  const invalidSamples: BackfillProviderEndpointSample[] = [];

  while (true) {
    const whereClauses = [isNull(providers.deletedAt), gt(providers.id, lastProviderId)];
    if (scopedVendorIds.length > 0) {
      whereClauses.push(inArray(providers.providerVendorId, scopedVendorIds));
    }

    const rows = await db
      .select({
        id: providers.id,
        vendorId: providers.providerVendorId,
        providerType: providers.providerType,
        url: providers.url,
      })
      .from(providers)
      .where(and(...whereClauses))
      .orderBy(asc(providers.id))
      .limit(pageSize);

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      lastProviderId = Math.max(lastProviderId, row.id);
      scannedProviders += 1;

      if (!row.vendorId || row.vendorId <= 0) {
        skippedInvalid += 1;
        pushBackfillSample(
          invalidSamples,
          {
            providerId: row.id,
            vendorId: row.vendorId ?? null,
            providerType: row.providerType,
            url: row.url,
            key: null,
            risk: "invalid-provider-row",
            reason: "active-provider-vendor-id-invalid",
          },
          sampleLimit
        );
        continue;
      }

      const trimmedUrl = row.url.trim();
      if (!trimmedUrl) {
        skippedInvalid += 1;
        pushBackfillSample(
          invalidSamples,
          {
            providerId: row.id,
            vendorId: row.vendorId,
            providerType: row.providerType,
            url: row.url,
            key: null,
            risk: "invalid-provider-row",
            reason: "active-provider-url-empty",
          },
          sampleLimit
        );
        continue;
      }

      try {
        // eslint-disable-next-line no-new
        new URL(trimmedUrl);
      } catch {
        skippedInvalid += 1;
        pushBackfillSample(
          invalidSamples,
          {
            providerId: row.id,
            vendorId: row.vendorId,
            providerType: row.providerType,
            url: trimmedUrl,
            key: null,
            risk: "invalid-provider-row",
            reason: "active-provider-url-invalid",
          },
          sampleLimit
        );
        continue;
      }

      const key = toProviderEndpointCandidateKey({
        vendorId: row.vendorId,
        providerType: row.providerType,
        url: trimmedUrl,
      });

      if (candidatesByKey.has(key)) {
        continue;
      }

      candidatesByKey.set(key, {
        key,
        providerId: row.id,
        vendorId: row.vendorId,
        providerType: row.providerType,
        url: trimmedUrl,
      });
    }
  }

  const candidateKeys = new Set(candidatesByKey.keys());
  const activeEndpointKeys = new Set<string>();

  if (candidateKeys.size > 0) {
    let lastEndpointId = 0;
    while (true) {
      const whereClauses = [
        isNull(providerEndpoints.deletedAt),
        gt(providerEndpoints.id, lastEndpointId),
      ];
      if (scopedVendorIds.length > 0) {
        whereClauses.push(inArray(providerEndpoints.vendorId, scopedVendorIds));
      }

      const rows = await db
        .select({
          id: providerEndpoints.id,
          vendorId: providerEndpoints.vendorId,
          providerType: providerEndpoints.providerType,
          url: providerEndpoints.url,
        })
        .from(providerEndpoints)
        .where(and(...whereClauses))
        .orderBy(asc(providerEndpoints.id))
        .limit(pageSize);

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        lastEndpointId = Math.max(lastEndpointId, row.id);
        const key = toProviderEndpointCandidateKey({
          vendorId: row.vendorId,
          providerType: row.providerType,
          url: row.url.trim(),
        });
        if (candidateKeys.has(key)) {
          activeEndpointKeys.add(key);
        }
      }

      if (activeEndpointKeys.size === candidateKeys.size) {
        break;
      }
    }
  }

  const missingCandidates = [...candidatesByKey.values()]
    .filter((candidate) => !activeEndpointKeys.has(candidate.key))
    .sort(compareBackfillCandidates);

  const missingCandidateKeys = new Set(missingCandidates.map((candidate) => candidate.key));
  const historicalSoftDeletedKeys = new Set<string>();

  if (missingCandidateKeys.size > 0) {
    let lastEndpointId = 0;
    while (true) {
      const whereClauses = [
        isNotNull(providerEndpoints.deletedAt),
        gt(providerEndpoints.id, lastEndpointId),
      ];
      if (scopedVendorIds.length > 0) {
        whereClauses.push(inArray(providerEndpoints.vendorId, scopedVendorIds));
      }

      const rows = await db
        .select({
          id: providerEndpoints.id,
          vendorId: providerEndpoints.vendorId,
          providerType: providerEndpoints.providerType,
          url: providerEndpoints.url,
        })
        .from(providerEndpoints)
        .where(and(...whereClauses))
        .orderBy(asc(providerEndpoints.id))
        .limit(pageSize);

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        lastEndpointId = Math.max(lastEndpointId, row.id);
        const key = toProviderEndpointCandidateKey({
          vendorId: row.vendorId,
          providerType: row.providerType,
          url: row.url.trim(),
        });
        if (missingCandidateKeys.has(key)) {
          historicalSoftDeletedKeys.add(key);
        }
      }

      if (historicalSoftDeletedKeys.size === missingCandidateKeys.size) {
        break;
      }
    }
  }

  const deterministicSamples: BackfillProviderEndpointSample[] = [];
  const reportOnlyHistoricalSamples: BackfillProviderEndpointSample[] = [];
  const deterministicCandidates: BackfillProviderEndpointCandidate[] = [];
  let reportOnlyHistoricalCandidates = 0;

  for (const candidate of missingCandidates) {
    if (historicalSoftDeletedKeys.has(candidate.key)) {
      reportOnlyHistoricalCandidates += 1;
      pushBackfillSample(
        reportOnlyHistoricalSamples,
        {
          providerId: candidate.providerId,
          vendorId: candidate.vendorId,
          providerType: candidate.providerType,
          url: candidate.url,
          key: candidate.key,
          risk: "historical-ambiguous-report-only",
          reason: "historical-soft-deleted-endpoint-present",
        },
        sampleLimit
      );
      continue;
    }

    deterministicCandidates.push(candidate);
    pushBackfillSample(
      deterministicSamples,
      {
        providerId: candidate.providerId,
        vendorId: candidate.vendorId,
        providerType: candidate.providerType,
        url: candidate.url,
        key: candidate.key,
        risk: "deterministic-safe-insert",
        reason: "missing-active-endpoint",
      },
      sampleLimit
    );
  }

  let repaired = 0;
  if (mode === "apply" && deterministicCandidates.length > 0) {
    const pending: Array<{ vendorId: number; providerType: ProviderType; url: string }> = [];
    const flush = async (): Promise<void> => {
      if (pending.length === 0) {
        return;
      }

      const now = new Date();
      const inserted = await db
        .insert(providerEndpoints)
        .values(pending.map((value) => ({ ...value, updatedAt: now })))
        .onConflictDoNothing({
          target: providerEndpointsConflictTarget,
          where: providerEndpointsConflictWhere,
        })
        .returning({ id: providerEndpoints.id });
      repaired += inserted.length;
      pending.length = 0;
    };

    for (const candidate of deterministicCandidates) {
      pending.push({
        vendorId: candidate.vendorId,
        providerType: candidate.providerType,
        url: candidate.url,
      });

      if (pending.length >= insertBatchSize) {
        await flush();
      }
    }

    await flush();
  }

  const report: BackfillProviderEndpointsFromProvidersReport = {
    mode,
    inserted: repaired,
    repaired,
    uniqueCandidates: candidatesByKey.size,
    skippedInvalid,
    scannedProviders,
    missingActiveEndpoints: missingCandidates.length,
    deterministicCandidates: deterministicCandidates.length,
    reportOnlyHistoricalCandidates,
    reportOnlyTotal: reportOnlyHistoricalCandidates + skippedInvalid,
    sampleLimit,
    riskSummary: {
      deterministicSafeInsert: deterministicCandidates.length,
      reportOnlyHistoricalAmbiguous: reportOnlyHistoricalCandidates,
      reportOnlyInvalidProvider: skippedInvalid,
    },
    samples: {
      deterministic: deterministicSamples,
      reportOnlyHistorical: reportOnlyHistoricalSamples,
      invalid: invalidSamples,
    },
  };

  if (options === undefined) {
    return {
      inserted: report.inserted,
      uniqueCandidates: report.uniqueCandidates,
      skippedInvalid: report.skippedInvalid,
    };
  }

  return report;
}

export async function updateProviderEndpoint(
  endpointId: number,
  payload: { url?: string; label?: string | null; sortOrder?: number; isEnabled?: boolean }
): Promise<ProviderEndpoint | null> {
  const expectedEditableFields = pickEditableFieldExpectations(payload);

  if (Object.keys(payload).length === 0) {
    return findActiveProviderEndpointById(endpointId);
  }

  const now = new Date();
  const updates: Partial<typeof providerEndpoints.$inferInsert> = { updatedAt: now };
  if (expectedEditableFields.url !== undefined) updates.url = expectedEditableFields.url;
  if (expectedEditableFields.label !== undefined) updates.label = expectedEditableFields.label;
  if (expectedEditableFields.sortOrder !== undefined)
    updates.sortOrder = expectedEditableFields.sortOrder;
  if (expectedEditableFields.isEnabled !== undefined)
    updates.isEnabled = expectedEditableFields.isEnabled;

  try {
    const rows = await db
      .update(providerEndpoints)
      .set(updates)
      .where(and(eq(providerEndpoints.id, endpointId), isNull(providerEndpoints.deletedAt)))
      .returning(providerEndpointSelectFields);

    const updated = rows[0] ? toProviderEndpoint(rows[0]) : null;
    if (!updated) {
      return null;
    }

    if (matchesEditableFieldExpectations(updated, expectedEditableFields)) {
      return updated;
    }

    const consistentAfterRead = await readConsistentProviderEndpointAfterWrite({
      endpointId,
      expected: expectedEditableFields,
    });

    if (consistentAfterRead) {
      return consistentAfterRead;
    }

    throw Object.assign(new Error("[ProviderEndpointEdit] write-read consistency check failed"), {
      code: PROVIDER_ENDPOINT_WRITE_READ_INCONSISTENCY_CODE,
    });
  } catch (error) {
    if (!isUniqueViolationError(error)) {
      throw error;
    }

    const consistentAfterConflict = await readConsistentProviderEndpointAfterWrite({
      endpointId,
      expected: expectedEditableFields,
    });

    if (consistentAfterConflict) {
      return consistentAfterConflict;
    }

    throw Object.assign(new Error("[ProviderEndpointEdit] endpoint conflict"), {
      code: PROVIDER_ENDPOINT_CONFLICT_CODE,
      cause: error,
    });
  }
}

export async function softDeleteProviderEndpoint(endpointId: number): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(providerEndpoints)
    .set({
      deletedAt: now,
      isEnabled: false,
      updatedAt: now,
    })
    .where(and(eq(providerEndpoints.id, endpointId), isNull(providerEndpoints.deletedAt)))
    .returning({ id: providerEndpoints.id });

  return rows.length > 0;
}

export async function recordProviderEndpointProbeResult(input: {
  endpointId: number;
  source: ProviderEndpointProbeSource;
  ok: boolean;
  statusCode?: number | null;
  latencyMs?: number | null;
  errorType?: string | null;
  errorMessage?: string | null;
  probedAt?: Date;
}): Promise<void> {
  const probedAt = input.probedAt ?? new Date();

  await db.transaction(async (tx) => {
    await tx.insert(providerEndpointProbeLogs).values({
      endpointId: input.endpointId,
      source: input.source,
      ok: input.ok,
      statusCode: input.statusCode ?? null,
      latencyMs: input.latencyMs ?? null,
      errorType: input.errorType ?? null,
      errorMessage: input.errorMessage ?? null,
      createdAt: probedAt,
    });

    await tx
      .update(providerEndpoints)
      .set({
        lastProbedAt: probedAt,
        lastProbeOk: input.ok,
        lastProbeStatusCode: input.statusCode ?? null,
        lastProbeLatencyMs: input.latencyMs ?? null,
        lastProbeErrorType: input.ok ? null : (input.errorType ?? null),
        lastProbeErrorMessage: input.ok ? null : (input.errorMessage ?? null),
        updatedAt: new Date(),
      })
      .where(and(eq(providerEndpoints.id, input.endpointId), isNull(providerEndpoints.deletedAt)));
  });
}

export async function findProviderEndpointProbeLogs(
  endpointId: number,
  limit: number = 200,
  offset: number = 0
): Promise<ProviderEndpointProbeLog[]> {
  const rows = await db
    .select({
      id: providerEndpointProbeLogs.id,
      endpointId: providerEndpointProbeLogs.endpointId,
      source: providerEndpointProbeLogs.source,
      ok: providerEndpointProbeLogs.ok,
      statusCode: providerEndpointProbeLogs.statusCode,
      latencyMs: providerEndpointProbeLogs.latencyMs,
      errorType: providerEndpointProbeLogs.errorType,
      errorMessage: providerEndpointProbeLogs.errorMessage,
      createdAt: providerEndpointProbeLogs.createdAt,
    })
    .from(providerEndpointProbeLogs)
    .where(eq(providerEndpointProbeLogs.endpointId, endpointId))
    .orderBy(desc(providerEndpointProbeLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map(toProviderEndpointProbeLog);
}
