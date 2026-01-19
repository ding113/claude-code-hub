import "server-only";

import type Redis from "ioredis";

/**
 * Scan Redis keys by pattern using cursor-based iteration.
 * Non-blocking alternative to KEYS command.
 *
 * @param redis - Redis client instance
 * @param pattern - Pattern to match (e.g., "key:*:cost_*")
 * @param count - Number of keys to scan per iteration (default: 100)
 * @returns Array of matching keys
 *
 * @example
 * const keys = await scanPattern(redis, "session:*:info", 100);
 */
export async function scanPattern(redis: Redis, pattern: string, count = 100): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";

  do {
    const [nextCursor, batch] = (await redis.scan(cursor, "MATCH", pattern, "COUNT", count)) as [
      string,
      string[],
    ];

    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");

  return keys;
}
