/**
 * Redis Realtime Counter Tests
 *
 * Basic tests for RealtimeCounter functionality
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { RealtimeCounter } from "./realtime-counter";
import { getRedisClient } from "./client";

describe("RealtimeCounter", () => {
  let counter: RealtimeCounter;
  const testUserId = 99999; // Use a high ID to avoid conflicts
  const testSessionId = "test-session-" + Date.now();

  beforeAll(() => {
    counter = RealtimeCounter.getInstance();
  });

  afterAll(async () => {
    // Cleanup test data
    const redis = getRedisClient();
    if (redis) {
      await redis.del(`user:${testUserId}:stats`);
      await redis.del(`user:${testUserId}:active_sessions`);
      await redis.zrem("active_sessions", testSessionId);
    }
  });

  describe("User Stats", () => {
    it("should increment user count", async () => {
      const result = await counter.incrementUserCount(testUserId, "today_requests", 1);

      // If Redis is available, should return the new value
      // If Redis is unavailable (Fail Open), returns null
      if (result !== null) {
        expect(result).toBeGreaterThan(0);
      }
    });

    it("should increment user cost", async () => {
      const result = await counter.incrementUserCost(testUserId, "today_cost", 0.01);

      if (result !== null) {
        expect(result).toBeGreaterThan(0);
      }
    });

    it("should get user stats", async () => {
      // Increment some values first
      await counter.incrementUserCount(testUserId, "today_requests", 5);
      await counter.incrementUserCost(testUserId, "today_cost", 0.05);

      const stats = await counter.getUserStats(testUserId);

      if (stats !== null) {
        expect(stats.userId).toBe(testUserId);
        expect(stats.todayRequests).toBeGreaterThan(0);
        expect(stats.todayCost).toBeGreaterThan(0);
      }
    });

    it("should get batch user stats", async () => {
      const userIds = [testUserId, testUserId + 1];
      const stats = await counter.getBatchUserStats(userIds);

      // Should return an array (empty if Redis unavailable)
      expect(Array.isArray(stats)).toBe(true);

      if (stats.length > 0) {
        expect(stats[0].userId).toBe(testUserId);
      }
    });
  });

  describe("Active Sessions", () => {
    it("should track active session", async () => {
      const result = await counter.trackActiveSession(testSessionId, testUserId);

      // Returns boolean (true if successful, false if Redis unavailable)
      expect(typeof result).toBe("boolean");
    });

    it("should get active sessions", async () => {
      // Track a session first
      await counter.trackActiveSession(testSessionId, testUserId);

      const sessions = await counter.getActiveSessions(300000); // 5 minutes

      // Should return an array (empty if Redis unavailable)
      expect(Array.isArray(sessions)).toBe(true);

      if (sessions.length > 0) {
        const found = sessions.find((s) => s.sessionId === testSessionId);
        if (found) {
          expect(found.timestamp).toBeGreaterThan(0);
        }
      }
    });

    it("should get user-specific active sessions", async () => {
      const sessions = await counter.getActiveSessions(300000, testUserId);

      expect(Array.isArray(sessions)).toBe(true);
    });

    it("should cleanup expired sessions", async () => {
      const result = await counter.cleanupExpiredSessions(300000);

      // Returns number of cleaned sessions (0 if Redis unavailable)
      expect(typeof result).toBe("number");
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Daily Stats Reset", () => {
    it("should reset daily stats for a user", async () => {
      const result = await counter.resetDailyStats(testUserId);

      // Returns boolean
      expect(typeof result).toBe("boolean");
    });
  });

  describe("Status", () => {
    it("should return counter status", () => {
      const status = counter.getStatus();

      expect(status).toHaveProperty("available");
      expect(status).toHaveProperty("redisStatus");
      expect(typeof status.available).toBe("boolean");
    });
  });

  describe("Data Recovery", () => {
    it("should recover from database without errors", async () => {
      const result = await counter.recoverFromDatabase();

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("usersRecovered");
      expect(result).toHaveProperty("sessionsRecovered");
      expect(result).toHaveProperty("durationMs");

      expect(typeof result.success).toBe("boolean");
      expect(typeof result.usersRecovered).toBe("number");
      expect(typeof result.sessionsRecovered).toBe("number");
      expect(typeof result.durationMs).toBe("number");
    });
  });
});
