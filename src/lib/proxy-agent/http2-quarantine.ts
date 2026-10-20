type Http2TransportRoute = {
  targetUrl: string;
  proxyUrl?: string | null;
};

const HTTP2_QUARANTINE_TTL_MS = 5 * 60 * 1000;
const HTTP2_QUARANTINE_MAX_ROUTES = 1024;

const quarantinedRoutes = new Map<string, number>();

function normalizeOrigin(value: string): string {
  return new URL(value).origin;
}

function pruneExpired(now: number): void {
  for (const [key, expiresAt] of quarantinedRoutes) {
    if (expiresAt <= now) quarantinedRoutes.delete(key);
  }
}

export function getHttp2TransportKey(route: Http2TransportRoute): string {
  const targetOrigin = normalizeOrigin(route.targetUrl);
  const proxyOrigin = route.proxyUrl ? normalizeOrigin(route.proxyUrl) : "direct";
  return `${targetOrigin}|${proxyOrigin}`;
}

export function isHttp2TransportQuarantined(route: Http2TransportRoute): boolean {
  const now = Date.now();
  pruneExpired(now);
  const expiresAt = quarantinedRoutes.get(getHttp2TransportKey(route));
  return expiresAt !== undefined && expiresAt > now;
}

export function quarantineHttp2Transport(route: Http2TransportRoute): void {
  const now = Date.now();
  pruneExpired(now);
  const key = getHttp2TransportKey(route);

  // Refresh the route's TTL and insertion order so repeatedly failing routes stay
  // visible while the map remains bounded by the oldest known route.
  quarantinedRoutes.delete(key);
  quarantinedRoutes.set(key, now + HTTP2_QUARANTINE_TTL_MS);

  while (quarantinedRoutes.size > HTTP2_QUARANTINE_MAX_ROUTES) {
    const oldestKey = quarantinedRoutes.keys().next().value;
    if (oldestKey === undefined) break;
    quarantinedRoutes.delete(oldestKey);
  }
}

export function clearHttp2TransportQuarantine(): void {
  quarantinedRoutes.clear();
}
