import type { Context } from "hono";
import { z } from "zod";
import type { ActionResult } from "@/actions/types";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { DASHBOARD_COMPAT_HEADER, HIDDEN_PROVIDER_TYPES } from "@/lib/api/v1/_shared/constants";
import {
  createProblemResponse,
  fromZodError,
  publicActionErrorDetail,
} from "@/lib/api/v1/_shared/error-envelope";
import { redactUrlCredentials } from "@/lib/api/v1/_shared/redaction";
import { parseHonoJsonBody } from "@/lib/api/v1/_shared/request-body";
import { jsonResponse, noContentResponse } from "@/lib/api/v1/_shared/response-helpers";
import {
  BatchEndpointCircuitSchema,
  BatchProbeLogsSchema,
  BatchVendorEndpointStatsSchema,
  ProviderEndpointCreateSchema,
  ProviderEndpointIdParamSchema,
  ProviderEndpointListQuerySchema,
  ProviderEndpointProbeSchema,
  ProviderEndpointUpdateSchema,
  ProviderProbeLogsQuerySchema,
  ProviderVendorIdParamSchema,
  ProviderVendorListQuerySchema,
  ProviderVendorUpdateSchema,
  VendorTypeBodySchema,
  VendorTypeManualOpenSchema,
  VendorTypeQuerySchema,
} from "@/lib/api/v1/schemas/provider-endpoints";

const INTERNAL_PROVIDER_TYPE_VALUES = [
  "claude",
  "claude-auth",
  "codex",
  "gemini",
  "gemini-cli",
  "openai-compatible",
] as const;

const InternalProviderTypeSchema = z.enum(INTERNAL_PROVIDER_TYPE_VALUES);
const InternalProviderEndpointListQuerySchema = ProviderEndpointListQuerySchema.extend({
  providerType: InternalProviderTypeSchema.optional(),
});
const InternalProviderEndpointCreateSchema = ProviderEndpointCreateSchema.extend({
  providerType: InternalProviderTypeSchema,
});
const InternalBatchVendorEndpointStatsSchema = BatchVendorEndpointStatsSchema.extend({
  providerType: InternalProviderTypeSchema,
});
const InternalVendorTypeQuerySchema = VendorTypeQuerySchema.extend({
  providerType: InternalProviderTypeSchema,
});
const InternalVendorTypeManualOpenSchema = VendorTypeManualOpenSchema.extend({
  providerType: InternalProviderTypeSchema,
});
const InternalVendorTypeBodySchema = VendorTypeBodySchema.extend({
  providerType: InternalProviderTypeSchema,
});

export async function listProviderVendors(c: Context): Promise<Response> {
  const query = ProviderVendorListQuerySchema.safeParse({ dashboard: c.req.query("dashboard") });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/provider-endpoints");
  const action = query.data.dashboard
    ? actions.getDashboardProviderVendors
    : actions.getProviderVendors;
  const result = await callAction(c, action, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  const data = isDashboardCompatRequest(c) ? result.data : filterVisibleProviderTypes(result.data);
  return jsonResponse({
    items: sanitizeProviderEndpointData(data),
  });
}

export async function getProviderVendor(c: Context): Promise<Response> {
  const params = parseVendorParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/provider-endpoints");
  const result = await callAction(
    c,
    actions.getProviderVendorById,
    [params.vendorId] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  if (!result.data)
    return notFound(c, "provider_vendor.not_found", "Provider vendor was not found.");
  return jsonResponse(sanitizeProviderEndpointData(result.data));
}

export async function updateProviderVendor(c: Context): Promise<Response> {
  const params = parseVendorParams(c);
  if (params instanceof Response) return params;
  const body = await parseHonoJsonBody(c, ProviderVendorUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/provider-endpoints");
  return sanitizedActionJson(
    c,
    await callAction(
      c,
      actions.editProviderVendor,
      [{ vendorId: params.vendorId, ...body.data }] as never[],
      c.get("auth")
    )
  );
}

export async function deleteProviderVendor(c: Context): Promise<Response> {
  const params = parseVendorParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/provider-endpoints");
  const result = await callAction(
    c,
    actions.removeProviderVendor,
    [{ vendorId: params.vendorId }] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function listProviderEndpoints(c: Context): Promise<Response> {
  const params = parseVendorParams(c);
  if (params instanceof Response) return params;
  const query = (
    isDashboardCompatRequest(c)
      ? InternalProviderEndpointListQuerySchema
      : ProviderEndpointListQuerySchema
  ).safeParse({
    providerType: c.req.query("providerType"),
    dashboard: c.req.query("dashboard"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/provider-endpoints");
  const result = query.data.providerType
    ? await callAction(
        c,
        query.data.dashboard ? actions.getDashboardProviderEndpoints : actions.getProviderEndpoints,
        [{ vendorId: params.vendorId, providerType: query.data.providerType }] as never[],
        c.get("auth")
      )
    : await callAction(
        c,
        actions.getProviderEndpointsByVendor,
        [{ vendorId: params.vendorId }] as never[],
        c.get("auth")
      );
  if (!result.ok) return actionError(c, result);
  const data = isDashboardCompatRequest(c) ? result.data : filterVisibleProviderTypes(result.data);
  return jsonResponse({
    items: sanitizeProviderEndpointData(data),
  });
}

export async function createProviderEndpoint(c: Context): Promise<Response> {
  const params = parseVendorParams(c);
  if (params instanceof Response) return params;
  const body = await parseHonoJsonBody(
    c,
    isDashboardCompatRequest(c)
      ? InternalProviderEndpointCreateSchema
      : ProviderEndpointCreateSchema
  );
  if (!body.ok) return body.response;
  const actions = await import("@/actions/provider-endpoints");
  return sanitizedActionJson(
    c,
    await callAction(
      c,
      actions.addProviderEndpoint,
      [{ vendorId: params.vendorId, ...body.data }] as never[],
      c.get("auth")
    ),
    201
  );
}

export async function updateProviderEndpoint(c: Context): Promise<Response> {
  const params = parseEndpointParams(c);
  if (params instanceof Response) return params;
  const hidden = await ensureVisibleEndpoint(c, params.endpointId);
  if (hidden) return hidden;
  const body = await parseHonoJsonBody(c, ProviderEndpointUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/provider-endpoints");
  return sanitizedActionJson(
    c,
    await callAction(
      c,
      actions.editProviderEndpoint,
      [{ endpointId: params.endpointId, ...body.data }] as never[],
      c.get("auth")
    )
  );
}

export async function deleteProviderEndpoint(c: Context): Promise<Response> {
  const params = parseEndpointParams(c);
  if (params instanceof Response) return params;
  const hidden = await ensureVisibleEndpoint(c, params.endpointId);
  if (hidden) return hidden;
  const actions = await import("@/actions/provider-endpoints");
  const result = await callAction(
    c,
    actions.removeProviderEndpoint,
    [{ endpointId: params.endpointId }] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function probeProviderEndpoint(c: Context): Promise<Response> {
  const params = parseEndpointParams(c);
  if (params instanceof Response) return params;
  const hidden = await ensureVisibleEndpoint(c, params.endpointId);
  if (hidden) return hidden;
  const body = await parseHonoJsonBody(c, ProviderEndpointProbeSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/provider-endpoints");
  return sanitizedActionJson(
    c,
    await callAction(
      c,
      actions.probeProviderEndpoint,
      [{ endpointId: params.endpointId, ...body.data }] as never[],
      c.get("auth")
    )
  );
}

export async function getProviderEndpointProbeLogs(c: Context): Promise<Response> {
  const params = parseEndpointParams(c);
  if (params instanceof Response) return params;
  const hidden = await ensureVisibleEndpoint(c, params.endpointId);
  if (hidden) return hidden;
  const query = ProviderProbeLogsQuerySchema.safeParse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/provider-endpoints");
  return sanitizedActionJson(
    c,
    await callAction(
      c,
      actions.getProviderEndpointProbeLogs,
      [{ endpointId: params.endpointId, ...query.data }] as never[],
      c.get("auth")
    )
  );
}

export async function batchGetProbeLogs(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, BatchProbeLogsSchema);
  if (!body.ok) return body.response;
  const hidden = await ensureVisibleEndpointIds(c, body.data.endpointIds);
  if (hidden) return hidden;
  const actions = await import("@/actions/provider-endpoints");
  return sanitizedActionJson(
    c,
    await callAction(
      c,
      actions.batchGetProviderEndpointProbeLogs,
      [body.data] as never[],
      c.get("auth")
    )
  );
}

export async function batchGetVendorEndpointStats(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(
    c,
    isDashboardCompatRequest(c)
      ? InternalBatchVendorEndpointStatsSchema
      : BatchVendorEndpointStatsSchema
  );
  if (!body.ok) return body.response;
  const actions = await import("@/actions/provider-endpoints");
  return sanitizedActionJson(
    c,
    await callAction(
      c,
      actions.batchGetVendorTypeEndpointStats,
      [body.data] as never[],
      c.get("auth")
    )
  );
}

export async function getEndpointCircuit(c: Context): Promise<Response> {
  const params = parseEndpointParams(c);
  if (params instanceof Response) return params;
  const hidden = await ensureVisibleEndpoint(c, params.endpointId);
  if (hidden) return hidden;
  const actions = await import("@/actions/provider-endpoints");
  return sanitizedActionJson(
    c,
    await callAction(
      c,
      actions.getEndpointCircuitInfo,
      [{ endpointId: params.endpointId }] as never[],
      c.get("auth")
    )
  );
}

export async function batchGetEndpointCircuits(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, BatchEndpointCircuitSchema);
  if (!body.ok) return body.response;
  const hidden = await ensureVisibleEndpointIds(c, body.data.endpointIds);
  if (hidden) return hidden;
  const actions = await import("@/actions/provider-endpoints");
  return sanitizedActionJson(
    c,
    await callAction(c, actions.batchGetEndpointCircuitInfo, [body.data] as never[], c.get("auth"))
  );
}

export async function resetEndpointCircuit(c: Context): Promise<Response> {
  const params = parseEndpointParams(c);
  if (params instanceof Response) return params;
  const hidden = await ensureVisibleEndpoint(c, params.endpointId);
  if (hidden) return hidden;
  const actions = await import("@/actions/provider-endpoints");
  const result = await callAction(
    c,
    actions.resetEndpointCircuit,
    [{ endpointId: params.endpointId }] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function getVendorCircuit(c: Context): Promise<Response> {
  const params = parseVendorParams(c);
  if (params instanceof Response) return params;
  const query = (
    isDashboardCompatRequest(c) ? InternalVendorTypeQuerySchema : VendorTypeQuerySchema
  ).safeParse({ providerType: c.req.query("providerType") });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/provider-endpoints");
  return sanitizedActionJson(
    c,
    await callAction(
      c,
      actions.getVendorTypeCircuitInfo,
      [{ vendorId: params.vendorId, providerType: query.data.providerType }] as never[],
      c.get("auth")
    )
  );
}

export async function setVendorCircuitManualOpen(c: Context): Promise<Response> {
  const params = parseVendorParams(c);
  if (params instanceof Response) return params;
  const body = await parseHonoJsonBody(
    c,
    isDashboardCompatRequest(c) ? InternalVendorTypeManualOpenSchema : VendorTypeManualOpenSchema
  );
  if (!body.ok) return body.response;
  const actions = await import("@/actions/provider-endpoints");
  const result = await callAction(
    c,
    actions.setVendorTypeCircuitManualOpen,
    [{ vendorId: params.vendorId, ...body.data }] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function resetVendorCircuit(c: Context): Promise<Response> {
  const params = parseVendorParams(c);
  if (params instanceof Response) return params;
  const body = await parseHonoJsonBody(
    c,
    isDashboardCompatRequest(c) ? InternalVendorTypeBodySchema : VendorTypeBodySchema
  );
  if (!body.ok) return body.response;
  const actions = await import("@/actions/provider-endpoints");
  const result = await callAction(
    c,
    actions.resetVendorTypeCircuit,
    [{ vendorId: params.vendorId, providerType: body.data.providerType }] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

function parseVendorParams(c: Context): { vendorId: number } | Response {
  const params = ProviderVendorIdParamSchema.safeParse({ vendorId: c.req.param("vendorId") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  return params.data;
}

function parseEndpointParams(c: Context): { endpointId: number } | Response {
  const rawEndpointId = (c.req.param("endpointId") ?? "").replace(/:probe$/, "");
  const params = ProviderEndpointIdParamSchema.safeParse({ endpointId: rawEndpointId });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  return params.data;
}

async function ensureVisibleEndpoint(c: Context, endpointId: number): Promise<Response | null> {
  const { findProviderEndpointById } = await import("@/repository/provider-endpoints");
  const endpoint = await findProviderEndpointById(endpointId);
  if (!endpoint || (!isDashboardCompatRequest(c) && isHiddenProviderType(endpoint.providerType))) {
    return notFound(c, "provider_endpoint.not_found", "Provider endpoint was not found.");
  }
  return null;
}

async function ensureVisibleEndpointIds(
  c: Context,
  endpointIds: number[]
): Promise<Response | null> {
  for (const endpointId of endpointIds) {
    const hidden = await ensureVisibleEndpoint(c, endpointId);
    if (hidden) return hidden;
  }
  return null;
}

function sanitizedActionJson<T>(c: Context, result: ActionResult<T>, status = 200): Response {
  if (!result.ok) return actionError(c, result);
  return jsonResponse(sanitizeProviderEndpointData(result.data), { status });
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const code = result.errorCode;
  const status =
    code === "NOT_FOUND" || detail.includes("不存在") || detail.includes("not found")
      ? 404
      : code === "CONFLICT" ||
          code === "ENDPOINT_REFERENCED_BY_ENABLED_PROVIDERS" ||
          detail.includes("冲突")
        ? 409
        : detail.includes("权限")
          ? 403
          : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: code ?? "provider_endpoint.action_failed",
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}

function notFound(c: Context, errorCode: string, detail: string): Response {
  return createProblemResponse({
    status: 404,
    instance: new URL(c.req.url).pathname,
    errorCode,
    detail,
  });
}

function filterVisibleProviderTypes<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => filterVisibleProviderTypes(item))
      .filter(
        (item) => !isHiddenProviderType((item as { providerType?: string }).providerType)
      ) as T;
  }
  if (value instanceof Date) return value;
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const filtered = Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      key,
      key === "providerTypes" && Array.isArray(child)
        ? child.filter((type) => !isHiddenProviderType(type))
        : filterVisibleProviderTypes(child),
    ])
  );
  return filtered as T;
}

function sanitizeProviderEndpointData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProviderEndpointData(item)) as T;
  }
  if (value instanceof Date) return value;
  if (!value || typeof value !== "object") return value;

  const sanitized = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => {
      if ((key === "url" || key === "websiteUrl") && typeof child === "string") {
        return [key, redactUrlCredentials(child)];
      }
      return [key, sanitizeProviderEndpointData(child)];
    })
  );
  return sanitized as T;
}

function isHiddenProviderType(providerType: unknown): boolean {
  return HIDDEN_PROVIDER_TYPES.some((hidden) => hidden === providerType);
}

function isDashboardCompatRequest(c: Context): boolean {
  return c.req.header(DASHBOARD_COMPAT_HEADER) === "1";
}
