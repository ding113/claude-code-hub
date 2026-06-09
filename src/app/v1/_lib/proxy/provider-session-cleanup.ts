import { logger } from "@/lib/logger";
import { RateLimitService } from "@/lib/rate-limit";
import type { ProxySession } from "./session";

/**
 * bugfix #03 compensating release for provider session refs.
 *
 * The `provider` guard step ZADD's the request into `provider:{id}:active_sessions`
 * before later guards (`rateLimit`, `modelRateLimit`) run. If one of those later
 * guards throws (e.g. RateLimitError), the ZSET entry would otherwise leak
 * until `SESSION_TTL_MS` aged it out, causing the provider to falsely report
 * itself at capacity. This helper drains all recorded refs and fires the
 * release calls; `drainProviderSessionRefs` keeps the operation idempotent so
 * the forwarder's per-failure `consumeProviderSessionRef` cannot double-release.
 */
export async function releaseAllProviderSessionRefs(session: ProxySession): Promise<void> {
  if (!session.sessionId) return;
  // Tolerate legacy / mocked sessions that don't expose the drain API.
  const drain = (session as unknown as { drainProviderSessionRefs?: () => number[] })
    .drainProviderSessionRefs;
  if (typeof drain !== "function") return;
  const refs = drain.call(session);
  if (!Array.isArray(refs) || refs.length === 0) return;
  for (const providerId of refs) {
    try {
      await RateLimitService.releaseProviderSession(providerId, session.sessionId);
    } catch (error) {
      logger.warn("[ProviderSessionCleanup] release failed", {
        providerId,
        sessionId: session.sessionId,
        error,
      });
    }
  }
}
