/**
 * /api/v1/error-rules handler 集合
 *
 * 大部分 action 自身做权限检查（admin only），handler 走 callAction 桥接。
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
  ErrorRuleCreateSchema,
  ErrorRuleTestRequestSchema,
  ErrorRuleUpdateSchema,
} from "@/lib/api/v1/schemas/error-rules";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

const RESOURCE_BASE_PATH = "/api/v1/error-rules";

async function loadActions() {
  const mod = await import("@/actions/error-rules");
  return {
    list: mod.listErrorRules as unknown as AnyAction,
    create: mod.createErrorRuleAction as unknown as AnyAction,
    update: mod.updateErrorRuleAction as unknown as AnyAction,
    remove: mod.deleteErrorRuleAction as unknown as AnyAction,
    refresh: mod.refreshCacheAction as unknown as AnyAction,
    test: mod.testErrorRuleAction as unknown as AnyAction,
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

// ==================== GET /error-rules ====================

export async function listErrorRules(c: Context): Promise<Response> {
  const actions = await loadActions();
  const result = await callAction<unknown[]>(c, actions.list, [], {
    treatRawAsActionResult: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data ?? [] }, 200);
}

// ==================== POST /error-rules ====================

export async function createErrorRule(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof ErrorRuleCreateSchema>(c, ErrorRuleCreateSchema);
  if (!body.ok) return body.response;
  const actions = await loadActions();
  const result = await callAction<{ id: number }>(c, actions.create, [body.data]);
  if (!result.ok) return result.problem;
  return respondCreated(c, result.data, `${RESOURCE_BASE_PATH}/${result.data.id}`);
}

// ==================== PATCH /error-rules/{id} ====================

export async function updateErrorRule(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof ErrorRuleUpdateSchema>(c, ErrorRuleUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.update, [parsed.id, body.data]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== DELETE /error-rules/{id} ====================

export async function deleteErrorRule(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.remove, [parsed.id]);
  if (!result.ok) return result.problem;
  return respondNoContent(c);
}

// ==================== POST /error-rules/cache:refresh ====================

export async function refreshErrorRulesCache(c: Context): Promise<Response> {
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.refresh, []);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== POST /error-rules:test ====================

export async function testErrorRule(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof ErrorRuleTestRequestSchema>(
    c,
    ErrorRuleTestRequestSchema
  );
  if (!body.ok) return body.response;
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.test, [body.data]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /error-rules/cache/stats ====================

export async function getErrorRulesCacheStats(c: Context): Promise<Response> {
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.stats, [], {
    treatRawAsActionResult: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, result.data ?? null, 200);
}
