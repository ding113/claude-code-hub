import type { Context } from "hono";
import type { ActionResult } from "@/actions/types";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import {
  createProblemResponse,
  fromZodError,
  publicActionErrorDetail,
} from "@/lib/api/v1/_shared/error-envelope";
import { jsonResponse } from "@/lib/api/v1/_shared/response-helpers";
import {
  MeIpGeoParamSchema,
  MeIpGeoQuerySchema,
  MeStatsSummaryQuerySchema,
  type MeUsageLogsActionQueryInput,
  MeUsageLogsQuerySchema,
} from "@/lib/api/v1/schemas/me";

export async function getMeMetadata(c: Context): Promise<Response> {
  const actions = await import("@/actions/my-usage");
  return actionJson(c, await callAction(c, actions.getMyUsageMetadata, [], c.get("auth")));
}

export async function getMeQuota(c: Context): Promise<Response> {
  const actions = await import("@/actions/my-usage");
  return actionJson(c, await callAction(c, actions.getMyQuota, [], c.get("auth")));
}

export async function getMeToday(c: Context): Promise<Response> {
  const actions = await import("@/actions/my-usage");
  return actionJson(c, await callAction(c, actions.getMyTodayStats, [], c.get("auth")));
}

export async function listMeUsageLogs(c: Context): Promise<Response> {
  const query = parseMeUsageLogsQuery(c);
  if (query instanceof Response) return query;
  const actions = await import("@/actions/my-usage");
  const result = query.cursor
    ? await callAction(c, actions.getMyUsageLogsBatch, [query] as never[], c.get("auth"))
    : await callAction(c, actions.getMyUsageLogs, [query] as never[], c.get("auth"));
  return result.ok
    ? jsonResponse(toMeUsageLogsListResponse(result.data, query))
    : actionError(c, result);
}

export async function listMeUsageLogsFull(c: Context): Promise<Response> {
  const query = parseMeUsageLogsQuery(c);
  if (query instanceof Response) return query;
  const actions = await import("@/actions/my-usage");
  return actionJson(
    c,
    await callAction(c, actions.getMyUsageLogsBatchFull, [query] as never[], c.get("auth"))
  );
}

export async function listMeUsageModels(c: Context): Promise<Response> {
  const actions = await import("@/actions/my-usage");
  const result = await callAction(c, actions.getMyAvailableModels, [], c.get("auth"));
  return result.ok ? jsonResponse({ items: result.data }) : actionError(c, result);
}

export async function listMeUsageEndpoints(c: Context): Promise<Response> {
  const actions = await import("@/actions/my-usage");
  const result = await callAction(c, actions.getMyAvailableEndpoints, [], c.get("auth"));
  return result.ok ? jsonResponse({ items: result.data }) : actionError(c, result);
}

export async function getMeStatsSummary(c: Context): Promise<Response> {
  const query = MeStatsSummaryQuerySchema.safeParse({
    startDate: c.req.query("startDate"),
    endDate: c.req.query("endDate"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/my-usage");
  return actionJson(
    c,
    await callAction(c, actions.getMyStatsSummary, [query.data] as never[], c.get("auth"))
  );
}

export async function getMeIpGeo(c: Context): Promise<Response> {
  const params = MeIpGeoParamSchema.safeParse({ ip: c.req.param("ip") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const query = MeIpGeoQuerySchema.safeParse({ lang: c.req.query("lang") });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/my-usage");
  return actionJson(
    c,
    await callAction(
      c,
      actions.getMyIpGeoDetails,
      [{ ip: params.data.ip, lang: query.data.lang }] as never[],
      c.get("auth")
    )
  );
}

function parseMeUsageLogsQuery(c: Context): MeUsageLogsActionQueryInput | Response {
  const query = MeUsageLogsQuerySchema.safeParse({
    cursorCreatedAt: c.req.query("cursorCreatedAt"),
    cursorId: c.req.query("cursorId"),
    limit: c.req.query("limit"),
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
    startDate: c.req.query("startDate"),
    endDate: c.req.query("endDate"),
    startTime: c.req.query("startTime"),
    endTime: c.req.query("endTime"),
    sessionId: c.req.query("sessionId"),
    model: c.req.query("model"),
    statusCode: c.req.query("statusCode"),
    excludeStatusCode200: c.req.query("excludeStatusCode200"),
    endpoint: c.req.query("endpoint"),
    minRetryCount: c.req.query("minRetryCount"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const { cursorCreatedAt, cursorId, ...rest } = query.data;
  return {
    ...rest,
    cursor: cursorCreatedAt && cursorId ? { createdAt: cursorCreatedAt, id: cursorId } : undefined,
  };
}

function actionJson<T>(c: Context, result: ActionResult<T>): Response {
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data ?? { ok: true });
}

function toMeUsageLogsListResponse(data: unknown, query: MeUsageLogsActionQueryInput) {
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
    result.errorCode === "UNAUTHORIZED" || detail.toLowerCase().includes("unauthorized")
      ? 401
      : result.errorCode === "NOT_FOUND" ||
          detail.toLowerCase().includes("not found") ||
          detail.includes("不存在")
        ? 404
        : detail.includes("权限")
          ? 403
          : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: result.errorCode ?? "me.action_failed",
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
