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
  ProviderGroupCreateSchema,
  ProviderGroupIdParamSchema,
  ProviderGroupUpdateSchema,
} from "@/lib/api/v1/schemas/provider-groups";

export async function listProviderGroups(c: Context): Promise<Response> {
  const actions = await import("@/actions/provider-groups");
  const result = await callAction(c, actions.getProviderGroups, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function createProviderGroup(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, ProviderGroupCreateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/provider-groups");
  const result = await callAction(
    c,
    actions.createProviderGroup,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return createdResponse(result.data, `/api/v1/provider-groups/${result.data.id}`);
}

export async function updateProviderGroup(c: Context): Promise<Response> {
  const params = ProviderGroupIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const body = await parseHonoJsonBody(c, ProviderGroupUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/provider-groups");
  const result = await callAction(
    c,
    actions.updateProviderGroup,
    [params.data.id, body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function deleteProviderGroup(c: Context): Promise<Response> {
  const params = ProviderGroupIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/provider-groups");
  const result = await callAction(
    c,
    actions.deleteProviderGroup,
    [params.data.id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const notFound = result.errorCode === "NOT_FOUND" || detail.toLowerCase().includes("not found");
  const status = notFound
    ? 404
    : detail.includes("权限") || result.errorCode === "UNAUTHORIZED"
      ? 403
      : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode:
      status === 404
        ? "provider_group.not_found"
        : (result.errorCode ?? "provider_group.action_failed"),
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
