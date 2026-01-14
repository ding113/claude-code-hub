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
  const pageRaw = parseIntParam(searchParams.page);
  const page = pageRaw && pageRaw >= 1 ? pageRaw : undefined;

  const statusCode =
    statusCodeParam && statusCodeParam !== "!200"
      ? Number.parseInt(statusCodeParam, 10)
      : undefined;

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
    page,
  };
}

export function buildLogsUrlQuery(filters: LogsUrlFilters): URLSearchParams {
  const query = new URLSearchParams();

  if (filters.userId !== undefined) query.set("userId", filters.userId.toString());
  if (filters.keyId !== undefined) query.set("keyId", filters.keyId.toString());
  if (filters.providerId !== undefined) query.set("providerId", filters.providerId.toString());

  const sessionId = filters.sessionId?.trim();
  if (sessionId) query.set("sessionId", sessionId);

  if (filters.startTime !== undefined) query.set("startTime", filters.startTime.toString());
  if (filters.endTime !== undefined) query.set("endTime", filters.endTime.toString());

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

  if (filters.page !== undefined && filters.page > 1) {
    query.set("page", filters.page.toString());
  }

  return query;
}
