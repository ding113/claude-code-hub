/**
 * /api/v1/notifications handler 集合
 *
 * 设计要点：
 * - getNotificationSettingsAction 直接 throw（非 ActionResult），用 raw 模式包装；
 * - updateNotificationSettingsAction / testWebhookAction 走标准 ActionResult；
 * - testWebhookAction 实际返回 { success, error? } 而非 ActionResult；
 *   通过 raw 模式透传，加上 setNoStore 防止响应缓存。
 */

import type { Context } from "hono";
import {
  getNotificationSettingsAction,
  testWebhookAction,
  updateNotificationSettingsAction,
} from "@/actions/notifications";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { setNoStore } from "@/lib/api/v1/_shared/cache-control";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import { respondJson } from "@/lib/api/v1/_shared/response-helpers";
import {
  NotificationSettingsUpdateSchema,
  serializeNotificationSettings,
  TestWebhookRequestSchema,
} from "@/lib/api/v1/schemas/notifications";
import type { NotificationSettings } from "@/repository/notifications";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

const fetchAction = getNotificationSettingsAction as unknown as AnyAction;
const updateAction = updateNotificationSettingsAction as unknown as AnyAction;
const testAction = testWebhookAction as unknown as AnyAction;

// ==================== GET /notifications/settings ====================

export async function getNotificationSettings(c: Context): Promise<Response> {
  const result = await callAction<NotificationSettings>(c, fetchAction, [], {
    treatRawAsActionResult: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, serializeNotificationSettings(result.data), 200);
}

// ==================== PUT /notifications/settings ====================

export async function updateNotificationSettings(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof NotificationSettingsUpdateSchema>(
    c,
    NotificationSettingsUpdateSchema
  );
  if (!body.ok) return body.response;
  const result = await callAction<NotificationSettings>(c, updateAction, [body.data]);
  if (!result.ok) return result.problem;
  return respondJson(c, serializeNotificationSettings(result.data), 200);
}

// ==================== POST /notifications/test-webhook ====================

interface TestWebhookRaw {
  success: boolean;
  error?: string;
}

export async function testWebhook(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof TestWebhookRequestSchema>(c, TestWebhookRequestSchema);
  if (!body.ok) return body.response;
  const result = await callAction<TestWebhookRaw>(
    c,
    testAction,
    [body.data.webhookUrl, body.data.type],
    {
      treatRawAsActionResult: true,
    }
  );
  if (!result.ok) return result.problem;
  setNoStore(c);
  return new Response(JSON.stringify(result.data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    },
  });
}
