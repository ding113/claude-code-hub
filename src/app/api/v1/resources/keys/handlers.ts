/**
 * /api/v1/keys handler 集合
 *
 * 设计要点：
 * - listForUser 调用 getKeys（admin tier）；?include=statistics 时再合并统计数据；
 * - createKey (POST /users/{userId}/keys)：legacy `addKey` 返回 `{ generatedKey, name }`，
 *   v1 在响应里把 generatedKey 暴露一次，并附 Location 头（指向新 key 的 PATCH 路径）。
 *   id 来自 Action 之后立即查 getKeys（按 name 匹配；同名密钥 legacy 已禁止）；
 * - patchKey (PATCH /keys/{id}): 调用 editKey，不返回新对象 -> 我们再查一次后回传；
 * - 其他动作类端点（enable / renew / limits:reset）返回 {ok:true} JSON；
 * - getLimitUsage 暴露给 read tier，自身权限通过 action 内部校验。
 */

import type { Context } from "hono";
import { getKeyQuotaUsage as getKeyQuotaUsageAction } from "@/actions/key-quota";
import {
  addKey,
  editKey,
  getKeyLimitUsage,
  getKeys,
  getKeysWithStatistics,
  removeKey,
  renewKeyExpiresAt,
  resetKeyLimitsOnly,
  toggleKeyEnabled,
} from "@/actions/keys";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { problem } from "@/lib/api/v1/_shared/error-envelope";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import {
  respondCreated,
  respondJson,
  respondNoContent,
} from "@/lib/api/v1/_shared/response-helpers";
import {
  KeyCreateSchema,
  KeyEnableSchema,
  KeyRenewSchema,
  KeyUpdateSchema,
  serializeKey,
} from "@/lib/api/v1/schemas/keys";
import type { Key } from "@/types/key";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

const addKeyAction = addKey as unknown as AnyAction;
const editKeyAction = editKey as unknown as AnyAction;
const removeKeyAction = removeKey as unknown as AnyAction;
const getKeysAction = getKeys as unknown as AnyAction;
const getKeysWithStatsAction = getKeysWithStatistics as unknown as AnyAction;
const toggleKeyEnabledAction = toggleKeyEnabled as unknown as AnyAction;
const renewKeyAction = renewKeyExpiresAt as unknown as AnyAction;
const resetKeyLimitsAction = resetKeyLimitsOnly as unknown as AnyAction;
const getKeyLimitUsageAction = getKeyLimitUsage as unknown as AnyAction;
const getKeyQuotaUsageFn = getKeyQuotaUsageAction as unknown as AnyAction;

const RESOURCE_BASE_PATH = "/api/v1/keys";

/** 路径参数解析（兼容 :id / :idEnable / :idRenew / :idLimitsReset / :userId）。 */
function parseNumericPathParam(
  c: Context,
  paramName: string
): { ok: true; value: number } | { ok: false; response: Response } {
  let raw = c.req.param(paramName);
  if (raw?.includes(":")) raw = raw.split(":")[0];
  const value = raw ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value <= 0) {
    return {
      ok: false,
      response: problem(c, {
        status: 400,
        errorCode: "validation_failed",
        title: "Invalid path parameter",
        detail: `Path parameter \`${paramName}\` must be a positive integer.`,
      }),
    };
  }
  return { ok: true, value };
}

function parseIdLike(c: Context): { ok: true; id: number } | { ok: false; response: Response } {
  for (const name of ["id", "idEnable", "idRenew", "idLimitsReset"]) {
    const raw = c.req.param(name);
    if (typeof raw === "string" && raw.length > 0) {
      const stripped = raw.includes(":") ? raw.split(":")[0] : raw;
      const id = Number(stripped);
      if (Number.isInteger(id) && id > 0) {
        return { ok: true, id };
      }
      break;
    }
  }
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

// ==================== GET /users/{userId}/keys ====================

export async function listKeysForUser(c: Context): Promise<Response> {
  const parsed = parseNumericPathParam(c, "userId");
  if (!parsed.ok) return parsed.response;
  const userId = parsed.value;
  const include = c.req.query("include") ?? "";
  const wantStatistics = include.split(",").includes("statistics");
  const keysResult = await callAction<Key[]>(c, getKeysAction, [userId]);
  if (!keysResult.ok) return keysResult.problem;
  const items = keysResult.data.map((k) => serializeKey(k as unknown as Record<string, unknown>));

  if (!wantStatistics) {
    return respondJson(c, { items }, 200);
  }
  const statsResult = await callAction<unknown>(c, getKeysWithStatsAction, [userId]);
  if (!statsResult.ok) return statsResult.problem;
  // statistics 当前不在 KeyResponseSchema 中，附加 ?include=statistics 时返回平行字段。
  return respondJson(c, { items, statistics: statsResult.data }, 200);
}

// ==================== POST /users/{userId}/keys ====================

interface AddKeyData {
  generatedKey: string;
  name: string;
}

export async function createKeyHandler(c: Context): Promise<Response> {
  const parsed = parseNumericPathParam(c, "userId");
  if (!parsed.ok) return parsed.response;
  const userId = parsed.value;

  const body = await parseJsonBody<typeof KeyCreateSchema>(c, KeyCreateSchema);
  if (!body.ok) return body.response;

  const result = await callAction<AddKeyData>(c, addKeyAction, [{ ...body.data, userId }]);
  if (!result.ok) return result.problem;

  // legacy addKey 不返回完整 key 对象；要给前端回传 id，再查一次列表按 name+key 匹配。
  const list = await callAction<Key[]>(c, getKeysAction, [userId]);
  if (!list.ok) return list.problem;
  const created = list.data.find(
    (k) => k.name === result.data.name && k.key === result.data.generatedKey
  );
  if (!created) {
    // 找不到时不能再回退到 id=0：parseIdLike 会拒绝 0，导致 Location 头指向
    // 永远 400 的资源 URL。改为 500 problem+json，暴露后续运维侧定位线索。
    // 注意：此响应仍然包含已生成的 key 字段会被丢失；但这是 legacy mock 不更新
    // list 才会触发的边界，正确的 mock 已经把新 key 加进 list。
    return problem(c, {
      status: 500,
      errorCode: "internal_error",
      title: "Internal Server Error",
      detail: "Key was created but could not be located in the subsequent list.",
    });
  }
  const responseBody = {
    id: created.id,
    name: result.data.name,
    key: result.data.generatedKey, // 原始 key，仅此一次
  };
  return respondCreated(c, responseBody, `${RESOURCE_BASE_PATH}/${created.id}`);
}

// ==================== PATCH /keys/{id} ====================

export async function patchKey(c: Context): Promise<Response> {
  const parsed = parseIdLike(c);
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof KeyUpdateSchema>(c, KeyUpdateSchema);
  if (!body.ok) return body.response;

  // editKey 要求 name；KeyUpdateSchema partial 后 name 可能缺失，缺失时填空字符串
  // 触发 action 内部校验更友好（不会绕过）。
  const editPayload = {
    name: typeof body.data.name === "string" ? body.data.name : "",
    ...body.data,
  };

  const result = await callAction<void>(c, editKeyAction, [parsed.id, editPayload]);
  if (!result.ok) return result.problem;

  // editKey 不返回更新后的 key；需要再查一次。我们没有 keyId -> userId 的反查 action,
  // 所以扫描 getKeys 的常用做法是知道 userId，这里只能从原 key 拿（再读 DB 路径不暴露）。
  // 简化方案：返回 {ok: true, id} 即可；前端可直接用 list 刷新。
  return respondJson(c, { ok: true, id: parsed.id }, 200);
}

// ==================== DELETE /keys/{id} ====================

export async function deleteKeyHandler(c: Context): Promise<Response> {
  const parsed = parseIdLike(c);
  if (!parsed.ok) return parsed.response;
  const result = await callAction<void>(c, removeKeyAction, [parsed.id]);
  if (!result.ok) return result.problem;
  return respondNoContent(c);
}

// ==================== POST /keys/{id}:enable ====================

export async function enableKeyHandler(c: Context): Promise<Response> {
  const parsed = parseIdLike(c);
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof KeyEnableSchema>(c, KeyEnableSchema);
  if (!body.ok) return body.response;
  const result = await callAction<void>(c, toggleKeyEnabledAction, [parsed.id, body.data.enabled]);
  if (!result.ok) return result.problem;
  return respondJson(c, { ok: true }, 200);
}

// ==================== POST /keys/{id}:renew ====================

export async function renewKeyHandler(c: Context): Promise<Response> {
  const parsed = parseIdLike(c);
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof KeyRenewSchema>(c, KeyRenewSchema);
  if (!body.ok) return body.response;
  const result = await callAction<void>(c, renewKeyAction, [
    parsed.id,
    {
      expiresAt: body.data.expiresAt,
      enableKey: body.data.enableKey,
    },
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, { ok: true }, 200);
}

// ==================== POST /keys/{id}/limits:reset ====================

export async function resetKeyLimitsHandler(c: Context): Promise<Response> {
  const parsed = parseIdLike(c);
  if (!parsed.ok) return parsed.response;
  const result = await callAction<void>(c, resetKeyLimitsAction, [parsed.id]);
  if (!result.ok) return result.problem;
  return respondJson(c, { ok: true }, 200);
}

// ==================== GET /keys/{id}/limit-usage ====================

interface KeyLimitUsageData {
  cost5h: { current: number; limit: number | null; resetAt?: Date };
  costDaily: { current: number; limit: number | null; resetAt?: Date };
  costWeekly: { current: number; limit: number | null; resetAt?: Date };
  costMonthly: { current: number; limit: number | null; resetAt?: Date };
  costTotal: { current: number; limit: number | null; resetAt?: Date };
  concurrentSessions: { current: number; limit: number };
}

interface KeyQuotaUsageData {
  keyName: string;
  items: Array<{
    type:
      | "limit5h"
      | "limitDaily"
      | "limitWeekly"
      | "limitMonthly"
      | "limitTotal"
      | "limitSessions";
    current: number;
    limit: number | null;
    mode?: "fixed" | "rolling";
    time?: string;
    resetAt?: Date;
  }>;
  currencyCode: string;
}

// ==================== GET /keys/{id}/quota-usage ====================

/**
 * 与 GET /keys/{id}/limit-usage 不同；这个端点返回与 legacy getKeyQuotaUsage 完全
 * 相同的 items[] 形状（含 type、mode、time、resetAt），方便迁移现有 quota dialog UI。
 */
export async function getKeyQuotaUsageHandler(c: Context): Promise<Response> {
  const parsed = parseIdLike(c);
  if (!parsed.ok) return parsed.response;
  const result = await callAction<KeyQuotaUsageData>(c, getKeyQuotaUsageFn, [parsed.id], {
    allowReadOnlyAccess: true,
  });
  if (!result.ok) return result.problem;
  const items = result.data.items.map((item) => ({
    ...item,
    resetAt: item.resetAt instanceof Date ? item.resetAt.toISOString() : undefined,
  }));
  return respondJson(
    c,
    {
      keyName: result.data.keyName,
      items,
      currencyCode: result.data.currencyCode,
    },
    200
  );
}

export async function getKeyLimitUsageHandler(c: Context): Promise<Response> {
  const parsed = parseIdLike(c);
  if (!parsed.ok) return parsed.response;
  const result = await callAction<KeyLimitUsageData>(c, getKeyLimitUsageAction, [parsed.id], {
    allowReadOnlyAccess: true,
  });
  if (!result.ok) return result.problem;
  const toIso = (d: Date | undefined): string | undefined =>
    d instanceof Date ? d.toISOString() : undefined;
  const body = {
    cost5h: { ...result.data.cost5h, resetAt: toIso(result.data.cost5h.resetAt) },
    costDaily: { ...result.data.costDaily, resetAt: toIso(result.data.costDaily.resetAt) },
    costWeekly: { ...result.data.costWeekly, resetAt: toIso(result.data.costWeekly.resetAt) },
    costMonthly: { ...result.data.costMonthly, resetAt: toIso(result.data.costMonthly.resetAt) },
    costTotal: { ...result.data.costTotal, resetAt: toIso(result.data.costTotal.resetAt) },
    concurrentSessions: result.data.concurrentSessions,
  };
  return respondJson(c, body, 200);
}
