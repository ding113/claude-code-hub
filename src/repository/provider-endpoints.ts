"use server";

import { and, asc, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import {
  providerEndpointProbeLogs,
  providerEndpoints,
  providers,
  providerVendors,
} from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import type {
  ProviderEndpoint,
  ProviderEndpointProbeLog,
  ProviderEndpointProbeSource,
  ProviderType,
  ProviderVendor,
} from "@/types/provider";

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
  "id" | "url" | "lastProbedAt" | "lastProbeOk"
>;

export async function findEnabledProviderEndpointsForProbing(): Promise<
  ProviderEndpointProbeTarget[]
> {
  const rows = await db
    .select({
      id: providerEndpoints.id,
      url: providerEndpoints.url,
      lastProbedAt: providerEndpoints.lastProbedAt,
      lastProbeOk: providerEndpoints.lastProbeOk,
    })
    .from(providerEndpoints)
    .where(and(eq(providerEndpoints.isEnabled, true), isNull(providerEndpoints.deletedAt)))
    .orderBy(asc(providerEndpoints.id));

  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    lastProbedAt: toNullableDate(row.lastProbedAt),
    lastProbeOk: row.lastProbeOk ?? null,
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

  const result = await db.execute(sql`
    WITH ids_to_delete AS (
      SELECT id FROM provider_endpoint_probe_logs
      WHERE created_at < ${input.beforeDate}
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

export async function getOrCreateProviderVendorIdFromUrls(input: {
  providerUrl: string;
  websiteUrl?: string | null;
  faviconUrl?: string | null;
  displayName?: string | null;
}): Promise<number> {
  const domainSource = input.websiteUrl?.trim() ? input.websiteUrl : input.providerUrl;
  const websiteDomain = normalizeWebsiteDomainFromUrl(domainSource);
  if (!websiteDomain) {
    throw new Error("Failed to resolve provider vendor domain");
  }

  const existing = await db
    .select({ id: providerVendors.id })
    .from(providerVendors)
    .where(eq(providerVendors.websiteDomain, websiteDomain))
    .limit(1);
  if (existing[0]) {
    return existing[0].id;
  }

  const now = new Date();
  const inserted = await db
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

  const fallback = await db
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
function deriveDisplayNameFromDomain(domain: string): string {
  const parts = domain.split(".");
  const name = parts[0] === "api" && parts[1] ? parts[1] : parts[0];
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

      const domainSource = row.websiteUrl?.trim() || row.url;
      const domain = normalizeWebsiteDomainFromUrl(domainSource);

      if (!domain) {
        logger.warn("[backfillVendors] Invalid URL for provider", {
          providerId: row.id,
          url: row.url,
        });
        stats.skippedInvalidUrl++;
        lastId = Math.max(lastId, row.id);
        continue;
      }

      try {
        const displayName = deriveDisplayNameFromDomain(domain);
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

export async function tryDeleteProviderVendorIfEmpty(vendorId: number): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
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
    });
  } catch (error) {
    logger.warn("[ProviderVendor] Auto delete failed", {
      vendorId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
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

export async function ensureProviderEndpointExistsForUrl(input: {
  vendorId: number;
  providerType: ProviderType;
  url: string;
  label?: string | null;
}): Promise<boolean> {
  const trimmedUrl = input.url.trim();
  if (!trimmedUrl) {
    return false;
  }

  try {
    // eslint-disable-next-line no-new
    new URL(trimmedUrl);
  } catch {
    return false;
  }

  const now = new Date();
  const inserted = await db
    .insert(providerEndpoints)
    .values({
      vendorId: input.vendorId,
      providerType: input.providerType,
      url: trimmedUrl,
      label: input.label ?? null,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [providerEndpoints.vendorId, providerEndpoints.providerType, providerEndpoints.url],
    })
    .returning({ id: providerEndpoints.id });

  return inserted.length > 0;
}

export async function backfillProviderEndpointsFromProviders(): Promise<{
  inserted: number;
  uniqueCandidates: number;
  skippedInvalid: number;
}> {
  const pageSize = 1000;
  const insertBatchSize = 500;

  let lastProviderId = 0;
  let skippedInvalid = 0;
  let insertedTotal = 0;
  const seen = new Set<string>();
  const pending: Array<{ vendorId: number; providerType: ProviderType; url: string }> = [];

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    const now = new Date();
    const inserted = await db
      .insert(providerEndpoints)
      .values(pending.map((value) => ({ ...value, updatedAt: now })))
      .onConflictDoNothing({
        target: [providerEndpoints.vendorId, providerEndpoints.providerType, providerEndpoints.url],
      })
      .returning({ id: providerEndpoints.id });
    insertedTotal += inserted.length;
    pending.length = 0;
  };

  while (true) {
    const rows = await db
      .select({
        id: providers.id,
        vendorId: providers.providerVendorId,
        providerType: providers.providerType,
        url: providers.url,
      })
      .from(providers)
      .where(and(isNull(providers.deletedAt), gt(providers.id, lastProviderId)))
      .orderBy(asc(providers.id))
      .limit(pageSize);

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      lastProviderId = Math.max(lastProviderId, row.id);

      if (!row.vendorId || row.vendorId <= 0) {
        skippedInvalid++;
        continue;
      }

      const trimmedUrl = row.url.trim();
      if (!trimmedUrl) {
        skippedInvalid++;
        continue;
      }

      try {
        // eslint-disable-next-line no-new
        new URL(trimmedUrl);
      } catch {
        skippedInvalid++;
        continue;
      }

      const key = `${row.vendorId}|${row.providerType}|${trimmedUrl}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      pending.push({ vendorId: row.vendorId, providerType: row.providerType, url: trimmedUrl });

      if (pending.length >= insertBatchSize) {
        await flush();
      }
    }
  }

  await flush();
  return { inserted: insertedTotal, uniqueCandidates: seen.size, skippedInvalid };
}

export async function updateProviderEndpoint(
  endpointId: number,
  payload: { url?: string; label?: string | null; sortOrder?: number; isEnabled?: boolean }
): Promise<ProviderEndpoint | null> {
  if (Object.keys(payload).length === 0) {
    const existing = await db
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

    return existing[0] ? toProviderEndpoint(existing[0]) : null;
  }

  const now = new Date();
  const updates: Partial<typeof providerEndpoints.$inferInsert> = { updatedAt: now };
  if (payload.url !== undefined) updates.url = payload.url;
  if (payload.label !== undefined) updates.label = payload.label;
  if (payload.sortOrder !== undefined) updates.sortOrder = payload.sortOrder;
  if (payload.isEnabled !== undefined) updates.isEnabled = payload.isEnabled;

  const rows = await db
    .update(providerEndpoints)
    .set(updates)
    .where(and(eq(providerEndpoints.id, endpointId), isNull(providerEndpoints.deletedAt)))
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

  return rows[0] ? toProviderEndpoint(rows[0]) : null;
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
