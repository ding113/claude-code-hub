import "server-only";

import { asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerGroups, providers } from "@/drizzle/schema";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { normalizeProviderGroupMatchRules } from "@/lib/provider-groups/match-rules";
import {
  normalizeProviderGroupModelMatchRules,
  type ProviderGroupModelMatchRule,
} from "@/lib/provider-groups/model-match-rules";
import { normalizeProviderGroupSharedSettings } from "@/lib/provider-groups/shared-settings";
import { parseProviderGroups } from "@/lib/utils/provider-group";
import type {
  CreateProviderGroupInput,
  ProviderGroup,
  UpdateProviderGroupInput,
} from "@/types/provider-group";

// ---------------------------------------------------------------------------
// Internal: drizzle row -> ProviderGroup type transformer
// ---------------------------------------------------------------------------

type ProviderGroupRow = typeof providerGroups.$inferSelect;
type TransactionExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ProviderGroupQueryExecutor = Pick<TransactionExecutor, "select">;
type ProviderGroupMutationExecutor = Pick<TransactionExecutor, "update">;

function toProviderGroup(row: ProviderGroupRow): ProviderGroup {
  return {
    id: row.id,
    name: row.name,
    costMultiplier: Number(row.costMultiplier),
    description: row.description ?? null,
    healthTestModel:
      row.healthTestModel != null && String(row.healthTestModel).trim()
        ? String(row.healthTestModel).trim()
        : null,
    sharedSettings: normalizeProviderGroupSharedSettings(row.sharedSettings),
    sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : 0,
    matchRules: normalizeProviderGroupMatchRules(row.matchRules),
    modelMatchRules: normalizeProviderGroupModelMatchRules(row.modelMatchRules),
    createdAt: row.createdAt!,
    updatedAt: row.updatedAt!,
  };
}

// ---------------------------------------------------------------------------
// In-memory cache for getGroupCostMultiplier (hot-path, called per request)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000; // 60 seconds

interface CacheEntry {
  value: number;
  expiresAt: number;
}

const multiplierCache = new Map<string, CacheEntry>();
let modelMatchRulesCache: {
  value: ReadonlyMap<string, ProviderGroupModelMatchRule[] | null>;
  expiresAt: number;
} | null = null;

/**
 * Invalidate the in-memory cost multiplier cache.
 * Call this after any mutation (create / update / delete) to provider groups.
 */
export function invalidateGroupMultiplierCache(): void {
  multiplierCache.clear();
  modelMatchRulesCache = null;
}

/** Return cached request-model rules for all provider groups. */
export async function getProviderGroupModelMatchRules(): Promise<
  ReadonlyMap<string, ProviderGroupModelMatchRule[] | null>
> {
  const now = Date.now();
  if (modelMatchRulesCache && modelMatchRulesCache.expiresAt > now) {
    return modelMatchRulesCache.value;
  }

  const rows = await db
    .select({ name: providerGroups.name, modelMatchRules: providerGroups.modelMatchRules })
    .from(providerGroups);
  const value = new Map(
    rows.map((row) => [row.name, normalizeProviderGroupModelMatchRules(row.modelMatchRules)])
  );
  modelMatchRulesCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

/**
 * Return all provider groups ordered for classification:
 * "default" always first, then sort_order ASC, then name.
 */
export async function findAllProviderGroups(): Promise<ProviderGroup[]> {
  const rows = await db
    .select()
    .from(providerGroups)
    .orderBy(
      sql`CASE WHEN ${providerGroups.name} = ${PROVIDER_GROUP.DEFAULT} THEN 0 ELSE 1 END`,
      asc(providerGroups.sortOrder),
      asc(providerGroups.name)
    );

  return rows.map(toProviderGroup);
}

/**
 * Look up a single provider group by its unique name.
 */
export async function findProviderGroupByName(name: string): Promise<ProviderGroup | null> {
  const [row] = await db
    .select()
    .from(providerGroups)
    .where(eq(providerGroups.name, name))
    .limit(1);

  return row ? toProviderGroup(row) : null;
}

/**
 * Look up a single provider group by its id.
 */
export async function findProviderGroupById(
  id: number,
  executor: ProviderGroupQueryExecutor = db
): Promise<ProviderGroup | null> {
  const [row] = await executor
    .select()
    .from(providerGroups)
    .where(eq(providerGroups.id, id))
    .limit(1);

  return row ? toProviderGroup(row) : null;
}

// ---------------------------------------------------------------------------
// Mutation functions
// ---------------------------------------------------------------------------

/**
 * Create a new provider group.
 */
export async function createProviderGroup(input: CreateProviderGroupInput): Promise<ProviderGroup> {
  const maxSort = await db
    .select({ value: sql<number>`coalesce(max(${providerGroups.sortOrder}), 0)` })
    .from(providerGroups);
  const nextSort =
    input.sortOrder !== undefined && Number.isFinite(input.sortOrder)
      ? Math.trunc(input.sortOrder)
      : Number(maxSort[0]?.value ?? 0) + 10;

  const [row] = await db
    .insert(providerGroups)
    .values({
      name: input.name,
      costMultiplier: input.costMultiplier?.toString() ?? "1.0",
      description: input.description ?? null,
      healthTestModel:
        input.healthTestModel != null && String(input.healthTestModel).trim()
          ? String(input.healthTestModel).trim()
          : null,
      sharedSettings: normalizeProviderGroupSharedSettings(input.sharedSettings),
      sortOrder: nextSort,
      matchRules: normalizeProviderGroupMatchRules(input.matchRules),
      modelMatchRules: normalizeProviderGroupModelMatchRules(input.modelMatchRules),
    })
    .returning();

  invalidateGroupMultiplierCache();
  return toProviderGroup(row);
}

/**
 * Update an existing provider group by id.
 * Returns null if the row does not exist.
 */
export async function updateProviderGroup(
  id: number,
  input: UpdateProviderGroupInput,
  executor: ProviderGroupMutationExecutor = db
): Promise<ProviderGroup | null> {
  const setData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (input.costMultiplier !== undefined) {
    setData.costMultiplier = input.costMultiplier.toString();
  }
  if (input.description !== undefined) {
    setData.description = input.description;
  }
  if (input.healthTestModel !== undefined) {
    const raw = input.healthTestModel;
    setData.healthTestModel =
      raw != null && String(raw).trim() ? String(raw).trim() : null;
  }
  if (input.sharedSettings !== undefined) {
    setData.sharedSettings = normalizeProviderGroupSharedSettings(input.sharedSettings);
  }
  if (input.sortOrder !== undefined && Number.isFinite(input.sortOrder)) {
    setData.sortOrder = Math.trunc(input.sortOrder);
  }
  if (input.matchRules !== undefined) {
    setData.matchRules = normalizeProviderGroupMatchRules(input.matchRules);
  }
  if (input.modelMatchRules !== undefined) {
    setData.modelMatchRules = normalizeProviderGroupModelMatchRules(input.modelMatchRules);
  }

  const [row] = await executor
    .update(providerGroups)
    .set(setData)
    .where(eq(providerGroups.id, id))
    .returning();

  if (!row) return null;

  invalidateGroupMultiplierCache();
  return toProviderGroup(row);
}

/**
 * Count how many providers reference the given group name in their groupTag.
 * Used to prevent orphaning providers when a group is deleted.
 *
 * Note: `groupTag` is a comma/newline separated string, so we parse each
 * provider's tag and count matches. Provider count is small, no optimization
 * needed.
 */
export async function countProvidersUsingGroup(name: string): Promise<number> {
  const rows = await db
    .select({ groupTag: providers.groupTag })
    .from(providers)
    .where(isNull(providers.deletedAt));

  let count = 0;
  for (const row of rows) {
    const groups = parseProviderGroups(row.groupTag);
    if (groups.includes(name)) {
      count++;
    }
  }
  return count;
}

/**
 * 批量确保给定分组名在 provider_groups 表中存在。
 *
 * 用于 source-of-truth (providers.groupTag 字符串) 向元数据侧表的写时同步。
 * 对每个不存在的分组名插入一行（使用 schema 默认倍率 1.0，description 为 null），
 * 已存在的名字走 ON CONFLICT DO NOTHING 忽略，保证幂等与并发安全。
 *
 * 不触发 audit——这是系统级同步，非用户显式操作。
 */
export async function ensureProviderGroupsExist(names: string[]): Promise<void> {
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter((n) => n.length > 0)));
  if (unique.length === 0) return;

  await db
    .insert(providerGroups)
    .values(unique.map((name) => ({ name })))
    .onConflictDoNothing({ target: providerGroups.name });

  invalidateGroupMultiplierCache();
}

/**
 * Delete a provider group by id.
 * Throws an error when attempting to delete the "default" group.
 */
export async function deleteProviderGroup(id: number): Promise<void> {
  // Look up the group to check its name before deleting.
  const [existing] = await db
    .select({ name: providerGroups.name })
    .from(providerGroups)
    .where(eq(providerGroups.id, id))
    .limit(1);

  if (existing?.name === PROVIDER_GROUP.DEFAULT) {
    throw new Error("Cannot delete the default provider group");
  }

  await db.delete(providerGroups).where(eq(providerGroups.id, id));
  invalidateGroupMultiplierCache();
}

/**
 * Persist a full non-default group order. `orderedIds` is top-to-bottom match priority.
 * The default group keeps sort_order=0 and is never reordered here.
 */
export async function reorderProviderGroups(orderedIds: number[]): Promise<ProviderGroup[]> {
  const uniqueIds = Array.from(
    new Set(orderedIds.filter((id) => Number.isInteger(id) && id > 0))
  );
  if (uniqueIds.length === 0) {
    return findAllProviderGroups();
  }

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: providerGroups.id, name: providerGroups.name })
      .from(providerGroups)
      .where(inArray(providerGroups.id, uniqueIds));

    const byId = new Map(rows.map((row) => [row.id, row]));
    let rank = 10;
    for (const id of uniqueIds) {
      const row = byId.get(id);
      if (!row || row.name === PROVIDER_GROUP.DEFAULT) continue;
      await tx
        .update(providerGroups)
        .set({ sortOrder: rank, updatedAt: new Date() })
        .where(eq(providerGroups.id, id));
      rank += 10;
    }
  });

  invalidateGroupMultiplierCache();
  return findAllProviderGroups();
}

// ---------------------------------------------------------------------------
// Hot-path helper (cached)
// ---------------------------------------------------------------------------

/**
 * Return the cost multiplier for an effective provider group string.
 *
 * The input can be a single group name ("premium") or a comma/newline
 * separated list as stored on users / keys ("premium,enterprise").
 *
 * Resolution policy: the first group in the parsed list that exists in the
 * provider_groups table wins. This gives users and admins a predictable
 * ordering (the user's first-declared group takes precedence).
 *
 * Falls back to 1.0 when none of the groups exist.
 *
 * Results are cached in-memory with a 60-second TTL so that the proxy
 * pipeline can call this on every request without extra DB round-trips.
 * Cache misses (value === 1.0 because no matching row was found) are NOT
 * cached, so newly-created groups propagate on the next request.
 *
 * Note: this cache is per-process. In multi-instance deployments, a mutation
 * on one node will not invalidate other nodes' caches; worst-case staleness
 * is bounded by CACHE_TTL_MS.
 */
export async function getGroupCostMultiplier(rawGroupString: string): Promise<number> {
  const now = Date.now();

  // Cache hit fast-path: we key the cache on the raw input string so that
  // repeated lookups for the same user bypass parsing + DB entirely.
  const cached = multiplierCache.get(rawGroupString);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  if (cached) {
    multiplierCache.delete(rawGroupString);
  }

  const parsedGroups = parseProviderGroups(rawGroupString);
  if (parsedGroups.length === 0) {
    return 1.0;
  }

  const rows = await db
    .select({
      name: providerGroups.name,
      costMultiplier: providerGroups.costMultiplier,
    })
    .from(providerGroups)
    .where(inArray(providerGroups.name, parsedGroups));

  const multiplierByName = new Map(rows.map((row) => [row.name, Number(row.costMultiplier)]));

  let resolved: number | null = null;
  for (const name of parsedGroups) {
    const multiplier = multiplierByName.get(name);
    if (multiplier !== undefined) {
      resolved = multiplier;
      break;
    }
  }

  // Only cache real hits. Caching misses would defer new-group visibility by
  // up to CACHE_TTL_MS on this process and is rarely worth the win.
  if (resolved !== null) {
    multiplierCache.set(rawGroupString, {
      value: resolved,
      expiresAt: now + CACHE_TTL_MS,
    });
    return resolved;
  }

  return 1.0;
}


/**
 * Resolve scheduled health-test model for a provider based on its groupTag(s).
 * First matching non-empty group.healthTestModel wins (group name order as in tag).
 * Returns null when no configured group model → scheduled tests should skip.
 */
export async function resolveHealthTestModelForProviderGroups(
  groupTag: string | null | undefined
): Promise<string | null> {
  const tags = parseProviderGroups(groupTag);
  if (tags.length === 0) return null;

  const rows = await db
    .select({
      name: providerGroups.name,
      healthTestModel: providerGroups.healthTestModel,
    })
    .from(providerGroups)
    .where(inArray(providerGroups.name, tags));

  const byName = new Map(
    rows.map((r) => [
      r.name,
      r.healthTestModel != null && String(r.healthTestModel).trim()
        ? String(r.healthTestModel).trim()
        : null,
    ])
  );

  for (const tag of tags) {
    const model = byName.get(tag);
    if (model) return model;
  }
  return null;
}

/**
 * Map group name → healthTestModel for bulk scheduler filtering.
 */
export async function getProviderGroupHealthTestModelMap(): Promise<Map<string, string | null>> {
  const rows = await db
    .select({
      name: providerGroups.name,
      healthTestModel: providerGroups.healthTestModel,
    })
    .from(providerGroups);
  const map = new Map<string, string | null>();
  for (const r of rows) {
    map.set(
      r.name,
      r.healthTestModel != null && String(r.healthTestModel).trim()
        ? String(r.healthTestModel).trim()
        : null
    );
  }
  return map;
}


/**
 * Apply group shared_settings onto all non-deleted providers whose groupTag
 * includes the group name. Returns number of providers updated.
 */
export async function applyProviderGroupSharedSettingsToMembers(
  groupName: string,
  sharedSettings: import("@/lib/provider-groups/shared-settings").ProviderGroupSharedSettings | null
): Promise<number> {
  const { sharedSettingsToProviderPatch } = await import(
    "@/lib/provider-groups/shared-settings"
  );
  const patch = sharedSettingsToProviderPatch(sharedSettings);
  if (Object.keys(patch).length === 0) return 0;

  const rows = await db
    .select({ id: providers.id, groupTag: providers.groupTag })
    .from(providers)
    .where(isNull(providers.deletedAt));

  const ids: number[] = [];
  for (const row of rows) {
    const tags = parseProviderGroups(row.groupTag);
    if (tags.includes(groupName)) ids.push(row.id);
  }
  if (ids.length === 0) return 0;

  await db
    .update(providers)
    .set({ ...patch, updatedAt: new Date() })
    .where(inArray(providers.id, ids));

  return ids.length;
}
