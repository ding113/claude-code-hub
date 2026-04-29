/**
 * /api/v1/notifications/types/{type}/bindings handler 集合
 *
 * 设计要点：
 * - GET: 调用 getBindingsForTypeAction 获取绑定列表（含已脱敏 target）；
 * - PUT: 调用 updateBindingsAction，整体替换该 type 下的全部绑定。
 */

import type { Context } from "hono";
import { getBindingsForTypeAction, updateBindingsAction } from "@/actions/notification-bindings";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { problem } from "@/lib/api/v1/_shared/error-envelope";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import { respondJson } from "@/lib/api/v1/_shared/response-helpers";
import {
  NotificationBindingsUpdateSchema,
  serializeNotificationBinding,
} from "@/lib/api/v1/schemas/notification-bindings";
import type {
  NotificationBindingWithTarget,
  NotificationType,
} from "@/repository/notification-bindings";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

const fetchAction = getBindingsForTypeAction as unknown as AnyAction;
const updateAction = updateBindingsAction as unknown as AnyAction;

const VALID_TYPES: ReadonlyArray<NotificationType> = [
  "circuit_breaker",
  "daily_leaderboard",
  "cost_alert",
  "cache_hit_rate_alert",
];

function parseTypeParam(
  c: Context
): { ok: true; type: NotificationType } | { ok: false; response: Response } {
  const raw = c.req.param("type");
  if (!raw || !VALID_TYPES.includes(raw as NotificationType)) {
    return {
      ok: false,
      response: problem(c, {
        status: 400,
        errorCode: "validation_failed",
        title: "Invalid notification type",
        detail: `Path parameter \`type\` must be one of: ${VALID_TYPES.join(", ")}.`,
      }),
    };
  }
  return { ok: true, type: raw as NotificationType };
}

// ==================== GET /notifications/types/{type}/bindings ====================

export async function listBindings(c: Context): Promise<Response> {
  const parsed = parseTypeParam(c);
  if (!parsed.ok) return parsed.response;
  const result = await callAction<NotificationBindingWithTarget[]>(c, fetchAction, [parsed.type]);
  if (!result.ok) return result.problem;
  return respondJson(
    c,
    {
      items: result.data.map(serializeNotificationBinding),
    },
    200
  );
}

// ==================== PUT /notifications/types/{type}/bindings ====================

export async function updateBindings(c: Context): Promise<Response> {
  const parsed = parseTypeParam(c);
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof NotificationBindingsUpdateSchema>(
    c,
    NotificationBindingsUpdateSchema
  );
  if (!body.ok) return body.response;

  const result = await callAction<void>(c, updateAction, [parsed.type, body.data.bindings]);
  if (!result.ok) return result.problem;

  // 返回更新后的最新绑定列表，便于 UI 直接刷新
  const refreshed = await callAction<NotificationBindingWithTarget[]>(c, fetchAction, [
    parsed.type,
  ]);
  if (!refreshed.ok) return refreshed.problem;
  return respondJson(
    c,
    {
      items: refreshed.data.map(serializeNotificationBinding),
    },
    200
  );
}
