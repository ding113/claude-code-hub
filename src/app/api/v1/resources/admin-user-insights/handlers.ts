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
  AdminUserInsightDateQuerySchema,
  AdminUserInsightIdParamSchema,
  AdminUserInsightKeyTrendQuerySchema,
  AdminUserInsightModelBreakdownQuerySchema,
  AdminUserInsightProviderBreakdownQuerySchema,
} from "@/lib/api/v1/schemas/admin-user-insights";

export async function getAdminUserInsightsOverview(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const query = AdminUserInsightDateQuerySchema.safeParse(readQuery(c, ["startDate", "endDate"]));
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/admin-user-insights");
  const result = await callAction(
    c,
    actions.getUserInsightsOverview,
    [params.userId, query.data.startDate, query.data.endDate] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function getAdminUserInsightsKeyTrend(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const query = AdminUserInsightKeyTrendQuerySchema.safeParse(readQuery(c, ["timeRange"]));
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/admin-user-insights");
  const result = await callAction(
    c,
    actions.getUserInsightsKeyTrend,
    [params.userId, query.data.timeRange] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function getAdminUserInsightsModelBreakdown(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const query = AdminUserInsightModelBreakdownQuerySchema.safeParse(
    readQuery(c, ["startDate", "endDate", "keyId", "providerId"])
  );
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/admin-user-insights");
  const result = await callAction(
    c,
    actions.getUserInsightsModelBreakdown,
    [params.userId, query.data.startDate, query.data.endDate, pickFilters(query.data)] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function getAdminUserInsightsProviderBreakdown(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const query = AdminUserInsightProviderBreakdownQuerySchema.safeParse(
    readQuery(c, ["startDate", "endDate", "keyId", "model"])
  );
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/admin-user-insights");
  const result = await callAction(
    c,
    actions.getUserInsightsProviderBreakdown,
    [params.userId, query.data.startDate, query.data.endDate, pickFilters(query.data)] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

function parseUserParams(c: Context): { userId: number } | Response {
  const params = AdminUserInsightIdParamSchema.safeParse({ userId: c.req.param("userId") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  return params.data;
}

function readQuery(c: Context, keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, c.req.query(key)]));
}

function pickFilters<T extends Record<string, unknown>>(query: T): Partial<T> | undefined {
  const entries = Object.entries(query).filter(([key, value]) => {
    return !["startDate", "endDate"].includes(key) && value !== undefined;
  });
  return entries.length ? (Object.fromEntries(entries) as Partial<T>) : undefined;
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const lower = detail.toLowerCase();
  const status =
    result.errorCode === "PERMISSION_DENIED" || detail === "Unauthorized"
      ? 403
      : lower.includes("not found") || detail.includes("不存在")
        ? 404
        : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode:
      status === 404
        ? "admin_user_insights.not_found"
        : (result.errorCode ?? "admin_user_insights.action_failed"),
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
