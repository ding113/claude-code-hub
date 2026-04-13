import { NextResponse } from "next/server";
import { checkReadiness } from "@/lib/health/checker";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await checkReadiness();
    const httpStatus = health.status === "unhealthy" ? 503 : 200;
    return NextResponse.json(health, { status: httpStatus });
  } catch (error) {
    logger.error({
      action: "health_check_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { status: "unhealthy", timestamp: new Date().toISOString(), error: "Health check failed" },
      { status: 503 }
    );
  }
}
