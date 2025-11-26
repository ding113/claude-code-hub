/**
 * Provider Current Status API Endpoint
 *
 * GET /api/availability/current
 * Returns current status for all providers (lightweight query, last 15 minutes)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentProviderStatus } from '@/lib/availability';
import { validateKey } from '@/lib/auth';

/**
 * GET /api/availability/current
 */
export async function GET(request: NextRequest) {
  // Verify admin authentication
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const session = await validateKey(token);
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: Admin access required' },
      { status: 403 }
    );
  }

  try {
    const result = await getCurrentProviderStatus();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Current availability API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
