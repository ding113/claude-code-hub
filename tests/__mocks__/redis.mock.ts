/**
 * Redis Mock Infrastructure for Testing
 *
 * Provides a mock Redis client using ioredis-mock that supports:
 * - Basic operations (GET, SET, DEL, KEYS, etc.)
 * - ZSET operations (for sliding window rate limiting)
 * - Pipeline operations
 * - Lua script eval (limited support)
 * - Hash operations (for circuit breaker state)
 *
 * Usage:
 * ```typescript
 * import { createMockRedis, resetMockRedis } from "../__mocks__/redis.mock";
 *
 * const redis = createMockRedis();
 * await redis.set("key", "value");
 * await resetMockRedis(redis);
 * ```
 */

import Redis from "ioredis-mock";
import type { Redis as RedisType } from "ioredis";

// Re-export the Redis type for type safety
export type MockRedisClient = ReturnType<typeof Redis>;

/**
 * Create a new mock Redis instance
 * Each call creates an isolated instance with its own data store
 */
export function createMockRedis(): MockRedisClient {
  const mockRedis = new Redis();
  return mockRedis;
}

/**
 * Reset all data in the mock Redis instance
 * Use in afterEach() to ensure test isolation
 */
export async function resetMockRedis(redis: MockRedisClient): Promise<"OK"> {
  return redis.flushall();
}

/**
 * Seed mock Redis with initial data
 * Useful for setting up test fixtures
 */
export async function seedMockRedis(
  redis: MockRedisClient,
  data: Record<string, string>
): Promise<Array<[Error | null, unknown]> | null> {
  if (Object.keys(data).length === 0) {
    return null;
  }

  const pipeline = redis.pipeline();
  for (const [key, value] of Object.entries(data)) {
    pipeline.set(key, value);
  }
  return pipeline.exec();
}

/**
 * Seed Redis with ZSET data (for rate limiting tests)
 */
export async function seedMockRedisZset(
  redis: MockRedisClient,
  key: string,
  members: Array<{ score: number; member: string }>
): Promise<number> {
  const args: Array<string | number> = [];
  for (const { score, member } of members) {
    args.push(score, member);
  }
  return redis.zadd(key, ...args);
}

/**
 * Seed Redis with Hash data (for circuit breaker state)
 */
export async function seedMockRedisHash(
  redis: MockRedisClient,
  key: string,
  data: Record<string, string | number>
): Promise<number> {
  const args: string[] = [];
  for (const [field, value] of Object.entries(data)) {
    args.push(field, String(value));
  }
  return redis.hset(key, ...args);
}

/**
 * Get all keys matching a pattern (for debugging)
 */
export async function getMockRedisKeys(
  redis: MockRedisClient,
  pattern = "*"
): Promise<string[]> {
  return redis.keys(pattern);
}

/**
 * Dump all data from mock Redis (for debugging)
 */
export async function dumpMockRedis(
  redis: MockRedisClient
): Promise<Record<string, unknown>> {
  const keys = await redis.keys("*");
  const result: Record<string, unknown> = {};

  for (const key of keys) {
    const type = await redis.type(key);
    switch (type) {
      case "string":
        result[key] = await redis.get(key);
        break;
      case "hash":
        result[key] = await redis.hgetall(key);
        break;
      case "zset":
        result[key] = await redis.zrange(key, 0, -1, "WITHSCORES");
        break;
      case "set":
        result[key] = await redis.smembers(key);
        break;
      case "list":
        result[key] = await redis.lrange(key, 0, -1);
        break;
      default:
        result[key] = `<${type}>`;
    }
  }

  return result;
}

/**
 * Simulate Redis connection failure
 * Use this to test Fail-Open behavior
 */
export function createFailingMockRedis(): MockRedisClient {
  const redis = createMockRedis();

  // Override commands to throw errors
  const failingCommands = [
    "get",
    "set",
    "zadd",
    "zcard",
    "zrangebyscore",
    "hget",
    "hset",
  ];
  for (const cmd of failingCommands) {
    // biome-ignore lint/suspicious/noExplicitAny: Mock override requires any
    (redis as any)[cmd] = async () => {
      throw new Error("Redis connection failed");
    };
  }

  return redis;
}

/**
 * Create a delayed mock Redis for testing timeout scenarios
 */
export function createSlowMockRedis(delayMs: number): MockRedisClient {
  const redis = createMockRedis();
  const originalGet = redis.get.bind(redis);
  const originalSet = redis.set.bind(redis);

  // biome-ignore lint/suspicious/noExplicitAny: Mock override requires any
  (redis as any).get = async (...args: unknown[]) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic call
    return originalGet(...(args as any));
  };

  // biome-ignore lint/suspicious/noExplicitAny: Mock override requires any
  (redis as any).set = async (...args: unknown[]) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic call
    return originalSet(...(args as any));
  };

  return redis;
}
