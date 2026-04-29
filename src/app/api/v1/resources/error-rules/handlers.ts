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
  ErrorRuleCreateSchema,
  ErrorRuleIdParamSchema,
  ErrorRuleTestRequestSchema,
  ErrorRuleUpdateSchema,
} from "@/lib/api/v1/schemas/error-rules";

export async function listErrorRules(c: Context): Promise<Response> {
  const actions = await import("@/actions/error-rules");
  const result = await callAction(c, actions.listErrorRules, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function createErrorRule(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, ErrorRuleCreateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/error-rules");
  const result = await callAction(
    c,
    actions.createErrorRuleAction,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return createdResponse(result.data, `/api/v1/error-rules/${result.data.id}`);
}

export async function updateErrorRule(c: Context): Promise<Response> {
  const params = ErrorRuleIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const body = await parseHonoJsonBody(c, ErrorRuleUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/error-rules");
  const result = await callAction(
    c,
    actions.updateErrorRuleAction,
    [params.data.id, body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function deleteErrorRule(c: Context): Promise<Response> {
  const params = ErrorRuleIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/error-rules");
  const result = await callAction(
    c,
    actions.deleteErrorRuleAction,
    [params.data.id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function refreshErrorRulesCache(c: Context): Promise<Response> {
  const actions = await import("@/actions/error-rules");
  const result = await callAction(c, actions.refreshCacheAction, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function getErrorRulesCacheStats(c: Context): Promise<Response> {
  const actions = await import("@/actions/error-rules");
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

export async function testErrorRule(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, ErrorRuleTestRequestSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/error-rules");
  const result = await callAction(
    c,
    actions.testErrorRuleAction,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const status = detail.includes("不存在") ? 404 : detail.includes("权限") ? 403 : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode:
      status === 404 ? "error_rule.not_found" : (result.errorCode ?? "error_rule.action_failed"),
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
