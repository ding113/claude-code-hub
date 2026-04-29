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
  DashboardRateLimitStatsQuerySchema,
  DashboardStatisticsQuerySchema,
  DispatchSimulatorInputSchema,
} from "@/lib/api/v1/schemas/dashboard";

export async function getDashboardOverview(c: Context): Promise<Response> {
  const actions = await import("@/actions/overview");
  return actionJson(c, await callAction(c, actions.getOverviewData, [], c.get("auth")));
}

export async function getDashboardStatistics(c: Context): Promise<Response> {
  const query = DashboardStatisticsQuerySchema.safeParse({ timeRange: c.req.query("timeRange") });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/statistics");
  return actionJson(
    c,
    await callAction(c, actions.getUserStatistics, [query.data.timeRange] as never[], c.get("auth"))
  );
}

export async function getDashboardConcurrentSessions(c: Context): Promise<Response> {
  const auth = c.get("auth") as { session?: { user?: { role?: string } } } | undefined;
  if (auth?.session?.user?.role !== "admin") {
    const { getSystemSettings } = await import("@/repository/system-config");
    const settings = await getSystemSettings();
    if (!settings.allowGlobalUsageView) {
      return createProblemResponse({
        status: 403,
        instance: new URL(c.req.url).pathname,
        errorCode: "dashboard.global_usage_forbidden",
        detail: "Global concurrent session metrics are not available to this user.",
      });
    }
  }

  const actions = await import("@/actions/concurrent-sessions");
  const result = await callAction(c, actions.getConcurrentSessions, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ count: result.data });
}

export async function getDashboardRealtime(c: Context): Promise<Response> {
  const actions = await import("@/actions/dashboard-realtime");
  return actionJson(c, await callAction(c, actions.getDashboardRealtimeData, [], c.get("auth")));
}

export async function getDashboardProviderSlots(c: Context): Promise<Response> {
  const actions = await import("@/actions/provider-slots");
  const result = await callAction(c, actions.getProviderSlots, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function getDashboardRateLimitStats(c: Context): Promise<Response> {
  const query = DashboardRateLimitStatsQuerySchema.safeParse({
    userId: c.req.query("userId"),
    providerId: c.req.query("providerId"),
    keyId: c.req.query("keyId"),
    limitType: c.req.query("limitType"),
    startTime: c.req.query("startTime"),
    endTime: c.req.query("endTime"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const filters = {
    user_id: query.data.userId,
    provider_id: query.data.providerId,
    key_id: query.data.keyId,
    limit_type: query.data.limitType,
    start_time: query.data.startTime ? new Date(query.data.startTime) : undefined,
    end_time: query.data.endTime ? new Date(query.data.endTime) : undefined,
  };
  const actions = await import("@/actions/rate-limit-stats");
  return actionJson(
    c,
    await callAction(c, actions.getRateLimitStats, [filters] as never[], c.get("auth"))
  );
}

export async function getDashboardProxyStatus(c: Context): Promise<Response> {
  const actions = await import("@/actions/proxy-status");
  return actionJson(c, await callAction(c, actions.getProxyStatus, [], c.get("auth")));
}

export async function getDashboardClientVersions(c: Context): Promise<Response> {
  const actions = await import("@/actions/client-versions");
  const result = await callAction(c, actions.fetchClientVersionStats, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function simulateDispatch(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, DispatchSimulatorInputSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/dispatch-simulator");
  return actionJson(
    c,
    await callAction(c, actions.simulateDispatchAction, [body.data] as never[], c.get("auth"))
  );
}

function actionJson<T>(c: Context, result: ActionResult<T>): Response {
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const status =
    detail.includes("权限") ||
    detail.toLowerCase().includes("unauthorized") ||
    result.errorCode === "PERMISSION_DENIED"
      ? 403
      : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: result.errorCode ?? "dashboard.action_failed",
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
