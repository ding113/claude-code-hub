import type { Context } from "hono";
import type { ActionResult } from "@/actions/types";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { withNoStoreHeaders } from "@/lib/api/v1/_shared/cache-control";
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
  KeyCreateSchema,
  KeyEnableSchema,
  KeyIdParamSchema,
  KeyListQuerySchema,
  KeyRenewSchema,
  KeysBatchUpdateSchema,
  KeyUpdateSchema,
  PatchKeyLimitParamSchema,
  PatchKeyLimitSchema,
  UserIdForKeysParamSchema,
} from "@/lib/api/v1/schemas/keys";
import { maskKey } from "@/lib/utils/validation";

export async function listUserKeys(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const query = KeyListQuerySchema.safeParse({ include: c.req.query("include") });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/keys");
  const result =
    query.data.include === "statistics"
      ? await callAction(
          c,
          actions.getKeysWithStatistics,
          [params.userId] as never[],
          c.get("auth")
        )
      : await callAction(c, actions.getKeys, [params.userId] as never[], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: Array.isArray(result.data) ? result.data.map(sanitizeKey) : [] });
}

export async function createUserKey(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const body = await parseHonoJsonBody(c, KeyCreateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/keys");
  const result = await callAction(
    c,
    actions.addKey,
    [{ userId: params.userId, ...body.data }] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return createdResponse(result.data, "/api/v1/keys", { headers: withNoStoreHeaders() });
}

export async function getKey(c: Context): Promise<Response> {
  const params = parseKeyParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/keys");
  const result = await callAction(
    c,
    actions.getKeyLimitUsage,
    [params.keyId] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ id: params.keyId, limitUsage: result.data });
}

export async function updateKey(c: Context): Promise<Response> {
  const params = parseKeyParams(c);
  if (params instanceof Response) return params;
  const body = await parseHonoJsonBody(c, KeyUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/keys");
  return actionJson(
    c,
    await callAction(c, actions.editKey, [params.keyId, body.data] as never[], c.get("auth"))
  );
}

export async function deleteKey(c: Context): Promise<Response> {
  const params = parseKeyParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/keys");
  const result = await callAction(c, actions.removeKey, [params.keyId] as never[], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function enableKey(c: Context): Promise<Response> {
  const params = parseKeyParams(c);
  if (params instanceof Response) return params;
  const body = await parseHonoJsonBody(c, KeyEnableSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/keys");
  return actionJson(
    c,
    await callAction(
      c,
      actions.toggleKeyEnabled,
      [params.keyId, body.data.enabled] as never[],
      c.get("auth")
    )
  );
}

export async function renewKey(c: Context): Promise<Response> {
  const params = parseKeyParams(c);
  if (params instanceof Response) return params;
  const body = await parseHonoJsonBody(c, KeyRenewSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/keys");
  return actionJson(
    c,
    await callAction(
      c,
      actions.renewKeyExpiresAt,
      [params.keyId, body.data] as never[],
      c.get("auth")
    )
  );
}

export async function resetKeyLimits(c: Context): Promise<Response> {
  const params = parseKeyParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/keys");
  const result = await callAction(
    c,
    actions.resetKeyLimitsOnly,
    [params.keyId] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function getKeyLimitUsage(c: Context): Promise<Response> {
  const params = parseKeyParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/keys");
  return actionJson(
    c,
    await callAction(c, actions.getKeyLimitUsage, [params.keyId] as never[], c.get("auth"))
  );
}

export async function getKeyQuotaUsage(c: Context): Promise<Response> {
  const params = parseKeyParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/key-quota");
  return actionJson(
    c,
    await callAction(c, actions.getKeyQuotaUsage, [params.keyId] as never[], c.get("auth"))
  );
}

export async function patchKeyLimit(c: Context): Promise<Response> {
  const params = PatchKeyLimitParamSchema.safeParse({
    keyId: c.req.param("keyId"),
    field: c.req.param("field"),
  });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const body = await parseHonoJsonBody(c, PatchKeyLimitSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/keys");
  return actionJson(
    c,
    await callAction(
      c,
      actions.patchKeyLimit,
      [params.data.keyId, params.data.field, body.data.value] as never[],
      c.get("auth")
    )
  );
}

export async function batchUpdateKeys(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, KeysBatchUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/keys");
  return actionJson(
    c,
    await callAction(c, actions.batchUpdateKeys, [body.data] as never[], c.get("auth"))
  );
}

function parseUserParams(c: Context): { userId: number } | Response {
  const params = UserIdForKeysParamSchema.safeParse({ userId: c.req.param("userId") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  return params.data;
}

function parseKeyParams(c: Context): { keyId: number } | Response {
  const rawKeyId = (c.req.param("keyId") ?? "").replace(/:(enable|renew)$/, "");
  const params = KeyIdParamSchema.safeParse({ keyId: rawKeyId });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  return params.data;
}

function actionJson<T>(c: Context, result: ActionResult<T>): Response {
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data ?? { ok: true });
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const code = result.errorCode;
  const status =
    code === "NOT_FOUND" || detail.includes("不存在") || detail.includes("not found")
      ? 404
      : detail.includes("权限")
        ? 403
        : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: code ?? (status === 404 ? "key.not_found" : "key.action_failed"),
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}

function sanitizeKey(item: unknown): unknown {
  if (!item || typeof item !== "object" || !("key" in item)) {
    return item;
  }

  const { key, ...rest } = item as Record<string, unknown> & { key?: unknown };
  return {
    ...rest,
    ...(typeof key === "string" ? { maskedKey: maskKey(key) } : {}),
  };
}
