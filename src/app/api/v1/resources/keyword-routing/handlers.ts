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
  KeywordRoutingRuleCreateSchema,
  KeywordRoutingRuleIdParamSchema,
  KeywordRoutingRuleUpdateSchema,
} from "@/lib/api/v1/schemas/keyword-routing";

export async function listKeywordRoutingRules(c: Context): Promise<Response> {
  const actions = await import("@/actions/keyword-routing");
  const result = await callAction(c, actions.listKeywordRoutingRules, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function createKeywordRoutingRule(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, KeywordRoutingRuleCreateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/keyword-routing");
  const result = await callAction(
    c,
    actions.createKeywordRoutingRuleAction,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return createdResponse(result.data, `/api/v1/keyword-routing-rules/${result.data.id}`);
}

export async function updateKeywordRoutingRule(c: Context): Promise<Response> {
  const params = KeywordRoutingRuleIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const body = await parseHonoJsonBody(c, KeywordRoutingRuleUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/keyword-routing");
  const result = await callAction(
    c,
    actions.updateKeywordRoutingRuleAction,
    [params.data.id, body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function deleteKeywordRoutingRule(c: Context): Promise<Response> {
  const params = KeywordRoutingRuleIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/keyword-routing");
  const result = await callAction(
    c,
    actions.deleteKeywordRoutingRuleAction,
    [params.data.id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function refreshKeywordRoutingCache(c: Context): Promise<Response> {
  const actions = await import("@/actions/keyword-routing");
  const result = await callAction(c, actions.refreshKeywordRoutingCacheAction, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function getKeywordRoutingCacheStats(c: Context): Promise<Response> {
  const actions = await import("@/actions/keyword-routing");
  const result = await callAction(c, actions.getKeywordRoutingCacheStats, [], c.get("auth"));
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
  const code = result.errorCode;
  const status = getActionErrorStatus(code, detail);

  // Map errorCode to namespace-prefixed code
  let errorCode: string;
  if (code === "NOT_FOUND" || status === 404) {
    errorCode = "keyword_routing_rule.not_found";
  } else if (code) {
    errorCode = code;
  } else {
    errorCode = "keyword_routing_rule.action_failed";
  }

  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode,
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}

function getActionErrorStatus(code: string | undefined, detail: string): 400 | 403 | 404 | 500 {
  if (code === "PERMISSION_DENIED") return 403;
  if (code === "NOT_FOUND") return 404;
  if (code === "VALIDATION_ERROR") return 400;
  if (code === "OPERATION_FAILED") return 500;

  // Fallback to string matching for backward compatibility
  if (detail.includes("不存在") || detail.includes("not found")) return 404;
  if (detail.includes("权限")) return 403;
  return 400;
}
