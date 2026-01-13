"use server";

import { and, asc, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/drizzle/db";
import {
  providerEndpointProbeEvents,
  providerEndpoints,
  providers,
  providerVendors,
} from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import type { ProviderType, ProviderVendor } from "@/types/provider";
import { toProviderVendor } from "./_shared/transformers";

export async function findProviderVendorById(id: number): Promise<ProviderVendor | null> {
  const [row] = await db
    .select({
      id: providerVendors.id,
      vendorKey: providerVendors.vendorKey,
      displayName: providerVendors.displayName,
      websiteUrl: providerVendors.websiteUrl,
      faviconUrl: providerVendors.faviconUrl,
      isEnabled: providerVendors.isEnabled,
      createdAt: providerVendors.createdAt,
      updatedAt: providerVendors.updatedAt,
      deletedAt: providerVendors.deletedAt,
    })
    .from(providerVendors)
    .where(and(eq(providerVendors.id, id), isNull(providerVendors.deletedAt)));

  return row ? toProviderVendor(row) : null;
}

export async function findProviderVendorByVendorKey(
  vendorKey: string
): Promise<ProviderVendor | null> {
  const [row] = await db
    .select({
      id: providerVendors.id,
      vendorKey: providerVendors.vendorKey,
      displayName: providerVendors.displayName,
      websiteUrl: providerVendors.websiteUrl,
      faviconUrl: providerVendors.faviconUrl,
      isEnabled: providerVendors.isEnabled,
      createdAt: providerVendors.createdAt,
      updatedAt: providerVendors.updatedAt,
      deletedAt: providerVendors.deletedAt,
    })
    .from(providerVendors)
    .where(and(eq(providerVendors.vendorKey, vendorKey), isNull(providerVendors.deletedAt)));

  return row ? toProviderVendor(row) : null;
}

export async function findAllProviderVendors(): Promise<ProviderVendor[]> {
  const rows = await db
    .select({
      id: providerVendors.id,
      vendorKey: providerVendors.vendorKey,
      displayName: providerVendors.displayName,
      websiteUrl: providerVendors.websiteUrl,
      faviconUrl: providerVendors.faviconUrl,
      isEnabled: providerVendors.isEnabled,
      createdAt: providerVendors.createdAt,
      updatedAt: providerVendors.updatedAt,
      deletedAt: providerVendors.deletedAt,
    })
    .from(providerVendors)
    .where(isNull(providerVendors.deletedAt))
    .orderBy(asc(providerVendors.displayName));

  return rows.map(toProviderVendor);
}

export type ProviderVendorSummary = ProviderVendor & {
  providerCount: number;
  endpointCount: number;
};

export async function findProviderVendorSummaries(): Promise<ProviderVendorSummary[]> {
  const vendors = await findAllProviderVendors();
  if (vendors.length === 0) return [];

  const vendorIds = vendors.map((v) => v.id);

  const providerCounts = await db
    .select({
      vendorId: providers.vendorId,
      providerCount: count(providers.id),
    })
    .from(providers)
    .where(
      and(
        inArray(providers.vendorId, vendorIds),
        isNull(providers.deletedAt),
        isNotNull(providers.vendorId)
      )
    )
    .groupBy(providers.vendorId);

  const endpointCounts = await db
    .select({
      vendorId: providerEndpoints.vendorId,
      endpointCount: count(providerEndpoints.id),
    })
    .from(providerEndpoints)
    .where(and(inArray(providerEndpoints.vendorId, vendorIds), isNull(providerEndpoints.deletedAt)))
    .groupBy(providerEndpoints.vendorId);

  const providerCountMap = new Map<number, number>();
  for (const row of providerCounts) {
    if (row.vendorId !== null) providerCountMap.set(row.vendorId, row.providerCount);
  }

  const endpointCountMap = new Map<number, number>();
  for (const row of endpointCounts) {
    endpointCountMap.set(row.vendorId, row.endpointCount);
  }

  return vendors.map((v) => ({
    ...v,
    providerCount: providerCountMap.get(v.id) ?? 0,
    endpointCount: endpointCountMap.get(v.id) ?? 0,
  }));
}

export async function createProviderVendor(data: {
  vendorKey: string;
  displayName: string;
  websiteUrl?: string | null;
  faviconUrl?: string | null;
  isEnabled?: boolean;
}): Promise<ProviderVendor> {
  const [row] = await db
    .insert(providerVendors)
    .values({
      vendorKey: data.vendorKey,
      displayName: data.displayName,
      websiteUrl: data.websiteUrl ?? null,
      faviconUrl: data.faviconUrl ?? null,
      isEnabled: data.isEnabled ?? true,
    })
    .returning({
      id: providerVendors.id,
      vendorKey: providerVendors.vendorKey,
      displayName: providerVendors.displayName,
      websiteUrl: providerVendors.websiteUrl,
      faviconUrl: providerVendors.faviconUrl,
      isEnabled: providerVendors.isEnabled,
      createdAt: providerVendors.createdAt,
      updatedAt: providerVendors.updatedAt,
      deletedAt: providerVendors.deletedAt,
    });

  return toProviderVendor(row);
}

export async function updateProviderVendor(
  id: number,
  patch: {
    displayName?: string;
    websiteUrl?: string | null;
    faviconUrl?: string | null;
    isEnabled?: boolean;
  }
): Promise<ProviderVendor | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbPatch: any = { updatedAt: new Date() };
  if (patch.displayName !== undefined) dbPatch.displayName = patch.displayName;
  if (patch.websiteUrl !== undefined) dbPatch.websiteUrl = patch.websiteUrl;
  if (patch.faviconUrl !== undefined) dbPatch.faviconUrl = patch.faviconUrl;
  if (patch.isEnabled !== undefined) dbPatch.isEnabled = patch.isEnabled;

  const [row] = await db
    .update(providerVendors)
    .set(dbPatch)
    .where(and(eq(providerVendors.id, id), isNull(providerVendors.deletedAt)))
    .returning({
      id: providerVendors.id,
      vendorKey: providerVendors.vendorKey,
      displayName: providerVendors.displayName,
      websiteUrl: providerVendors.websiteUrl,
      faviconUrl: providerVendors.faviconUrl,
      isEnabled: providerVendors.isEnabled,
      createdAt: providerVendors.createdAt,
      updatedAt: providerVendors.updatedAt,
      deletedAt: providerVendors.deletedAt,
    });

  return row ? toProviderVendor(row) : null;
}

export async function ensureProviderVendor(input: {
  vendorKey: string;
  websiteUrl?: string | null;
  faviconUrl?: string | null;
}): Promise<ProviderVendor> {
  const existing = await findProviderVendorByVendorKey(input.vendorKey);
  if (existing) {
    const shouldPatchWebsite = !existing.websiteUrl && input.websiteUrl;
    const shouldPatchFavicon = !existing.faviconUrl && input.faviconUrl;

    if (shouldPatchWebsite || shouldPatchFavicon) {
      const updated = await updateProviderVendor(existing.id, {
        websiteUrl: shouldPatchWebsite ? (input.websiteUrl ?? null) : undefined,
        faviconUrl: shouldPatchFavicon ? (input.faviconUrl ?? null) : undefined,
      });

      if (updated) {
        return updated;
      }

      logger.warn("ensureProviderVendor: failed to patch vendor metadata", {
        vendorId: existing.id,
        vendorKey: input.vendorKey,
      });
    }

    return existing;
  }

  return createProviderVendor({
    vendorKey: input.vendorKey,
    displayName: input.vendorKey,
    websiteUrl: input.websiteUrl ?? null,
    faviconUrl: input.faviconUrl ?? null,
    isEnabled: true,
  });
}

export type MergeProviderVendorsResult = {
  targetVendorId: number;
  sourceVendorIds: number[];
  movedProviders: number;
  movedEndpoints: number;
  dedupedEndpoints: number;
  reattachedProbeEvents: number;
  deletedVendors: number;
};

export async function mergeProviderVendors(input: {
  targetVendorId: number;
  sourceVendorIds: number[];
}): Promise<MergeProviderVendorsResult> {
  const normalizedSources = Array.from(
    new Set(input.sourceVendorIds.filter((id) => id !== input.targetVendorId))
  );

  if (normalizedSources.length === 0) {
    return {
      targetVendorId: input.targetVendorId,
      sourceVendorIds: [],
      movedProviders: 0,
      movedEndpoints: 0,
      dedupedEndpoints: 0,
      reattachedProbeEvents: 0,
      deletedVendors: 0,
    };
  }

  const now = new Date();

  return await db.transaction(async (tx) => {
    const [targetVendor] = await tx
      .select({ id: providerVendors.id })
      .from(providerVendors)
      .where(and(eq(providerVendors.id, input.targetVendorId), isNull(providerVendors.deletedAt)))
      .limit(1);

    if (!targetVendor) {
      throw new Error("target vendor not found");
    }

    const existingSourceVendors = await tx
      .select({ id: providerVendors.id })
      .from(providerVendors)
      .where(
        and(inArray(providerVendors.id, normalizedSources), isNull(providerVendors.deletedAt))
      );

    const existingSourceIds = existingSourceVendors.map((v) => v.id);

    if (existingSourceIds.length === 0) {
      return {
        targetVendorId: input.targetVendorId,
        sourceVendorIds: [],
        movedProviders: 0,
        movedEndpoints: 0,
        dedupedEndpoints: 0,
        reattachedProbeEvents: 0,
        deletedVendors: 0,
      };
    }

    const movedProviders = await tx
      .update(providers)
      .set({ vendorId: input.targetVendorId, updatedAt: now })
      .where(and(inArray(providers.vendorId, existingSourceIds), isNull(providers.deletedAt)))
      .returning({ id: providers.id });

    const sourceEndpoints = await tx
      .select({
        id: providerEndpoints.id,
        vendorId: providerEndpoints.vendorId,
        providerType: providerEndpoints.providerType,
        baseUrl: providerEndpoints.baseUrl,
      })
      .from(providerEndpoints)
      .where(
        and(
          inArray(providerEndpoints.vendorId, existingSourceIds),
          isNull(providerEndpoints.deletedAt)
        )
      );

    const targetEndpoints = await tx
      .select({
        id: providerEndpoints.id,
        providerType: providerEndpoints.providerType,
        baseUrl: providerEndpoints.baseUrl,
      })
      .from(providerEndpoints)
      .where(
        and(
          eq(providerEndpoints.vendorId, input.targetVendorId),
          isNull(providerEndpoints.deletedAt)
        )
      );

    const keyOf = (p: { providerType: ProviderType; baseUrl: string }) =>
      `${p.providerType}|${p.baseUrl}`;

    const endpointKeyToId = new Map<string, number>();
    for (const e of targetEndpoints) {
      endpointKeyToId.set(
        keyOf({ providerType: e.providerType as ProviderType, baseUrl: e.baseUrl }),
        e.id
      );
    }

    let movedEndpointsCount = 0;
    let dedupedEndpointsCount = 0;
    let reattachedProbeEventsCount = 0;

    for (const endpoint of sourceEndpoints) {
      const endpointKey = keyOf({
        providerType: endpoint.providerType as ProviderType,
        baseUrl: endpoint.baseUrl,
      });
      const existingTargetEndpointId = endpointKeyToId.get(endpointKey);

      if (existingTargetEndpointId) {
        const updatedEvents = await tx
          .update(providerEndpointProbeEvents)
          .set({ endpointId: existingTargetEndpointId })
          .where(eq(providerEndpointProbeEvents.endpointId, endpoint.id))
          .returning({ id: providerEndpointProbeEvents.id });

        reattachedProbeEventsCount += updatedEvents.length;

        await tx
          .update(providerEndpoints)
          .set({ deletedAt: now, isEnabled: false, updatedAt: now })
          .where(and(eq(providerEndpoints.id, endpoint.id), isNull(providerEndpoints.deletedAt)));

        dedupedEndpointsCount++;
        continue;
      }

      await tx
        .update(providerEndpoints)
        .set({ vendorId: input.targetVendorId, updatedAt: now })
        .where(and(eq(providerEndpoints.id, endpoint.id), isNull(providerEndpoints.deletedAt)));

      endpointKeyToId.set(endpointKey, endpoint.id);
      movedEndpointsCount++;
    }

    const deletedVendors = await tx
      .update(providerVendors)
      .set({ deletedAt: now, isEnabled: false, updatedAt: now })
      .where(and(inArray(providerVendors.id, existingSourceIds), isNull(providerVendors.deletedAt)))
      .returning({ id: providerVendors.id });

    return {
      targetVendorId: input.targetVendorId,
      sourceVendorIds: existingSourceIds,
      movedProviders: movedProviders.length,
      movedEndpoints: movedEndpointsCount,
      dedupedEndpoints: dedupedEndpointsCount,
      reattachedProbeEvents: reattachedProbeEventsCount,
      deletedVendors: deletedVendors.length,
    };
  });
}

export type SplitProviderVendorResult = {
  sourceVendorId: number;
  newVendor: ProviderVendor;
  movedProviderIds: number[];
  ensuredEndpoints: number;
};

export async function splitProviderVendor(input: {
  sourceVendorId: number;
  newVendorKey: string;
  newDisplayName: string;
  websiteUrl?: string | null;
  faviconUrl?: string | null;
  providerIdsToMove: number[];
}): Promise<SplitProviderVendorResult> {
  const providerIdsToMove = Array.from(new Set(input.providerIdsToMove));
  const now = new Date();

  return await db.transaction(async (tx) => {
    const [sourceVendor] = await tx
      .select({ id: providerVendors.id })
      .from(providerVendors)
      .where(and(eq(providerVendors.id, input.sourceVendorId), isNull(providerVendors.deletedAt)))
      .limit(1);

    if (!sourceVendor) {
      throw new Error("source vendor not found");
    }

    const [createdVendorRow] = await tx
      .insert(providerVendors)
      .values({
        vendorKey: input.newVendorKey,
        displayName: input.newDisplayName,
        websiteUrl: input.websiteUrl ?? null,
        faviconUrl: input.faviconUrl ?? null,
        isEnabled: true,
      })
      .returning({
        id: providerVendors.id,
        vendorKey: providerVendors.vendorKey,
        displayName: providerVendors.displayName,
        websiteUrl: providerVendors.websiteUrl,
        faviconUrl: providerVendors.faviconUrl,
        isEnabled: providerVendors.isEnabled,
        createdAt: providerVendors.createdAt,
        updatedAt: providerVendors.updatedAt,
        deletedAt: providerVendors.deletedAt,
      });

    const newVendor = toProviderVendor(createdVendorRow);

    const movedProviders = providerIdsToMove.length
      ? await tx
          .update(providers)
          .set({ vendorId: newVendor.id, updatedAt: now })
          .where(
            and(
              inArray(providers.id, providerIdsToMove),
              eq(providers.vendorId, input.sourceVendorId),
              isNull(providers.deletedAt)
            )
          )
          .returning({
            id: providers.id,
            url: providers.url,
            providerType: providers.providerType,
          })
      : [];

    let ensuredEndpoints = 0;

    for (const p of movedProviders) {
      await tx
        .insert(providerEndpoints)
        .values({
          vendorId: newVendor.id,
          providerType: (p.providerType || "claude") as ProviderType,
          baseUrl: p.url,
          isEnabled: true,
          priority: 0,
          weight: 1,
        })
        .onConflictDoNothing();

      ensuredEndpoints++;
    }

    return {
      sourceVendorId: input.sourceVendorId,
      newVendor,
      movedProviderIds: movedProviders.map((p) => p.id),
      ensuredEndpoints,
    };
  });
}
