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
  SensitiveWordCreateSchema,
  SensitiveWordIdParamSchema,
  SensitiveWordUpdateSchema,
} from "@/lib/api/v1/schemas/sensitive-words";

export async function listSensitiveWords(c: Context): Promise<Response> {
  const actions = await import("@/actions/sensitive-words");
  const result = await callAction(c, actions.listSensitiveWords, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function createSensitiveWord(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, SensitiveWordCreateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/sensitive-words");
  const result = await callAction(
    c,
    actions.createSensitiveWordAction,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return createdResponse(result.data, `/api/v1/sensitive-words/${result.data.id}`);
}

export async function updateSensitiveWord(c: Context): Promise<Response> {
  const params = SensitiveWordIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const body = await parseHonoJsonBody(c, SensitiveWordUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/sensitive-words");
  const result = await callAction(
    c,
    actions.updateSensitiveWordAction,
    [params.data.id, body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function deleteSensitiveWord(c: Context): Promise<Response> {
  const params = SensitiveWordIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/sensitive-words");
  const result = await callAction(
    c,
    actions.deleteSensitiveWordAction,
    [params.data.id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function refreshSensitiveWordsCache(c: Context): Promise<Response> {
  const actions = await import("@/actions/sensitive-words");
  const result = await callAction(c, actions.refreshCacheAction, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function getSensitiveWordsCacheStats(c: Context): Promise<Response> {
  const actions = await import("@/actions/sensitive-words");
  const result = await callAction(c, actions.getCacheStats, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  if (result.data == null) {
    return createProblemResponse({
      status: 403,
      instance: new URL(c.req.url).pathname,
      errorCode: "auth.forbidden",
      detail: "Admin access is required.",
    });
  }
  return jsonResponse(result.data);
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const status = detail.includes("不存在") ? 404 : detail.includes("权限") ? 403 : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode:
      status === 404
        ? "sensitive_word.not_found"
        : (result.errorCode ?? "sensitive_word.action_failed"),
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
