import type { Context } from "hono";
import type { ActionResult } from "@/actions/types";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import {
  createProblemResponse,
  fromZodError,
  publicActionErrorDetail,
} from "@/lib/api/v1/_shared/error-envelope";
import { parseHonoJsonBody } from "@/lib/api/v1/_shared/request-body";
import {
  createdResponse,
  jsonResponse,
  noContentResponse,
} from "@/lib/api/v1/_shared/response-helpers";
import {
  RequestFilterCreateSchema,
  RequestFilterIdParamSchema,
  RequestFilterUpdateSchema,
} from "@/lib/api/v1/schemas/request-filters";

export async function listRequestFilters(c: Context): Promise<Response> {
  const actions = await import("@/actions/request-filters");
  const result = await callAction(c, actions.listRequestFilters, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function createRequestFilter(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, RequestFilterCreateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/request-filters");
  const result = await callAction(
    c,
    actions.createRequestFilterAction,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return createdResponse(result.data, `/api/v1/request-filters/${result.data.id}`);
}

export async function updateRequestFilter(c: Context): Promise<Response> {
  const params = RequestFilterIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const body = await parseHonoJsonBody(c, RequestFilterUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/request-filters");
  const result = await callAction(
    c,
    actions.updateRequestFilterAction,
    [params.data.id, body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function deleteRequestFilter(c: Context): Promise<Response> {
  const params = RequestFilterIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/request-filters");
  const result = await callAction(
    c,
    actions.deleteRequestFilterAction,
    [params.data.id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function refreshRequestFiltersCache(c: Context): Promise<Response> {
  const actions = await import("@/actions/request-filters");
  const result = await callAction(c, actions.refreshRequestFiltersCache, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function listProviderOptions(c: Context): Promise<Response> {
  const actions = await import("@/actions/request-filters");
  const result = await callAction(c, actions.listProvidersForFilterAction, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function listGroupOptions(c: Context): Promise<Response> {
  const actions = await import("@/actions/request-filters");
  const result = await callAction(c, actions.getDistinctProviderGroupsAction, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const status = detail.includes("不存在") ? 404 : detail.includes("权限") ? 403 : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode:
      status === 404
        ? "request_filter.not_found"
        : (result.errorCode ?? "request_filter.action_failed"),
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
