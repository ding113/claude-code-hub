import "server-only";

/**
 * Per-process singleflight for rolling-cost display cache loads.
 *
 * Problem (review M2): when a rolling display cache entry expires, every
 * concurrent caller in the same process used to issue its own
 * `SUM(cost_usd)` query, briefly multiplying DB load by the in-flight count.
 * The collision window is short (one DB SUM, ~ms) but it does coincide with
 * fleet rollouts and TTL-aligned expirations, which are exactly the moments
 * the rest of the system is also under load.
 *
 * Contract:
 * - Concurrent calls with the same key share a single loader execution.
 * - On resolve OR reject the in-flight entry is cleared immediately, so the
 *   next caller re-runs the loader (no negative caching here -- the layer
 *   above is responsible for ttl-based caching).
 * - Process-local only. Fleet-wide coalescing would need a redis lock and
 *   is intentionally out of scope -- per-replica deduplication already
 *   eliminates the dominant `in_flight × replicas` factor.
 */
const inFlight = new Map<string, Promise<number>>();

export function withRollingCostSingleflight(
  key: string,
  loader: () => Promise<number>
): Promise<number> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      return await loader();
    } finally {
      // Clear synchronously after the promise settles so the next caller
      // recomputes. Using finally covers both resolve and reject paths.
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/**
 * Test-only helper: clear in-flight state between cases. Production code
 * never needs this -- the map self-clears as promises settle.
 */
export function __resetCostSingleflightForTests(): void {
  inFlight.clear();
}
