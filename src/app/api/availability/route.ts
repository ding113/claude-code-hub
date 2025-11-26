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

import { NextRequest, NextResponse } from 'next/server';
import {
  queryProviderAvailability,
  type AvailabilityQueryOptions,
} from '@/lib/availability';
import { getSession } from '@/lib/auth';

/**
 * GET /api/availability
 */
export async function GET(request: NextRequest) {
  // Verify admin authentication using session cookies
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);

    // Parse query options
    const options: AvailabilityQueryOptions = {};

    const startTime = searchParams.get('startTime');
    if (startTime) {
      options.startTime = startTime;
    }

    const endTime = searchParams.get('endTime');
    if (endTime) {
      options.endTime = endTime;
    }

    const providerIds = searchParams.get('providerIds');
    if (providerIds) {
      options.providerIds = providerIds.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id));
    }

    const bucketSizeMinutes = searchParams.get('bucketSizeMinutes');
    if (bucketSizeMinutes) {
      options.bucketSizeMinutes = parseInt(bucketSizeMinutes, 10);
    }

    const includeDisabled = searchParams.get('includeDisabled');
    if (includeDisabled) {
      options.includeDisabled = includeDisabled === 'true';
    }

    const maxBuckets = searchParams.get('maxBuckets');
    if (maxBuckets) {
      options.maxBuckets = parseInt(maxBuckets, 10);
    }

    const result = await queryProviderAvailability(options);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Availability API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
