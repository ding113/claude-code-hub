const PROVIDER_FAILURE_STATUSES = new Set([401, 402, 403, 408, 429, 451]);

export function shouldRecordProviderCircuitFailure(statusCode: number): boolean {
  if (statusCode >= 500) {
    return true;
  }

  return PROVIDER_FAILURE_STATUSES.has(statusCode);
}
