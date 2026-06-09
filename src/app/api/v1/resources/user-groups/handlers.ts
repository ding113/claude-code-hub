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
  UserGroupCreateSchema,
  UserGroupIdParamSchema,
  UserGroupUpdateSchema,
} from "@/lib/api/v1/schemas/user-groups";

export async function listUserGroups(c: Context): Promise<Response> {
  const actions = await import("@/actions/user-group");
  const result = await callAction(c, actions.listUserGroups, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function createUserGroup(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, UserGroupCreateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/user-group");
  const result = await callAction(
    c,
    actions.createUserGroup,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return createdResponse(result.data, `/api/v1/resources/user-groups/${result.data.id}`);
}

export async function updateUserGroup(c: Context): Promise<Response> {
  const params = UserGroupIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const body = await parseHonoJsonBody(c, UserGroupUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/user-group");
  const result = await callAction(
    c,
    actions.updateUserGroup,
    [params.data.id, body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function deleteUserGroup(c: Context): Promise<Response> {
  const params = UserGroupIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/user-group");
  const result = await callAction(
    c,
    actions.deleteUserGroup,
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
      status === 404 ? "user_group.not_found" : (result.errorCode ?? "user_group.action_failed"),
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
