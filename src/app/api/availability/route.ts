/**
 * Provider Availability API Endpoint
 *
 * GET /api/availability
 * Query parameters:
 *   - startTime: ISO string, start of query range (default: 24h ago)
 *   - endTime: ISO string, end of query range (default: now)
 *   - providerIds: comma-separated provider IDs (default: all)
 *   - bucketSizeMinutes: number, time bucket size (default: auto, min: 0.25, hard cap: 1440)
 *   - includeDisabled: boolean, include disabled providers (default: false)
 *   - maxBuckets: number, max non-empty time buckets per provider (default: 100, hard cap: 100)
 */

import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  type AvailabilityQueryOptions,
  AvailabilityQueryValidationError,
  MAX_BUCKET_SIZE_MINUTES,
  MAX_BUCKETS_HARD_LIMIT,
  MIN_BUCKET_SIZE_MINUTES,
  queryProviderAvailability,
} from "@/lib/availability";

function parseBooleanQueryParam(value: string, fieldName: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;

  throw new AvailabilityQueryValidationError(`Invalid ${fieldName}: expected true or false`);
}

function parsePositiveIntegerQueryParam(
  value: string,
  fieldName: string,
  maxValue?: number
): number {
  const normalizedValue = value.trim();
  if (!/^\d+$/.test(normalizedValue)) {
    throw new AvailabilityQueryValidationError(`Invalid ${fieldName}: expected a positive integer`);
  }

  const parsed = Number(normalizedValue);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AvailabilityQueryValidationError(`Invalid ${fieldName}: expected a positive integer`);
  }

  if (typeof maxValue === "number" && parsed > maxValue) {
    throw new AvailabilityQueryValidationError(
      `Invalid ${fieldName}: expected a positive integer not greater than ${maxValue}`
    );
  }

  return parsed;
}

function parsePositiveNumberQueryParam(
  value: string,
  fieldName: string,
  bounds?: {
    minValue?: number;
    maxValue?: number;
  }
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AvailabilityQueryValidationError(`Invalid ${fieldName}: expected a positive number`);
  }

  if (typeof bounds?.minValue === "number" && parsed < bounds.minValue) {
    throw new AvailabilityQueryValidationError(
      `Invalid ${fieldName}: expected a positive number not less than ${bounds.minValue}`
    );
  }

  if (typeof bounds?.maxValue === "number" && parsed > bounds.maxValue) {
    throw new AvailabilityQueryValidationError(
      `Invalid ${fieldName}: expected a positive number not greater than ${bounds.maxValue}`
    );
  }

  return parsed;
}

function parseProviderIdsQueryParam(value: string): number[] {
  const tokens = value.split(",").map((token) => token.trim());
  if (tokens.some((token) => token.length === 0)) {
    throw new AvailabilityQueryValidationError(
      "Invalid providerIds: expected comma-separated positive integers"
    );
  }

  const providerIds = tokens.map((token) => parsePositiveIntegerQueryParam(token, "providerIds"));

  return Array.from(new Set(providerIds));
}

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
    if (startTime !== null) {
      if (!startTime.trim()) {
        throw new AvailabilityQueryValidationError(
          "Invalid startTime: expected a valid Date or ISO timestamp"
        );
      }
      options.startTime = startTime;
    }

    const endTime = searchParams.get("endTime");
    if (endTime !== null) {
      if (!endTime.trim()) {
        throw new AvailabilityQueryValidationError(
          "Invalid endTime: expected a valid Date or ISO timestamp"
        );
      }
      options.endTime = endTime;
    }

    const providerIds = searchParams.get("providerIds");
    if (providerIds !== null) {
      options.providerIds = parseProviderIdsQueryParam(providerIds);
    }

    const bucketSizeMinutes = searchParams.get("bucketSizeMinutes");
    if (bucketSizeMinutes !== null) {
      options.bucketSizeMinutes = parsePositiveNumberQueryParam(
        bucketSizeMinutes,
        "bucketSizeMinutes",
        {
          minValue: MIN_BUCKET_SIZE_MINUTES,
          maxValue: MAX_BUCKET_SIZE_MINUTES,
        }
      );
    }

    const includeDisabled = searchParams.get("includeDisabled");
    if (includeDisabled !== null) {
      options.includeDisabled = parseBooleanQueryParam(includeDisabled, "includeDisabled");
    }

    const maxBuckets = searchParams.get("maxBuckets");
    if (maxBuckets !== null) {
      options.maxBuckets = parsePositiveIntegerQueryParam(
        maxBuckets,
        "maxBuckets",
        MAX_BUCKETS_HARD_LIMIT
      );
    }

    const result = await queryProviderAvailability(options);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AvailabilityQueryValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("Availability API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
