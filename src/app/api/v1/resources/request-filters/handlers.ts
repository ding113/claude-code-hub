/**
 * /api/v1/request-filters handler 集合
 */

import type { Context } from "hono";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { problem } from "@/lib/api/v1/_shared/error-envelope";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import {
  respondCreated,
  respondJson,
  respondNoContent,
} from "@/lib/api/v1/_shared/response-helpers";
import {
  RequestFilterCreateSchema,
  RequestFilterUpdateSchema,
} from "@/lib/api/v1/schemas/request-filters";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

const RESOURCE_BASE_PATH = "/api/v1/request-filters";

async function loadActions() {
  const mod = await import("@/actions/request-filters");
  return {
    list: mod.listRequestFilters as unknown as AnyAction,
    create: mod.createRequestFilterAction as unknown as AnyAction,
    update: mod.updateRequestFilterAction as unknown as AnyAction,
    remove: mod.deleteRequestFilterAction as unknown as AnyAction,
    refresh: mod.refreshRequestFiltersCache as unknown as AnyAction,
    listProviders: mod.listProvidersForFilterAction as unknown as AnyAction,
    listGroups: mod.getDistinctProviderGroupsAction as unknown as AnyAction,
  };
}

function parseIdParam(c: Context): { ok: true; id: number } | { ok: false; response: Response } {
  const raw = c.req.param("id");
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

export async function listRequestFilters(c: Context): Promise<Response> {
  const actions = await loadActions();
  const result = await callAction<unknown[]>(c, actions.list, [], {
    treatRawAsActionResult: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data ?? [] }, 200);
}

export async function createRequestFilter(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof RequestFilterCreateSchema>(c, RequestFilterCreateSchema);
  if (!body.ok) return body.response;
  const actions = await loadActions();
  const result = await callAction<{ id: number }>(c, actions.create, [body.data]);
  if (!result.ok) return result.problem;
  return respondCreated(c, result.data, `${RESOURCE_BASE_PATH}/${result.data.id}`);
}

export async function updateRequestFilter(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof RequestFilterUpdateSchema>(c, RequestFilterUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.update, [parsed.id, body.data]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

export async function deleteRequestFilter(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.remove, [parsed.id]);
  if (!result.ok) return result.problem;
  return respondNoContent(c);
}

export async function refreshRequestFiltersCache(c: Context): Promise<Response> {
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.refresh, []);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

export async function listProvidersForFilter(c: Context): Promise<Response> {
  const actions = await loadActions();
  const result = await callAction<Array<{ id: number; name: string }>>(
    c,
    actions.listProviders,
    []
  );
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data ?? [] }, 200);
}

export async function listGroupsForFilter(c: Context): Promise<Response> {
  const actions = await loadActions();
  const result = await callAction<string[]>(c, actions.listGroups, []);
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data ?? [] }, 200);
}
