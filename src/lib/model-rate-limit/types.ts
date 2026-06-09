import type { DailyResetMode } from "@/lib/rate-limit/time-utils";

function isDisabled(raw: string | undefined): boolean {
  const v = raw?.trim();
  return v === "false" || v === "0";
}

function isEnabledExplicit(raw: string | undefined): boolean {
  const v = raw?.trim();
  return v === "true" || v === "1";
}

/**
 * Per-model rate limiting is opt-in (default OFF) and additionally requires
 * mainline rate limiting (ENABLE_RATE_LIMIT, default ON) to be enabled.
 */
export function isModelRateLimitEnabled(): boolean {
  if (!isEnabledExplicit(process.env.ENABLE_MODEL_RATE_LIMIT)) return false;
  if (isDisabled(process.env.ENABLE_RATE_LIMIT)) return false;
  return true;
}

/**
 * On Redis failure, fail open by default (mirrors mainline lease behavior).
 */
export function isModelRateLimitFailOpen(): boolean {
  return !isDisabled(process.env.MODEL_RATE_LIMIT_FAIL_OPEN);
}

// ============================================================================
// group-rate-limit contract (用户组 × 模型组) — see docs/limit/group-rate-limit.md §4
// These types model the rewritten resolver. Resolution is a PURE function over an
// in-process snapshot (built by cache.ts), so the merge/boost logic is unit-testable
// without any I/O. The legacy single-row `ModelLimit` above remains until the guard
// switches over (Phase C).
// ============================================================================

/** Limit subject dimensions (DB enum limit_subject). */
export type LimitSubjectType = "user" | "key" | "user_group";

/** Boost / cost windows (DB enum boost_window). 5 base tiers. */
export type LimitWindow = "5h" | "daily" | "weekly" | "monthly" | "total";

/** Which mainline cost axis a bucket bypasses when it is enforced. */
export type LimitAxis = "user" | "key";

/**
 * USD caps for a single bucket/source. `null` = unlimited for that window
 * (and, per §4.4, wins as +infinity in the MAX merge).
 */
export interface ModelLimitCaps {
  limit5hUsd: number | null;
  limit5hResetMode: DailyResetMode;
  dailyLimitUsd: number | null;
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  limitTotalUsd: number | null;
  limit5hCostResetAt: Date | null;
}

/** One configured limit row contributing to resolution (a "source"). */
export interface ModelLimitSource {
  subjectType: LimitSubjectType;
  subjectId: number;
  caps: ModelLimitCaps;
}

/**
 * An active temporary boost grant (D10/D11). Plain data; the snapshot holds
 * active + future grants and resolution applies `validFrom <= now < validTo`
 * in-memory (F2), so future grants activate exactly on time with zero delay.
 */
export interface BoostGrant {
  modelGroupId: number;
  window: LimitWindow;
  amountUsd: number;
  validFrom: Date;
  validTo: Date;
}

/**
 * A resolved, enforceable lease bucket for one axis on one model group.
 * `scopeId` is always measured against the request's own user/key consumption
 * (per-member semantics, D5) — user-group sources only contribute cap values.
 */
export interface ModelLimitBucket {
  axis: LimitAxis;
  scopeId: number; // userId (user axis) | keyId (key axis)
  modelGroupId: number;
  models: string[]; // group member models, for DB aggregation (model IN (...))
  caps: ModelLimitCaps;
}

/**
 * In-process resolution snapshot (built by cache.ts; §4.7/§17). Read-only maps
 * keyed for O(1) per-request resolution with zero hot-path DB round-trips.
 */
export interface ModelLimitSnapshot {
  /** model name -> model group id (global exclusivity, D6). */
  modelToGroupId: ReadonlyMap<string, number>;
  /** model group id -> member model names. */
  groupMembers: ReadonlyMap<number, readonly string[]>;
  /** `${subjectType}:${subjectId}:${modelGroupId}` -> source. */
  limits: ReadonlyMap<string, ModelLimitSource>;
  /** user tag -> user group ids registered for that tag. */
  userGroupIdsByTag: ReadonlyMap<string, readonly number[]>;
  /** userId -> active/future boost grants (filtered to now in-memory). */
  boostGrantsByUser: ReadonlyMap<number, readonly BoostGrant[]>;
}

/** Per-request resolution inputs. */
export interface ModelLimitResolveParams {
  userId: number;
  keyId?: number;
  model: string;
  tags: readonly string[];
  now: Date;
}
