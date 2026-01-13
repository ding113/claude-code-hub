import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findProviderEndpointById, findProviderEndpointProbeLogs } from "@/repository";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  const endpointIdRaw = searchParams.get("endpointId");
  const endpointId = endpointIdRaw ? Number.parseInt(endpointIdRaw, 10) : Number.NaN;

  const limitRaw = searchParams.get("limit");
  const offsetRaw = searchParams.get("offset");

  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 200;
  const offset = offsetRaw ? Number.parseInt(offsetRaw, 10) : 0;

  if (!Number.isFinite(endpointId) || endpointId <= 0) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  if (!Number.isFinite(limit) || limit <= 0 || limit > 1000) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  if (!Number.isFinite(offset) || offset < 0) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  try {
    const endpoint = await findProviderEndpointById(endpointId);
    if (!endpoint) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const logs = await findProviderEndpointProbeLogs(endpointId, limit, offset);
    return NextResponse.json({ endpoint, logs });
  } catch (error) {
    console.error("Endpoint probe logs API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
