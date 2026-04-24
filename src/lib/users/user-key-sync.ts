import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { normalizeProviderGroup } from "@/lib/utils/provider-group";

export type UserKeySyncAmountField =
  | "limit5hUsd"
  | "limitDailyUsd"
  | "limitWeeklyUsd"
  | "limitMonthlyUsd"
  | "limitTotalUsd";

export interface UserKeySyncSource {
  dailyQuota?: number | string | null;
  limit5hUsd?: number | string | null;
  limitWeeklyUsd?: number | string | null;
  limitMonthlyUsd?: number | string | null;
  limitTotalUsd?: number | string | null;
  limitConcurrentSessions?: number | string | null;
  providerGroup?: string | null;
  dailyResetMode?: "fixed" | "rolling" | null;
  dailyResetTime?: string | null;
}

export interface SyncedKeyConfig {
  limit5hUsd: number | null;
  limitDailyUsd: number | null;
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  limitTotalUsd: number | null;
  limitConcurrentSessions: number;
  providerGroup: string;
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;
}

export interface UserKeySyncFieldSummary {
  values: Array<number | null>;
  discarded?: number;
}

export interface UserKeySyncSummary {
  limit5hUsd: UserKeySyncFieldSummary;
  limitDailyUsd: UserKeySyncFieldSummary;
  limitWeeklyUsd: UserKeySyncFieldSummary;
  limitMonthlyUsd: UserKeySyncFieldSummary;
  limitTotalUsd: UserKeySyncFieldSummary;
  limitConcurrentSessions: UserKeySyncFieldSummary;
  providerGroup: string;
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;
}

const AMOUNT_FIELDS = [
  "limit5hUsd",
  "limitDailyUsd",
  "limitWeeklyUsd",
  "limitMonthlyUsd",
  "limitTotalUsd",
] as const;

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function centsToUsd(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function distributeAmount(
  value: number | string | null | undefined,
  keyCount: number
): { values: Array<number | null>; discarded: number } {
  if (keyCount <= 0) return { values: [], discarded: 0 };

  const amount = toFiniteNumber(value);
  if (amount === null || amount <= 0) {
    return { values: Array.from({ length: keyCount }, () => null), discarded: 0 };
  }

  const totalCents = Math.round(amount * 100);
  if (totalCents <= 0) {
    return { values: Array.from({ length: keyCount }, () => null), discarded: 0 };
  }

  if (totalCents >= keyCount) {
    const perKeyCents = Math.floor(totalCents / keyCount);
    return {
      values: Array.from({ length: keyCount }, () => centsToUsd(perKeyCents)),
      discarded: centsToUsd(totalCents - perKeyCents * keyCount),
    };
  }

  return {
    values: Array.from({ length: keyCount }, (_, index) =>
      index < totalCents ? centsToUsd(1) : null
    ),
    discarded: 0,
  };
}

function distributeConcurrentSessions(
  value: number | string | null | undefined,
  keyCount: number
): { values: number[]; discarded: number } {
  if (keyCount <= 0) return { values: [], discarded: 0 };

  const total = toFiniteNumber(value);
  const normalizedTotal = total === null ? 0 : Math.floor(total);
  if (normalizedTotal <= 0) {
    return { values: Array.from({ length: keyCount }, () => 0), discarded: 0 };
  }

  if (normalizedTotal >= keyCount) {
    const perKey = Math.floor(normalizedTotal / keyCount);
    return {
      values: Array.from({ length: keyCount }, () => perKey),
      discarded: normalizedTotal - perKey * keyCount,
    };
  }

  return {
    values: Array.from({ length: keyCount }, (_, index) => (index < normalizedTotal ? 1 : 0)),
    discarded: 0,
  };
}

export function buildSyncedKeyConfigs(
  source: UserKeySyncSource,
  keyCount: number
): { configs: SyncedKeyConfig[]; summary: UserKeySyncSummary } {
  const normalizedKeyCount = Math.max(0, Math.floor(keyCount));
  const providerGroup = normalizeProviderGroup(source.providerGroup ?? PROVIDER_GROUP.DEFAULT);
  const dailyResetMode: "fixed" | "rolling" =
    source.dailyResetMode === "rolling" ? "rolling" : "fixed";
  const dailyResetTime = source.dailyResetTime || "00:00";
  const amountInputByField: Record<UserKeySyncAmountField, number | string | null | undefined> = {
    limit5hUsd: source.limit5hUsd,
    limitDailyUsd: source.dailyQuota,
    limitWeeklyUsd: source.limitWeeklyUsd,
    limitMonthlyUsd: source.limitMonthlyUsd,
    limitTotalUsd: source.limitTotalUsd,
  };
  const amountByField = Object.fromEntries(
    AMOUNT_FIELDS.map((field) => [
      field,
      distributeAmount(amountInputByField[field], normalizedKeyCount),
    ])
  ) as Record<UserKeySyncAmountField, { values: Array<number | null>; discarded: number }>;
  const concurrent = distributeConcurrentSessions(
    source.limitConcurrentSessions,
    normalizedKeyCount
  );

  const configs = Array.from({ length: normalizedKeyCount }, (_, index) => ({
    limit5hUsd: amountByField.limit5hUsd.values[index] ?? null,
    limitDailyUsd: amountByField.limitDailyUsd.values[index] ?? null,
    limitWeeklyUsd: amountByField.limitWeeklyUsd.values[index] ?? null,
    limitMonthlyUsd: amountByField.limitMonthlyUsd.values[index] ?? null,
    limitTotalUsd: amountByField.limitTotalUsd.values[index] ?? null,
    limitConcurrentSessions: concurrent.values[index] ?? 0,
    providerGroup,
    dailyResetMode,
    dailyResetTime,
  }));

  return {
    configs,
    summary: {
      limit5hUsd: amountByField.limit5hUsd,
      limitDailyUsd: amountByField.limitDailyUsd,
      limitWeeklyUsd: amountByField.limitWeeklyUsd,
      limitMonthlyUsd: amountByField.limitMonthlyUsd,
      limitTotalUsd: amountByField.limitTotalUsd,
      limitConcurrentSessions: concurrent,
      providerGroup,
      dailyResetMode,
      dailyResetTime,
    },
  };
}

export function buildFirstSyncedKeyConfig(source: UserKeySyncSource): SyncedKeyConfig {
  return buildSyncedKeyConfigs(source, 1).configs[0];
}
