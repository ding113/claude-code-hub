"use server";

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerEndpointProbeLogs, providerEndpoints, providerVendors } from "@/drizzle/schema";
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
      logger.debug("[ProviderVendor] Failed to parse URL", { candidate, error });
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
  payload: { displayName?: string | null; websiteUrl?: string | null; faviconUrl?: string | null }
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
