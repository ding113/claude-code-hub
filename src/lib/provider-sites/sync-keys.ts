/**
 * Ensure every (site, upstream group) pair has exactly one connected provider key.
 *
 * Product rules:
 * - Key source: the site's own upstream key list (sub2api /api/v1/keys, newapi /api/token/).
 * - Upstream groups that fail keyword classification ("other") still receive an upstream
 *   key, but are never bound to a random CCH dispatch pool.
 * - Missing key: create an upstream key for that group (auto-provision), then create a
 *   CCH provider when the group has a dispatch-pool match. Failures are retried next tick.
 * - Duplicate keys under the same site+group: keep exactly one (prefer enabled, then the
 *   one already linked to this site+group, then most recently updated); soft-delete the rest.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providers } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import { classifySiteGroupTag } from "@/lib/provider-sites/billing";
import {
  createUpstreamApiKey,
  deleteUpstreamApiKey,
  type UpstreamApiKey,
  type UpstreamAuthSession,
  type UpstreamSiteCredentials,
} from "@/lib/provider-sites/upstream-connector";
import { createProvider, deleteProvider } from "@/repository/provider";
import type { ProviderType } from "@/types/provider";
import type { ProviderGroup } from "@/types/provider-group";

export type SiteKeySyncSummary = {
  groupsEligible: number;
  groupsSkipped: number;
  skippedGroupNames: string[];
  keysSeen: number;
  providersCreated: number;
  providersDeleted: number;
  providersReused: number;
  providersReactivated: number;
  keysAutoCreated: number;
};

export const SITE_PROVIDER_BALANCE_ENABLE_THRESHOLD = 0.01;

/**
 * Resolve the automatic provider switch for a site's upstream balance.
 *
 * A missing/non-finite balance means the upstream balance request was not
 * trustworthy, so the sync must leave the current provider state unchanged.
 */
export function resolveSiteProviderBalanceEnabled(
  balance: number | null | undefined
): boolean | null {
  if (balance == null || !Number.isFinite(balance)) return null;
  return balance >= SITE_PROVIDER_BALANCE_ENABLE_THRESHOLD;
}

type ProviderRow = {
  id: number;
  name: string;
  key: string;
  url: string;
  siteId: number | null;
  siteGroupName: string | null;
  groupTag: string | null;
  isEnabled: boolean;
  providerType: string;
  updatedAt: Date | null;
  balanceAutoDisabled: boolean;
};

function normalizeGroupKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function isUsableKey(key: string | null | undefined): boolean {
  const raw = (key ?? "").trim();
  if (!raw) return false;
  if (raw.includes("*") || raw.includes("...") || raw.includes("…")) return false;
  return raw.length > 12;
}

/** Re-enable a site-linked provider only when the upstream still exposes a full key. */
export function shouldReactivateSiteProvider(
  isEnabled: boolean,
  upstreamKeys: UpstreamApiKey[]
): boolean {
  return !isEnabled && upstreamKeys.some((key) => isUsableKey(key.key));
}

export function shouldReactivateSiteProviderForBalance(
  isEnabled: boolean,
  balanceAutoDisabled: boolean,
  balance: number | null | undefined,
  upstreamKeys: UpstreamApiKey[]
): boolean {
  return (
    resolveSiteProviderBalanceEnabled(balance) === true &&
    balanceAutoDisabled &&
    shouldReactivateSiteProvider(isEnabled, upstreamKeys)
  );
}

/** Return true when a linked provider points at a group absent from the last trusted upstream list. */
export function isSiteProviderGroupStale(
  siteGroupName: string | null | undefined,
  upstreamGroupNames: string[]
): boolean {
  const normalizedSiteGroup = siteGroupName?.trim();
  if (!normalizedSiteGroup) return false;

  const upstreamGroups = new Set(upstreamGroupNames.map(normalizeGroupKey));
  return !upstreamGroups.has(normalizeGroupKey(normalizedSiteGroup));
}

export function findStaleSiteProviderIds(
  rows: Array<Pick<ProviderRow, "id" | "siteGroupName">>,
  upstreamGroupNames: string[]
): number[] {
  const trustedGroupNames = Array.from(
    new Map(
      upstreamGroupNames
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        .map((name) => [normalizeGroupKey(name), name] as const)
    ).values()
  );
  if (trustedGroupNames.length === 0) return [];

  return rows
    .filter((row) => isSiteProviderGroupStale(row.siteGroupName, trustedGroupNames))
    .map((row) => row.id);
}

/**
 * Return non-routable upstream groups that have no key in a complete key-list response.
 *
 * This is retained as a diagnostic helper. The live sync no longer prunes these groups;
 * key provisioning handles them first so an unclassified group can receive a key.
 * A key list with missing group names is treated as incomplete and never authorizes pruning.
 */
export function findUnkeyedOtherSiteGroupNames(input: {
  groupNames: string[];
  upstreamKeys: Array<Pick<UpstreamApiKey, "groupName">>;
  groups: ProviderGroup[];
}): string[] {
  const normalizedKeyNames = input.upstreamKeys.map((key) => normalizeGroupKey(key.groupName));
  if (
    normalizedKeyNames.length === 0 ||
    normalizedKeyNames.some((groupName) => groupName.length === 0)
  ) {
    return [];
  }

  const keyNames = new Set(normalizedKeyNames);
  const classifiable = input.groups.map((group) => ({
    name: group.name,
    sortOrder: group.sortOrder,
    matchRules: group.matchRules,
  }));

  return input.groupNames.filter((groupName) => {
    const normalized = normalizeGroupKey(groupName);
    return (
      normalized.length > 0 &&
      !keyNames.has(normalized) &&
      classifySiteGroupTag(groupName, classifiable) === "other"
    );
  });
}

/**
 * Return keys with no currently resolvable upstream group, or whose group has
 * been removed from the upstream account.
 * Unknown group IDs are deliberately excluded: a failed/stale group lookup must
 * never turn into a destructive cleanup decision. Orphaned IDs are safe to clean
 * only after the connector has loaded a non-empty authoritative group map, and
 * a key bound to a group absent from that trusted map is treated as stale the
 * same way local providers are pruned (see isSiteProviderGroupStale).
 */
export function findUnboundUpstreamApiKeys(
  upstreamKeys: UpstreamApiKey[],
  upstreamGroupNames: string[]
): UpstreamApiKey[] {
  const trusted = upstreamGroupNames.some((name) => name.trim().length > 0);
  const knownGroups = trusted ? new Set(upstreamGroupNames.map(normalizeGroupKey)) : null;
  return upstreamKeys.filter((key) => {
    const groupName = key.groupName.trim();
    if (groupName.length > 0) {
      // Bound to a group that no longer exists upstream -> stale, safe to clean
      // only when the group refresh was non-empty.
      return knownGroups !== null && !knownGroups.has(normalizeGroupKey(groupName));
    }
    return key.groupBinding === "unbound" || key.groupBinding === "orphaned";
  });
}

/** Delete unassigned/orphaned upstream keys after a trusted non-empty group refresh. */
export async function deleteUnboundUpstreamApiKeys(input: {
  siteId: number;
  siteName: string;
  upstreamKeys: UpstreamApiKey[];
  upstreamGroupNames: string[];
  creds: UpstreamSiteCredentials;
  session: UpstreamAuthSession;
}): Promise<number> {
  let deleted = 0;
  for (const key of findUnboundUpstreamApiKeys(input.upstreamKeys, input.upstreamGroupNames)) {
    try {
      await deleteUpstreamApiKey(input.creds, input.session, key.id);
      deleted += 1;
      logger.info(
        key.groupName.trim().length > 0
          ? "[provider-sites] deleted upstream key bound to removed group"
          : "[provider-sites] deleted upstream key with no resolvable group",
        {
          siteId: input.siteId,
          siteName: input.siteName,
          keyId: key.id,
          keyName: key.name,
          groupBinding: key.groupBinding,
          groupName: key.groupName.trim(),
        }
      );
    } catch (error) {
      logger.warn("[provider-sites] unbound upstream key delete failed", {
        siteId: input.siteId,
        siteName: input.siteName,
        keyId: key.id,
        keyName: key.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return deleted;
}

/**
 * Keep one upstream key per normalized group and return the surviving view.
 *
 * The CCH side already keeps one provider per site+group, but that does not
 * remove duplicate tokens from the upstream account. Prefer a full secret so
 * the local mirror can continue using it, then prefer the newest numeric id.
 */
export async function deleteDuplicateUpstreamApiKeys(input: {
  siteId: number;
  siteName: string;
  upstreamKeys: UpstreamApiKey[];
  creds: UpstreamSiteCredentials;
  session: UpstreamAuthSession;
}): Promise<{ keys: UpstreamApiKey[]; deleted: number }> {
  const byGroup = new Map<string, UpstreamApiKey[]>();
  for (const key of input.upstreamKeys) {
    const groupName = key.groupName.trim();
    if (!groupName) continue;
    const normalized = normalizeGroupKey(groupName);
    const list = byGroup.get(normalized) ?? [];
    list.push(key);
    byGroup.set(normalized, list);
  }

  const deletedIds = new Set<string>();
  let deleted = 0;
  for (const [normalizedGroup, keys] of byGroup) {
    if (keys.length < 2) continue;
    const sorted = [...keys].sort((a, b) => {
      const usable = Number(isUsableKey(b.key)) - Number(isUsableKey(a.key));
      if (usable !== 0) return usable;
      const aId = Number(a.id);
      const bId = Number(b.id);
      if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return bId - aId;
      return b.id.localeCompare(a.id);
    });
    const keeper = sorted[0];
    for (const duplicate of sorted.slice(1)) {
      try {
        await deleteUpstreamApiKey(input.creds, input.session, duplicate.id);
        deletedIds.add(duplicate.id);
        deleted += 1;
        logger.info("[provider-sites] deleted duplicate upstream group key", {
          siteId: input.siteId,
          siteName: input.siteName,
          groupName: keeper.groupName,
          normalizedGroup,
          keeperId: keeper.id,
          deletedKeyId: duplicate.id,
        });
      } catch (error) {
        logger.warn("[provider-sites] duplicate upstream group key delete failed", {
          siteId: input.siteId,
          siteName: input.siteName,
          groupName: keeper.groupName,
          duplicateKeyId: duplicate.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    keys: input.upstreamKeys.filter((key) => !deletedIds.has(key.id)),
    deleted,
  };
}

async function deleteStaleSiteProvidersForRows(
  siteId: number,
  rows: Array<Pick<ProviderRow, "id" | "siteGroupName">>,
  upstreamGroupNames: string[]
): Promise<number> {
  const staleProviderIds = new Set(findStaleSiteProviderIds(rows, upstreamGroupNames));
  let deletedCount = 0;

  for (const row of rows) {
    if (!staleProviderIds.has(row.id)) continue;
    try {
      const deleted = await deleteProvider(row.id);
      if (!deleted) continue;
      deletedCount += 1;
      logger.info("[provider-sites] deleted provider for removed upstream group", {
        siteId,
        providerId: row.id,
        groupName: row.siteGroupName,
      });
    } catch (error) {
      logger.warn("[provider-sites] stale upstream group provider delete failed", {
        siteId,
        providerId: row.id,
        groupName: row.siteGroupName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return deletedCount;
}

/**
 * Prune site-linked providers whose upstream group disappeared.
 *
 * This is intentionally callable before the upstream key endpoint is queried:
 * group-rate data is the authoritative group list, so a temporary key-list
 * failure must not leave a removed group routable locally.
 */
export async function pruneStaleSiteProvidersForUpstreamGroups(
  siteId: number,
  upstreamGroupNames: string[]
): Promise<number> {
  const rows = await db
    .select({ id: providers.id, siteGroupName: providers.siteGroupName })
    .from(providers)
    .where(and(eq(providers.siteId, siteId), isNull(providers.deletedAt)));

  return deleteStaleSiteProvidersForRows(siteId, rows, upstreamGroupNames);
}

function pickKeeper(rows: ProviderRow[], siteId: number, groupName: string): ProviderRow {
  const norm = normalizeGroupKey(groupName);
  const score = (row: ProviderRow): number => {
    let s = 0;
    if (row.isEnabled) s += 100;
    if (row.siteId === siteId && normalizeGroupKey(row.siteGroupName ?? "") === norm) s += 50;
    // newer updatedAt slightly preferred
    const ts = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
    return s * 1e13 + ts;
  };
  return [...rows].sort((a, b) => score(b) - score(a))[0];
}

function siteApiBase(siteUrl: string): string {
  return siteUrl.trim().replace(/\/+$/, "");
}

async function createLinkedProvider(input: {
  siteId: number;
  siteName: string;
  groupName: string;
  tag: string;
  providerType: ProviderType;
  url: string;
  websiteUrl: string;
  key: string;
  /** Upstream group ratio — used for dispatch ranking (cheaper first). */
  costMultiplier?: number;
  isEnabled?: boolean;
  balanceAutoDisabled?: boolean;
}): Promise<boolean> {
  const cost =
    typeof input.costMultiplier === "number" && Number.isFinite(input.costMultiplier)
      ? Math.max(0, input.costMultiplier)
      : 1;
  try {
    const created = await createProvider({
      name: `${input.siteName}-${input.groupName}`,
      url: input.url,
      key: input.key,
      provider_type: input.providerType,
      group_tag: input.tag,
      is_enabled: input.isEnabled ?? true,
      website_url: input.websiteUrl,
      cost_multiplier: cost,
      tpm: null,
      rpm: null,
      rpd: null,
      cc: null,
    } as Parameters<typeof createProvider>[0]);

    // Use the exact row returned by createProvider. Looking up by key could
    // select an older active provider when the upstream key is shared/reused.
    await db
      .update(providers)
      .set({
        siteId: input.siteId,
        siteGroupName: input.groupName,
        billingMode: "site_group_ratio",
        groupTag: input.tag,
        costMultiplier: cost.toString(),
        balanceAutoDisabled: input.balanceAutoDisabled ?? false,
        updatedAt: new Date(),
      })
      .where(eq(providers.id, created.id));
    return true;
  } catch (error) {
    logger.error("[provider-sites] create provider from upstream key failed", {
      siteId: input.siteId,
      groupName: input.groupName,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function syncSiteKeysForGroups(input: {
  siteId: number;
  siteName: string;
  siteUrl: string;
  siteType: string;
  providerVendorId: number | null;
  upstreamKeys: UpstreamApiKey[];
  groupNames: string[];
  groups: ProviderGroup[];
  /** Upstream groupName -> ratio for dispatch cost ranking. */
  groupRatios?: Record<string, number> | Map<string, number> | null;
  /** Upstream site balance used to gate automatic provider activation. */
  balance?: number | null;
  /** When set, missing upstream keys are auto-created for all upstream groups. */
  creds?: UpstreamSiteCredentials | null;
  session?: UpstreamAuthSession | null;
}): Promise<SiteKeySyncSummary> {
  const summary: SiteKeySyncSummary = {
    groupsEligible: 0,
    groupsSkipped: 0,
    skippedGroupNames: [],
    keysSeen: input.upstreamKeys.length,
    providersCreated: 0,
    providersDeleted: 0,
    providersReused: 0,
    providersReactivated: 0,
    keysAutoCreated: 0,
  };

  const classifiable = input.groups.map((g) => ({
    name: g.name,
    sortOrder: g.sortOrder,
    matchRules: g.matchRules,
  }));
  const sharedByName = new Map(input.groups.map((g) => [g.name, g.sharedSettings ?? null]));
  const balanceEnabled = resolveSiteProviderBalanceEnabled(input.balance);
  const trustedGroupNames = Array.from(
    new Map(
      input.groupNames
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        .map((name) => [normalizeGroupKey(name), name] as const)
    ).values()
  );

  // Load all providers linked to this site before classifying groups. A successful,
  // non-empty upstream group response is authoritative: keys for groups that vanished
  // upstream must not remain routable locally. An empty response is treated as
  // untrusted by the caller and deliberately does not enter this pruning branch.
  const siteRows = (await db
    .select({
      id: providers.id,
      name: providers.name,
      key: providers.key,
      url: providers.url,
      siteId: providers.siteId,
      siteGroupName: providers.siteGroupName,
      groupTag: providers.groupTag,
      isEnabled: providers.isEnabled,
      providerType: providers.providerType,
      updatedAt: providers.updatedAt,
      balanceAutoDisabled: providers.balanceAutoDisabled,
    })
    .from(providers)
    .where(and(eq(providers.siteId, input.siteId), isNull(providers.deletedAt)))) as ProviderRow[];

  if (trustedGroupNames.length > 0) {
    summary.providersDeleted += await deleteStaleSiteProvidersForRows(
      input.siteId,
      siteRows,
      trustedGroupNames
    );
  }

  // Every upstream group gets key provisioning, including groups that are not
  // mapped to a CCH dispatch pool yet. "other" groups receive an upstream key
  // but are not bound to a random local pool.
  const tagByGroup = new Map<string, string>();
  const eligibleGroups: Array<{ groupName: string; tag: string }> = [];
  for (const groupName of trustedGroupNames) {
    const tag = classifySiteGroupTag(groupName, classifiable) || "other";
    tagByGroup.set(normalizeGroupKey(groupName), tag);
    if (tag === "other") {
      summary.groupsSkipped += 1;
      summary.skippedGroupNames.push(groupName);
      continue;
    }
    eligibleGroups.push({ groupName, tag });
  }
  summary.groupsEligible = eligibleGroups.length;
  if (trustedGroupNames.length === 0) return summary;

  const byGroup = new Map<string, ProviderRow[]>();
  for (const row of siteRows) {
    const sgn = (row.siteGroupName ?? "").trim();
    if (!sgn) continue;
    const key = normalizeGroupKey(sgn);
    const list = byGroup.get(key) ?? [];
    list.push(row);
    byGroup.set(key, list);
  }

  // Mutable: auto-create may append newly provisioned keys for later groups.
  const keysByGroup = new Map<string, UpstreamApiKey[]>();
  for (const k of input.upstreamKeys) {
    if (!k.groupName) continue;
    const key = normalizeGroupKey(k.groupName);
    const list = keysByGroup.get(key) ?? [];
    list.push(k);
    keysByGroup.set(key, list);
  }

  const siteBase = siteApiBase(input.siteUrl);
  const canAutoCreate = Boolean(input.creds && input.session);
  const ratioOf = (groupName: string): number => {
    if (!input.groupRatios) return 1;
    if (input.groupRatios instanceof Map) {
      const v = input.groupRatios.get(groupName);
      return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 1;
    }
    const v = input.groupRatios[groupName];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 1;
  };

  for (const groupName of trustedGroupNames) {
    const norm = normalizeGroupKey(groupName);
    const tag = tagByGroup.get(norm) ?? "other";
    let upstreamGroupKeys = keysByGroup.get(norm) ?? [];
    let upstreamKey = upstreamGroupKeys.find((k) => isUsableKey(k.key));

    // Provision the upstream side before looking at local CCH providers. This
    // also repairs a group whose local provider survived after its upstream
    // token was removed.
    if (!upstreamKey && canAutoCreate && input.creds && input.session) {
      // If any masked key is present, do not create a second one: the key-list
      // is authoritative even when a reveal request was rate-limited.
      const hasAnyUpstream = upstreamGroupKeys.length > 0;
      if (!hasAnyUpstream) {
        logger.info("[provider-sites] key sync: auto-creating upstream key for empty group", {
          siteId: input.siteId,
          groupName,
          tag,
        });
        const created = await createUpstreamApiKey(input.creds, input.session, { groupName });
        if (created && isUsableKey(created.key)) {
          summary.keysAutoCreated += 1;
          upstreamKey = created;
          const list = keysByGroup.get(norm) ?? [];
          list.push(created);
          keysByGroup.set(norm, list);
          upstreamGroupKeys = list;
        }
      } else {
        logger.warn("[provider-sites] key sync: group has keys but none usable (masked?)", {
          siteId: input.siteId,
          groupName,
          upstreamKeyCount: upstreamGroupKeys.length,
        });
      }
    }

    // An unclassified group (for example 国模) is intentionally not attached
    // to a random CCH dispatch pool. Its upstream key is still provisioned so
    // the account remains one-key-per-group and can be mapped later by adding a
    // provider-group match rule.
    if (tag === "other") {
      if (!upstreamKey) {
        logger.warn("[provider-sites] key sync: no usable upstream key for non-routable group", {
          siteId: input.siteId,
          groupName,
          upstreamKeyCount: upstreamGroupKeys.length,
          autoCreateAttempted: canAutoCreate,
        });
      }
      continue;
    }

    const existing = byGroup.get(norm) ?? [];
    const shared = sharedByName.get(tag) ?? null;
    const providerType =
      (shared?.providerType as ProviderType | null | undefined) ??
      (siteRows[0]?.providerType as ProviderType | undefined) ??
      "claude";
    const url = siteRows.find((r) => r.url)?.url ?? `${siteBase}/v1`;
    const costMultiplier = ratioOf(groupName);

    if (existing.length > 0) {
      // Exactly one keeper; delete the rest (prefer enabled).
      const keeper = pickKeeper(existing, input.siteId, groupName);
      summary.providersReused += 1;
      const shouldReactivate = shouldReactivateSiteProviderForBalance(
        keeper.isEnabled,
        keeper.balanceAutoDisabled,
        input.balance,
        upstreamGroupKeys
      );
      // Keep dispatch cost in sync with live upstream group ratio.
      try {
        const set: Record<string, unknown> = {
          ...(shouldReactivate ? { isEnabled: true, balanceAutoDisabled: false } : {}),
          costMultiplier: costMultiplier.toString(),
          billingMode: "site_group_ratio",
          siteGroupName: groupName,
          groupTag: tag,
          updatedAt: new Date(),
        };
        // Repair a stale/masked local key: the upstream reveal (when it
        // succeeded) holds the full secret. Without this write-back a provider
        // whose key was stored masked or rotated upstream would 401 forever
        // while every sync tick re-reveals the same full key in vain.
        if (upstreamKey && isUsableKey(upstreamKey.key) && upstreamKey.key !== keeper.key) {
          set.key = upstreamKey.key;
        }
        await db
          .update(providers)
          .set(set)
          .where(eq(providers.id, keeper.id));
        if (shouldReactivate) summary.providersReactivated += 1;
      } catch (error) {
        logger.warn("[provider-sites] cost multiplier sync failed", {
          providerId: keeper.id,
          groupName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      for (const row of existing) {
        if (row.id === keeper.id) continue;
        try {
          await deleteProvider(row.id);
          summary.providersDeleted += 1;
        } catch (error) {
          logger.warn("[provider-sites] duplicate key delete failed", {
            providerId: row.id,
            siteId: input.siteId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      continue;
    }

    if (!upstreamKey) {
      logger.warn("[provider-sites] key sync: no usable upstream key for group", {
        siteId: input.siteId,
        groupName,
        upstreamKeyCount: upstreamGroupKeys.length,
        autoCreateAttempted: canAutoCreate,
      });
      continue;
    }

    const ok = await createLinkedProvider({
      siteId: input.siteId,
      siteName: input.siteName,
      groupName,
      tag,
      providerType,
      url,
      websiteUrl: siteBase,
      key: upstreamKey.key,
      costMultiplier,
      isEnabled: balanceEnabled ?? true,
      balanceAutoDisabled: balanceEnabled === false,
    });
    if (ok) summary.providersCreated += 1;
  }

  logger.info("[provider-sites] key sync summary", {
    siteId: input.siteId,
    siteName: input.siteName,
    groupsEligible: summary.groupsEligible,
    groupsSkipped: summary.groupsSkipped,
    skippedGroupNames: summary.skippedGroupNames,
    keysSeen: summary.keysSeen,
    created: summary.providersCreated,
    deleted: summary.providersDeleted,
    reused: summary.providersReused,
    reactivated: summary.providersReactivated,
    keysAutoCreated: summary.keysAutoCreated,
    existingSiteRows: siteRows.length,
  });
  return summary;
}

/** Apply the site's balance policy to every linked, non-deleted provider. */
export async function syncSiteProviderBalanceState(
  siteId: number,
  balance: number | null | undefined
): Promise<{ enabled: boolean | null; changed: number }> {
  const enabled = resolveSiteProviderBalanceEnabled(balance);
  if (enabled == null) return { enabled: null, changed: 0 };

  const where = enabled
    ? and(
        eq(providers.siteId, siteId),
        isNull(providers.deletedAt),
        eq(providers.isEnabled, false),
        eq(providers.balanceAutoDisabled, true)
      )
    : and(eq(providers.siteId, siteId), isNull(providers.deletedAt), eq(providers.isEnabled, true));

  const changed = await db
    .update(providers)
    .set({ isEnabled: enabled, balanceAutoDisabled: !enabled, updatedAt: new Date() })
    .where(where)
    .returning({ id: providers.id });

  return { enabled, changed: changed.length };
}
