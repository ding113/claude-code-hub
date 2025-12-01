/**
 * Provider Availability API Endpoint
 *
 * GET /api/availability
 * Query parameters:
 *   - startTime: ISO string, start of query range (default: 24h ago)
 *   - endTime: ISO string, end of query range (default: now)
 *   - providerIds: comma-separated provider IDs (default: all)
 *   - bucketSizeMinutes: number, time bucket size (default: auto)
 *   - includeDisabled: boolean, include disabled providers (default: false)
 *   - maxBuckets: number, max time buckets (default: 100)
 */

import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { type AvailabilityQueryOptions, queryProviderAvailability } from "@/lib/availability";

/**
 * GET /api/availability
 */
export async function GET(request: NextRequest) {
  // Verify admin authentication using session cookies
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);

    // Parse query options
    const options: AvailabilityQueryOptions = {};

    const startTime = searchParams.get("startTime");
    if (startTime) {
      options.startTime = startTime;
    }

    const endTime = searchParams.get("endTime");
    if (endTime) {
      options.endTime = endTime;
    }

    const providerIds = searchParams.get("providerIds");
    if (providerIds) {
      options.providerIds = providerIds
        .split(",")
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !Number.isNaN(id));
    }

    const bucketSizeMinutes = searchParams.get("bucketSizeMinutes");
    if (bucketSizeMinutes) {
      // Use parseFloat to support sub-minute bucket sizes (e.g., 0.25 for 15 seconds)
      const parsed = parseFloat(bucketSizeMinutes);
      // Ensure bucket size is valid and at least 0.25 minutes (15 seconds) to prevent division by zero
      options.bucketSizeMinutes = Number.isNaN(parsed) ? 0.25 : Math.max(0.25, parsed);
    }

    const includeDisabled = searchParams.get("includeDisabled");
    if (includeDisabled) {
      options.includeDisabled = includeDisabled === "true";
    }

    const maxBuckets = searchParams.get("maxBuckets");
    if (maxBuckets) {
      options.maxBuckets = parseInt(maxBuckets, 10);
    }

    const result = await queryProviderAvailability(options);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Availability API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
