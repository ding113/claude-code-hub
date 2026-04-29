import type { Context } from "hono";
import type { ActionResult } from "@/actions/types";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import {
  createProblemResponse,
  fromZodError,
  publicActionErrorDetail,
} from "@/lib/api/v1/_shared/error-envelope";
import { parseHonoJsonBody } from "@/lib/api/v1/_shared/request-body";
import { jsonResponse } from "@/lib/api/v1/_shared/response-helpers";
import {
  UsageLogExportJobParamSchema,
  UsageLogSessionSuggestionsQuerySchema,
  type UsageLogsActionQueryInput,
  UsageLogsExportCreateSchema,
  UsageLogsQuerySchema,
} from "@/lib/api/v1/schemas/usage-logs";

export async function listUsageLogs(c: Context): Promise<Response> {
  const query = parseUsageLogsQuery(c);
  if (query instanceof Response) return query;
  const actions = await import("@/actions/usage-logs");
  const result = query.cursor
    ? await callAction(c, actions.getUsageLogsBatch, [query] as never[], c.get("auth"))
    : await callAction(c, actions.getUsageLogs, [query] as never[], c.get("auth"));
  return result.ok
    ? jsonResponse(toUsageLogsListResponse(result.data, query))
    : actionError(c, result);
}

export async function getUsageLogsStats(c: Context): Promise<Response> {
  const query = parseUsageLogsQuery(c);
  if (query instanceof Response) return query;
  const actions = await import("@/actions/usage-logs");
  return actionJson(
    c,
    await callAction(c, actions.getUsageLogsStats, [query] as never[], c.get("auth"))
  );
}

export async function getFilterOptions(c: Context): Promise<Response> {
  const actions = await import("@/actions/usage-logs");
  return actionJson(c, await callAction(c, actions.getFilterOptions, [], c.get("auth")));
}

export async function getModelList(c: Context): Promise<Response> {
  const actions = await import("@/actions/usage-logs");
  const result = await callAction(c, actions.getModelList, [], c.get("auth"));
  return result.ok ? jsonResponse({ items: result.data }) : actionError(c, result);
}

export async function getStatusCodeList(c: Context): Promise<Response> {
  const actions = await import("@/actions/usage-logs");
  const result = await callAction(c, actions.getStatusCodeList, [], c.get("auth"));
  return result.ok ? jsonResponse({ items: result.data }) : actionError(c, result);
}

export async function getEndpointList(c: Context): Promise<Response> {
  const actions = await import("@/actions/usage-logs");
  const result = await callAction(c, actions.getEndpointList, [], c.get("auth"));
  return result.ok ? jsonResponse({ items: result.data }) : actionError(c, result);
}

export async function suggestSessionIds(c: Context): Promise<Response> {
  const query = UsageLogSessionSuggestionsQuerySchema.safeParse({
    term: c.req.query("term") ?? c.req.query("q") ?? "",
    userId: c.req.query("userId"),
    keyId: c.req.query("keyId"),
    providerId: c.req.query("providerId"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/usage-logs");
  const result = await callAction(
    c,
    actions.getUsageLogSessionIdSuggestions,
    [query.data] as never[],
    c.get("auth")
  );
  return result.ok ? jsonResponse({ items: result.data }) : actionError(c, result);
}

export async function createUsageLogsExport(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, UsageLogsExportCreateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/usage-logs");
  const preferAsync = (c.req.header("prefer") ?? "").toLowerCase().includes("respond-async");
  const result = preferAsync
    ? await callAction(c, actions.startUsageLogsExport, [body.data] as never[], c.get("auth"))
    : await callAction(c, actions.exportUsageLogs, [body.data] as never[], c.get("auth"));
  if (!result.ok) return actionError(c, result);

  if (preferAsync) {
    const jobId = (result.data as { jobId: string }).jobId;
    return jsonResponse(
      { jobId, status: "queued", statusUrl: `/api/v1/usage-logs/exports/${jobId}` },
      { status: 202, headers: { Location: `/api/v1/usage-logs/exports/${jobId}` } }
    );
  }

  return jsonResponse({ csv: result.data });
}

export async function getUsageLogsExportStatus(c: Context): Promise<Response> {
  const params = parseJobParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/usage-logs");
  return actionJson(
    c,
    await callAction(c, actions.getUsageLogsExportStatus, [params.jobId] as never[], c.get("auth"))
  );
}

export async function downloadUsageLogsExport(c: Context): Promise<Response> {
  const params = parseJobParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/usage-logs");
  const result = await callAction(
    c,
    actions.downloadUsageLogsExport,
    [params.jobId] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return new Response(String(result.data), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="usage-logs-${params.jobId}.csv"`,
    },
  });
}

function parseUsageLogsQuery(c: Context): UsageLogsActionQueryInput | Response {
  const query = UsageLogsQuerySchema.safeParse({
    cursorCreatedAt: c.req.query("cursorCreatedAt"),
    cursorId: c.req.query("cursorId"),
    limit: c.req.query("limit"),
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
    sessionId: c.req.query("sessionId"),
    userId: c.req.query("userId"),
    keyId: c.req.query("keyId"),
    providerId: c.req.query("providerId"),
    model: c.req.query("model"),
    statusCode: c.req.query("statusCode"),
    excludeStatusCode200: c.req.query("excludeStatusCode200"),
    endpoint: c.req.query("endpoint"),
    minRetryCount: c.req.query("minRetryCount"),
    startTime: c.req.query("startTime"),
    endTime: c.req.query("endTime"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const { cursorCreatedAt, cursorId, ...rest } = query.data;
  return {
    ...rest,
    cursor: cursorCreatedAt && cursorId ? { createdAt: cursorCreatedAt, id: cursorId } : undefined,
  };
}

function parseJobParams(c: Context): { jobId: string } | Response {
  const params = UsageLogExportJobParamSchema.safeParse({ jobId: c.req.param("jobId") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  return params.data;
}

function actionJson<T>(c: Context, result: ActionResult<T>): Response {
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data ?? { ok: true });
}

function toUsageLogsListResponse(data: unknown, query: UsageLogsActionQueryInput) {
  const body = data as {
    logs?: unknown[];
    nextCursor?: { createdAt: string; id: number } | string | null;
    hasMore?: boolean;
    total?: number;
    page?: number;
    pageSize?: number;
  };

  if (query.cursor || body.nextCursor !== undefined || body.hasMore !== undefined) {
    return {
      items: body.logs ?? [],
      pageInfo: {
        nextCursor: normalizeUsageLogsCursor(body.nextCursor),
        hasMore: Boolean(body.hasMore),
        limit: query.limit,
      },
    };
  }

  const page = body.page ?? query.page ?? 1;
  const pageSize = body.pageSize ?? query.pageSize ?? query.limit;
  const total = body.total ?? body.logs?.length ?? 0;
  return {
    items: body.logs ?? [],
    pageInfo: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

function normalizeUsageLogsCursor(
  cursor: { createdAt: string; id: number } | string | null | undefined
): string | null {
  if (!cursor) return null;
  if (typeof cursor === "string") return cursor;
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const status =
    detail.includes("not found") || detail.includes("不存在")
      ? 404
      : detail.includes("权限")
        ? 403
        : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: result.errorCode ?? "usage_logs.action_failed",
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
