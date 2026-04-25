import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { normalizeProviderGroup } from "@/lib/utils/provider-group";
import type { CreateKeyData, Key } from "@/types/key";

export const TEMPORARY_KEY_BATCH_MAX_COUNT = 100;
export const TEMPORARY_GROUP_NAME_MAX_LENGTH = 120;

export type TemporaryKeyTranslation = (
  key: string,
  values?: Record<string, string>
) => string;

export type TemporaryKeyLimitValidationInput = {
  limit5hUsd?: number | null;
  limitDailyUsd?: number | null;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number | null;
};

export type TemporaryKeyUserLimitInput = {
  limit5hUsd?: number | null;
  dailyQuota?: number | null;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number | null;
  providerGroup?: string | null;
};

export function validateTemporaryKeyLimitsAgainstUser(
  user: TemporaryKeyUserLimitInput,
  limits: TemporaryKeyLimitValidationInput,
  tError: TemporaryKeyTranslation
): string | null {
  if (
    limits.limit5hUsd != null &&
    limits.limit5hUsd > 0 &&
    user.limit5hUsd != null &&
    user.limit5hUsd > 0 &&
    limits.limit5hUsd > user.limit5hUsd
  ) {
    return tError("KEY_LIMIT_5H_EXCEEDS_USER_LIMIT", {
      keyLimit: String(limits.limit5hUsd),
      userLimit: String(user.limit5hUsd),
    });
  }

  if (
    limits.limitDailyUsd != null &&
    limits.limitDailyUsd > 0 &&
    user.dailyQuota != null &&
    user.dailyQuota > 0 &&
    limits.limitDailyUsd > user.dailyQuota
  ) {
    return tError("KEY_LIMIT_DAILY_EXCEEDS_USER_LIMIT", {
      keyLimit: String(limits.limitDailyUsd),
      userLimit: String(user.dailyQuota),
    });
  }

  if (
    limits.limitWeeklyUsd != null &&
    limits.limitWeeklyUsd > 0 &&
    user.limitWeeklyUsd != null &&
    user.limitWeeklyUsd > 0 &&
    limits.limitWeeklyUsd > user.limitWeeklyUsd
  ) {
    return tError("KEY_LIMIT_WEEKLY_EXCEEDS_USER_LIMIT", {
      keyLimit: String(limits.limitWeeklyUsd),
      userLimit: String(user.limitWeeklyUsd),
    });
  }

  if (
    limits.limitMonthlyUsd != null &&
    limits.limitMonthlyUsd > 0 &&
    user.limitMonthlyUsd != null &&
    user.limitMonthlyUsd > 0 &&
    limits.limitMonthlyUsd > user.limitMonthlyUsd
  ) {
    return tError("KEY_LIMIT_MONTHLY_EXCEEDS_USER_LIMIT", {
      keyLimit: String(limits.limitMonthlyUsd),
      userLimit: String(user.limitMonthlyUsd),
    });
  }

  if (
    limits.limitTotalUsd != null &&
    limits.limitTotalUsd > 0 &&
    user.limitTotalUsd != null &&
    user.limitTotalUsd > 0 &&
    limits.limitTotalUsd > user.limitTotalUsd
  ) {
    return tError("KEY_LIMIT_TOTAL_EXCEEDS_USER_LIMIT", {
      keyLimit: String(limits.limitTotalUsd),
      userLimit: String(user.limitTotalUsd),
    });
  }

  if (
    limits.limitConcurrentSessions != null &&
    limits.limitConcurrentSessions > 0 &&
    user.limitConcurrentSessions != null &&
    user.limitConcurrentSessions > 0 &&
    limits.limitConcurrentSessions > user.limitConcurrentSessions
  ) {
    return tError("KEY_LIMIT_CONCURRENT_EXCEEDS_USER_LIMIT", {
      keyLimit: String(limits.limitConcurrentSessions),
      userLimit: String(user.limitConcurrentSessions),
    });
  }

  return null;
}

export function resolveTemporaryGroupName(userProviderGroup?: string | null): string {
  return normalizeProviderGroup(userProviderGroup || PROVIDER_GROUP.DEFAULT);
}

export function normalizeTemporaryGroupName(value: string): string {
  return value.trim();
}

function extractTemporaryKeySequence(name: string): number | null {
  const match = name.trim().match(/(\d+)$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

export function resolveNextTemporaryKeySequence(
  existingKeys: Key[],
  normalizedGroupName: string
): number {
  let maxSequence = 0;

  for (const key of existingKeys) {
    if (key.temporaryGroupName?.trim() !== normalizedGroupName) continue;
    const sequence = extractTemporaryKeySequence(key.name);
    if (sequence != null && sequence > maxSequence) {
      maxSequence = sequence;
    }
  }

  return maxSequence + 1;
}

export function buildTemporaryKeyName(sequence: number): string {
  return String(sequence).padStart(3, "0");
}

export function buildTemporaryKeyGroupText(keys: Array<{ key: string }>): string {
  return keys.map((key) => key.key).join("\n");
}

export function buildTemporaryKeyCreatePayloads(params: {
  userId: number;
  baseKey: Key;
  existingKeys: Key[];
  groupName: string;
  count: number;
  customLimitTotalUsd?: number;
  createKeyString: () => string;
}): CreateKeyData[] {
  const nextSequence = resolveNextTemporaryKeySequence(params.existingKeys, params.groupName);
  const expiresAt = params.baseKey.expiresAt instanceof Date ? params.baseKey.expiresAt : null;
  const providerGroup = normalizeProviderGroup(
    params.baseKey.providerGroup || PROVIDER_GROUP.DEFAULT
  );
  const limitTotalUsd =
    params.customLimitTotalUsd !== undefined
      ? params.customLimitTotalUsd
      : (params.baseKey.limitTotalUsd ?? null);

  return Array.from({ length: params.count }, (_, index) => ({
    user_id: params.userId,
    name: buildTemporaryKeyName(nextSequence + index),
    key: params.createKeyString(),
    is_enabled: params.baseKey.isEnabled,
    expires_at: expiresAt,
    can_login_web_ui: params.baseKey.canLoginWebUi,
    limit_5h_usd: params.baseKey.limit5hUsd,
    limit_daily_usd: params.baseKey.limitDailyUsd,
    daily_reset_mode: params.baseKey.dailyResetMode,
    daily_reset_time: params.baseKey.dailyResetTime,
    limit_weekly_usd: params.baseKey.limitWeeklyUsd,
    limit_monthly_usd: params.baseKey.limitMonthlyUsd,
    limit_total_usd: limitTotalUsd,
    limit_concurrent_sessions: params.baseKey.limitConcurrentSessions,
    provider_group: providerGroup,
    cache_ttl_preference: params.baseKey.cacheTtlPreference ?? undefined,
    temporary_group_name: params.groupName,
  }));
}
