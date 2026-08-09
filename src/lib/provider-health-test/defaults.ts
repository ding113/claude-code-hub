import type { ProviderType } from "@/types/provider";

/**
 * Rolling window size for online-rate averages and sparklines.
 * It does not set the minimum SLO sample count (that is one).
 * Default matches system_settings.health_test_window_size (10).
 */
export const HEALTH_TEST_WINDOW_SIZE = 10;

/** Default scheduler poll interval: 30 minutes, wall-clock aligned. */
export const HEALTH_TEST_INTERVAL_MS = 30 * 60 * 1000;

const HEALTH_TEST_INTERVAL_MIN_SECONDS = 10;
const HEALTH_TEST_INTERVAL_MAX_SECONDS = 3600;
const HEALTH_TEST_TIMEOUT_MIN_SECONDS = 5;
const HEALTH_TEST_TIMEOUT_MAX_SECONDS = 300;

function normalizeHealthTestSeconds(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/** Normalize the live system setting used for the per-provider schedule. */
export function normalizeHealthTestIntervalSeconds(value: unknown): number {
  return normalizeHealthTestSeconds(
    value,
    HEALTH_TEST_INTERVAL_MS / 1000,
    HEALTH_TEST_INTERVAL_MIN_SECONDS,
    HEALTH_TEST_INTERVAL_MAX_SECONDS
  );
}

/** Normalize the live system setting used for the scheduled request deadline. */
export function normalizeHealthTestTimeoutSeconds(value: unknown): number {
  return normalizeHealthTestSeconds(
    value,
    SCHEDULED_HEALTH_TEST_TIMEOUT_MS / 1000,
    HEALTH_TEST_TIMEOUT_MIN_SECONDS,
    HEALTH_TEST_TIMEOUT_MAX_SECONDS
  );
}

/** True when the provider has no test yet or its elapsed interval has passed. */
export function isHealthTestDue(
  lastHealthTestAt: Date | null | undefined,
  now: Date | number = Date.now(),
  intervalMs: number = HEALTH_TEST_INTERVAL_MS
): boolean {
  if (!lastHealthTestAt) return true;
  const lastTs = lastHealthTestAt.getTime();
  const nowTs = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(lastTs) || !Number.isFinite(nowTs)) return true;
  const normalizedIntervalMs =
    Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : HEALTH_TEST_INTERVAL_MS;
  return nowTs - lastTs >= normalizedIntervalMs;
}

/** Ms until the next wall-clock interval boundary (e.g. next :00 second for 60s). */
export function msUntilNextHealthTestBoundary(
  now: number = Date.now(),
  intervalMs: number = HEALTH_TEST_INTERVAL_MS
): number {
  const rem = now % intervalMs;
  return rem === 0 ? intervalMs : intervalMs - rem;
}

/**
 * Manual and scheduled health tests share the same total timeout.
 * No first-token hard deadline: first-token TTFB is measured, but slow
 * first tokens are allowed to finish within the total timeout.
 */
export const MANUAL_HEALTH_TEST_TIMEOUT_MS = 120_000;

/** Gemini thinking can be slow; use the same ceiling as other health tests. */
export const MANUAL_HEALTH_TEST_GEMINI_TIMEOUT_MS = 120_000;

/**
 * Scheduled tests need a hard total deadline so a hung upstream cannot pin
 * scheduler workers forever. No separate first-token timeout.
 */
export const SCHEDULED_HEALTH_TEST_TIMEOUT_MS = 120_000;

/**
 * Default models for scheduled + manual health tests by provider type.
 * User-specified: codex=gpt-5.6-terra, claude=claude-opus-4-6, compatible=grok-4.5.
 */
export const DEFAULT_HEALTH_TEST_MODELS: Record<ProviderType, string> = {
  codex: "gpt-5.6-terra",
  claude: "claude-opus-4-6",
  "claude-auth": "claude-opus-4-6",
  "openai-compatible": "grok-4.5",
  gemini: "gemini-2.5-flash",
  "gemini-cli": "gemini-2.5-flash",
};

export function getDefaultHealthTestModel(providerType: ProviderType): string {
  return DEFAULT_HEALTH_TEST_MODELS[providerType] ?? "gpt-4.1-mini";
}

/**
 * Default site-wide per-provider daily health-test spend cap (display currency units).
 * Stored on system_settings.health_test_per_provider_daily_budget (default 0.1).
 * Same cap for every provider; over budget suspends only that provider.
 */
export const HEALTH_TEST_PROVIDER_DAILY_BUDGET_DEFAULT = 0.1;

/**
 * Default global daily scheduled health-test spend cap (display currency units).
 * Stored on system_settings.health_test_daily_budget_cny; override via UI.
 * Over budget → disable ALL scheduled health tests until next local day (midnight reset).
 */
export const HEALTH_TEST_GLOBAL_DAILY_BUDGET_DEFAULT = 1;

/** @deprecated use HEALTH_TEST_GLOBAL_DAILY_BUDGET_DEFAULT */
export const HEALTH_TEST_DAILY_BUDGET_CNY = HEALTH_TEST_GLOBAL_DAILY_BUDGET_DEFAULT;

/**
 * Normalize a budget amount for comparisons (no FX; display units as-is).
 */
export function healthTestDailyBudgetAmount(
  amount: number = HEALTH_TEST_GLOBAL_DAILY_BUDGET_DEFAULT
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return amount;
}

/** @deprecated alias */
export function healthTestDailyBudgetUsd(
  amount: number = HEALTH_TEST_GLOBAL_DAILY_BUDGET_DEFAULT
): number {
  return healthTestDailyBudgetAmount(amount);
}

export function isHealthTestOverDailyBudget(
  costAmount: number | null | undefined,
  budgetAmount: number = healthTestDailyBudgetAmount()
): boolean {
  if (costAmount == null || !Number.isFinite(costAmount)) return false;
  if (!Number.isFinite(budgetAmount) || budgetAmount <= 0) return false;
  return costAmount >= budgetAmount;
}
