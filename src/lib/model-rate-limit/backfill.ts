/**
 * Complete-split settle seam (group-rate-limit §5.2.4 / §5.3).
 *
 * Externalizes the logic the hot-path response-handler needs at billing time so
 * that file keeps only tiny call sites:
 *  - resolveCountedFlags: freeze per-axis counted_in_*_global from the guard's
 *    bypass flags (countedInX = !bypassX). Written with cost_usd; default true.
 *  - modelBucketDecrements: decrement every resolved model bucket's lease. The
 *    model bucket is its own budget and is decremented unconditionally, even on
 *    the axis whose mainline global decrement was skipped (§5.3).
 *
 * Structural session typing keeps this decoupled from the proxy ProxySession so
 * it stays unit-testable without the full request context.
 */

import { BucketRateLimitService } from "./bucket-service";
import type { ModelLimitBucket } from "./types";

export interface CountedFlags {
  countedInUserGlobal: boolean;
  countedInKeyGlobal: boolean;
}

interface BackfillSession {
  getBypassUserGlobalCost(): boolean;
  getBypassKeyGlobalCost(): boolean;
  getResolvedModelLimits(): ModelLimitBucket[];
}

/**
 * counted_in_*_global = !bypass*. A split axis (bypass=true) is not counted globally.
 *
 * Bugfix #02 safety is enforced earlier: when the forwarder switches provider it
 * calls `session.changeProvider(...)`, and the model rate-limit guard's listener
 * resets `bypass*` to false whenever buckets are no longer resolved for that
 * axis. This keeps the simple `counted = !bypass` contract here while still
 * preventing stale bypass flags from skipping the global window on failover.
 */
export function resolveCountedFlags(session: BackfillSession): CountedFlags {
  return {
    countedInUserGlobal: !session.getBypassUserGlobalCost(),
    countedInKeyGlobal: !session.getBypassKeyGlobalCost(),
  };
}

/** One lease decrement per resolved model bucket (empty when none resolved). */
export function modelBucketDecrements(
  session: BackfillSession,
  costFloat: number
): Promise<unknown>[] {
  return session
    .getResolvedModelLimits()
    .map((bucket) => BucketRateLimitService.decrementLease(bucket, costFloat));
}
