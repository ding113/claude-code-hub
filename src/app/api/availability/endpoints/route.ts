import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  type EndpointAvailabilityQueryOptions,
  queryEndpointAvailability,
} from "@/lib/endpoint-availability";
import type { ProviderType } from "@/types/provider";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);

    const options: EndpointAvailabilityQueryOptions = {};

    const startTime = searchParams.get("startTime");
    if (startTime) {
      options.startTime = startTime;
    }

    const endTime = searchParams.get("endTime");
    if (endTime) {
      options.endTime = endTime;
    }

    const endpointIds = searchParams.get("endpointIds");
    if (endpointIds) {
      options.endpointIds = endpointIds
        .split(",")
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !Number.isNaN(id));
    }

    const vendorIds = searchParams.get("vendorIds");
    if (vendorIds) {
      options.vendorIds = vendorIds
        .split(",")
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !Number.isNaN(id));
    }

    const providerTypes = searchParams.get("providerTypes");
    if (providerTypes) {
      options.providerTypes = providerTypes
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0) as ProviderType[];
    }

    const bucketSizeMinutes = searchParams.get("bucketSizeMinutes");
    if (bucketSizeMinutes) {
      const parsed = parseFloat(bucketSizeMinutes);
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

    const result = await queryEndpointAvailability(options);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Endpoint availability API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
