import type { Context } from "hono";
import { z } from "zod";
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
  ProviderSiteCreateSchema,
  ProviderSiteGroupRateUpdateSchema,
  ProviderSiteGroupRateUpsertSchema,
  ProviderSiteIdParamSchema,
  ProviderSiteReorderSchema,
  ProviderSiteUpdateSchema,
} from "@/lib/api/v1/schemas/provider-sites";

const RateIdParamSchema = z.object({
  rateId: z.coerce.number().int().positive(),
});

export async function listProviderSites(c: Context): Promise<Response> {
  const actions = await import("@/actions/provider-sites");
  const result = await callAction(c, actions.getProviderSites, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function createProviderSite(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, ProviderSiteCreateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/provider-sites");
  const result = await callAction(
    c,
    actions.createProviderSite,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return createdResponse(result.data, `/api/v1/provider-sites/${result.data.id}`);
}

export async function updateProviderSite(c: Context): Promise<Response> {
  const params = ProviderSiteIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const body = await parseHonoJsonBody(c, ProviderSiteUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/provider-sites");
  const result = await callAction(
    c,
    actions.updateProviderSite,
    [params.data.id, body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function deleteProviderSite(c: Context): Promise<Response> {
  const params = ProviderSiteIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/provider-sites");
  const result = await callAction(
    c,
    actions.deleteProviderSite,
    [params.data.id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function reorderProviderSitesHandler(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, ProviderSiteReorderSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/provider-sites");
  const result = await callAction(
    c,
    actions.reorderProviderSites,
    [body.data.orderedIds] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function upsertProviderSiteGroupRate(c: Context): Promise<Response> {
  const params = ProviderSiteIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const body = await parseHonoJsonBody(c, ProviderSiteGroupRateUpsertSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/provider-sites");
  const result = await callAction(
    c,
    actions.upsertProviderSiteGroupRate,
    [params.data.id, body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function updateProviderSiteGroupRate(c: Context): Promise<Response> {
  const params = RateIdParamSchema.safeParse({ rateId: c.req.param("rateId") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const body = await parseHonoJsonBody(c, ProviderSiteGroupRateUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/provider-sites");
  const result = await callAction(
    c,
    actions.updateProviderSiteGroupRate,
    [params.data.rateId, body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function deleteProviderSiteGroupRate(c: Context): Promise<Response> {
  const params = RateIdParamSchema.safeParse({ rateId: c.req.param("rateId") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/provider-sites");
  const result = await callAction(
    c,
    actions.deleteProviderSiteGroupRate,
    [params.data.rateId] as never[],
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
        ? "provider_site.not_found"
        : (result.errorCode ?? "provider_site.action_failed"),
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}

export async function syncProviderSiteRatesHandler(c: Context): Promise<Response> {
  const params = ProviderSiteIdParamSchema.safeParse({ id: c.req.param("id") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/provider-sites");
  const result = await callAction(
    c,
    actions.syncProviderSiteRates,
    [params.data.id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function syncAllProviderSiteRatesHandler(c: Context): Promise<Response> {
  const actions = await import("@/actions/provider-sites");
  const result = await callAction(c, actions.syncAllProviderSiteRates, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function fetchProviderSiteGroupUpstreamModels(c: Context): Promise<Response> {
  const params = RateIdParamSchema.safeParse({ rateId: c.req.param("rateId") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/provider-sites");
  const result = await callAction(
    c,
    actions.fetchProviderSiteGroupUpstreamModels,
    [params.data.rateId] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}
