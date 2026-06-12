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
  const status = detail.includes("不存在") ? 404 : detail.includes("权限") ? 403 : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode:
      status === 404
        ? "keyword_routing_rule.not_found"
        : (result.errorCode ?? "keyword_routing_rule.action_failed"),
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
