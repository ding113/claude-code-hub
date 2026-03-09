/**
 * Determine whether a request entry has been finalized.
 *
 * A request is considered finalized when:
 * - It was blocked by a guard (blockedBy is set), OR
 * - It has a non-empty providerChain (written at finalization time), OR
 * - It has a statusCode (set when the response completes)
 *
 * Before finalization, provider info is unreliable because the upstream
 * may change due to fallback, hedge, timeout, or fake-200 detection.
 */
export function isProviderFinalized(entry: {
  providerChain?: unknown[] | null;
  statusCode?: number | null;
  blockedBy?: string | null;
}): boolean {
  if (entry.blockedBy) return true;
  if (Array.isArray(entry.providerChain) && entry.providerChain.length > 0) return true;
  if (entry.statusCode != null) return true;
  return false;
}
