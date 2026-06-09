import type { Context } from "hono";
import type { ActionResult } from "@/actions/types";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import {
  createProblemResponse,
  fromZodError,
  publicActionErrorDetail,
} from "@/lib/api/v1/_shared/error-envelope";
import { parseHonoJsonBody } from "@/lib/api/v1/_shared/request-body";
import { jsonResponse, noContentResponse } from "@/lib/api/v1/_shared/response-helpers";
import {
  ModelGroupLimitIdParamSchema,
  ModelGroupLimitListQuerySchema,
  ModelGroupLimitUpsertSchema,
} from "@/lib/api/v1/schemas/model-limits";

export async function listModelGroupLimits(c: Context): Promise<Response> {
  const query = ModelGroupLimitListQuerySchema.safeParse({
    subjectType: c.req.query("subjectType"),
    subjectId: c.req.query("subjectId"),
    modelGroupId: c.req.query("modelGroupId"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/model-limit");
  const result = await callAction(
    c,
    actions.listModelGroupLimitsAction,
    [query.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data ?? [] });
}

export async function upsertModelGroupLimit(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, ModelGroupLimitUpsertSchema);
  if (!body.ok) return body.response;
  const { subjectType, subjectId: rawSubjectId, keyValue, modelGroupId, ...input } = body.data;

  let subjectId = rawSubjectId;

  if (subjectType === "key" && keyValue) {
    const { findKeyIdByValue } = await import("@/repository/key");
    const resolvedId = await findKeyIdByValue(keyValue);
    if (resolvedId === null) {
      return createProblemResponse({
        status: 404,
        instance: new URL(c.req.url).pathname,
        errorCode: "model_limit.key_not_found",
        detail: "Key not found.",
      });
    }
    subjectId = resolvedId;
  }

  if (subjectId === undefined) {
    return createProblemResponse({
      status: 400,
      instance: new URL(c.req.url).pathname,
      errorCode: "model_limit.subject_required",
      detail: "subjectId or keyValue is required.",
    });
  }

  const actions = await import("@/actions/model-limit");
  const result = await callAction(
    c,
    actions.upsertModelGroupLimitAction,
    [subjectType, subjectId, modelGroupId, input] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data ?? { ok: true });
}

export async function deleteModelGroupLimit(c: Context): Promise<Response> {
  const params = ModelGroupLimitIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/model-limit");
  const result = await callAction(
    c,
    actions.deleteModelGroupLimitAction,
    [params.data.id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const code = result.errorCode;
  const status =
    detail.includes("不存在") || detail.includes("not found")
      ? 404
      : result.error?.includes("权限") || isPermissionActionCode(code)
        ? 403
        : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: code ?? (status === 404 ? "model_limit.not_found" : "model_limit.action_failed"),
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}

function isPermissionActionCode(code: string | undefined): boolean {
  const normalized = code?.toUpperCase();
  return (
    normalized === "PERMISSION_DENIED" ||
    normalized === "UNAUTHORIZED" ||
    normalized?.includes("FORBIDDEN") === true
  );
}
