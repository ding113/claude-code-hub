/**
 * Lease Module
 *
 * Budget slicing mechanism for rate limiting.
 * DB is authoritative, Redis stores lease slices.
 */

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
  window: LeaseWindowType
): string {
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
