import { apiGet, searchParams, toActionResult } from "./_compat";

export function getRateLimitStats(filters?: object) {
  return toActionResult(
    apiGet(`/api/v1/dashboard/rate-limit-stats${searchParams(toQuery(filters))}`)
  );
}

function toQuery(filters?: object) {
  const values = (filters ?? {}) as Record<string, unknown>;
  return {
    userId: asQuery(values.user_id ?? values.userId),
    providerId: asQuery(values.provider_id ?? values.providerId),
    keyId: asQuery(values.key_id ?? values.keyId),
    limitType: asQuery(values.limit_type ?? values.limitType),
    startTime: asQuery(values.start_time ?? values.startTime),
    endTime: asQuery(values.end_time ?? values.endTime),
  };
}

function asQuery(value: unknown): string | number | undefined {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}
