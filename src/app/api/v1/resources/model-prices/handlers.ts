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
  ModelPriceCatalogQuerySchema,
  ModelPriceListQuerySchema,
  ModelPriceNameParamSchema,
  ModelPriceOverwriteSchema,
  ModelPricePinRequestSchema,
  ModelPriceUploadSchema,
  SingleModelPriceSchema,
} from "@/lib/api/v1/schemas/model-prices";

export async function listModelPrices(c: Context): Promise<Response> {
  const query = ModelPriceListQuerySchema.safeParse({
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
    search: c.req.query("search"),
    source: c.req.query("source"),
    litellmProvider: c.req.query("litellmProvider"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/model-prices");
  const result = await callAction(
    c,
    actions.getModelPricesPaginated,
    [query.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({
    items: result.data.data,
    page: result.data.page,
    pageSize: result.data.pageSize,
    total: result.data.total,
    totalPages: result.data.totalPages,
  });
}

export async function getModelPriceCatalog(c: Context): Promise<Response> {
  const query = ModelPriceCatalogQuerySchema.safeParse({ scope: c.req.query("scope") });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/model-prices");
  const result = await callAction(
    c,
    actions.getAvailableModelCatalog,
    [{ scope: query.data.scope }] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function hasModelPrices(c: Context): Promise<Response> {
  const actions = await import("@/actions/model-prices");
  const result = await callAction(c, actions.hasPriceTable, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ exists: Boolean(result.data) });
}

export async function uploadModelPrices(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, ModelPriceUploadSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/model-prices");
  const result = await callAction(
    c,
    actions.uploadPriceTable,
    [body.data.content, body.data.overwriteManual] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function checkLiteLlmSync(c: Context): Promise<Response> {
  const actions = await import("@/actions/model-prices");
  const result = await callAction(c, actions.checkLiteLLMSyncConflicts, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function syncLiteLlmPrices(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, ModelPriceOverwriteSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/model-prices");
  const result = await callAction(
    c,
    actions.syncLiteLLMPrices,
    [body.data.overwriteManual] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function upsertModelPrice(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, SingleModelPriceSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/model-prices");
  const result = await callAction(
    c,
    actions.upsertSingleModelPrice,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function deleteModelPrice(c: Context): Promise<Response> {
  const params = ModelPriceNameParamSchema.safeParse({ modelName: c.req.param("modelName") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/model-prices");
  const result = await callAction(
    c,
    actions.deleteSingleModelPrice,
    [params.data.modelName] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function pinModelPriceProvider(c: Context): Promise<Response> {
  const params = ModelPriceNameParamSchema.safeParse({ modelName: c.req.param("modelName") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const body = await parseHonoJsonBody(c, ModelPricePinRequestSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/model-prices");
  const result = await callAction(
    c,
    actions.pinModelPricingProviderAsManual,
    [
      { modelName: params.data.modelName, pricingProviderKey: body.data.pricingProviderKey },
    ] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const status = detail.includes("权限") ? 403 : detail.includes("未找到") ? 404 : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode:
      result.errorCode ?? (status === 404 ? "model_price.not_found" : "model_price.action_failed"),
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
