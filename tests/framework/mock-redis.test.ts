/**
 * Framework Self-Tests: Redis Mock
 *
 * Verifies that the Redis mock infrastructure works correctly:
 * - Basic operations (GET, SET, DEL)
 * - ZSET operations (for rate limiting)
 * - Hash operations (for circuit breaker)
 * - Pipeline operations
 * - Error simulation
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
  createMockRedis,
  resetMockRedis,
  seedMockRedis,
  seedMockRedisZset,
  seedMockRedisHash,
  getMockRedisKeys,
  dumpMockRedis,
  createFailingMockRedis,
  createSlowMockRedis,
  type MockRedisClient,
} from "../__mocks__/redis.mock";

describe("Redis Mock Infrastructure", () => {
  let redis: MockRedisClient;

  // Create fresh Redis instance and reset before each test
  beforeEach(async () => {
    redis = createMockRedis();
    await resetMockRedis(redis);
  });

  describe("Basic Operations", () => {
    test("should support GET and SET", async () => {
      await redis.set("test-key", "test-value");
      const value = await redis.get("test-key");

      expect(value).toBe("test-value");
    });

    test("should support DEL", async () => {
      await redis.set("key-to-delete", "value");
      expect(await redis.get("key-to-delete")).toBe("value");

      await redis.del("key-to-delete");
      expect(await redis.get("key-to-delete")).toBeNull();
    });

    test("should support KEYS pattern matching", async () => {
      await redis.set("user:1:name", "Alice");
      await redis.set("user:2:name", "Bob");
      await redis.set("session:abc", "data");

      const userKeys = await redis.keys("user:*");
      expect(userKeys.length).toBe(2);
      expect(userKeys).toContain("user:1:name");
      expect(userKeys).toContain("user:2:name");
    });

    test("should support TTL/EXPIRE", async () => {
      await redis.set("expiring-key", "value");
      await redis.expire("expiring-key", 60);

      const ttl = await redis.ttl("expiring-key");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });
  });

  describe("ZSET Operations (Rate Limiting)", () => {
    test("should support ZADD and ZCARD", async () => {
      await redis.zadd("rate-limit:user:1", Date.now(), "req_1");
      await redis.zadd("rate-limit:user:1", Date.now() + 1, "req_2");
      await redis.zadd("rate-limit:user:1", Date.now() + 2, "req_3");

      const count = await redis.zcard("rate-limit:user:1");
      expect(count).toBe(3);
    });

    test("should support ZRANGEBYSCORE", async () => {
      const now = Date.now();

      await redis.zadd("window", now - 1000, "old");
      await redis.zadd("window", now + 500, "recent1");
      await redis.zadd("window", now + 1000, "recent2");

      const recent = await redis.zrangebyscore("window", now, "+inf");
      expect(recent.length).toBe(2);
      expect(recent).toContain("recent1");
      expect(recent).toContain("recent2");
    });

    test("should support ZREMRANGEBYSCORE", async () => {
      const now = Date.now();

      await redis.zadd("cleanup-test", now - 2000, "very-old");
      await redis.zadd("cleanup-test", now - 1000, "old");
      await redis.zadd("cleanup-test", now, "current");

      // Remove entries older than 1500ms ago
      await redis.zremrangebyscore("cleanup-test", "-inf", now - 1500);

      const remaining = await redis.zrange("cleanup-test", 0, -1);
      expect(remaining.length).toBe(2);
      expect(remaining).not.toContain("very-old");
    });
  });

  describe("Hash Operations (Circuit Breaker)", () => {
    test("should support HSET and HGET", async () => {
      await redis.hset("circuit:provider:1", "state", "OPEN");
      await redis.hset("circuit:provider:1", "failures", "5");

      const state = await redis.hget("circuit:provider:1", "state");
      const failures = await redis.hget("circuit:provider:1", "failures");

      expect(state).toBe("OPEN");
      expect(failures).toBe("5");
    });

    test("should support HGETALL", async () => {
      await redis.hset("circuit:provider:2", "state", "CLOSED");
      await redis.hset("circuit:provider:2", "failures", "0");
      await redis.hset("circuit:provider:2", "lastFailure", "0");

      const data = await redis.hgetall("circuit:provider:2");

      expect(data).toEqual({
        state: "CLOSED",
        failures: "0",
        lastFailure: "0",
      });
    });

    test("should support HINCRBY", async () => {
      await redis.hset("counter", "value", "10");
      await redis.hincrby("counter", "value", 5);

      const value = await redis.hget("counter", "value");
      expect(value).toBe("15");
    });
  });

  describe("Pipeline Operations", () => {
    test("should support pipeline execution", async () => {
      const pipeline = redis.pipeline();
      pipeline.set("key1", "value1");
      pipeline.set("key2", "value2");
      pipeline.get("key1");

      const results = await pipeline.exec();

      expect(results).toHaveLength(3);
      expect(await redis.get("key1")).toBe("value1");
      expect(await redis.get("key2")).toBe("value2");
    });
  });

  describe("Helper Functions", () => {
    test("resetMockRedis should clear all data", async () => {
      await redis.set("key1", "value1");
      await redis.set("key2", "value2");
      expect((await redis.keys("*")).length).toBe(2);

      await resetMockRedis(redis);
      expect((await redis.keys("*")).length).toBe(0);
    });

    test("seedMockRedis should populate data", async () => {
      await seedMockRedis(redis, {
        "user:1": "Alice",
        "user:2": "Bob",
        "config:setting": "value",
      });

      expect(await redis.get("user:1")).toBe("Alice");
      expect(await redis.get("user:2")).toBe("Bob");
      expect(await redis.get("config:setting")).toBe("value");
    });

    test("seedMockRedisZset should populate ZSET data", async () => {
      await seedMockRedisZset(redis, "leaderboard", [
        { score: 100, member: "player1" },
        { score: 200, member: "player2" },
        { score: 150, member: "player3" },
      ]);

      const count = await redis.zcard("leaderboard");
      expect(count).toBe(3);
    });

    test("seedMockRedisHash should populate Hash data", async () => {
      await seedMockRedisHash(redis, "user:profile:1", {
        name: "Alice",
        age: 30,
        email: "alice@example.com",
      });

      const name = await redis.hget("user:profile:1", "name");
      expect(name).toBe("Alice");
    });

    test("getMockRedisKeys should return keys matching pattern", async () => {
      await seedMockRedis(redis, {
        "user:1": "a",
        "user:2": "b",
        "session:1": "c",
      });

      const userKeys = await getMockRedisKeys(redis, "user:*");
      expect(userKeys.length).toBe(2);
    });

    test("dumpMockRedis should return all data", async () => {
      await redis.set("string-key", "string-value");
      await redis.hset("hash-key", "field", "value");
      await redis.zadd("zset-key", 1, "member");

      const dump = await dumpMockRedis(redis);

      expect(dump["string-key"]).toBe("string-value");
      expect(dump["hash-key"]).toEqual({ field: "value" });
    });
  });

  describe("Error Simulation", () => {
    test("createFailingMockRedis should throw on operations", async () => {
      const failingRedis = createFailingMockRedis();

      await expect(failingRedis.get("any-key")).rejects.toThrow(
        "Redis connection failed"
      );
      await expect(failingRedis.set("any-key", "value")).rejects.toThrow(
        "Redis connection failed"
      );
    });

    test("createSlowMockRedis should delay operations", async () => {
      const slowRedis = createSlowMockRedis(100);

      const startTime = Date.now();
      await slowRedis.get("any-key");
      const elapsed = Date.now() - startTime;

      // Use wider tolerance for CI environments (90ms min, 500ms max)
      expect(elapsed).toBeGreaterThanOrEqual(90);
      expect(elapsed).toBeLessThan(500);
    });
  });
});
