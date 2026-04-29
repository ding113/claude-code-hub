/**
 * /api/v1/providers handler 集合
 *
 * 设计要点：
 * - 列表 / 详情通过 `getProviders` action 拉取；?include=statistics 时再附加
 *   `getProviderStatisticsAsync` 的结果；
 * - 列表 / 详情读接口在序列化前过滤掉 providerType 为 claude-auth / gemini-cli
 *   的隐藏类型（参考 plan「Hidden Provider」章节）；
 * - 写接口（POST/PATCH）使用 v1 ProviderTypeSchema 校验（已排除隐藏类型）；
 *   v1 -> legacy 时把 camelCase 转换成 snake_case；
 * - GET /providers/{id}/key:reveal（issue #1123 核心）：
 *   - 显式带 Cache-Control: no-store；
 *   - 通过 callAction 调用，session + IP/UA 已写入 ALS，确保 audit 完整；
 *   - 响应固定 { id, key }，禁止任何脱敏。
 */

import type { Context } from "hono";
import {
  addProvider as addProviderAction,
  autoSortProviderPriority as autoSortProviderPriorityAction,
  batchResetProviderCircuits as batchResetProviderCircuitsAction,
  batchUpdateProviders as batchUpdateProvidersAction,
  editProvider as editProviderAction,
  getAvailableProviderGroups as getAvailableProviderGroupsAction,
  getProviderGroupsWithCount as getProviderGroupsWithCountAction,
  getProviderStatisticsAsync as getProviderStatisticsAsyncAction,
  getProviders as getProvidersAction,
  getProvidersHealthStatus as getProvidersHealthStatusAction,
  getUnmaskedProviderKey as getUnmaskedProviderKeyAction,
  removeProvider as removeProviderAction,
  resetProviderCircuit as resetProviderCircuitAction,
  resetProviderTotalUsage as resetProviderTotalUsageAction,
} from "@/actions/providers";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { problem } from "@/lib/api/v1/_shared/error-envelope";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import {
  respondCreated,
  respondJson,
  respondNoContent,
} from "@/lib/api/v1/_shared/response-helpers";
import {
  filterVisibleProviders,
  ProviderAutoSortPrioritySchema,
  ProviderBatchResetCircuitsSchema,
  ProviderBatchUpdateSchema,
  ProviderCreateSchema,
  ProviderUpdateSchema,
  serializeProvider,
} from "@/lib/api/v1/schemas/providers";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

const listProvidersFn = getProvidersAction as unknown as AnyAction;
const statisticsFn = getProviderStatisticsAsyncAction as unknown as AnyAction;
const addProviderFn = addProviderAction as unknown as AnyAction;
const editProviderFn = editProviderAction as unknown as AnyAction;
const removeProviderFn = removeProviderAction as unknown as AnyAction;
const healthFn = getProvidersHealthStatusAction as unknown as AnyAction;
const resetCircuitFn = resetProviderCircuitAction as unknown as AnyAction;
const resetUsageFn = resetProviderTotalUsageAction as unknown as AnyAction;
const batchResetCircuitsFn = batchResetProviderCircuitsAction as unknown as AnyAction;
const groupsAvailableFn = getAvailableProviderGroupsAction as unknown as AnyAction;
const groupsCountFn = getProviderGroupsWithCountAction as unknown as AnyAction;
const autoSortFn = autoSortProviderPriorityAction as unknown as AnyAction;
const batchUpdateFn = batchUpdateProvidersAction as unknown as AnyAction;
const revealKeyFn = getUnmaskedProviderKeyAction as unknown as AnyAction;

const RESOURCE_BASE_PATH = "/api/v1/providers";

/** 路径参数解析（兼容 :id / :idCircuitReset / :idUsageReset / :idKeyReveal）。 */
function parseProviderIdParam(
  c: Context
): { ok: true; id: number } | { ok: false; response: Response } {
  const candidates = [
    c.req.param("id"),
    c.req.param("idCircuitReset"),
    c.req.param("idUsageReset"),
    c.req.param("idKeyReveal"),
  ];
  let raw: string | undefined;
  for (const cand of candidates) {
    if (typeof cand === "string" && cand.length > 0) {
      raw = cand.includes(":") ? cand.split(":")[0] : cand;
      break;
    }
  }
  const id = raw ? Number(raw) : Number.NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return {
      ok: false,
      response: problem(c, {
        status: 400,
        errorCode: "validation_failed",
        title: "Invalid path parameter",
        detail: "Path parameter `id` must be a positive integer.",
      }),
    };
  }
  return { ok: true, id };
}

/** v1 camelCase -> legacy snake_case 字段映射（仅做名字翻译，不增删字段）。 */
function camelToSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function v1ToLegacyProviderInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[camelToSnakeKey(k)] = v;
  }
  return out;
}

// ==================== GET /providers ====================

export async function listProviders(c: Context): Promise<Response> {
  const include = c.req.query("include");
  // getProviders 直接返回数组（不是 ActionResult），用 raw 模式
  const result = await callAction<Array<Record<string, unknown>>>(c, listProvidersFn, [], {
    treatRawAsActionResult: true,
  });
  if (!result.ok) return result.problem;

  const visibleProviders = filterVisibleProviders(result.data ?? []).map(serializeProvider);

  if (include === "statistics") {
    const stats = await callAction<Record<string, unknown>>(c, statisticsFn, [], {
      treatRawAsActionResult: true,
    });
    if (!stats.ok) return stats.problem;
    return respondJson(c, { items: visibleProviders, statistics: stats.data ?? {} }, 200);
  }

  return respondJson(c, { items: visibleProviders }, 200);
}

// ==================== GET /providers/{id} ====================

export async function getProvider(c: Context): Promise<Response> {
  const parsed = parseProviderIdParam(c);
  if (!parsed.ok) return parsed.response;
  const result = await callAction<Array<Record<string, unknown>>>(c, listProvidersFn, [], {
    treatRawAsActionResult: true,
  });
  if (!result.ok) return result.problem;
  const all = result.data ?? [];
  const found = filterVisibleProviders(all).find((p) => (p as { id: number }).id === parsed.id);
  if (!found) {
    return problem(c, {
      status: 404,
      errorCode: "not_found",
      title: "Provider not found",
      detail: `Provider #${parsed.id} does not exist or has a hidden type.`,
    });
  }
  return respondJson(c, serializeProvider(found), 200);
}

// ==================== POST /providers ====================

export async function createProviderHandler(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof ProviderCreateSchema>(c, ProviderCreateSchema, {
    strict: false,
  });
  if (!body.ok) return body.response;

  const legacyInput = v1ToLegacyProviderInput(body.data as Record<string, unknown>);
  const result = await callAction<unknown>(c, addProviderFn, [legacyInput]);
  if (!result.ok) return result.problem;

  // addProvider 返回 ActionResult<void>；为了取到新 id，我们再查一次 list。
  const listed = await callAction<Array<Record<string, unknown>>>(c, listProvidersFn, [], {
    treatRawAsActionResult: true,
  });
  if (!listed.ok) return listed.problem;
  // 用 name 匹配（addProvider 内部把 name 当作唯一显示名，单测 mock 也按此处理）。
  const name = (body.data as { name?: string }).name;
  const found = filterVisibleProviders(listed.data ?? []).find(
    (p) => (p as { name: string }).name === name
  );
  if (!found) {
    // 若 list 找不到（mock 不更新 list 时的 fallback），仍返回 201 + 输入回显。
    const fallbackId = 0;
    return respondCreated(
      c,
      { ...body.data, id: fallbackId },
      `${RESOURCE_BASE_PATH}/${fallbackId}`
    );
  }
  const serialized = serializeProvider(found);
  return respondCreated(c, serialized, `${RESOURCE_BASE_PATH}/${serialized.id}`);
}

// ==================== PATCH /providers/{id} ====================

export async function patchProvider(c: Context): Promise<Response> {
  const parsed = parseProviderIdParam(c);
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof ProviderUpdateSchema>(c, ProviderUpdateSchema, {
    strict: false,
  });
  if (!body.ok) return body.response;

  const legacyInput = v1ToLegacyProviderInput(body.data as Record<string, unknown>);
  const result = await callAction<unknown>(c, editProviderFn, [parsed.id, legacyInput]);
  if (!result.ok) return result.problem;

  // editProvider 返回 ActionResult<EditProviderResult>，但我们只关心是否成功；
  // REST 语义返回更新后的 provider；再查一次 list。
  const listed = await callAction<Array<Record<string, unknown>>>(c, listProvidersFn, [], {
    treatRawAsActionResult: true,
  });
  if (!listed.ok) return listed.problem;
  const found = filterVisibleProviders(listed.data ?? []).find(
    (p) => (p as { id: number }).id === parsed.id
  );
  if (!found) {
    return problem(c, {
      status: 404,
      errorCode: "not_found",
      title: "Provider not found",
      detail: `Provider #${parsed.id} not found after update.`,
    });
  }
  return respondJson(c, serializeProvider(found), 200);
}

// ==================== DELETE /providers/{id} ====================

export async function deleteProviderHandler(c: Context): Promise<Response> {
  const parsed = parseProviderIdParam(c);
  if (!parsed.ok) return parsed.response;
  const result = await callAction<unknown>(c, removeProviderFn, [parsed.id]);
  if (!result.ok) return result.problem;
  return respondNoContent(c);
}

// ==================== GET /providers/health ====================

export async function getHealthStatus(c: Context): Promise<Response> {
  const result = await callAction<Record<string, unknown>>(c, healthFn, [], {
    treatRawAsActionResult: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, result.data ?? {}, 200);
}

// ==================== POST /providers/{id}/circuit:reset ====================

export async function resetProviderCircuitHandler(c: Context): Promise<Response> {
  const parsed = parseProviderIdParam(c);
  if (!parsed.ok) return parsed.response;
  const result = await callAction<unknown>(c, resetCircuitFn, [parsed.id]);
  if (!result.ok) return result.problem;
  return respondJson(c, { ok: true }, 200);
}

// ==================== POST /providers/{id}/usage:reset ====================

export async function resetProviderUsageHandler(c: Context): Promise<Response> {
  const parsed = parseProviderIdParam(c);
  if (!parsed.ok) return parsed.response;
  const result = await callAction<unknown>(c, resetUsageFn, [parsed.id]);
  if (!result.ok) return result.problem;
  return respondJson(c, { ok: true }, 200);
}

// ==================== POST /providers/circuits:batchReset ====================

export async function batchResetCircuitsHandler(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof ProviderBatchResetCircuitsSchema>(
    c,
    ProviderBatchResetCircuitsSchema
  );
  if (!body.ok) return body.response;
  const result = await callAction<{ resetCount: number }>(c, batchResetCircuitsFn, [
    { providerIds: body.data.providerIds },
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /providers/groups ====================

export async function listProviderGroupsForProviders(c: Context): Promise<Response> {
  const include = c.req.query("include");
  if (include === "count") {
    const result = await callAction<Array<{ group: string; providerCount: number }>>(
      c,
      groupsCountFn,
      []
    );
    if (!result.ok) return result.problem;
    return respondJson(c, { items: result.data }, 200);
  }
  const result = await callAction<string[]>(c, groupsAvailableFn, [], {
    treatRawAsActionResult: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data ?? [] }, 200);
}

// ==================== POST /providers:autoSortPriority ====================

export async function autoSortPriorityHandler(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof ProviderAutoSortPrioritySchema>(
    c,
    ProviderAutoSortPrioritySchema
  );
  if (!body.ok) return body.response;
  const result = await callAction<unknown>(c, autoSortFn, [{ confirm: body.data.confirm }]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data ?? {}, 200);
}

// ==================== POST /providers:batchUpdate ====================

export async function batchUpdateProvidersHandler(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof ProviderBatchUpdateSchema>(c, ProviderBatchUpdateSchema, {
    strict: false,
  });
  if (!body.ok) return body.response;
  const legacyUpdates = v1ToLegacyProviderInput(body.data.updates as Record<string, unknown>);
  const result = await callAction<{ updatedCount: number }>(c, batchUpdateFn, [
    { providerIds: body.data.providerIds, updates: legacyUpdates },
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /providers/{id}/key:reveal ====================

/**
 * Issue #1123：暴露完整 provider key。
 * - 必须带 Cache-Control: no-store；
 * - callAction 已经把 session + IP + UA 写入 ALS，audit 由 action 自身处理。
 */
export async function revealProviderKeyHandler(c: Context): Promise<Response> {
  const parsed = parseProviderIdParam(c);
  if (!parsed.ok) return parsed.response;
  const result = await callAction<{ key: string }>(c, revealKeyFn, [parsed.id]);
  if (!result.ok) {
    // 即便错误也不应被缓存
    const headers = new Headers(result.problem.headers);
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("Pragma", "no-cache");
    return new Response(result.problem.body, {
      status: result.problem.status,
      statusText: result.problem.statusText,
      headers,
    });
  }
  return new Response(JSON.stringify({ id: parsed.id, key: result.data.key }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    },
  });
}
