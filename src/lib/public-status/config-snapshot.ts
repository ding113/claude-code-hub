import { getRedisClient } from "@/lib/redis";
import {
  buildPublicStatusConfigSnapshotKey,
  buildPublicStatusInternalConfigSnapshotKey,
} from "./redis-contract";

export interface PublicStatusModelSnapshot {
  publicModelKey: string;
  label: string;
  vendorIconKey: string;
  requestTypeBadge: string;
}

export interface PublicStatusGroupSnapshot {
  slug: string;
  displayName: string;
  sortOrder: number;
  description: string | null;
  models: PublicStatusModelSnapshot[];
}

export interface InternalPublicStatusGroupSnapshot extends PublicStatusGroupSnapshot {
  sourceGroupName: string;
}

export interface PublicStatusConfigSnapshot {
  configVersion: string;
  generatedAt: string;
  siteTitle: string;
  siteDescription: string;
  timeZone: string | null;
  defaultIntervalMinutes: number;
  defaultRangeHours: number;
  groups: PublicStatusGroupSnapshot[];
}

export interface InternalPublicStatusConfigSnapshot
  extends Omit<PublicStatusConfigSnapshot, "groups"> {
  groups: InternalPublicStatusGroupSnapshot[];
}

interface BuildPublicStatusConfigSnapshotInput {
  configVersion: string;
  siteTitle: string;
  siteDescription: string;
  timeZone?: string | null;
  defaultIntervalMinutes: number;
  defaultRangeHours: number;
  groups: Array<{
    slug: string;
    displayName: string;
    sortOrder: number;
    description: string | null;
    models: Array<{
      publicModelKey: string;
      label: string;
      vendorIconKey: string;
      requestTypeBadge: string;
      internalProviderName?: string;
      endpointUrl?: string;
    }>;
  }>;
}

interface RedisWriter {
  set(key: string, value: string): Promise<unknown> | unknown;
}

interface RedisReader {
  get(key: string): Promise<string | null> | string | null;
  status?: string;
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function buildPublicStatusConfigSnapshot(
  input: BuildPublicStatusConfigSnapshotInput
): PublicStatusConfigSnapshot {
  // 这里只保留 public-safe 字段，避免后续页面/路由再去查价格表或内部 provider 元数据。
  return {
    configVersion: input.configVersion,
    generatedAt: new Date().toISOString(),
    siteTitle: input.siteTitle.trim(),
    siteDescription: input.siteDescription.trim(),
    timeZone: input.timeZone ?? null,
    defaultIntervalMinutes: input.defaultIntervalMinutes,
    defaultRangeHours: input.defaultRangeHours,
    groups: [...input.groups]
      .sort(
        (left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug)
      )
      .map((group) => ({
        slug: group.slug,
        displayName: group.displayName,
        sortOrder: group.sortOrder,
        description: group.description,
        models: group.models.map((model) => ({
          publicModelKey: model.publicModelKey,
          label: model.label,
          vendorIconKey: model.vendorIconKey,
          requestTypeBadge: model.requestTypeBadge,
        })),
      })),
  };
}

export async function publishPublicStatusConfigSnapshot(input: {
  reason: string;
  snapshot?: PublicStatusConfigSnapshot;
  redis?: RedisWriter | null;
}): Promise<{
  configVersion: string;
  key: string;
  written: boolean;
}> {
  const snapshot =
    input.snapshot ??
    buildPublicStatusConfigSnapshot({
      configVersion: `cfg-${Date.now()}`,
      siteTitle: "Claude Code Hub Status",
      siteDescription: "Request-derived public status",
      timeZone: null,
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [],
    });

  const key = buildPublicStatusConfigSnapshotKey(snapshot.configVersion);
  const redis = input.redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });

  if (redis) {
    await redis.set(key, JSON.stringify(snapshot));
    await redis.set(
      buildPublicStatusConfigSnapshotKey(),
      JSON.stringify({ key, configVersion: snapshot.configVersion })
    );
  }

  return {
    configVersion: snapshot.configVersion,
    key,
    written: Boolean(redis),
  };
}

export function buildInternalPublicStatusConfigSnapshot(
  input: Omit<InternalPublicStatusConfigSnapshot, "generatedAt">
): InternalPublicStatusConfigSnapshot {
  return {
    ...input,
    generatedAt: new Date().toISOString(),
    groups: [...input.groups].sort(
      (left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug)
    ),
  };
}

export async function publishInternalPublicStatusConfigSnapshot(input: {
  snapshot: InternalPublicStatusConfigSnapshot;
  redis?: RedisWriter | null;
}): Promise<{ configVersion: string; key: string; written: boolean }> {
  const key = buildPublicStatusInternalConfigSnapshotKey(input.snapshot.configVersion);
  const redis = input.redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });

  if (redis) {
    await redis.set(key, JSON.stringify(input.snapshot));
    await redis.set(
      buildPublicStatusInternalConfigSnapshotKey(),
      JSON.stringify({ key, configVersion: input.snapshot.configVersion })
    );
  }

  return {
    configVersion: input.snapshot.configVersion,
    key,
    written: Boolean(redis),
  };
}

export async function readCurrentPublicStatusConfigSnapshot(input?: {
  redis?: RedisReader | null;
}): Promise<PublicStatusConfigSnapshot | null> {
  const redis = input?.redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || ("status" in redis && redis.status && redis.status !== "ready")) {
    return null;
  }

  const pointerRaw = await redis.get(buildPublicStatusConfigSnapshotKey());
  const pointer = safeParseJson<{ key?: string }>(pointerRaw);
  if (!pointer?.key) {
    return null;
  }

  const snapshotRaw = await redis.get(pointer.key);
  return safeParseJson<PublicStatusConfigSnapshot>(snapshotRaw);
}

export async function readCurrentInternalPublicStatusConfigSnapshot(input?: {
  redis?: RedisReader | null;
}): Promise<InternalPublicStatusConfigSnapshot | null> {
  const redis = input?.redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || ("status" in redis && redis.status && redis.status !== "ready")) {
    return null;
  }

  const pointerRaw = await redis.get(buildPublicStatusInternalConfigSnapshotKey());
  const pointer = safeParseJson<{ key?: string }>(pointerRaw);
  if (!pointer?.key) {
    return null;
  }

  const snapshotRaw = await redis.get(pointer.key);
  return safeParseJson<InternalPublicStatusConfigSnapshot>(snapshotRaw);
}

export async function readPublicStatusSiteMetadata(input?: {
  redis?: RedisReader | null;
}): Promise<{
  siteTitle: string;
  siteDescription: string;
} | null> {
  const snapshot = await readCurrentPublicStatusConfigSnapshot(input);
  if (!snapshot || !snapshot.siteTitle || !snapshot.siteDescription) {
    return null;
  }

  return {
    siteTitle: snapshot.siteTitle,
    siteDescription: snapshot.siteDescription,
  };
}

export async function readPublicStatusTimeZone(input?: {
  redis?: RedisReader | null;
}): Promise<string | null> {
  const snapshot = await readCurrentPublicStatusConfigSnapshot(input);
  return snapshot?.timeZone ?? null;
}
