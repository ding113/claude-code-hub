import type { Context } from "hono";
import type { ActionResult } from "@/actions/types";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import {
  createProblemResponse,
  fromZodError,
  publicActionErrorDetail,
} from "@/lib/api/v1/_shared/error-envelope";
import { parseHonoJsonBody } from "@/lib/api/v1/_shared/request-body";
import { jsonResponse } from "@/lib/api/v1/_shared/response-helpers";
import {
  IpGeoParamSchema,
  IpGeoQuerySchema,
  PublicStatusSettingsUpdateSchema,
} from "@/lib/api/v1/schemas/public";
import {
  buildPublicStatusRouteResponse,
  PublicStatusQueryValidationError,
  parsePublicStatusQuery,
} from "@/lib/public-status/public-api-contract";

export async function getPublicStatus(c: Context): Promise<Response> {
  try {
    const url = new URL(c.req.url);
    const [{ readCurrentPublicStatusConfigSnapshot }, { readPublicStatusPayload }] =
      await Promise.all([
        import("@/lib/public-status/config-snapshot"),
        import("@/lib/public-status/read-store"),
      ]);
    const configSnapshot = await readCurrentPublicStatusConfigSnapshot();
    const defaults = {
      intervalMinutes: configSnapshot?.defaultIntervalMinutes ?? 5,
      rangeHours: configSnapshot?.defaultRangeHours ?? 24,
    };
    const query = parsePublicStatusQuery(url.searchParams, defaults);
    let rebuildReason: string | null = null;

    const payload = await readPublicStatusPayload({
      intervalMinutes: query.intervalMinutes,
      rangeHours: query.rangeHours,
      configVersion: configSnapshot?.configVersion,
      hasConfiguredGroups: configSnapshot ? configSnapshot.groups.length > 0 : undefined,
      nowIso: new Date().toISOString(),
      triggerRebuildHint: async (reason) => {
        const { schedulePublicStatusRebuild } = await import("@/lib/public-status/rebuild-hints");
        rebuildReason = reason;
        await schedulePublicStatusRebuild({
          intervalMinutes: query.intervalMinutes,
          rangeHours: query.rangeHours,
          reason,
        });
      },
    });

    const responseBody = buildPublicStatusRouteResponse({
      payload,
      query,
      defaults,
      meta: {
        siteTitle: configSnapshot?.siteTitle?.trim() || null,
        siteDescription: configSnapshot?.siteDescription?.trim() || null,
        timeZone: configSnapshot?.timeZone ?? null,
      },
      rebuildReason,
    });

    return jsonResponse(responseBody, {
      status: responseBody.status === "rebuilding" ? 503 : 200,
      headers: responseBody.status === "rebuilding" ? { "Cache-Control": "no-store" } : undefined,
    });
  } catch (error) {
    if (error instanceof PublicStatusQueryValidationError) {
      return createProblemResponse({
        status: 400,
        instance: new URL(c.req.url).pathname,
        title: "Validation failed",
        detail: "One or more query parameters are invalid.",
        errorCode: "public_status.invalid_query",
        invalidParams: error.details.map((issue) => ({
          path: [issue.field],
          code: issue.code,
          message: issue.message,
        })),
      });
    }

    throw error;
  }
}

export async function updatePublicStatusSettings(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, PublicStatusSettingsUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/public-status");
  const result = await callAction(
    c,
    actions.savePublicStatusSettings,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function lookupIpGeo(c: Context): Promise<Response> {
  const params = IpGeoParamSchema.safeParse({ ip: c.req.param("ip") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const query = IpGeoQuerySchema.safeParse({ lang: c.req.query("lang") });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const [{ getCachedSystemSettings }, { lookupIp }] = await Promise.all([
    import("@/lib/config/system-settings-cache"),
    import("@/lib/ip-geo/client"),
  ]);
  const settings = await getCachedSystemSettings();
  if (!settings.ipGeoLookupEnabled) {
    return createProblemResponse({
      status: 404,
      instance: new URL(c.req.url).pathname,
      errorCode: "ip_geo.disabled",
      detail: "IP geolocation lookup is disabled.",
    });
  }

  const result = await lookupIp(params.data.ip, { lang: query.data.lang });
  return jsonResponse(result, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const status = detail.includes("权限") || detail.includes("UNAUTHORIZED") ? 403 : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: result.errorCode ?? "public_status.action_failed",
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
