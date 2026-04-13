import { handleReadinessRequest } from "@/lib/health/checker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return handleReadinessRequest("health_check_failed");
}
