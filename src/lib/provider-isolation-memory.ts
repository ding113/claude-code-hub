const isolationMap = new Map<number, number>(); // providerId -> expiresAt (ms)
const DEFAULT_TTL_MS = 30_000;

export function setInMemoryIsolation(providerId: number, ttlMs = DEFAULT_TTL_MS): void {
  isolationMap.set(providerId, Date.now() + ttlMs);
}

export function isInMemoryIsolated(providerId: number): boolean {
  const expiresAt = isolationMap.get(providerId);
  if (!expiresAt) {
    return false;
  }
  if (expiresAt <= Date.now()) {
    isolationMap.delete(providerId);
    return false;
  }
  return true;
}

export function getInMemoryIsolationTTL(): number {
  return DEFAULT_TTL_MS;
}
