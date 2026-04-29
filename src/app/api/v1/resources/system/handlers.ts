import type { Context } from "hono";
import type { ActionResult } from "@/actions/types";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import {
  createProblemResponse,
  publicActionErrorDetail,
} from "@/lib/api/v1/_shared/error-envelope";
import { parseHonoJsonBody } from "@/lib/api/v1/_shared/request-body";
import { jsonResponse } from "@/lib/api/v1/_shared/response-helpers";
import { SystemSettingsUpdateSchema } from "@/lib/api/v1/schemas/system-config";

export async function getSystemSettings(c: Context): Promise<Response> {
  const actions = await import("@/actions/system-config");
  const result = await callAction(c, actions.fetchSystemSettings, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function getSystemDisplaySettings(_c: Context): Promise<Response> {
  const { getSystemSettings: readSystemSettings } = await import("@/repository/system-config");
  const settings = await readSystemSettings();
  return jsonResponse({
    siteTitle: settings.siteTitle,
    currencyDisplay: settings.currencyDisplay,
    billingModelSource: settings.billingModelSource,
  });
}

export async function updateSystemSettings(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, SystemSettingsUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/system-config");
  const result = await callAction(
    c,
    actions.saveSystemSettings,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function getSystemTimezone(c: Context): Promise<Response> {
  const actions = await import("@/actions/system-config");
  const result = await callAction(c, actions.getServerTimeZone, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const status = detail.includes("权限") || detail.includes("无权限") ? 403 : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: result.errorCode ?? "system.action_failed",
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
