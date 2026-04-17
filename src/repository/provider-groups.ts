import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerGroups, providers } from "@/drizzle/schema";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
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

function toProviderGroup(row: ProviderGroupRow): ProviderGroup {
  return {
    id: row.id,
    name: row.name,
    costMultiplier: Number(row.costMultiplier),
    description: row.description ?? null,
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

/**
 * Invalidate the in-memory cost multiplier cache.
 * Call this after any mutation (create / update / delete) to provider groups.
 */
export function invalidateGroupMultiplierCache(): void {
  multiplierCache.clear();
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

/**
 * Return all provider groups sorted by name, with "default" always first.
 */
export async function findAllProviderGroups(): Promise<ProviderGroup[]> {
  const rows = await db
    .select()
    .from(providerGroups)
    .orderBy(
      sql`CASE WHEN ${providerGroups.name} = ${PROVIDER_GROUP.DEFAULT} THEN 0 ELSE 1 END`,
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
export async function findProviderGroupById(id: number): Promise<ProviderGroup | null> {
  const [row] = await db.select().from(providerGroups).where(eq(providerGroups.id, id)).limit(1);

  return row ? toProviderGroup(row) : null;
}

// ---------------------------------------------------------------------------
// Mutation functions
// ---------------------------------------------------------------------------

/**
 * Create a new provider group.
 */
export async function createProviderGroup(input: CreateProviderGroupInput): Promise<ProviderGroup> {
  const [row] = await db
    .insert(providerGroups)
    .values({
      name: input.name,
      costMultiplier: input.costMultiplier?.toString() ?? "1.0",
      description: input.description ?? null,
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
  input: UpdateProviderGroupInput
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

  const [row] = await db
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
  const rows = await db.select({ groupTag: providers.groupTag }).from(providers);

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

  const parsedGroups = parseProviderGroups(rawGroupString);
  if (parsedGroups.length === 0) {
    return 1.0;
  }

  // Walk the user's declared groups in order; the first matching DB row wins.
  let resolved: number | null = null;
  for (const name of parsedGroups) {
    const group = await findProviderGroupByName(name);
    if (group) {
      resolved = group.costMultiplier;
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
