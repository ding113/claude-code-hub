import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerGroups } from "@/drizzle/schema";
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
      sql`CASE WHEN ${providerGroups.name} = 'default' THEN 0 ELSE 1 END`,
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

  if (existing?.name === "default") {
    throw new Error("Cannot delete the default provider group");
  }

  await db.delete(providerGroups).where(eq(providerGroups.id, id));
  invalidateGroupMultiplierCache();
}

// ---------------------------------------------------------------------------
// Hot-path helper (cached)
// ---------------------------------------------------------------------------

/**
 * Return the cost multiplier for a provider group.
 * Falls back to 1.0 when the group does not exist.
 *
 * Results are cached in-memory with a 60-second TTL so that the proxy
 * pipeline can call this on every request without extra DB round-trips.
 */
export async function getGroupCostMultiplier(groupName: string): Promise<number> {
  const now = Date.now();
  const cached = multiplierCache.get(groupName);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const group = await findProviderGroupByName(groupName);
  const value = group?.costMultiplier ?? 1.0;

  multiplierCache.set(groupName, {
    value,
    expiresAt: now + CACHE_TTL_MS,
  });

  return value;
}
