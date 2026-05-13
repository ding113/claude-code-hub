/**
 * Short-TTL in-memory cache for provider endpoints known to NOT support the
 * OpenAI Responses WebSocket transport.
 *
 * Populated when an upstream WebSocket handshake is rejected or closes before
 * emitting any response event. Used by the forwarder to skip the WS attempt
 * and go straight to HTTP for the duration of the TTL. Not persisted to Redis
 * or disk; a process restart clears the cache (which is fine — the next
 * request simply re-probes once and re-caches if still unsupported).
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;

type Entry = {
  expiresAt: number;
  reason: string;
};

const cache = new Map<string, Entry>();

function buildKey(providerId: number, endpointId: number | null | undefined): string {
  return `${providerId}:${endpointId ?? "default"}`;
}

export function markResponsesWsUnsupported(
  providerId: number,
  endpointId: number | null | undefined,
  reason: string,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  cache.set(buildKey(providerId, endpointId), {
    expiresAt: Date.now() + Math.max(1000, ttlMs),
    reason,
  });
}

export function isResponsesWsUnsupported(
  providerId: number,
  endpointId: number | null | undefined
): { unsupported: boolean; reason?: string } {
  const key = buildKey(providerId, endpointId);
  const entry = cache.get(key);
  if (!entry) return { unsupported: false };
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return { unsupported: false };
  }
  return { unsupported: true, reason: entry.reason };
}

export function clearResponsesWsUnsupportedCache(): void {
  cache.clear();
}
