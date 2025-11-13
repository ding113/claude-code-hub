/**
 * Sync Scheduler Tests
 *
 * Basic tests for SyncScheduler functionality
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { SyncScheduler } from "./sync-scheduler";

describe("SyncScheduler", () => {
  let scheduler: SyncScheduler;

  beforeAll(() => {
    scheduler = SyncScheduler.getInstance();
  });

  afterAll(() => {
    // Stop scheduler if running
    scheduler.stop();
  });

  describe("Initialization", () => {
    it("should get singleton instance", () => {
      const instance1 = SyncScheduler.getInstance();
      const instance2 = SyncScheduler.getInstance();

      expect(instance1).toBe(instance2);
    });

    it("should return status", () => {
      const status = scheduler.getStatus();

      expect(status).toHaveProperty("running");
      expect(status).toHaveProperty("redisAvailable");
      expect(status).toHaveProperty("config");

      expect(typeof status.running).toBe("boolean");
      expect(typeof status.redisAvailable).toBe("boolean");
      expect(status.config).toHaveProperty("syncIntervalMs");
    });
  });

  describe("Manual Sync", () => {
    it("should sync to database without errors", async () => {
      const result = await scheduler.syncToDatabase();

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("usersSynced");
      expect(result).toHaveProperty("sessionsSynced");
      expect(result).toHaveProperty("durationMs");

      expect(typeof result.success).toBe("boolean");
      expect(typeof result.usersSynced).toBe("number");
      expect(typeof result.sessionsSynced).toBe("number");
      expect(typeof result.durationMs).toBe("number");
    });

    it("should check consistency without errors", async () => {
      const result = await scheduler.checkConsistency();

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("totalUsers");
      expect(result).toHaveProperty("inconsistentUsers");
      expect(result).toHaveProperty("autoFixedUsers");
      expect(result).toHaveProperty("durationMs");

      expect(typeof result.success).toBe("boolean");
      expect(typeof result.totalUsers).toBe("number");
      expect(typeof result.inconsistentUsers).toBe("number");
      expect(typeof result.autoFixedUsers).toBe("number");
      expect(typeof result.durationMs).toBe("number");
    });
  });

  describe("Scheduler Lifecycle", () => {
    it("should start and stop scheduler", () => {
      const statusBefore = scheduler.getStatus();
      const wasRunning = statusBefore.running;

      // Start scheduler
      scheduler.start();
      const statusAfterStart = scheduler.getStatus();

      // Stop scheduler
      scheduler.stop();
      const statusAfterStop = scheduler.getStatus();

      // Verify state changes
      expect(statusAfterStop.running).toBe(false);

      // Restore original state
      if (wasRunning) {
        scheduler.start();
      }
    });
  });
});
