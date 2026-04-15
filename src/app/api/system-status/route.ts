import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getPublicSystemStatusSnapshot } from "@/lib/system-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getPublicSystemStatusSnapshot();
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    logger.error("Failed to fetch public system status snapshot", { error });
    return NextResponse.json({ error: "Failed to fetch system status" }, { status: 500 });
  }
}
