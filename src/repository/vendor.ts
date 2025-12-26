"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { vendors } from "@/drizzle/schema-v2";
import type { Vendor, VendorCategory } from "@/types/vendor";
import { toVendor } from "./_shared/transformers";

export interface CreateVendorData {
  slug: string;
  name: string;
  category: VendorCategory;
  description?: string | null;
  isManaged?: boolean;
  isEnabled?: boolean;
  tags?: string[];
  websiteUrl?: string | null;
  faviconUrl?: string | null;
  balanceCheckEnabled?: boolean;
  balanceCheckEndpoint?: string | null;
  balanceCheckJsonpath?: string | null;
  balanceCheckIntervalSeconds?: number | null;
  balanceCheckLowThresholdUsd?: number | null;
}

export interface UpdateVendorData {
  slug?: string;
  name?: string;
  category?: VendorCategory;
  description?: string | null;
  isManaged?: boolean;
  isEnabled?: boolean;
  tags?: string[];
  websiteUrl?: string | null;
  faviconUrl?: string | null;
  balanceCheckEnabled?: boolean;
  balanceCheckEndpoint?: string | null;
  balanceCheckJsonpath?: string | null;
  balanceCheckIntervalSeconds?: number | null;
  balanceCheckLowThresholdUsd?: number | null;
}

export async function createVendor(data: CreateVendorData): Promise<Vendor> {
  const dbData = {
    slug: data.slug,
    name: data.name,
    description: data.description ?? null,
    category: data.category,
    isManaged: data.isManaged ?? false,
    isEnabled: data.isEnabled ?? true,
    tags: data.tags ?? [],
    websiteUrl: data.websiteUrl ?? null,
    faviconUrl: data.faviconUrl ?? null,
    balanceCheckEnabled: data.balanceCheckEnabled ?? false,
    balanceCheckEndpoint: data.balanceCheckEndpoint ?? null,
    balanceCheckJsonpath: data.balanceCheckJsonpath ?? null,
    balanceCheckIntervalSeconds: data.balanceCheckIntervalSeconds ?? null,
    balanceCheckLowThresholdUsd:
      data.balanceCheckLowThresholdUsd != null ? data.balanceCheckLowThresholdUsd.toString() : null,
  };

  const [vendor] = await db.insert(vendors).values(dbData).returning({
    id: vendors.id,
    slug: vendors.slug,
    name: vendors.name,
    description: vendors.description,
    category: vendors.category,
    isManaged: vendors.isManaged,
    isEnabled: vendors.isEnabled,
    tags: vendors.tags,
    websiteUrl: vendors.websiteUrl,
    faviconUrl: vendors.faviconUrl,
    balanceCheckEnabled: vendors.balanceCheckEnabled,
    balanceCheckEndpoint: vendors.balanceCheckEndpoint,
    balanceCheckJsonpath: vendors.balanceCheckJsonpath,
    balanceCheckIntervalSeconds: vendors.balanceCheckIntervalSeconds,
    balanceCheckLowThresholdUsd: vendors.balanceCheckLowThresholdUsd,
    createdAt: vendors.createdAt,
    updatedAt: vendors.updatedAt,
    deletedAt: vendors.deletedAt,
  });

  return toVendor(vendor);
}

export async function findVendorList(limit: number = 50, offset: number = 0): Promise<Vendor[]> {
  const result = await db
    .select({
      id: vendors.id,
      slug: vendors.slug,
      name: vendors.name,
      description: vendors.description,
      category: vendors.category,
      isManaged: vendors.isManaged,
      isEnabled: vendors.isEnabled,
      tags: vendors.tags,
      websiteUrl: vendors.websiteUrl,
      faviconUrl: vendors.faviconUrl,
      balanceCheckEnabled: vendors.balanceCheckEnabled,
      balanceCheckEndpoint: vendors.balanceCheckEndpoint,
      balanceCheckJsonpath: vendors.balanceCheckJsonpath,
      balanceCheckIntervalSeconds: vendors.balanceCheckIntervalSeconds,
      balanceCheckLowThresholdUsd: vendors.balanceCheckLowThresholdUsd,
      createdAt: vendors.createdAt,
      updatedAt: vendors.updatedAt,
      deletedAt: vendors.deletedAt,
    })
    .from(vendors)
    .where(isNull(vendors.deletedAt))
    .orderBy(desc(vendors.createdAt))
    .limit(limit)
    .offset(offset);

  return result.map(toVendor);
}

export async function findAllVendors(): Promise<Vendor[]> {
  const result = await db
    .select({
      id: vendors.id,
      slug: vendors.slug,
      name: vendors.name,
      description: vendors.description,
      category: vendors.category,
      isManaged: vendors.isManaged,
      isEnabled: vendors.isEnabled,
      tags: vendors.tags,
      websiteUrl: vendors.websiteUrl,
      faviconUrl: vendors.faviconUrl,
      balanceCheckEnabled: vendors.balanceCheckEnabled,
      balanceCheckEndpoint: vendors.balanceCheckEndpoint,
      balanceCheckJsonpath: vendors.balanceCheckJsonpath,
      balanceCheckIntervalSeconds: vendors.balanceCheckIntervalSeconds,
      balanceCheckLowThresholdUsd: vendors.balanceCheckLowThresholdUsd,
      createdAt: vendors.createdAt,
      updatedAt: vendors.updatedAt,
      deletedAt: vendors.deletedAt,
    })
    .from(vendors)
    .where(isNull(vendors.deletedAt))
    .orderBy(desc(vendors.createdAt));

  return result.map(toVendor);
}

export async function findVendorById(id: number): Promise<Vendor | null> {
  const [vendor] = await db
    .select({
      id: vendors.id,
      slug: vendors.slug,
      name: vendors.name,
      description: vendors.description,
      category: vendors.category,
      isManaged: vendors.isManaged,
      isEnabled: vendors.isEnabled,
      tags: vendors.tags,
      websiteUrl: vendors.websiteUrl,
      faviconUrl: vendors.faviconUrl,
      balanceCheckEnabled: vendors.balanceCheckEnabled,
      balanceCheckEndpoint: vendors.balanceCheckEndpoint,
      balanceCheckJsonpath: vendors.balanceCheckJsonpath,
      balanceCheckIntervalSeconds: vendors.balanceCheckIntervalSeconds,
      balanceCheckLowThresholdUsd: vendors.balanceCheckLowThresholdUsd,
      createdAt: vendors.createdAt,
      updatedAt: vendors.updatedAt,
      deletedAt: vendors.deletedAt,
    })
    .from(vendors)
    .where(and(eq(vendors.id, id), isNull(vendors.deletedAt)))
    .limit(1);

  if (!vendor) return null;
  return toVendor(vendor);
}

export async function findVendorBySlug(slug: string): Promise<Vendor | null> {
  const [vendor] = await db
    .select({
      id: vendors.id,
      slug: vendors.slug,
      name: vendors.name,
      description: vendors.description,
      category: vendors.category,
      isManaged: vendors.isManaged,
      isEnabled: vendors.isEnabled,
      tags: vendors.tags,
      websiteUrl: vendors.websiteUrl,
      faviconUrl: vendors.faviconUrl,
      balanceCheckEnabled: vendors.balanceCheckEnabled,
      balanceCheckEndpoint: vendors.balanceCheckEndpoint,
      balanceCheckJsonpath: vendors.balanceCheckJsonpath,
      balanceCheckIntervalSeconds: vendors.balanceCheckIntervalSeconds,
      balanceCheckLowThresholdUsd: vendors.balanceCheckLowThresholdUsd,
      createdAt: vendors.createdAt,
      updatedAt: vendors.updatedAt,
      deletedAt: vendors.deletedAt,
    })
    .from(vendors)
    .where(and(eq(vendors.slug, slug), isNull(vendors.deletedAt)))
    .limit(1);

  if (!vendor) return null;
  return toVendor(vendor);
}

export async function updateVendor(id: number, data: UpdateVendorData): Promise<Vendor | null> {
  if (Object.keys(data).length === 0) {
    return findVendorById(id);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbData: any = {
    updatedAt: new Date(),
  };

  if (data.slug !== undefined) dbData.slug = data.slug;
  if (data.name !== undefined) dbData.name = data.name;
  if (data.description !== undefined) dbData.description = data.description;
  if (data.category !== undefined) dbData.category = data.category;
  if (data.isManaged !== undefined) dbData.isManaged = data.isManaged;
  if (data.isEnabled !== undefined) dbData.isEnabled = data.isEnabled;
  if (data.tags !== undefined) dbData.tags = data.tags;
  if (data.websiteUrl !== undefined) dbData.websiteUrl = data.websiteUrl;
  if (data.faviconUrl !== undefined) dbData.faviconUrl = data.faviconUrl;
  if (data.balanceCheckEnabled !== undefined) dbData.balanceCheckEnabled = data.balanceCheckEnabled;
  if (data.balanceCheckEndpoint !== undefined)
    dbData.balanceCheckEndpoint = data.balanceCheckEndpoint;
  if (data.balanceCheckJsonpath !== undefined)
    dbData.balanceCheckJsonpath = data.balanceCheckJsonpath;
  if (data.balanceCheckIntervalSeconds !== undefined)
    dbData.balanceCheckIntervalSeconds = data.balanceCheckIntervalSeconds;
  if (data.balanceCheckLowThresholdUsd !== undefined)
    dbData.balanceCheckLowThresholdUsd =
      data.balanceCheckLowThresholdUsd != null ? data.balanceCheckLowThresholdUsd.toString() : null;

  const [vendor] = await db
    .update(vendors)
    .set(dbData)
    .where(and(eq(vendors.id, id), isNull(vendors.deletedAt)))
    .returning({
      id: vendors.id,
      slug: vendors.slug,
      name: vendors.name,
      description: vendors.description,
      category: vendors.category,
      isManaged: vendors.isManaged,
      isEnabled: vendors.isEnabled,
      tags: vendors.tags,
      websiteUrl: vendors.websiteUrl,
      faviconUrl: vendors.faviconUrl,
      balanceCheckEnabled: vendors.balanceCheckEnabled,
      balanceCheckEndpoint: vendors.balanceCheckEndpoint,
      balanceCheckJsonpath: vendors.balanceCheckJsonpath,
      balanceCheckIntervalSeconds: vendors.balanceCheckIntervalSeconds,
      balanceCheckLowThresholdUsd: vendors.balanceCheckLowThresholdUsd,
      createdAt: vendors.createdAt,
      updatedAt: vendors.updatedAt,
      deletedAt: vendors.deletedAt,
    });

  if (!vendor) return null;
  return toVendor(vendor);
}

export async function deleteVendor(id: number): Promise<boolean> {
  const result = await db
    .update(vendors)
    .set({ deletedAt: new Date() })
    .where(and(eq(vendors.id, id), isNull(vendors.deletedAt)))
    .returning({ id: vendors.id });

  return result.length > 0;
}
