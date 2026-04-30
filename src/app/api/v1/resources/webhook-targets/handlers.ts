/**
 * /api/v1/webhook-targets handler 集合
 *
 * 设计要点：
 * - 每个 handler 仅做：参数解析 → callAction(...) → 序列化响应；
 * - 永远通过 `redactWebhookTarget(...)` 脱敏响应中的敏感字段；
 * - 错误一律返回 problem+json（由 callAction / parseJsonBody 自动构造）；
 * - test 端点写入 `Cache-Control: no-store`，避免缓存层复用敏感测试结果；
 * - 不重复实现业务校验：让旧 action 完成校验，失败时通过 ActionResult.error 透传。
 */

import type { Context } from "hono";
import {
  createWebhookTargetAction,
  deleteWebhookTargetAction,
  getWebhookTargetsAction,
  testWebhookTargetAction,
  updateWebhookTargetAction,
} from "@/actions/webhook-targets";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { setNoStore } from "@/lib/api/v1/_shared/cache-control";
import { problem } from "@/lib/api/v1/_shared/error-envelope";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import {
  respondCreated,
  respondJson,
  respondNoContent,
} from "@/lib/api/v1/_shared/response-helpers";
import {
  redactWebhookTarget,
  type WebhookTargetCreateInput,
  WebhookTargetCreateSchema,
  type WebhookTargetTestInput,
  WebhookTargetTestSchema,
  type WebhookTargetUpdateInput,
  WebhookTargetUpdateSchema,
} from "@/lib/api/v1/schemas/webhook-targets";
import type { WebhookTarget } from "@/repository/webhook-targets";

/** 把 server action 函数擦除签名以适配 callAction 的统一入参类型。 */
type AnyAction = (...args: unknown[]) => Promise<unknown>;

const listAction = getWebhookTargetsAction as unknown as AnyAction;
const createAction = createWebhookTargetAction as unknown as AnyAction;
const updateAction = updateWebhookTargetAction as unknown as AnyAction;
const deleteAction = deleteWebhookTargetAction as unknown as AnyAction;
const testAction = testWebhookTargetAction as unknown as AnyAction;

const RESOURCE_BASE_PATH = "/api/v1/webhook-targets";

/**
 * 解析路径参数 `{id}`，统一返回正整数或返回 problem+json 的 400 响应。
 *
 * 兼容两种参数名：
 * - "id"     -> 普通资源路径 `/webhook-targets/:id`
 * - "idTest" -> 动作动词路径 `/webhook-targets/:idTest{[0-9]+:test}`，
 *               其值形如 "42:test"，需要剥离冒号前缀。
 */
function parseIdParam(c: Context): { ok: true; id: number } | { ok: false; response: Response } {
  const rawId = c.req.param("id");
  const rawIdTest = c.req.param("idTest");
  let raw: string | undefined = rawId;
  if (!raw && typeof rawIdTest === "string") {
    raw = rawIdTest.split(":")[0];
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

// ==================== GET /webhook-targets ====================

export async function listWebhookTargets(c: Context): Promise<Response> {
  const result = await callAction<WebhookTarget[]>(c, listAction, []);
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data.map(redactWebhookTarget) }, 200);
}

// ==================== GET /webhook-targets/{id} ====================

export async function getWebhookTarget(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;

  const result = await callAction<WebhookTarget[]>(c, listAction, []);
  if (!result.ok) return result.problem;

  const target = result.data.find((t) => t.id === parsed.id);
  if (!target) {
    return problem(c, {
      status: 404,
      errorCode: "not_found",
      title: "Webhook target not found",
      detail: `Webhook target #${parsed.id} does not exist.`,
    });
  }
  return respondJson(c, redactWebhookTarget(target), 200);
}

// ==================== POST /webhook-targets ====================

export async function createWebhookTarget(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof WebhookTargetCreateSchema>(c, WebhookTargetCreateSchema);
  if (!body.ok) return body.response;

  const result = await callAction<WebhookTarget>(c, createAction, [
    body.data satisfies WebhookTargetCreateInput,
  ]);
  if (!result.ok) return result.problem;

  const sanitized = redactWebhookTarget(result.data);
  return respondCreated(c, sanitized, `${RESOURCE_BASE_PATH}/${sanitized.id}`);
}

// ==================== PATCH /webhook-targets/{id} ====================

export async function patchWebhookTarget(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;

  const body = await parseJsonBody<typeof WebhookTargetUpdateSchema>(c, WebhookTargetUpdateSchema);
  if (!body.ok) return body.response;

  const result = await callAction<WebhookTarget>(c, updateAction, [
    parsed.id,
    body.data satisfies WebhookTargetUpdateInput,
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, redactWebhookTarget(result.data), 200);
}

// ==================== DELETE /webhook-targets/{id} ====================

export async function deleteWebhookTarget(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;

  const result = await callAction<void>(c, deleteAction, [parsed.id]);
  if (!result.ok) return result.problem;
  return respondNoContent(c);
}

// ==================== POST /webhook-targets/{id}:test ====================

export async function testWebhookTarget(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;

  const body = await parseJsonBody<typeof WebhookTargetTestSchema>(c, WebhookTargetTestSchema);
  if (!body.ok) return body.response;

  const input = body.data satisfies WebhookTargetTestInput;
  const result = await callAction<{ latencyMs: number }>(c, testAction, [
    parsed.id,
    input.notificationType,
  ]);

  if (!result.ok) {
    setNoStore(c);
    return result.problem;
  }
  // respondJson constructs a fresh Response that ignores c.header() — apply no-store directly.
  return new Response(JSON.stringify({ latencyMs: result.data.latencyMs }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    },
  });
}
