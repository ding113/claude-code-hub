/**
 * Lease Module
 *
 * Budget slicing mechanism for rate limiting.
 * DB is authoritative, Redis stores lease slices.
 */

import {
  DEFAULT_LEASE_TTL_SECONDS,
  HIGH_CONCURRENCY_MIN_LEASE_TTL_SECONDS,
} from "./quota-lease-constants";
import {
  type DailyResetMode,
  getTimeRangeForPeriodWithMode,
  getTTLForPeriodWithMode,
  type TimePeriod,
} from "./time-utils";

/**
 * Lease window types
 */
export const LeaseWindow = ["5h", "daily", "weekly", "monthly"] as const;
export type LeaseWindowType = (typeof LeaseWindow)[number];

/**
 * Entity types that can have leases
 */
export const LeaseEntityType = ["key", "user", "provider"] as const;
export type LeaseEntityTypeType = (typeof LeaseEntityType)[number];

/**
 * Lease refresh coordination.
 *
 * - Refreshes for one entity are single-flight inside a process and across processes (Redis lock).
 * - A lease key outlives its logical TTL by LEASE_STALE_GRACE_SECONDS so that, while another process
 *   refreshes, callers can keep using the expired lease. A stale lease never grants new budget: its
 *   remainingBudget keeps being decremented by settlement, so the over-spend bound stays one slice.
 */
export const LEASE_REFRESH_LOCK_TTL_SECONDS = 3;
export const LEASE_REFRESH_WAIT_MS = 1_000;
export const LEASE_REFRESH_POLL_MS = 25;
export const LEASE_STALE_GRACE_SECONDS = 10;

/** High-concurrency mode trades quota freshness for fewer usage_ledger aggregations. */
export { DEFAULT_LEASE_TTL_SECONDS, HIGH_CONCURRENCY_MIN_LEASE_TTL_SECONDS };
export const TOTAL_COST_CACHE_TTL_SECONDS = 300;
export const HIGH_CONCURRENCY_TOTAL_COST_CACHE_TTL_SECONDS = 900;

export function resolveLeaseTtlSeconds(
  configuredSeconds: number | null | undefined,
  highConcurrencyMode: boolean
): number {
  const configured =
    typeof configuredSeconds === "number" &&
    Number.isFinite(configuredSeconds) &&
    configuredSeconds > 0
      ? configuredSeconds
      : DEFAULT_LEASE_TTL_SECONDS;
  return highConcurrencyMode
    ? Math.max(configured, HIGH_CONCURRENCY_MIN_LEASE_TTL_SECONDS)
    : configured;
}

export function resolveTotalCostCacheTtlSeconds(highConcurrencyMode: boolean): number {
  return highConcurrencyMode
    ? HIGH_CONCURRENCY_TOTAL_COST_CACHE_TTL_SECONDS
    : TOTAL_COST_CACHE_TTL_SECONDS;
}

export function buildLeaseRefreshLockKey(
  entityType: LeaseEntityTypeType,
  entityId: number
): string {
  return `lease:refresh_lock:${entityType}:${entityId}`;
}

/**
 * Budget lease structure
 */
export interface BudgetLease {
  entityType: LeaseEntityTypeType;
  entityId: number;
  window: LeaseWindowType;
  resetMode: DailyResetMode;
  resetTime: string;
  snapshotAtMs: number;
  currentUsage: number;
  limitAmount: number;
  remainingBudget: number;
  ttlSeconds: number;
  costResetAtMs?: number | null;
  windowResetAtMs?: number | null;
}

/**
 * Create a budget lease object
 */
export function createBudgetLease(params: BudgetLease): BudgetLease {
  return { ...params };
}

/**
 * Build Redis key for a lease
 * Format: lease:{entityType}:{entityId}:{window}
 */
export function buildLeaseKey(
  entityType: LeaseEntityTypeType,
  entityId: number,
  window: LeaseWindowType,
  resetMode?: DailyResetMode
): string {
  const effectiveResetMode = resetMode ?? (window === "5h" ? "rolling" : "fixed");
  if (window === "5h" || window === "daily") {
    return `lease:${entityType}:${entityId}:${window}:${effectiveResetMode}`;
  }
  return `lease:${entityType}:${entityId}:${window}`;
}

/**
 * Get time range for a lease window
 * Delegates to time-utils for consistent behavior
 */
export async function getLeaseTimeRange(
  window: LeaseWindowType,
  resetTime = "00:00",
  mode: DailyResetMode = "fixed"
): Promise<{ startTime: Date; endTime: Date }> {
  return getTimeRangeForPeriodWithMode(window as TimePeriod, resetTime, mode);
}

/**
 * Get TTL in seconds for a lease window
 * Delegates to time-utils for consistent behavior
 */
export async function getLeaseTtlSeconds(
  window: LeaseWindowType,
  resetTime = "00:00",
  mode: DailyResetMode = "fixed"
): Promise<number> {
  return getTTLForPeriodWithMode(window as TimePeriod, resetTime, mode);
}

/**
 * Calculate lease slice parameters
 */
export interface CalculateLeaseSliceParams {
  limitAmount: number;
  currentUsage: number;
  percent: number;
  capUsd?: number;
}

/**
 * Calculate lease slice as percentage of limit
 * Returns min(limit * percent, remaining budget, capUsd)
 * Rounded to 4 decimal places
 */
export function calculateLeaseSlice(params: CalculateLeaseSliceParams): number {
  const { limitAmount, currentUsage, percent, capUsd } = params;

  const remaining = Math.max(0, limitAmount - currentUsage);
  if (remaining === 0) {
    return 0;
  }

  // Clamp percent to valid range [0, 1]
  const safePercent = Math.min(1, Math.max(0, percent));
  let slice = limitAmount * safePercent;

  // Cap by remaining budget
  slice = Math.min(slice, remaining);

  // Cap by USD limit if provided (ensure non-negative)
  if (capUsd !== undefined) {
    slice = Math.min(slice, Math.max(0, capUsd));
  }

  // Round to 4 decimal places, ensure non-negative
  return Math.max(0, Math.round(slice * 10000) / 10000);
}

/**
 * Serialize a lease to JSON string for Redis storage
 */
export function serializeLease(lease: BudgetLease): string {
  return JSON.stringify(lease);
}

/**
 * Deserialize a lease from JSON string
 * Returns null if invalid JSON or incomplete data
 */
export function deserializeLease(json: string): BudgetLease | null {
  try {
    const parsed = JSON.parse(json);

    // Validate required fields
    if (
      typeof parsed.entityType !== "string" ||
      typeof parsed.entityId !== "number" ||
      typeof parsed.window !== "string" ||
      typeof parsed.resetMode !== "string" ||
      typeof parsed.resetTime !== "string" ||
      typeof parsed.snapshotAtMs !== "number" ||
      typeof parsed.currentUsage !== "number" ||
      typeof parsed.limitAmount !== "number" ||
      typeof parsed.remainingBudget !== "number" ||
      typeof parsed.ttlSeconds !== "number"
    ) {
      return null;
    }

    return parsed as BudgetLease;
  } catch {
    return null;
  }
}

/**
 * Check if a lease has expired based on its TTL
 */
export function isLeaseExpired(lease: BudgetLease): boolean {
  const now = Date.now();
  const expiresAt = lease.snapshotAtMs + lease.ttlSeconds * 1000;
  return now >= expiresAt;
}
