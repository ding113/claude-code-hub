import { createHash } from "node:crypto";
import type { LeaseWindowType } from "@/lib/rate-limit/lease";
import type { DailyResetMode } from "@/lib/rate-limit/time-utils";

export type ModelScopeType = "user" | "key";

/**
 * Hash a normalized model name into a short, Redis-key-safe token.
 * Raw model strings may contain "/" or ":" which collide with key delimiters.
 */
export function modelHash(model: string): string {
  return createHash("sha1").update(model).digest("hex").slice(0, 16);
}

/**
 * Build the Redis lease key for a (scope, model, window) tuple.
 * Prefixes (lease:user-model: / lease:key-model:) are disjoint from the
 * mainline lease:user: / lease:key: namespaces so the two never collide.
 */
export function buildModelLeaseKey(
  scopeType: ModelScopeType,
  scopeId: number,
  model: string,
  window: LeaseWindowType,
  resetMode?: DailyResetMode
): string {
  const prefix = scopeType === "user" ? "lease:user-model" : "lease:key-model";
  const hash = modelHash(model);
  const effectiveResetMode = resetMode ?? (window === "5h" ? "rolling" : "fixed");
  if (window === "5h" || window === "daily") {
    return `${prefix}:${scopeId}:${hash}:${window}:${effectiveResetMode}`;
  }
  return `${prefix}:${scopeId}:${hash}:${window}`;
}

/**
 * Build the Redis lease key for a (axis, scope, model group, window) bucket (§6).
 * Namespaced under lease:user-mg: / lease:key-mg: — disjoint from both the
 * mainline lease:user: / lease:key: and the legacy single-model namespaces.
 */
export function buildModelGroupLeaseKey(
  axis: ModelScopeType,
  scopeId: number,
  modelGroupId: number,
  window: LeaseWindowType,
  resetMode?: DailyResetMode
): string {
  const prefix = axis === "user" ? "lease:user-mg" : "lease:key-mg";
  const effectiveResetMode = resetMode ?? (window === "5h" ? "rolling" : "fixed");
  if (window === "5h" || window === "daily") {
    return `${prefix}:${scopeId}:${modelGroupId}:${window}:${effectiveResetMode}`;
  }
  return `${prefix}:${scopeId}:${modelGroupId}:${window}`;
}
