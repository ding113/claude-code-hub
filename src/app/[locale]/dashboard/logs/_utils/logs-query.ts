export interface LogsUrlFilters {
  userId?: number;
  keyId?: number;
  providerId?: number;
  sessionId?: string;
  startTime?: number;
  endTime?: number;
  statusCode?: number;
  excludeStatusCode200?: boolean;
  model?: string;
  endpoint?: string;
  minRetryCount?: number;
  page?: number;
}

function firstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseIntParam(value: string | string[] | undefined): number | undefined {
  const raw = firstString(value);
  if (!raw) return undefined;
  const num = Number.parseInt(raw, 10);
  return Number.isFinite(num) ? num : undefined;
}

function parseStringParam(value: string | string[] | undefined): string | undefined {
  const raw = firstString(value);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseLogsUrlFilters(searchParams: {
  [key: string]: string | string[] | undefined;
}): LogsUrlFilters {
  const statusCodeParam = parseStringParam(searchParams.statusCode);

  const statusCode =
    statusCodeParam && statusCodeParam !== "!200" ? Number.parseInt(statusCodeParam, 10) : undefined;

  return {
    userId: parseIntParam(searchParams.userId),
    keyId: parseIntParam(searchParams.keyId),
    providerId: parseIntParam(searchParams.providerId),
    sessionId: parseStringParam(searchParams.sessionId),
    startTime: parseIntParam(searchParams.startTime),
    endTime: parseIntParam(searchParams.endTime),
    statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
    excludeStatusCode200: statusCodeParam === "!200",
    model: parseStringParam(searchParams.model),
    endpoint: parseStringParam(searchParams.endpoint),
    minRetryCount: parseIntParam(searchParams.minRetry),
    page: parseIntParam(searchParams.page),
  };
}

export function buildLogsUrlQuery(filters: LogsUrlFilters): URLSearchParams {
  const query = new URLSearchParams();

  if (filters.userId) query.set("userId", filters.userId.toString());
  if (filters.keyId) query.set("keyId", filters.keyId.toString());
  if (filters.providerId) query.set("providerId", filters.providerId.toString());

  const sessionId = filters.sessionId?.trim();
  if (sessionId) query.set("sessionId", sessionId);

  if (filters.startTime) query.set("startTime", filters.startTime.toString());
  if (filters.endTime) query.set("endTime", filters.endTime.toString());

  if (filters.excludeStatusCode200) {
    query.set("statusCode", "!200");
  } else if (filters.statusCode !== undefined) {
    query.set("statusCode", filters.statusCode.toString());
  }

  if (filters.model) query.set("model", filters.model);
  if (filters.endpoint) query.set("endpoint", filters.endpoint);

  if (filters.minRetryCount !== undefined) {
    query.set("minRetry", filters.minRetryCount.toString());
  }

  if (filters.page) query.set("page", filters.page.toString());

  return query;
}

