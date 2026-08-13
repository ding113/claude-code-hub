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
import type { ProviderGroupSharedSettings } from "@/lib/provider-groups/shared-settings";
import { normalizeProviderGroupSharedSettings } from "@/lib/provider-groups/shared-settings";
import {
  firstProviderGroupHealthTestModel,
  normalizeProviderGroupHealthTestModels,
  resolveProviderGroupHealthTestModelFallback,
} from "@/lib/provider-health-test/model-config";
import { parseProviderGroups, resolveProviderGroupsWithDefault } from "@/lib/utils/provider-group";
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
type ProviderGroupMutationExecutor = Pick<TransactionExecutor, "select" | "update">;

function toProviderGroup(row: ProviderGroupRow): ProviderGroup {
  const healthTestModels = normalizeProviderGroupHealthTestModels(
    row.healthTestModels,
    row.healthTestModel
  );
  return {
    id: row.id,
    name: row.name,
    costMultiplier: Number(row.costMultiplier),
    description: row.description ?? null,
    healthTestModel: firstProviderGroupHealthTestModel(healthTestModels),
    healthTestModels,
    healthTestModelFallback: resolveProviderGroupHealthTestModelFallback(
      row.healthTestModelFallback,
      healthTestModels
    ),
    sharedSettings: normalizeProviderGroupSharedSettings(row.sharedSettings),
    sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : 0,
    matchRules: normalizeProviderGroupMatchRules(row.matchRules),
    modelMatchRules: normalizeProviderGroupModelMatchRules(row.modelMatchRules),
    whitelistProviderIds: row.whitelistProviderIds ?? null,
    blacklistProviderIds: row.blacklistProviderIds ?? null,
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
let groupSharedSettingsCache: {
  value: ReadonlyMap<string, ProviderGroupSharedSettings | null>;
  expiresAt: number;
} | null = null;
let healthTestModelsCache: {
  value: ReadonlyMap<string, string[]>;
  expiresAt: number;
} | null = null;
let healthTestModelFallbackCache: {
  value: ReadonlyMap<string, string | null>;
  expiresAt: number;
} | null = null;

let allowBlockListsCache: {
  value: ReadonlyMap<string, { whitelist: number[] | null; blacklist: number[] | null }>;
  expiresAt: number;
} | null = null;

/**
 * Invalidate the in-memory cost multiplier cache.
 * Call this after any mutation (create / update / delete) to provider groups.
 */
export function invalidateGroupMultiplierCache(): void {
  multiplierCache.clear();
  modelMatchRulesCache = null;
  groupSharedSettingsCache = null;
  healthTestModelsCache = null;
  healthTestModelFallbackCache = null;
  allowBlockListsCache = null;
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

/**
 * Return cached shared-settings (incl. explicit providerType: null = "accept all
 * request formats") for all provider groups, keyed by group name.
 *
 * `providerType === null` is the explicit "不覆盖" marker written by the group UI:
 * the router treats it as "accept every client request format" for member
 * providers. A missing key means the group never set a format policy.
 */
export async function getProviderGroupSharedSettingsMap(): Promise<
  ReadonlyMap<string, ProviderGroupSharedSettings | null>
> {
  const now = Date.now();
  if (groupSharedSettingsCache && groupSharedSettingsCache.expiresAt > now) {
    return groupSharedSettingsCache.value;
  }

  const rows = await db
    .select({ name: providerGroups.name, sharedSettings: providerGroups.sharedSettings })
    .from(providerGroups);
  const value = new Map(
    rows.map((row) => [row.name, normalizeProviderGroupSharedSettings(row.sharedSettings)])
  );
  groupSharedSettingsCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/**
 * Cached map of group name → { whitelist, blacklist } provider id arrays.
 * Used by the dispatch layer to apply per-group allow/block filters.
 */
export async function getProviderGroupAllowBlockListsMap(): Promise<
  ReadonlyMap<string, { whitelist: number[] | null; blacklist: number[] | null }>
> {
  const now = Date.now();
  if (allowBlockListsCache && allowBlockListsCache.expiresAt > now) {
    return allowBlockListsCache.value;
  }

  const rows = await db
    .select({
      name: providerGroups.name,
      whitelist: providerGroups.whitelistProviderIds,
      blacklist: providerGroups.blacklistProviderIds,
    })
    .from(providerGroups);
  const value = new Map(
    rows.map((row) => [
      row.name,
      {
        whitelist: row.whitelist ?? null,
        blacklist: row.blacklist ?? null,
      },
    ])
  );
  allowBlockListsCache = { value, expiresAt: now + CACHE_TTL_MS };
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

  const models = normalizeProviderGroupHealthTestModels(
    input.healthTestModels,
    input.healthTestModel
  );
  const healthTestModelFallback = resolveProviderGroupHealthTestModelFallback(
    input.healthTestModelFallback,
    models,
    input.healthTestModel
  );
  const [row] = await db
    .insert(providerGroups)
    .values({
      name: input.name,
      costMultiplier: input.costMultiplier?.toString() ?? "1.0",
      description: input.description ?? null,
      healthTestModel: models[0] ?? null,
      healthTestModels: models.length > 0 ? models : null,
      healthTestModelFallback,
      sharedSettings: normalizeProviderGroupSharedSettings(input.sharedSettings),
      sortOrder: nextSort,
      matchRules: normalizeProviderGroupMatchRules(input.matchRules),
      modelMatchRules: normalizeProviderGroupModelMatchRules(input.modelMatchRules),
      whitelistProviderIds:
        input.whitelistProviderIds !== undefined ? input.whitelistProviderIds : null,
      blacklistProviderIds:
        input.blacklistProviderIds !== undefined ? input.blacklistProviderIds : null,
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
  if (input.healthTestModels !== undefined || input.healthTestModel !== undefined) {
    const models = normalizeProviderGroupHealthTestModels(
      input.healthTestModels,
      input.healthTestModel
    );
    setData.healthTestModel = models[0] ?? null;
    setData.healthTestModels = models.length > 0 ? models : null;
    setData.healthTestModelFallback = resolveProviderGroupHealthTestModelFallback(
      input.healthTestModelFallback,
      models,
      input.healthTestModel
    );
  } else if (input.healthTestModelFallback !== undefined) {
    const existing = await findProviderGroupById(id, executor);
    const existingModels = existing?.healthTestModels ?? [];
    setData.healthTestModelFallback = resolveProviderGroupHealthTestModelFallback(
      input.healthTestModelFallback,
      existingModels,
      existing?.healthTestModel
    );
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
  if (input.whitelistProviderIds !== undefined) {
    setData.whitelistProviderIds = input.whitelistProviderIds;
  }
  if (input.blacklistProviderIds !== undefined) {
    setData.blacklistProviderIds = input.blacklistProviderIds;
  }

  const [row] = await executor
    .update(providerGroups)
    .set(setData)
    .where(eq(providerGroups.id, id))
    .returning();

  if (!row) return null;

  // 分组测试模型被清空时，同步清空该分组关联 provider 的残留健康测试记录，
  // 避免调度仍依据旧快照判定“合格”并优先选择。
  if (input.healthTestModels !== undefined || input.healthTestModel !== undefined) {
    const models = normalizeProviderGroupHealthTestModels(
      input.healthTestModels,
      input.healthTestModel
    );
    if (models.length === 0) {
      const [groupRow] = await executor
        .select({ name: providerGroups.name })
        .from(providerGroups)
        .where(eq(providerGroups.id, id))
        .limit(1);
      if (groupRow) {
        await clearProviderHealthTestRecordsForGroup(groupRow.name, executor);
      }
    }
  }

  invalidateGroupMultiplierCache();
  return toProviderGroup(row);
}

/**
 * 清空指定分组关联 provider 的健康测试快照字段。
 *
 * 仅当 provider 的所有关联分组（groupTag 解析出的全部组）都不再配置
 * 任何测试模型时，才清空其记录；只要还有一个分组仍有测试模型，保留。
 * 不清空 scheduledHealthTestEnabled / budget / SLO 自动禁用等开关状态。
 */
export async function clearProviderHealthTestRecordsForGroup(
  groupName: string,
  executor: ProviderGroupMutationExecutor = db
): Promise<number> {
  const providerRows = await executor
    .select({ id: providers.id, groupTag: providers.groupTag })
    .from(providers)
    .where(isNull(providers.deletedAt));

  const groupRows = await executor
    .select({
      name: providerGroups.name,
      healthTestModel: providerGroups.healthTestModel,
      healthTestModels: providerGroups.healthTestModels,
    })
    .from(providerGroups);
  const modelsByGroup = new Map(
    groupRows.map((r) => [
      r.name,
      normalizeProviderGroupHealthTestModels(r.healthTestModels, r.healthTestModel),
    ])
  );

  const targets: number[] = [];
  for (const providerRow of providerRows) {
    const tags = resolveProviderGroupsWithDefault(providerRow.groupTag);
    if (!tags.includes(groupName)) continue;
    const hasAnyModel = tags.some((tag) => (modelsByGroup.get(tag) ?? []).length > 0);
    if (!hasAnyModel) targets.push(providerRow.id);
  }

  if (targets.length === 0) return 0;

  await executor
    .update(providers)
    .set({
      lastHealthTestAt: null,
      lastHealthTestOk: null,
      lastHealthTestStatus: null,
      lastHealthTestFirstByteMs: null,
      lastHealthTestLatencyMs: null,
      lastHealthTestModel: null,
      lastHealthTestErrorType: null,
      lastHealthTestErrorMessage: null,
      healthTestOnlineRate: null,
      healthTestAvgFirstByteMs: null,
      healthTestRecentResults: null,
      healthTestModelStats: null,
      healthTestTodayCostUsd: null,
      healthTestTodayCalls: 0,
      healthTestTodayDate: null,
      updatedAt: new Date(),
    })
    .where(inArray(providers.id, targets));

  try {
    const { publishProviderCacheInvalidation } = await import("@/lib/cache/provider-cache");
    await publishProviderCacheInvalidation();
  } catch {
    // best-effort
  }

  return targets.length;
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
 *
 * 删除分组时自动解除引用：从所有 groupTag 包含该分组名的 provider 中
 * 移除该组名（若移除后为空则置 null / default），避免出现悬空引用。
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

  if (!existing) return;

  // 分组删除后，其关联 provider 若不再属于任何仍有测试模型的分组，
  // 同步清空残留健康测试记录，避免调度仍依据旧快照判定“合格”。
  // 注意：必须在解绑（移除 groupTag 中的组名）之前执行，
  // 因为匹配依赖 provider.groupTag 仍包含该组名。
  await clearProviderHealthTestRecordsForGroup(existing.name);

  // 自动解绑：从所有引用该分组的 provider.groupTag 中移除该组名。
  const providerRows = await db
    .select({ id: providers.id, groupTag: providers.groupTag })
    .from(providers)
    .where(isNull(providers.deletedAt));

  let changed = 0;
  for (const row of providerRows) {
    const groups = parseProviderGroups(row.groupTag);
    if (!groups.includes(existing.name)) continue;
    const remaining = groups.filter((g) => g !== existing.name);
    const newTag = remaining.length === 0 ? null : remaining.join(",");
    if (newTag === row.groupTag) continue;
    await db
      .update(providers)
      .set({ groupTag: newTag, updatedAt: new Date() })
      .where(eq(providers.id, row.id));
    changed++;
  }

  if (changed > 0) {
    try {
      const { publishProviderCacheInvalidation } = await import("@/lib/cache/provider-cache");
      await publishProviderCacheInvalidation();
    } catch {
      // best-effort
    }
  }
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
  const tags = resolveProviderGroupsWithDefault(groupTag);
  if (tags.length === 0) return null;

  const rows = await db
    .select({
      name: providerGroups.name,
      healthTestModel: providerGroups.healthTestModel,
      healthTestModels: providerGroups.healthTestModels,
    })
    .from(providerGroups)
    .where(inArray(providerGroups.name, tags));

  const byName = new Map(
    rows.map((r) => [
      r.name,
      firstProviderGroupHealthTestModel(r.healthTestModels, r.healthTestModel),
    ])
  );

  for (const tag of tags) {
    const model = byName.get(tag);
    if (model) return model;
  }
  return null;
}

/**
 * Map group name → all configured scheduled health-test models.
 */
export async function getProviderGroupHealthTestModelsMap(): Promise<
  ReadonlyMap<string, string[]>
> {
  const now = Date.now();
  if (healthTestModelsCache && healthTestModelsCache.expiresAt > now) {
    return healthTestModelsCache.value;
  }

  const rows = await db
    .select({
      name: providerGroups.name,
      healthTestModel: providerGroups.healthTestModel,
      healthTestModels: providerGroups.healthTestModels,
    })
    .from(providerGroups);
  const value = new Map(
    rows.map((r) => [
      r.name,
      normalizeProviderGroupHealthTestModels(r.healthTestModels, r.healthTestModel),
    ])
  );
  healthTestModelsCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/**
 * Map group name → the first configured health-test model for legacy callers.
 */
export async function getProviderGroupHealthTestModelMap(): Promise<Map<string, string | null>> {
  const models = await getProviderGroupHealthTestModelsMap();
  return new Map(Array.from(models.entries()).map(([name, list]) => [name, list[0] ?? null]));
}

/** Map group name → the configured baseline model for non-test requests/displays. */
export async function getProviderGroupHealthTestModelFallbackMap(): Promise<
  ReadonlyMap<string, string | null>
> {
  const now = Date.now();
  if (healthTestModelFallbackCache && healthTestModelFallbackCache.expiresAt > now) {
    return healthTestModelFallbackCache.value;
  }

  const rows = await db
    .select({
      name: providerGroups.name,
      healthTestModel: providerGroups.healthTestModel,
      healthTestModels: providerGroups.healthTestModels,
      healthTestModelFallback: providerGroups.healthTestModelFallback,
    })
    .from(providerGroups);
  const value = new Map(
    rows.map((row) => {
      const models = normalizeProviderGroupHealthTestModels(
        row.healthTestModels,
        row.healthTestModel
      );
      return [
        row.name,
        resolveProviderGroupHealthTestModelFallback(row.healthTestModelFallback, models),
      ] as const;
    })
  );
  healthTestModelFallbackCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
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
