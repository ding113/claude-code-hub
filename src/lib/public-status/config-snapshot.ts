import { getRedisClient } from "@/lib/redis";
import { buildPublicStatusConfigSnapshotKey } from "./redis-contract";

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

export interface PublicStatusConfigSnapshot {
  configVersion: string;
  generatedAt: string;
  siteTitle: string;
  siteDescription: string;
  defaultIntervalMinutes: number;
  defaultRangeHours: number;
  groups: PublicStatusGroupSnapshot[];
}

interface BuildPublicStatusConfigSnapshotInput {
  configVersion: string;
  siteTitle: string;
  siteDescription: string;
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

export function buildPublicStatusConfigSnapshot(
  input: BuildPublicStatusConfigSnapshotInput
): PublicStatusConfigSnapshot {
  // 这里只保留 public-safe 字段，避免后续页面/路由再去查价格表或内部 provider 元数据。
  return {
    configVersion: input.configVersion,
    generatedAt: new Date().toISOString(),
    siteTitle: input.siteTitle.trim(),
    siteDescription: input.siteDescription.trim(),
    defaultIntervalMinutes: input.defaultIntervalMinutes,
    defaultRangeHours: input.defaultRangeHours,
    groups: [...input.groups]
      .sort((left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug))
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
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [],
    });

  const key = buildPublicStatusConfigSnapshotKey(snapshot.configVersion);
  const redis = input.redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });

  if (redis) {
    await redis.set(key, JSON.stringify({ ...snapshot, publishReason: input.reason }));
    await redis.set(buildPublicStatusConfigSnapshotKey(), JSON.stringify({ key, configVersion: snapshot.configVersion }));
  }

  return {
    configVersion: snapshot.configVersion,
    key,
    written: Boolean(redis),
  };
}
