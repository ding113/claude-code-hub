/**
 * /api/v1/system handler 集合
 *
 * 设计要点：
 * - GET /system/settings -> fetchSystemSettings (ActionResult);
 * - PUT /system/settings -> saveSystemSettings (ActionResult);
 * - GET /system/timezone -> getServerTimeZone (ActionResult; read tier).
 */

import type { Context } from "hono";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import { respondJson } from "@/lib/api/v1/_shared/response-helpers";
import {
  type SystemSettingsResponse,
  SystemSettingsUpdateSchema,
  type SystemTimezoneResponse,
  serializeSystemSettings,
} from "@/lib/api/v1/schemas/system";
import type { SystemSettings } from "@/types/system-config";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

/**
 * 延迟解析 system-config action：避免在模块加载阶段把 lobehub icon 等
 * 客户端组件链拉进 OpenAPI 文档生成器（react-server condition）。
 */
async function loadSystemConfigActions() {
  const mod = await import("@/actions/system-config");
  return {
    fetch: mod.fetchSystemSettings as unknown as AnyAction,
    save: mod.saveSystemSettings as unknown as AnyAction,
    timezone: mod.getServerTimeZone as unknown as AnyAction,
  };
}

type SystemSettingsRaw = SystemSettings & {
  publicStatusProjectionWarningCode?: string | null;
};

// ==================== GET /system/settings ====================

export async function getSystemSettings(c: Context): Promise<Response> {
  const actions = await loadSystemConfigActions();
  const result = await callAction<SystemSettingsRaw>(c, actions.fetch, []);
  if (!result.ok) return result.problem;
  const body: SystemSettingsResponse = serializeSystemSettings(
    result.data as unknown as Parameters<typeof serializeSystemSettings>[0]
  );
  return respondJson(c, body, 200);
}

// ==================== PUT /system/settings ====================

export async function updateSystemSettings(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof SystemSettingsUpdateSchema>(
    c,
    SystemSettingsUpdateSchema
  );
  if (!body.ok) return body.response;
  const actions = await loadSystemConfigActions();
  const result = await callAction<SystemSettingsRaw>(c, actions.save, [body.data]);
  if (!result.ok) return result.problem;
  const out: SystemSettingsResponse = serializeSystemSettings(
    result.data as unknown as Parameters<typeof serializeSystemSettings>[0]
  );
  return respondJson(c, out, 200);
}

// ==================== GET /system/timezone ====================

export async function getSystemTimezone(c: Context): Promise<Response> {
  const actions = await loadSystemConfigActions();
  const result = await callAction<SystemTimezoneResponse>(c, actions.timezone, []);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}
