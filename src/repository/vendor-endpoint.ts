"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { vendorEndpoints } from "@/drizzle/schema-v2";
import type { VendorApiFormat, VendorEndpoint } from "@/types/vendor";
import { toVendorEndpoint } from "./_shared/transformers";

export interface CreateVendorEndpointData {
  vendorId: number;
  name: string;
  url: string;
  apiFormat: VendorApiFormat;
  isEnabled?: boolean;
  priority?: number;
  latencyMs?: number | null;
  healthCheckEnabled?: boolean;
  healthCheckEndpoint?: string | null;
  healthCheckIntervalSeconds?: number | null;
  healthCheckTimeoutMs?: number | null;
}

export interface UpdateVendorEndpointData {
  vendorId?: number;
  name?: string;
  url?: string;
  apiFormat?: VendorApiFormat;
  isEnabled?: boolean;
  priority?: number;
  latencyMs?: number | null;
  healthCheckEnabled?: boolean;
  healthCheckEndpoint?: string | null;
  healthCheckIntervalSeconds?: number | null;
  healthCheckTimeoutMs?: number | null;
  healthCheckLastCheckedAt?: Date | null;
  healthCheckLastStatusCode?: number | null;
  healthCheckErrorMessage?: string | null;
}

export async function createVendorEndpoint(
  data: CreateVendorEndpointData
): Promise<VendorEndpoint> {
  const dbData = {
    vendorId: data.vendorId,
    name: data.name,
    url: data.url,
    apiFormat: data.apiFormat,
    isEnabled: data.isEnabled ?? true,
    priority: data.priority ?? 0,
    latencyMs: data.latencyMs ?? null,
    healthCheckEnabled: data.healthCheckEnabled ?? false,
    healthCheckEndpoint: data.healthCheckEndpoint ?? null,
    healthCheckIntervalSeconds: data.healthCheckIntervalSeconds ?? null,
    healthCheckTimeoutMs: data.healthCheckTimeoutMs ?? null,
  };

  const [endpoint] = await db.insert(vendorEndpoints).values(dbData).returning({
    id: vendorEndpoints.id,
    vendorId: vendorEndpoints.vendorId,
    name: vendorEndpoints.name,
    url: vendorEndpoints.url,
    apiFormat: vendorEndpoints.apiFormat,
    isEnabled: vendorEndpoints.isEnabled,
    priority: vendorEndpoints.priority,
    latencyMs: vendorEndpoints.latencyMs,
    healthCheckEnabled: vendorEndpoints.healthCheckEnabled,
    healthCheckEndpoint: vendorEndpoints.healthCheckEndpoint,
    healthCheckIntervalSeconds: vendorEndpoints.healthCheckIntervalSeconds,
    healthCheckTimeoutMs: vendorEndpoints.healthCheckTimeoutMs,
    healthCheckLastCheckedAt: vendorEndpoints.healthCheckLastCheckedAt,
    healthCheckLastStatusCode: vendorEndpoints.healthCheckLastStatusCode,
    healthCheckErrorMessage: vendorEndpoints.healthCheckErrorMessage,
    createdAt: vendorEndpoints.createdAt,
    updatedAt: vendorEndpoints.updatedAt,
    deletedAt: vendorEndpoints.deletedAt,
  });

  return toVendorEndpoint(endpoint);
}

export async function findVendorEndpointById(id: number): Promise<VendorEndpoint | null> {
  const [endpoint] = await db
    .select({
      id: vendorEndpoints.id,
      vendorId: vendorEndpoints.vendorId,
      name: vendorEndpoints.name,
      url: vendorEndpoints.url,
      apiFormat: vendorEndpoints.apiFormat,
      isEnabled: vendorEndpoints.isEnabled,
      priority: vendorEndpoints.priority,
      latencyMs: vendorEndpoints.latencyMs,
      healthCheckEnabled: vendorEndpoints.healthCheckEnabled,
      healthCheckEndpoint: vendorEndpoints.healthCheckEndpoint,
      healthCheckIntervalSeconds: vendorEndpoints.healthCheckIntervalSeconds,
      healthCheckTimeoutMs: vendorEndpoints.healthCheckTimeoutMs,
      healthCheckLastCheckedAt: vendorEndpoints.healthCheckLastCheckedAt,
      healthCheckLastStatusCode: vendorEndpoints.healthCheckLastStatusCode,
      healthCheckErrorMessage: vendorEndpoints.healthCheckErrorMessage,
      createdAt: vendorEndpoints.createdAt,
      updatedAt: vendorEndpoints.updatedAt,
      deletedAt: vendorEndpoints.deletedAt,
    })
    .from(vendorEndpoints)
    .where(and(eq(vendorEndpoints.id, id), isNull(vendorEndpoints.deletedAt)))
    .limit(1);

  if (!endpoint) return null;
  return toVendorEndpoint(endpoint);
}

export async function findVendorEndpointsByVendorId(vendorId: number): Promise<VendorEndpoint[]> {
  const result = await db
    .select({
      id: vendorEndpoints.id,
      vendorId: vendorEndpoints.vendorId,
      name: vendorEndpoints.name,
      url: vendorEndpoints.url,
      apiFormat: vendorEndpoints.apiFormat,
      isEnabled: vendorEndpoints.isEnabled,
      priority: vendorEndpoints.priority,
      latencyMs: vendorEndpoints.latencyMs,
      healthCheckEnabled: vendorEndpoints.healthCheckEnabled,
      healthCheckEndpoint: vendorEndpoints.healthCheckEndpoint,
      healthCheckIntervalSeconds: vendorEndpoints.healthCheckIntervalSeconds,
      healthCheckTimeoutMs: vendorEndpoints.healthCheckTimeoutMs,
      healthCheckLastCheckedAt: vendorEndpoints.healthCheckLastCheckedAt,
      healthCheckLastStatusCode: vendorEndpoints.healthCheckLastStatusCode,
      healthCheckErrorMessage: vendorEndpoints.healthCheckErrorMessage,
      createdAt: vendorEndpoints.createdAt,
      updatedAt: vendorEndpoints.updatedAt,
      deletedAt: vendorEndpoints.deletedAt,
    })
    .from(vendorEndpoints)
    .where(and(eq(vendorEndpoints.vendorId, vendorId), isNull(vendorEndpoints.deletedAt)))
    .orderBy(asc(vendorEndpoints.priority), asc(vendorEndpoints.id));

  return result.map(toVendorEndpoint);
}

export async function updateVendorEndpoint(
  id: number,
  data: UpdateVendorEndpointData
): Promise<VendorEndpoint | null> {
  if (Object.keys(data).length === 0) {
    return findVendorEndpointById(id);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbData: any = {
    updatedAt: new Date(),
  };

  if (data.vendorId !== undefined) dbData.vendorId = data.vendorId;
  if (data.name !== undefined) dbData.name = data.name;
  if (data.url !== undefined) dbData.url = data.url;
  if (data.apiFormat !== undefined) dbData.apiFormat = data.apiFormat;
  if (data.isEnabled !== undefined) dbData.isEnabled = data.isEnabled;
  if (data.priority !== undefined) dbData.priority = data.priority;
  if (data.latencyMs !== undefined) dbData.latencyMs = data.latencyMs;
  if (data.healthCheckEnabled !== undefined) dbData.healthCheckEnabled = data.healthCheckEnabled;
  if (data.healthCheckEndpoint !== undefined) dbData.healthCheckEndpoint = data.healthCheckEndpoint;
  if (data.healthCheckIntervalSeconds !== undefined)
    dbData.healthCheckIntervalSeconds = data.healthCheckIntervalSeconds;
  if (data.healthCheckTimeoutMs !== undefined)
    dbData.healthCheckTimeoutMs = data.healthCheckTimeoutMs;
  if (data.healthCheckLastCheckedAt !== undefined)
    dbData.healthCheckLastCheckedAt = data.healthCheckLastCheckedAt;
  if (data.healthCheckLastStatusCode !== undefined)
    dbData.healthCheckLastStatusCode = data.healthCheckLastStatusCode;
  if (data.healthCheckErrorMessage !== undefined)
    dbData.healthCheckErrorMessage = data.healthCheckErrorMessage;

  const [endpoint] = await db
    .update(vendorEndpoints)
    .set(dbData)
    .where(and(eq(vendorEndpoints.id, id), isNull(vendorEndpoints.deletedAt)))
    .returning({
      id: vendorEndpoints.id,
      vendorId: vendorEndpoints.vendorId,
      name: vendorEndpoints.name,
      url: vendorEndpoints.url,
      apiFormat: vendorEndpoints.apiFormat,
      isEnabled: vendorEndpoints.isEnabled,
      priority: vendorEndpoints.priority,
      latencyMs: vendorEndpoints.latencyMs,
      healthCheckEnabled: vendorEndpoints.healthCheckEnabled,
      healthCheckEndpoint: vendorEndpoints.healthCheckEndpoint,
      healthCheckIntervalSeconds: vendorEndpoints.healthCheckIntervalSeconds,
      healthCheckTimeoutMs: vendorEndpoints.healthCheckTimeoutMs,
      healthCheckLastCheckedAt: vendorEndpoints.healthCheckLastCheckedAt,
      healthCheckLastStatusCode: vendorEndpoints.healthCheckLastStatusCode,
      healthCheckErrorMessage: vendorEndpoints.healthCheckErrorMessage,
      createdAt: vendorEndpoints.createdAt,
      updatedAt: vendorEndpoints.updatedAt,
      deletedAt: vendorEndpoints.deletedAt,
    });

  if (!endpoint) return null;
  return toVendorEndpoint(endpoint);
}

export async function deleteVendorEndpoint(id: number): Promise<boolean> {
  const result = await db
    .update(vendorEndpoints)
    .set({ deletedAt: new Date() })
    .where(and(eq(vendorEndpoints.id, id), isNull(vendorEndpoints.deletedAt)))
    .returning({ id: vendorEndpoints.id });

  return result.length > 0;
}
