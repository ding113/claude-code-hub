/**
 * /api/v1/provider-groups handler
 */

import type { Context } from "hono";
import {
  createProviderGroup as createProviderGroupAction,
  deleteProviderGroup as deleteProviderGroupAction,
  getProviderGroups as getProviderGroupsAction,
  updateProviderGroup as updateProviderGroupAction,
} from "@/actions/provider-groups";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { problem } from "@/lib/api/v1/_shared/error-envelope";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import {
  respondCreated,
  respondJson,
  respondNoContent,
} from "@/lib/api/v1/_shared/response-helpers";
import {
  ProviderGroupCreateSchema,
  ProviderGroupUpdateSchema,
  serializeProviderGroup,
} from "@/lib/api/v1/schemas/provider-groups";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

const listFn = getProviderGroupsAction as unknown as AnyAction;
const createFn = createProviderGroupAction as unknown as AnyAction;
const updateFn = updateProviderGroupAction as unknown as AnyAction;
const deleteFn = deleteProviderGroupAction as unknown as AnyAction;

const RESOURCE_BASE_PATH = "/api/v1/provider-groups";

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

// ==================== GET /provider-groups ====================

export async function listProviderGroups(c: Context): Promise<Response> {
  const result = await callAction<Array<Record<string, unknown>>>(c, listFn, []);
  if (!result.ok) return result.problem;
  return respondJson(c, { items: (result.data ?? []).map(serializeProviderGroup) }, 200);
}

// ==================== POST /provider-groups ====================

export async function createProviderGroupHandler(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof ProviderGroupCreateSchema>(c, ProviderGroupCreateSchema);
  if (!body.ok) return body.response;
  const result = await callAction<Record<string, unknown>>(c, createFn, [body.data]);
  if (!result.ok) return result.problem;
  const serialized = serializeProviderGroup(result.data);
  return respondCreated(c, serialized, `${RESOURCE_BASE_PATH}/${serialized.id}`);
}

// ==================== PATCH /provider-groups/{id} ====================

export async function patchProviderGroupHandler(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof ProviderGroupUpdateSchema>(c, ProviderGroupUpdateSchema);
  if (!body.ok) return body.response;
  const result = await callAction<Record<string, unknown>>(c, updateFn, [parsed.id, body.data]);
  if (!result.ok) return result.problem;
  return respondJson(c, serializeProviderGroup(result.data), 200);
}

// ==================== DELETE /provider-groups/{id} ====================

export async function deleteProviderGroupHandler(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const result = await callAction<unknown>(c, deleteFn, [parsed.id]);
  if (!result.ok) return result.problem;
  return respondNoContent(c);
}
