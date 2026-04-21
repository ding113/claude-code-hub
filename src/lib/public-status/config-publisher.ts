import { getRedisClient } from "@/lib/redis";
import { findLatestPricesByModels } from "@/repository/model-price";
import { findAllProviderGroups } from "@/repository/provider-groups";
import { getSystemSettings } from "@/repository/system-config";
import { collectEnabledPublicStatusGroups, parsePublicStatusDescription } from "./config";
import {
  buildInternalPublicStatusConfigSnapshot,
  buildPublicStatusConfigSnapshot,
  publishCurrentPublicStatusConfigPointers,
  publishInternalPublicStatusConfigSnapshot,
  publishPublicStatusConfigSnapshot,
} from "./config-snapshot";
import { MAX_PUBLIC_STATUS_RANGE_HOURS, PUBLIC_STATUS_INTERVAL_SET } from "./constants";

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

function normalizePublicInterval(value: number | undefined): number {
  return value && PUBLIC_STATUS_INTERVAL_SET.has(value) ? value : 5;
}

function normalizePublicRange(value: number | undefined): number {
  return value && value >= 1 && value <= MAX_PUBLIC_STATUS_RANGE_HOURS ? value : 24;
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
  const defaultIntervalMinutes = normalizePublicInterval(
    settings.publicStatusAggregationIntervalMinutes
  );
  const defaultRangeHours = normalizePublicRange(settings.publicStatusWindowHours);

  const snapshot = buildPublicStatusConfigSnapshot({
    configVersion: input.configVersion ?? `cfg-${Date.now()}`,
    siteTitle: settings.siteTitle,
    siteDescription: settings.siteTitle,
    timeZone: settings.timezone,
    defaultIntervalMinutes,
    defaultRangeHours,
    groups: enabledGroups.map((group) => ({
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
  const internalSnapshot = buildInternalPublicStatusConfigSnapshot({
    configVersion: snapshot.configVersion,
    siteTitle: snapshot.siteTitle,
    siteDescription: snapshot.siteDescription,
    timeZone: snapshot.timeZone,
    defaultIntervalMinutes: snapshot.defaultIntervalMinutes,
    defaultRangeHours: snapshot.defaultRangeHours,
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

  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  const internalResult = await publishInternalPublicStatusConfigSnapshot({
    snapshot: internalSnapshot,
    redis,
    setCurrentPointer: false,
  });
  const result = await publishPublicStatusConfigSnapshot({
    reason: input.reason,
    snapshot,
    redis,
    setCurrentPointer: false,
  });
  const pointersWritten =
    internalResult.written && result.written
      ? await publishCurrentPublicStatusConfigPointers({
          configVersion: snapshot.configVersion,
          redis,
        })
      : false;

  return {
    ...result,
    written: result.written && internalResult.written && pointersWritten,
    groupCount: enabledGroups.length,
  };
}
