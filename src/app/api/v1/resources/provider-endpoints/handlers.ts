/**
 * /api/v1 provider-vendors / provider-endpoints handler
 *
 * 设计要点：
 * - 多数 vendor / endpoint 读 action 直接返回数组（非 ActionResult），用 raw 模式调用；
 * - 写 / 探测 / 熔断 action 返回 ActionResult，按常规走；
 * - 隐藏 providerType 在读端点上做后过滤；写端点天然被 v1 ProviderTypeSchema 拒绝。
 */

import type { Context } from "hono";
import {
  addProviderEndpoint as addProviderEndpointAction,
  editProviderEndpoint as editProviderEndpointAction,
  editProviderVendor as editProviderVendorAction,
  getDashboardProviderVendors as getDashboardProviderVendorsAction,
  getEndpointCircuitInfo as getEndpointCircuitInfoAction,
  getProviderEndpointProbeLogs as getProviderEndpointProbeLogsAction,
  getProviderEndpoints as getProviderEndpointsAction,
  getProviderEndpointsByVendor as getProviderEndpointsByVendorAction,
  getProviderVendorById as getProviderVendorByIdAction,
  getProviderVendors as getProviderVendorsAction,
  probeProviderEndpoint as probeProviderEndpointAction,
  removeProviderEndpoint as removeProviderEndpointAction,
  removeProviderVendor as removeProviderVendorAction,
  resetEndpointCircuit as resetEndpointCircuitAction,
} from "@/actions/provider-endpoints";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { problem } from "@/lib/api/v1/_shared/error-envelope";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import {
  respondCreated,
  respondJson,
  respondNoContent,
} from "@/lib/api/v1/_shared/response-helpers";
import {
  filterVisibleEndpoints,
  ProviderEndpointCreateSchema,
  ProviderEndpointProbeSchema,
  ProviderEndpointUpdateSchema,
  ProviderVendorUpdateSchema,
  serializeProviderEndpoint,
  serializeProviderVendor,
} from "@/lib/api/v1/schemas/provider-endpoints";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

const vendorsFn = getProviderVendorsAction as unknown as AnyAction;
const dashboardVendorsFn = getDashboardProviderVendorsAction as unknown as AnyAction;
const vendorByIdFn = getProviderVendorByIdAction as unknown as AnyAction;
const editVendorFn = editProviderVendorAction as unknown as AnyAction;
const removeVendorFn = removeProviderVendorAction as unknown as AnyAction;
const endpointsFn = getProviderEndpointsAction as unknown as AnyAction;
const endpointsByVendorFn = getProviderEndpointsByVendorAction as unknown as AnyAction;
const addEndpointFn = addProviderEndpointAction as unknown as AnyAction;
const editEndpointFn = editProviderEndpointAction as unknown as AnyAction;
const removeEndpointFn = removeProviderEndpointAction as unknown as AnyAction;
const probeEndpointFn = probeProviderEndpointAction as unknown as AnyAction;
const probeLogsFn = getProviderEndpointProbeLogsAction as unknown as AnyAction;
const endpointCircuitFn = getEndpointCircuitInfoAction as unknown as AnyAction;
const resetEndpointCircuitFn = resetEndpointCircuitAction as unknown as AnyAction;

const VENDORS_BASE_PATH = "/api/v1/provider-vendors";
const ENDPOINTS_BASE_PATH = "/api/v1/provider-endpoints";

function parsePositiveIntParam(
  c: Context,
  ...names: string[]
): { ok: true; value: number } | { ok: false; response: Response } {
  for (const name of names) {
    let raw = c.req.param(name);
    if (typeof raw === "string" && raw.length > 0) {
      if (raw.includes(":")) raw = raw.split(":")[0];
      const v = Number(raw);
      if (Number.isInteger(v) && v > 0) {
        return { ok: true, value: v };
      }
    }
  }
  return {
    ok: false,
    response: problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid path parameter",
      detail: "Path parameter must be a positive integer.",
    }),
  };
}

// ==================== GET /provider-vendors ====================

export async function listProviderVendors(c: Context): Promise<Response> {
  const dashboard = c.req.query("dashboard");
  const fn = dashboard === "true" ? dashboardVendorsFn : vendorsFn;
  const result = await callAction<Array<Record<string, unknown>>>(c, fn, [], {
    treatRawAsActionResult: true,
  });
  if (!result.ok) return result.problem;
  const items = (result.data ?? []).map(serializeProviderVendor);
  return respondJson(c, { items }, 200);
}

// ==================== GET /provider-vendors/{id} ====================

export async function getProviderVendor(c: Context): Promise<Response> {
  const parsed = parsePositiveIntParam(c, "id");
  if (!parsed.ok) return parsed.response;
  const result = await callAction<Record<string, unknown> | null>(c, vendorByIdFn, [parsed.value], {
    treatRawAsActionResult: true,
  });
  if (!result.ok) return result.problem;
  if (!result.data) {
    return problem(c, {
      status: 404,
      errorCode: "not_found",
      title: "Vendor not found",
      detail: `Vendor #${parsed.value} does not exist.`,
    });
  }
  return respondJson(c, serializeProviderVendor(result.data), 200);
}

// ==================== PATCH /provider-vendors/{id} ====================

export async function patchProviderVendor(c: Context): Promise<Response> {
  const parsed = parsePositiveIntParam(c, "id");
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof ProviderVendorUpdateSchema>(
    c,
    ProviderVendorUpdateSchema
  );
  if (!body.ok) return body.response;
  const result = await callAction<{ vendor: Record<string, unknown> }>(c, editVendorFn, [
    { vendorId: parsed.value, ...body.data },
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, serializeProviderVendor(result.data.vendor), 200);
}

// ==================== DELETE /provider-vendors/{id} ====================

export async function deleteProviderVendor(c: Context): Promise<Response> {
  const parsed = parsePositiveIntParam(c, "id");
  if (!parsed.ok) return parsed.response;
  const result = await callAction<unknown>(c, removeVendorFn, [{ vendorId: parsed.value }]);
  if (!result.ok) return result.problem;
  return respondNoContent(c);
}

// ==================== GET /provider-vendors/{vendorId}/endpoints ====================

export async function listEndpointsForVendor(c: Context): Promise<Response> {
  const parsed = parsePositiveIntParam(c, "vendorId");
  if (!parsed.ok) return parsed.response;

  const providerType = c.req.query("providerType");
  // 当 providerType 提供时使用 getProviderEndpoints；否则 fallback 到全 vendor。
  if (providerType) {
    const result = await callAction<Array<Record<string, unknown>>>(
      c,
      endpointsFn,
      [{ vendorId: parsed.value, providerType }],
      { treatRawAsActionResult: true }
    );
    if (!result.ok) return result.problem;
    const items = filterVisibleEndpoints(result.data ?? []).map(serializeProviderEndpoint);
    return respondJson(c, { items }, 200);
  }
  const result = await callAction<Array<Record<string, unknown>>>(
    c,
    endpointsByVendorFn,
    [{ vendorId: parsed.value }],
    { treatRawAsActionResult: true }
  );
  if (!result.ok) return result.problem;
  const items = filterVisibleEndpoints(result.data ?? []).map(serializeProviderEndpoint);
  return respondJson(c, { items }, 200);
}

// ==================== POST /provider-vendors/{vendorId}/endpoints ====================

export async function createEndpointForVendor(c: Context): Promise<Response> {
  const parsed = parsePositiveIntParam(c, "vendorId");
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof ProviderEndpointCreateSchema>(
    c,
    ProviderEndpointCreateSchema
  );
  if (!body.ok) return body.response;

  const result = await callAction<{ endpoint: Record<string, unknown> }>(c, addEndpointFn, [
    { vendorId: parsed.value, ...body.data },
  ]);
  if (!result.ok) return result.problem;
  const serialized = serializeProviderEndpoint(result.data.endpoint);
  return respondCreated(c, serialized, `${ENDPOINTS_BASE_PATH}/${serialized.id}`);
}

// ==================== PATCH /provider-endpoints/{id} ====================

export async function patchEndpoint(c: Context): Promise<Response> {
  const parsed = parsePositiveIntParam(c, "id");
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof ProviderEndpointUpdateSchema>(
    c,
    ProviderEndpointUpdateSchema
  );
  if (!body.ok) return body.response;
  const result = await callAction<{ endpoint: Record<string, unknown> }>(c, editEndpointFn, [
    { endpointId: parsed.value, ...body.data },
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, serializeProviderEndpoint(result.data.endpoint), 200);
}

// ==================== DELETE /provider-endpoints/{id} ====================

export async function deleteEndpoint(c: Context): Promise<Response> {
  const parsed = parsePositiveIntParam(c, "id");
  if (!parsed.ok) return parsed.response;
  const result = await callAction<unknown>(c, removeEndpointFn, [{ endpointId: parsed.value }]);
  if (!result.ok) return result.problem;
  return respondNoContent(c);
}

// ==================== POST /provider-endpoints/{id}:probe ====================

export async function probeEndpointHandler(c: Context): Promise<Response> {
  const parsed = parsePositiveIntParam(c, "id", "idProbe");
  if (!parsed.ok) return parsed.response;
  // probe 的请求体可选；若解析失败也兼容空体。
  const contentType = c.req.header("content-type") ?? "";
  let timeoutMs: number | undefined;
  if (/^application\/(?:[a-z0-9.+-]+\+)?json/i.test(contentType.trim())) {
    const body = await parseJsonBody<typeof ProviderEndpointProbeSchema>(
      c,
      ProviderEndpointProbeSchema
    );
    if (!body.ok) return body.response;
    timeoutMs = body.data.timeoutMs;
  }
  const result = await callAction<{
    endpoint: Record<string, unknown>;
    result: Record<string, unknown>;
  }>(c, probeEndpointFn, [{ endpointId: parsed.value, timeoutMs }]);
  if (!result.ok) return result.problem;
  return respondJson(
    c,
    {
      endpoint: serializeProviderEndpoint(result.data.endpoint),
      result: result.data.result,
    },
    200
  );
}

// ==================== GET /provider-endpoints/{id}/probe-logs ====================

export async function getEndpointProbeLogs(c: Context): Promise<Response> {
  const parsed = parsePositiveIntParam(c, "id");
  if (!parsed.ok) return parsed.response;
  const limitRaw = c.req.query("limit");
  const offsetRaw = c.req.query("offset");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const offset = offsetRaw ? Number(offsetRaw) : undefined;

  const result = await callAction<{
    endpointId: number;
    logs: Array<Record<string, unknown>>;
  }>(c, probeLogsFn, [{ endpointId: parsed.value, limit, offset }]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /provider-endpoints/{id}/circuit ====================

export async function getEndpointCircuit(c: Context): Promise<Response> {
  const parsed = parsePositiveIntParam(c, "id");
  if (!parsed.ok) return parsed.response;
  const result = await callAction<unknown>(c, endpointCircuitFn, [{ endpointId: parsed.value }]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data ?? {}, 200);
}

// ==================== POST /provider-endpoints/{id}/circuit:reset ====================

export async function resetEndpointCircuit(c: Context): Promise<Response> {
  const parsed = parsePositiveIntParam(c, "id", "idCircuitReset");
  if (!parsed.ok) return parsed.response;
  const result = await callAction<unknown>(c, resetEndpointCircuitFn, [
    { endpointId: parsed.value },
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, { ok: true }, 200);
}

// 暴露常量，便于上层 router 引用 BASE_PATH（当前未使用，保留以避免 dead-code 报错）
export { ENDPOINTS_BASE_PATH, VENDORS_BASE_PATH };
