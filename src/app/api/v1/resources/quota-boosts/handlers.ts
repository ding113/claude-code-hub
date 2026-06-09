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
  QuotaBoostGrantCreateSchema,
  QuotaBoostGrantIdParamSchema,
  QuotaBoostGrantListQuerySchema,
} from "@/lib/api/v1/schemas/quota-boosts";

export async function listQuotaBoostGrants(c: Context): Promise<Response> {
  const query = QuotaBoostGrantListQuerySchema.safeParse({
    userId: c.req.query("userId"),
    modelGroupId: c.req.query("modelGroupId"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/quota-boost");
  const result = await callAction(
    c,
    actions.listQuotaBoostGrantsAction,
    [query.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function createQuotaBoostGrant(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, QuotaBoostGrantCreateSchema);
  if (!body.ok) return body.response;

  const actions = await import("@/actions/quota-boost");
  const result = await callAction(
    c,
    actions.createQuotaBoostGrantAction,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return createdResponse(result.data, `/api/v1/quota-boosts/${result.data.id}`);
}

export async function deleteQuotaBoostGrant(c: Context): Promise<Response> {
  const params = QuotaBoostGrantIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/quota-boost");
  const result = await callAction(
    c,
    actions.deleteQuotaBoostGrantAction,
    [params.data.id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const status =
    detail.includes("not_found") || detail.includes("not found")
      ? 404
      : detail.includes("forbidden") || detail.includes("permission")
        ? 403
        : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: result.errorCode ?? "quota_boost.action_failed",
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
