import { NextResponse } from "next/server";
import { readCurrentPublicStatusConfigSnapshot } from "@/lib/public-status/config-snapshot";
import {
  buildPublicStatusRouteResponse,
  PublicStatusQueryValidationError,
  parsePublicStatusQuery,
} from "@/lib/public-status/public-api-contract";
import { readPublicStatusPayload } from "@/lib/public-status/read-store";
import { schedulePublicStatusRebuild } from "@/lib/public-status/rebuild-hints";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
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

    const status = responseBody.status === "rebuilding" ? 503 : 200;
    return NextResponse.json(responseBody, {
      status,
      headers: status === 503 ? { "Cache-Control": "no-store" } : undefined,
    });
  } catch (error) {
    if (error instanceof PublicStatusQueryValidationError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: 400 }
      );
    }

    console.error("GET /api/public-status failed", error);
    throw error;
  }
}
