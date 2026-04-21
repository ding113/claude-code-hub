import type { PublicStatusSnapshotPayload } from "@/lib/public-status/aggregation";
import { getRedisClient } from "@/lib/redis";

const SNAPSHOT_CACHE_KEY = "public_status_snapshot:v1:default";

export interface PublicStatusSnapshotRecord {
  aggregatedAt: string;
  payload: PublicStatusSnapshotPayload;
}

async function readSnapshotFromRedis(): Promise<PublicStatusSnapshotRecord | null> {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || redis.status !== "ready") {
    return null;
  }

  try {
    const raw = await redis.get(SNAPSHOT_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PublicStatusSnapshotRecord;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.aggregatedAt !== "string" ||
      !parsed.payload
    ) {
      await redis.del(SNAPSHOT_CACHE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function writeSnapshotToRedis(record: PublicStatusSnapshotRecord): Promise<void> {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || redis.status !== "ready") {
    return;
  }

  await redis.set(SNAPSHOT_CACHE_KEY, JSON.stringify(record));
}

async function clearSnapshotRedisCache(): Promise<void> {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || redis.status !== "ready") {
    return;
  }

  await redis.del(SNAPSHOT_CACHE_KEY);
}

export async function getPublicStatusSnapshotRecord(): Promise<PublicStatusSnapshotRecord | null> {
  return readSnapshotFromRedis();
}

export async function getPublicStatusSnapshot(): Promise<PublicStatusSnapshotPayload | null> {
  const record = await getPublicStatusSnapshotRecord();
  return record?.payload ?? null;
}

export async function savePublicStatusSnapshot(
  payload: PublicStatusSnapshotPayload
): Promise<PublicStatusSnapshotPayload> {
  const aggregatedAt = new Date(payload.generatedAt);
  const safeAggregatedAt = Number.isNaN(aggregatedAt.getTime()) ? new Date() : aggregatedAt;

  await writeSnapshotToRedis({
    aggregatedAt: safeAggregatedAt.toISOString(),
    payload,
  });

  return payload;
}

export async function clearPublicStatusSnapshot(): Promise<void> {
  await clearSnapshotRedisCache();
}
