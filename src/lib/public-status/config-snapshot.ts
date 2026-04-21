import { getRedisClient } from "@/lib/redis";
import { findLatestPricesByModels } from "@/repository/model-price";
import { findAllProviderGroups } from "@/repository/provider-groups";
import { getSystemSettings } from "@/repository/system-config";
import {
  collectEnabledPublicStatusGroups,
  parsePublicStatusDescription,
} from "./config";
import { buildPublicStatusConfigSnapshotKey } from "./redis-contract";

export interface PublicStatusModelSnapshot {
  publicModelKey: string;
  label: string;
  vendorIconKey: string;
  requestTypeBadge: string;
}

export interface PublicStatusGroupSnapshot {
  sourceGroupName?: string;
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
  timeZone: string | null;
  defaultIntervalMinutes: number;
  defaultRangeHours: number;
  groups: PublicStatusGroupSnapshot[];
}

interface BuildPublicStatusConfigSnapshotInput {
  configVersion: string;
  siteTitle: string;
  siteDescription: string;
  timeZone?: string | null;
  defaultIntervalMinutes: number;
  defaultRangeHours: number;
  groups: Array<{
    sourceGroupName?: string;
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
      .sort((left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug))
      .map((group) => ({
        sourceGroupName: group.sourceGroupName,
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
    await redis.set(key, JSON.stringify({ ...snapshot, publishReason: input.reason }));
    await redis.set(buildPublicStatusConfigSnapshotKey(), JSON.stringify({ key, configVersion: snapshot.configVersion }));
  }

  return {
    configVersion: snapshot.configVersion,
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

function resolvePublicVendorIconKey(modelName: string, raw?: string): string {
  const PUBLIC_VENDOR_ICON_KEYS = new Set([
    "openai",
    "anthropic",
    "gemini",
    "azure",
    "bedrock",
    "generic",
  ]);

  const normalized = raw?.trim().toLowerCase();
  if (normalized && PUBLIC_VENDOR_ICON_KEYS.has(normalized)) {
    return normalized;
  }

  const lowerModelName = modelName.toLowerCase();
  if (lowerModelName.includes("codex")) return "openai";
  if (lowerModelName.includes("claude")) return "anthropic";
  if (lowerModelName.includes("gemini")) return "gemini";
  return "generic";
}

function resolveRequestTypeBadge(modelName: string): string {
  const normalized = modelName.toLowerCase();
  if (normalized.includes("codex")) {
    return "codex";
  }
  if (normalized.includes("claude")) {
    return "anthropic";
  }
  if (normalized.includes("gemini")) {
    return "gemini";
  }
  return "openaiCompatible";
}

export async function publishCurrentPublicStatusConfigProjection(input: {
  reason: string;
  configVersion?: string;
}): Promise<{
  configVersion: string;
  key: string;
  written: boolean;
  groupCount: number;
}> {
  const settings = await getSystemSettings();
  const providerGroups = await findAllProviderGroups();
  const enabledGroups = collectEnabledPublicStatusGroups(
    providerGroups.map((group) => ({
      groupName: group.name,
      ...parsePublicStatusDescription(group.description),
    }))
  );
  const latestPrices = await findLatestPricesByModels(
    enabledGroups.flatMap((group) => group.publicModelKeys)
  );

  const snapshot = buildPublicStatusConfigSnapshot({
    configVersion: input.configVersion ?? `cfg-${Date.now()}`,
    siteTitle: settings.siteTitle,
    siteDescription: settings.siteTitle,
    timeZone: settings.timezone,
    defaultIntervalMinutes: settings.publicStatusAggregationIntervalMinutes,
    defaultRangeHours: settings.publicStatusWindowHours,
    groups: enabledGroups.map((group) => ({
      sourceGroupName: group.groupName,
      slug: group.publicGroupSlug,
      displayName: group.displayName,
      sortOrder: group.sortOrder,
      description: group.explanatoryCopy,
      models: group.publicModelKeys.map((modelName) => {
        const price = latestPrices.get(modelName);
        return {
          publicModelKey: modelName,
          label: price?.priceData.display_name?.trim() || modelName,
          vendorIconKey: resolvePublicVendorIconKey(
            modelName,
            typeof price?.priceData.litellm_provider === "string"
              ? price.priceData.litellm_provider
              : undefined
          ),
          requestTypeBadge: resolveRequestTypeBadge(modelName),
        };
      }),
    })),
  });

  const result = await publishPublicStatusConfigSnapshot({
    reason: input.reason,
    snapshot,
  });

  return {
    ...result,
    groupCount: enabledGroups.length,
  };
}
