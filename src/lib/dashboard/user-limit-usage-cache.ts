import { getUserAllLimitUsage } from "@/lib/api-client/v1/actions/users";

export interface LimitUsageData {
  limit5h: { usage: number; limit: number | null };
  limitDaily: { usage: number; limit: number | null };
  limitWeekly: { usage: number; limit: number | null };
  limitMonthly: { usage: number; limit: number | null };
  limitTotal: { usage: number; limit: number | null };
}

export const LIMIT_USAGE_CACHE_TTL = 60 * 1000;

const usageCache = new Map<number, { data: LimitUsageData; timestamp: number }>();
const inFlightUsageRequests = new Map<number, Promise<LimitUsageData | null>>();

function isFresh(cached: { data: LimitUsageData; timestamp: number } | undefined): cached is {
  data: LimitUsageData;
  timestamp: number;
} {
  return Boolean(cached && Date.now() - cached.timestamp < LIMIT_USAGE_CACHE_TTL);
}

export function clearUsageCache(userId?: number): void {
  if (userId !== undefined) {
    usageCache.delete(userId);
    inFlightUsageRequests.delete(userId);
    return;
  }

  usageCache.clear();
  inFlightUsageRequests.clear();
}

export function peekCachedUserLimitUsage(userId: number): LimitUsageData | null {
  const cached = usageCache.get(userId);
  return isFresh(cached) ? cached.data : null;
}

export async function getSharedUserLimitUsage(userId: number): Promise<LimitUsageData | null> {
  const cached = peekCachedUserLimitUsage(userId);
  if (cached) {
    return cached;
  }

  const inFlight = inFlightUsageRequests.get(userId);
  if (inFlight) {
    return inFlight;
  }

  const request = getUserAllLimitUsage(userId)
    .then((result) => {
      if (!result.ok || !result.data) {
        return null;
      }

      usageCache.set(userId, { data: result.data, timestamp: Date.now() });
      return result.data;
    })
    .catch((error) => {
      console.error("[user-limit-usage-cache] getUserAllLimitUsage failed", { userId, error });
      return null;
    })
    .finally(() => {
      inFlightUsageRequests.delete(userId);
    });

  inFlightUsageRequests.set(userId, request);
  return request;
}
