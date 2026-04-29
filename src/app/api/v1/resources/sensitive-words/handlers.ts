/**
 * /api/v1/sensitive-words handler 集合
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
  SensitiveWordCreateSchema,
  SensitiveWordUpdateSchema,
} from "@/lib/api/v1/schemas/sensitive-words";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

const RESOURCE_BASE_PATH = "/api/v1/sensitive-words";

async function loadActions() {
  const mod = await import("@/actions/sensitive-words");
  return {
    list: mod.listSensitiveWords as unknown as AnyAction,
    create: mod.createSensitiveWordAction as unknown as AnyAction,
    update: mod.updateSensitiveWordAction as unknown as AnyAction,
    remove: mod.deleteSensitiveWordAction as unknown as AnyAction,
    refresh: mod.refreshCacheAction as unknown as AnyAction,
    stats: mod.getCacheStats as unknown as AnyAction,
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

export async function listSensitiveWords(c: Context): Promise<Response> {
  const actions = await loadActions();
  const result = await callAction<unknown[]>(c, actions.list, [], {
    treatRawAsActionResult: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data ?? [] }, 200);
}

export async function createSensitiveWord(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof SensitiveWordCreateSchema>(c, SensitiveWordCreateSchema);
  if (!body.ok) return body.response;
  const actions = await loadActions();
  const result = await callAction<{ id: number }>(c, actions.create, [body.data]);
  if (!result.ok) return result.problem;
  return respondCreated(c, result.data, `${RESOURCE_BASE_PATH}/${result.data.id}`);
}

export async function updateSensitiveWord(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof SensitiveWordUpdateSchema>(c, SensitiveWordUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.update, [parsed.id, body.data]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

export async function deleteSensitiveWord(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.remove, [parsed.id]);
  if (!result.ok) return result.problem;
  return respondNoContent(c);
}

export async function refreshSensitiveWordsCache(c: Context): Promise<Response> {
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.refresh, []);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

export async function getSensitiveWordsCacheStats(c: Context): Promise<Response> {
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.stats, [], {
    treatRawAsActionResult: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, result.data ?? null, 200);
}
