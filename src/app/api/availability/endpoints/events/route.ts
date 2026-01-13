import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findProviderEndpointProbeEvents } from "@/repository/provider-endpoint-probe-event";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);

    const endpointIdRaw = searchParams.get("endpointId");
    const endpointId = endpointIdRaw ? parseInt(endpointIdRaw, 10) : NaN;

    if (!Number.isFinite(endpointId) || endpointId <= 0) {
      return NextResponse.json({ error: "Invalid endpointId" }, { status: 400 });
    }

    const limitRaw = searchParams.get("limit");
    const limitParsed = limitRaw ? parseInt(limitRaw, 10) : NaN;
    const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(limitParsed, 1), 500) : 100;

    const startTimeRaw = searchParams.get("startTime");
    const endTimeRaw = searchParams.get("endTime");

    const startTime = startTimeRaw ? new Date(startTimeRaw) : undefined;
    const endTime = endTimeRaw ? new Date(endTimeRaw) : undefined;

    const events = await findProviderEndpointProbeEvents({
      endpointId,
      startTime: startTime && Number.isFinite(startTime.getTime()) ? startTime : undefined,
      endTime: endTime && Number.isFinite(endTime.getTime()) ? endTime : undefined,
      limit,
    });

    return NextResponse.json(events);
  } catch (error) {
    console.error("Endpoint probe events API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
