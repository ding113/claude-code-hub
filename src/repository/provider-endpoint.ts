"use server";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerEndpoints } from "@/drizzle/schema";
import type { ProviderEndpoint, ProviderType } from "@/types/provider";
import { toProviderEndpoint } from "./_shared/transformers";

const ENDPOINT_SELECT = {
  id: providerEndpoints.id,
  vendorId: providerEndpoints.vendorId,
  providerType: providerEndpoints.providerType,
  baseUrl: providerEndpoints.baseUrl,
  isEnabled: providerEndpoints.isEnabled,
  priority: providerEndpoints.priority,
  weight: providerEndpoints.weight,
  createdAt: providerEndpoints.createdAt,
  updatedAt: providerEndpoints.updatedAt,
  deletedAt: providerEndpoints.deletedAt,
} as const;

export async function findProviderEndpointById(id: number): Promise<ProviderEndpoint | null> {
  const [row] = await db
    .select(ENDPOINT_SELECT)
    .from(providerEndpoints)
    .where(and(eq(providerEndpoints.id, id), isNull(providerEndpoints.deletedAt)));

  return row ? toProviderEndpoint(row) : null;
}

export async function findProviderEndpointsByVendorIds(
  vendorIds: number[]
): Promise<ProviderEndpoint[]> {
  if (vendorIds.length === 0) return [];

  const rows = await db
    .select(ENDPOINT_SELECT)
    .from(providerEndpoints)
    .where(and(inArray(providerEndpoints.vendorId, vendorIds), isNull(providerEndpoints.deletedAt)))
    .orderBy(
      asc(providerEndpoints.vendorId),
      asc(providerEndpoints.providerType),
      asc(providerEndpoints.priority)
    );

  return rows.map(toProviderEndpoint);
}

export async function findProviderEndpointsByVendorType(
  vendorId: number,
  providerType: ProviderType
): Promise<ProviderEndpoint[]> {
  const rows = await db
    .select(ENDPOINT_SELECT)
    .from(providerEndpoints)
    .where(
      and(
        eq(providerEndpoints.vendorId, vendorId),
        eq(providerEndpoints.providerType, providerType),
        isNull(providerEndpoints.deletedAt)
      )
    )
    .orderBy(asc(providerEndpoints.priority), asc(providerEndpoints.id));

  return rows.map(toProviderEndpoint);
}

export async function createProviderEndpoint(data: {
  vendorId: number;
  providerType: ProviderType;
  baseUrl: string;
  isEnabled?: boolean;
  priority?: number;
  weight?: number;
}): Promise<ProviderEndpoint> {
  const [row] = await db
    .insert(providerEndpoints)
    .values({
      vendorId: data.vendorId,
      providerType: data.providerType,
      baseUrl: data.baseUrl,
      isEnabled: data.isEnabled ?? true,
      priority: data.priority ?? 0,
      weight: data.weight ?? 1,
    })
    .returning(ENDPOINT_SELECT);

  return toProviderEndpoint(row);
}

export async function updateProviderEndpoint(
  id: number,
  patch: {
    baseUrl?: string;
    isEnabled?: boolean;
    priority?: number;
    weight?: number;
  }
): Promise<ProviderEndpoint | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbPatch: any = { updatedAt: new Date() };
  if (patch.baseUrl !== undefined) dbPatch.baseUrl = patch.baseUrl;
  if (patch.isEnabled !== undefined) dbPatch.isEnabled = patch.isEnabled;
  if (patch.priority !== undefined) dbPatch.priority = patch.priority;
  if (patch.weight !== undefined) dbPatch.weight = patch.weight;

  const [row] = await db
    .update(providerEndpoints)
    .set(dbPatch)
    .where(and(eq(providerEndpoints.id, id), isNull(providerEndpoints.deletedAt)))
    .returning(ENDPOINT_SELECT);

  return row ? toProviderEndpoint(row) : null;
}

export async function deleteProviderEndpoint(id: number): Promise<boolean> {
  const [row] = await db
    .update(providerEndpoints)
    .set({
      deletedAt: new Date(),
      isEnabled: false,
      updatedAt: new Date(),
    })
    .where(and(eq(providerEndpoints.id, id), isNull(providerEndpoints.deletedAt)))
    .returning({ id: providerEndpoints.id });

  return !!row;
}

export async function ensureProviderEndpoint(input: {
  vendorId: number;
  providerType: ProviderType;
  baseUrl: string;
}): Promise<ProviderEndpoint> {
  await db
    .insert(providerEndpoints)
    .values({
      vendorId: input.vendorId,
      providerType: input.providerType,
      baseUrl: input.baseUrl,
      isEnabled: true,
      priority: 0,
      weight: 1,
    })
    .onConflictDoNothing();

  const rows = await findProviderEndpointsByVendorType(input.vendorId, input.providerType);
  const matched = rows.find((r) => r.baseUrl === input.baseUrl);
  if (matched) return matched;

  return await createProviderEndpoint({
    vendorId: input.vendorId,
    providerType: input.providerType,
    baseUrl: input.baseUrl,
  });
}
