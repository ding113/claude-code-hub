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
  ModelGroupCreateSchema,
  ModelGroupIdParamSchema,
  ModelGroupMemberBodySchema,
  ModelGroupMemberQuerySchema,
  ModelGroupUpdateSchema,
  SingletonCreateSchema,
} from "@/lib/api/v1/schemas/model-groups";

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const isNotFound = result.errorCode === "NOT_FOUND" || detail.toLowerCase().includes("not found");
  const isConflict = result.errorCode === "MEMBER_CONFLICT";
  const isUnauth = result.errorCode === "UNAUTHORIZED" || detail.includes("权限");
  const status = isNotFound ? 404 : isConflict ? 409 : isUnauth ? 403 : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: result.errorCode ?? "model_group.action_failed",
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}

// ---------------------------------------------------------------------------
// Group CRUD
// ---------------------------------------------------------------------------

export async function listModelGroups(c: Context): Promise<Response> {
  const actions = await import("@/actions/model-group");
  const result = await callAction(c, actions.listModelGroups, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function createModelGroup(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, ModelGroupCreateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/model-group");
  const result = await callAction(
    c,
    actions.createModelGroup,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return createdResponse(result.data, `/api/v1/resources/model-groups/${result.data.id}`);
}

export async function getModelGroup(c: Context): Promise<Response> {
  const params = ModelGroupIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/model-group");
  const result = await callAction(
    c,
    actions.getModelGroupById,
    [params.data.id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function updateModelGroup(c: Context): Promise<Response> {
  const params = ModelGroupIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const body = await parseHonoJsonBody(c, ModelGroupUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/model-group");
  const result = await callAction(
    c,
    actions.updateModelGroup,
    [params.data.id, body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function deleteModelGroup(c: Context): Promise<Response> {
  const params = ModelGroupIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/model-group");
  const result = await callAction(
    c,
    actions.deleteModelGroup,
    [params.data.id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

// ---------------------------------------------------------------------------
// Member sub-resource
// ---------------------------------------------------------------------------

export async function addModelGroupMember(c: Context): Promise<Response> {
  const params = ModelGroupIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const body = await parseHonoJsonBody(c, ModelGroupMemberBodySchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/model-group");
  const result = await callAction(
    c,
    actions.addModelGroupMember,
    [params.data.id, body.data.model] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function removeModelGroupMember(c: Context): Promise<Response> {
  const params = ModelGroupIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const query = ModelGroupMemberQuerySchema.safeParse({ model: c.req.query("model") });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/model-group");
  const result = await callAction(
    c,
    actions.removeModelGroupMember,
    [params.data.id, query.data.model] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

// ---------------------------------------------------------------------------
// Singleton shortcut
// ---------------------------------------------------------------------------

export async function createSingletonModelGroup(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, SingletonCreateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/model-group");
  const result = await callAction(
    c,
    actions.createSingletonModelGroup,
    [body.data.model, body.data.name] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return createdResponse(result.data, `/api/v1/resources/model-groups/${result.data.id}`);
}
