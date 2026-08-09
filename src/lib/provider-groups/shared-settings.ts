/**
 * Shared defaults stored on provider_groups and optionally applied to all
 * providers whose groupTag includes that group name.
 *
 * Identity (name/url/key), website, endpoint pools and per-provider timeouts
 * stay on the provider row — not fleet-shared here.
 */

import type { ProviderType } from "@/types/provider";
import type { TestFormat } from "@/lib/provider-testing/presets";

export type ProviderGroupSharedSettings = {
  /** API / request format type applied to member providers. */
  providerType?: ProviderType | null;
  /** Health-test request format override. Null/absent = follow providerType default. */
  healthTestFormat?: TestFormat | null;
  // routing / options
  priority?: number | null;
  weight?: number | null;
  costMultiplier?: number | null;
  preserveClientIp?: boolean | null;
  disableSessionReuse?: boolean | null;
  // network (proxy only — no timeouts)
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean | null;
  // circuit breaker
  maxRetryAttempts?: number | null;
  circuitBreakerFailureThreshold?: number | null;
  circuitBreakerOpenDuration?: number | null;
  circuitBreakerHalfOpenSuccessThreshold?: number | null;
  // rate limits (USD)
  limit5hUsd?: number | null;
  limitDailyUsd?: number | null;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number | null;
};

const PROVIDER_TYPES = new Set<ProviderType>([
  "claude",
  "claude-auth",
  "codex",
  "gemini",
  "gemini-cli",
  "openai-compatible",
]);

const NUMBER_KEYS = [
  "priority",
  "weight",
  "costMultiplier",
  "maxRetryAttempts",
  "circuitBreakerFailureThreshold",
  "circuitBreakerOpenDuration",
  "circuitBreakerHalfOpenSuccessThreshold",
  "limit5hUsd",
  "limitDailyUsd",
  "limitWeeklyUsd",
  "limitMonthlyUsd",
  "limitTotalUsd",
  "limitConcurrentSessions",
] as const;

const BOOL_KEYS = ["preserveClientIp", "disableSessionReuse", "proxyFallbackToDirect"] as const;

function cleanNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function cleanBool(value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  return undefined;
}

function cleanProviderType(value: unknown): ProviderType | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string" && PROVIDER_TYPES.has(value as ProviderType)) {
    return value as ProviderType;
  }
  return undefined;
}

const TEST_FORMATS = new Set<TestFormat>(["response", "openai", "claude", "gemini"]);

function cleanHealthTestFormat(value: unknown): TestFormat | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string" && TEST_FORMATS.has(value as TestFormat)) {
    return value as TestFormat;
  }
  return undefined;
}

/** Normalize arbitrary JSON into a sparse shared-settings object. */
export function normalizeProviderGroupSharedSettings(
  raw: unknown
): ProviderGroupSharedSettings | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const out: ProviderGroupSharedSettings = {};

  const providerType = cleanProviderType(input.providerType);
  if (providerType !== undefined) out.providerType = providerType;
  const healthTestFormat = cleanHealthTestFormat(input.healthTestFormat);
  if (healthTestFormat !== undefined) out.healthTestFormat = healthTestFormat;

  for (const key of NUMBER_KEYS) {
    const cleaned = cleanNumber(input[key]);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  for (const key of BOOL_KEYS) {
    const cleaned = cleanBool(input[key]);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  if (input.proxyUrl !== undefined) {
    if (input.proxyUrl === null) out.proxyUrl = null;
    else if (typeof input.proxyUrl === "string") {
      const trimmed = input.proxyUrl.trim();
      out.proxyUrl = trimmed || null;
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Convert shared settings into a providers-table update payload.
 * Only defined (non-undefined) keys are emitted so partial apply works.
 */
export function sharedSettingsToProviderPatch(
  settings: ProviderGroupSharedSettings | null | undefined
): Record<string, unknown> {
  if (!settings) return {};
  const patch: Record<string, unknown> = {};

  if (settings.providerType !== undefined && settings.providerType !== null) {
    patch.providerType = settings.providerType;
  }
  if (settings.priority !== undefined && settings.priority !== null) {
    patch.priority = Math.trunc(settings.priority);
  }
  if (settings.weight !== undefined && settings.weight !== null) {
    patch.weight = settings.weight;
  }
  if (settings.costMultiplier !== undefined && settings.costMultiplier !== null) {
    patch.costMultiplier = String(settings.costMultiplier);
  }
  if (settings.preserveClientIp !== undefined && settings.preserveClientIp !== null) {
    patch.preserveClientIp = settings.preserveClientIp;
  }
  if (settings.disableSessionReuse !== undefined && settings.disableSessionReuse !== null) {
    patch.disableSessionReuse = settings.disableSessionReuse;
  }
  if (settings.proxyUrl !== undefined) {
    patch.proxyUrl = settings.proxyUrl;
  }
  if (settings.proxyFallbackToDirect !== undefined && settings.proxyFallbackToDirect !== null) {
    patch.proxyFallbackToDirect = settings.proxyFallbackToDirect;
  }
  if (settings.maxRetryAttempts !== undefined) {
    patch.maxRetryAttempts = settings.maxRetryAttempts;
  }
  if (settings.circuitBreakerFailureThreshold !== undefined) {
    patch.circuitBreakerFailureThreshold = settings.circuitBreakerFailureThreshold;
  }
  if (settings.circuitBreakerOpenDuration !== undefined) {
    patch.circuitBreakerOpenDuration = settings.circuitBreakerOpenDuration;
  }
  if (settings.circuitBreakerHalfOpenSuccessThreshold !== undefined) {
    patch.circuitBreakerHalfOpenSuccessThreshold = settings.circuitBreakerHalfOpenSuccessThreshold;
  }
  if (settings.limit5hUsd !== undefined) {
    patch.limit5hUsd = settings.limit5hUsd == null ? null : String(settings.limit5hUsd);
  }
  if (settings.limitDailyUsd !== undefined) {
    patch.limitDailyUsd = settings.limitDailyUsd == null ? null : String(settings.limitDailyUsd);
  }
  if (settings.limitWeeklyUsd !== undefined) {
    patch.limitWeeklyUsd = settings.limitWeeklyUsd == null ? null : String(settings.limitWeeklyUsd);
  }
  if (settings.limitMonthlyUsd !== undefined) {
    patch.limitMonthlyUsd =
      settings.limitMonthlyUsd == null ? null : String(settings.limitMonthlyUsd);
  }
  if (settings.limitTotalUsd !== undefined) {
    patch.limitTotalUsd = settings.limitTotalUsd == null ? null : String(settings.limitTotalUsd);
  }
  if (settings.limitConcurrentSessions !== undefined) {
    patch.limitConcurrentSessions = settings.limitConcurrentSessions;
  }

  return patch;
}
