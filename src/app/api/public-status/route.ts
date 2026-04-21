import { NextResponse } from "next/server";
import { readPublicStatusPayload } from "@/lib/public-status/read-store";
import { schedulePublicStatusRebuild } from "@/lib/public-status/rebuild-worker";

function parsePositiveIntegerParam(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const intervalMinutes = parsePositiveIntegerParam(url.searchParams.get("interval"), 5);
  const rangeHours = parsePositiveIntegerParam(url.searchParams.get("rangeHours"), 24);

  const payload = await readPublicStatusPayload({
    intervalMinutes,
    rangeHours,
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
