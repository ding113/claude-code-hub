import "server-only";

import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerSiteGroupRates, providerSites, providers } from "@/drizzle/schema";
import { classifySiteGroupTag } from "@/lib/provider-sites/billing";
import { findAllProviderGroups } from "@/repository/provider-groups";
import { encryptSecret, hasSecret } from "@/lib/provider-sites/secret-box";
import type {
  CreateProviderSiteInput,
  ProviderSite,
  ProviderSiteGroupRate,
  ProviderSiteWithRates,
  UpdateProviderSiteGroupRateInput,
  UpdateProviderSiteInput,
  UpsertProviderSiteGroupRateInput,
} from "@/types/provider-site";

type SiteRow = typeof providerSites.$inferSelect;
type RateRow = typeof providerSiteGroupRates.$inferSelect;

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toSite(row: SiteRow): ProviderSite {
  return {
    id: row.id,
    name: row.name,
    siteUrl: row.siteUrl,
    siteType: row.siteType,
    providerVendorId: row.providerVendorId ?? null,
    notes: row.notes ?? null,
    isEnabled: row.isEnabled ?? true,
    sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : 0,
    upstreamHubChannelId: row.upstreamHubChannelId ?? null,
    username: row.username ?? null,
    hasPassword: hasSecret(row.passwordCipher),
    turnstileEnabled: row.turnstileEnabled ?? false,
    captchaProvider: row.captchaProvider ?? "global",
    hasCaptchaApiKey: hasSecret(row.captchaApiKeyCipher),
    captchaEndpoint: row.captchaEndpoint ?? null,
    lastBalance: toNullableNumber(row.lastBalance),
    lastBalanceAt: row.lastBalanceAt ? new Date(row.lastBalanceAt) : null,
    todayCost: toNullableNumber(row.todayCost),
    totalCost: toNullableNumber(row.totalCost),
    lastSyncError: row.lastSyncError ?? null,
    lastSyncAt: row.lastSyncAt ? new Date(row.lastSyncAt) : null,
    lastRateSyncedAt: row.lastRateSyncedAt ? new Date(row.lastRateSyncedAt) : null,
    lastCostSyncedAt: row.lastCostSyncedAt ? new Date(row.lastCostSyncedAt) : null,
    createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
  };
}

function toRate(row: RateRow): ProviderSiteGroupRate {
  return {
    id: row.id,
    siteId: row.siteId,
    groupName: row.groupName,
    description: row.description ?? null,
    ratio: toFiniteNumber(row.ratio, 1),
    completionRatio: row.completionRatio == null ? null : toFiniteNumber(row.completionRatio, 0),
    dispatchGroupTag: row.dispatchGroupTag ?? null,
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt) : new Date(),
    createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
  };
}

function normalizeGroupName(name: string): string {
  return name.trim();
}

async function resolveDispatchTag(
  groupName: string,
  explicit?: string | null
): Promise<string | null> {
  if (explicit != null && String(explicit).trim()) {
    return String(explicit).trim();
  }
  try {
    const groups = await findAllProviderGroups();
    return classifySiteGroupTag(
      groupName,
      groups.map((g) => ({
        name: g.name,
        sortOrder: g.sortOrder,
        matchRules: g.matchRules,
      }))
    );
  } catch {
    return classifySiteGroupTag(groupName);
  }
}

export async function findAllProviderSites(): Promise<ProviderSite[]> {
  const rows = await db
    .select()
    .from(providerSites)
    .orderBy(asc(providerSites.sortOrder), asc(providerSites.id));
  return rows.map(toSite);
}

export async function findProviderSiteById(id: number): Promise<ProviderSite | null> {
  const [row] = await db.select().from(providerSites).where(eq(providerSites.id, id)).limit(1);
  return row ? toSite(row) : null;
}

/** Internal row including ciphertext/session fields for sync workers. */
export async function findProviderSiteAuthRow(id: number): Promise<SiteRow | null> {
  const [row] = await db.select().from(providerSites).where(eq(providerSites.id, id)).limit(1);
  return row ?? null;
}

export async function findEnabledProviderSiteAuthRows(): Promise<SiteRow[]> {
  return db
    .select()
    .from(providerSites)
    .where(eq(providerSites.isEnabled, true))
    .orderBy(asc(providerSites.id));
}

export async function findProviderSiteByName(name: string): Promise<ProviderSite | null> {
  const [row] = await db
    .select()
    .from(providerSites)
    .where(eq(providerSites.name, name.trim()))
    .limit(1);
  return row ? toSite(row) : null;
}

export async function findProviderSiteGroupRatesBySiteId(
  siteId: number
): Promise<ProviderSiteGroupRate[]> {
  const rows = await db
    .select()
    .from(providerSiteGroupRates)
    .where(eq(providerSiteGroupRates.siteId, siteId))
    .orderBy(asc(providerSiteGroupRates.ratio), asc(providerSiteGroupRates.groupName));
  return rows.map(toRate);
}

export async function findProviderSiteGroupRatesBySiteIds(
  siteIds: number[]
): Promise<ProviderSiteGroupRate[]> {
  if (siteIds.length === 0) return [];
  const rows = await db
    .select()
    .from(providerSiteGroupRates)
    .where(inArray(providerSiteGroupRates.siteId, siteIds))
    .orderBy(asc(providerSiteGroupRates.ratio), asc(providerSiteGroupRates.groupName));
  return rows.map(toRate);
}

async function countProvidersBySiteIds(
  siteIds: number[]
): Promise<Map<number, { total: number; enabled: number }>> {
  const map = new Map<number, { total: number; enabled: number }>();
  if (siteIds.length === 0) return map;
  const rows = await db
    .select({
      siteId: providers.siteId,
      total: count(),
      enabled: sql<number>`sum(case when ${providers.isEnabled} then 1 else 0 end)`.mapWith(Number),
    })
    .from(providers)
    .where(and(inArray(providers.siteId, siteIds), isNull(providers.deletedAt)))
    .groupBy(providers.siteId);
  for (const row of rows) {
    if (row.siteId == null) continue;
    map.set(row.siteId, { total: Number(row.total) || 0, enabled: Number(row.enabled) || 0 });
  }
  return map;
}

export async function findAllProviderSitesWithRates(): Promise<ProviderSiteWithRates[]> {
  const sites = await findAllProviderSites();
  const ids = sites.map((s) => s.id);
  const [rates, counts] = await Promise.all([
    findProviderSiteGroupRatesBySiteIds(ids),
    countProvidersBySiteIds(ids),
  ]);
  const ratesBySite = new Map<number, ProviderSiteGroupRate[]>();
  for (const rate of rates) {
    const list = ratesBySite.get(rate.siteId) ?? [];
    list.push(rate);
    ratesBySite.set(rate.siteId, list);
  }
  return sites.map((site) => {
    const c = counts.get(site.id) ?? { total: 0, enabled: 0 };
    return {
      ...site,
      groupRates: ratesBySite.get(site.id) ?? [],
      providerCount: c.total,
      enabledProviderCount: c.enabled,
    };
  });
}

export async function createProviderSite(input: CreateProviderSiteInput): Promise<ProviderSite> {
  const maxSort = await db
    .select({ value: sql<number>`coalesce(max(${providerSites.sortOrder}), -1)` })
    .from(providerSites);
  const nextSort =
    input.sortOrder !== undefined && Number.isFinite(input.sortOrder)
      ? Math.trunc(input.sortOrder)
      : (Number(maxSort[0]?.value) || -1) + 1;

  const [row] = await db
    .insert(providerSites)
    .values({
      name: input.name.trim(),
      siteUrl: input.siteUrl.trim(),
      siteType: input.siteType?.trim() || "sub2api",
      providerVendorId: input.providerVendorId ?? null,
      notes: input.notes?.trim() || null,
      isEnabled: input.isEnabled ?? true,
      sortOrder: nextSort,
      upstreamHubChannelId: input.upstreamHubChannelId ?? null,
      username: input.username?.trim() || null,
      passwordCipher: encryptSecret(input.password),
      turnstileEnabled: input.turnstileEnabled ?? false,
      captchaProvider: input.captchaProvider?.trim() || "global",
      captchaApiKeyCipher: encryptSecret(input.captchaApiKey),
    })
    .returning();
  return toSite(row);
}

export async function updateProviderSite(
  id: number,
  input: UpdateProviderSiteInput
): Promise<ProviderSite | null> {
  const patch: Partial<typeof providerSites.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.siteUrl !== undefined) patch.siteUrl = input.siteUrl.trim();
  if (input.siteType !== undefined) patch.siteType = input.siteType.trim() || "sub2api";
  if (input.providerVendorId !== undefined) patch.providerVendorId = input.providerVendorId;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.isEnabled !== undefined) patch.isEnabled = input.isEnabled;
  if (input.sortOrder !== undefined && Number.isFinite(input.sortOrder)) {
    patch.sortOrder = Math.trunc(input.sortOrder);
  }
  if (input.upstreamHubChannelId !== undefined) {
    patch.upstreamHubChannelId = input.upstreamHubChannelId;
  }
  if (input.username !== undefined) patch.username = input.username?.trim() || null;
  if (input.password !== undefined && input.password !== null && input.password !== "") {
    patch.passwordCipher = encryptSecret(input.password);
  }
  if (input.turnstileEnabled !== undefined) patch.turnstileEnabled = input.turnstileEnabled;
  if (input.captchaProvider !== undefined) {
    patch.captchaProvider = input.captchaProvider?.trim() || "global";
  }
  if (input.captchaApiKey !== undefined) {
    if (input.captchaApiKey === null || input.captchaApiKey === "") {
      // empty string means clear; null from form "unchanged" should be omitted by caller
      patch.captchaApiKeyCipher = null;
    } else {
      patch.captchaApiKeyCipher = encryptSecret(input.captchaApiKey);
    }
  }
  if (input.captchaEndpoint !== undefined) {
    patch.captchaEndpoint = input.captchaEndpoint?.trim() || null;
  }
  if (input.lastRateSyncedAt !== undefined) patch.lastRateSyncedAt = input.lastRateSyncedAt;
  if (input.lastCostSyncedAt !== undefined) patch.lastCostSyncedAt = input.lastCostSyncedAt;
  if (input.lastBalance !== undefined) {
    patch.lastBalance = input.lastBalance == null ? null : input.lastBalance.toString();
  }
  if (input.lastBalanceAt !== undefined) patch.lastBalanceAt = input.lastBalanceAt;
  if (input.todayCost !== undefined) {
    patch.todayCost = input.todayCost == null ? null : input.todayCost.toString();
  }
  if (input.totalCost !== undefined) {
    patch.totalCost = input.totalCost == null ? null : input.totalCost.toString();
  }
  if (input.lastSyncError !== undefined) patch.lastSyncError = input.lastSyncError;
  if (input.lastSyncAt !== undefined) patch.lastSyncAt = input.lastSyncAt;
  if (input.sessionAccessTokenCipher !== undefined) {
    patch.sessionAccessTokenCipher = input.sessionAccessTokenCipher;
  }
  if (input.sessionCookieCipher !== undefined) {
    patch.sessionCookieCipher = input.sessionCookieCipher;
  }
  if (input.sessionUserId !== undefined) patch.sessionUserId = input.sessionUserId;
  if (input.sessionExpiresAt !== undefined) patch.sessionExpiresAt = input.sessionExpiresAt;

  const [row] = await db
    .update(providerSites)
    .set(patch)
    .where(eq(providerSites.id, id))
    .returning();
  return row ? toSite(row) : null;
}

export async function deleteProviderSite(id: number): Promise<boolean> {
  // Soft-delete linked keys with the site so orphan keys don't reappear as unassigned.
  await db
    .update(providers)
    .set({
      deletedAt: new Date(),
      isEnabled: false,
      updatedAt: new Date(),
    })
    .where(and(eq(providers.siteId, id), isNull(providers.deletedAt)));
  await db.delete(providerSiteGroupRates).where(eq(providerSiteGroupRates.siteId, id));
  const deleted = await db.delete(providerSites).where(eq(providerSites.id, id)).returning({
    id: providerSites.id,
  });
  return deleted.length > 0;
}

/** Persist manual display order for provider site cards. */
export async function reorderProviderSites(orderedIds: number[]): Promise<ProviderSite[]> {
  const unique = Array.from(
    new Set(orderedIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
  );
  if (unique.length === 0) {
    return findAllProviderSites();
  }

  await db.transaction(async (tx) => {
    for (let rank = 0; rank < unique.length; rank += 1) {
      await tx
        .update(providerSites)
        .set({ sortOrder: rank, updatedAt: new Date() })
        .where(eq(providerSites.id, unique[rank]));
    }
  });

  return findAllProviderSites();
}

export async function upsertProviderSiteGroupRate(
  siteId: number,
  input: UpsertProviderSiteGroupRateInput
): Promise<ProviderSiteGroupRate> {
  const groupName = normalizeGroupName(input.groupName);
  const ratio = Math.max(0, toFiniteNumber(input.ratio, 1));
  const completionRatio =
    input.completionRatio == null ? 0 : Math.max(0, toFiniteNumber(input.completionRatio, 0));
  const dispatchGroupTag = await resolveDispatchTag(groupName, input.dispatchGroupTag);
  const now = new Date();

  const [row] = await db
    .insert(providerSiteGroupRates)
    .values({
      siteId,
      groupName,
      description: input.description?.trim() || null,
      ratio: ratio.toString(),
      completionRatio: completionRatio.toString(),
      dispatchGroupTag,
      lastSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [providerSiteGroupRates.siteId, providerSiteGroupRates.groupName],
      set: {
        description: input.description?.trim() || null,
        ratio: ratio.toString(),
        completionRatio: completionRatio.toString(),
        dispatchGroupTag,
        lastSeenAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return toRate(row);
}

export async function updateProviderSiteGroupRate(
  id: number,
  input: UpdateProviderSiteGroupRateInput
): Promise<ProviderSiteGroupRate | null> {
  const existing = await db
    .select()
    .from(providerSiteGroupRates)
    .where(eq(providerSiteGroupRates.id, id))
    .limit(1);
  if (!existing[0]) return null;

  const current = existing[0];
  const groupName =
    input.groupName !== undefined ? normalizeGroupName(input.groupName) : current.groupName;
  const patch: Partial<typeof providerSiteGroupRates.$inferInsert> = {
    updatedAt: new Date(),
    lastSeenAt: new Date(),
  };
  if (input.groupName !== undefined) patch.groupName = groupName;
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.ratio !== undefined) {
    patch.ratio = Math.max(0, toFiniteNumber(input.ratio, 1)).toString();
  }
  if (input.completionRatio !== undefined) {
    patch.completionRatio =
      input.completionRatio == null
        ? null
        : Math.max(0, toFiniteNumber(input.completionRatio, 0)).toString();
  }
  if (input.dispatchGroupTag !== undefined || input.groupName !== undefined) {
    patch.dispatchGroupTag = await resolveDispatchTag(
      groupName,
      input.dispatchGroupTag !== undefined ? input.dispatchGroupTag : current.dispatchGroupTag
    );
  }

  const [row] = await db
    .update(providerSiteGroupRates)
    .set(patch)
    .where(eq(providerSiteGroupRates.id, id))
    .returning();
  return row ? toRate(row) : null;
}

export async function deleteProviderSiteGroupRate(id: number): Promise<boolean> {
  const deleted = await db
    .delete(providerSiteGroupRates)
    .where(eq(providerSiteGroupRates.id, id))
    .returning({ id: providerSiteGroupRates.id });
  return deleted.length > 0;
}

/**
 * Drop site group-rate rows that are no longer returned by the upstream site.
 * Keeps the live UI mirror of current website groups (stale names like retired
 * plus-1/plus-2 would otherwise linger forever because sync only upserts).
 */
export async function deleteProviderSiteGroupRatesNotIn(
  siteId: number,
  keepGroupNames: string[]
): Promise<string[]> {
  const keep = new Set(
    keepGroupNames.map((name) => normalizeGroupName(name)).filter(Boolean)
  );
  const existing = await db
    .select({
      id: providerSiteGroupRates.id,
      groupName: providerSiteGroupRates.groupName,
    })
    .from(providerSiteGroupRates)
    .where(eq(providerSiteGroupRates.siteId, siteId));

  const removed: string[] = [];
  for (const row of existing) {
    if (keep.has(normalizeGroupName(row.groupName))) continue;
    await db.delete(providerSiteGroupRates).where(eq(providerSiteGroupRates.id, row.id));
    removed.push(row.groupName);
  }
  return removed;
}

export async function findProviderSiteGroupRateById(
  id: number
): Promise<ProviderSiteGroupRate | null> {
  const [row] = await db
    .select()
    .from(providerSiteGroupRates)
    .where(eq(providerSiteGroupRates.id, id))
    .limit(1);
  return row ? toRate(row) : null;
}
