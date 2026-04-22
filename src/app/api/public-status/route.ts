import { NextResponse } from "next/server";
import { readCurrentPublicStatusConfigSnapshot } from "@/lib/public-status/config-snapshot";
import {
  MAX_PUBLIC_STATUS_RANGE_HOURS,
  PUBLIC_STATUS_INTERVAL_SET,
} from "@/lib/public-status/constants";
import { readPublicStatusPayload } from "@/lib/public-status/read-store";
import { schedulePublicStatusRebuild } from "@/lib/public-status/rebuild-hints";

function clampInterval(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && PUBLIC_STATUS_INTERVAL_SET.has(parsed) ? parsed : fallback;
}

function clampRange(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_PUBLIC_STATUS_RANGE_HOURS
    ? parsed
    : fallback;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const configSnapshot = await readCurrentPublicStatusConfigSnapshot();
  const defaultInterval = configSnapshot?.defaultIntervalMinutes ?? 5;
  const defaultRange = configSnapshot?.defaultRangeHours ?? 24;
  const intervalMinutes = clampInterval(url.searchParams.get("interval"), defaultInterval);
  const rangeHours = clampRange(url.searchParams.get("rangeHours"), defaultRange);
  const payload = await readPublicStatusPayload({
    intervalMinutes,
    rangeHours,
    configVersion: configSnapshot?.configVersion,
    hasConfiguredGroups: configSnapshot ? configSnapshot.groups.length > 0 : undefined,
    nowIso: new Date().toISOString(),
    triggerRebuildHint: async (reason) => {
      await schedulePublicStatusRebuild({
        intervalMinutes,
        rangeHours,
        reason,
      });
    },
  });

  const status = payload.rebuildState === "rebuilding" && !payload.generatedAt ? 503 : 200;

  return NextResponse.json(payload, { status });
}
