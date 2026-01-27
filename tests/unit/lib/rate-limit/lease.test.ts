/**
 * Lease Module Tests
 *
 * TDD: RED phase - tests for lease budget slicing mechanism
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock getEnvConfig before importing lease module
vi.mock("@/lib/config", () => ({
  getEnvConfig: () => ({ TZ: "Asia/Shanghai" }),
}));

describe("lease module", () => {
  const nowMs = 1706400000000; // 2024-01-28 00:00:00 UTC

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("LeaseWindow type", () => {
    it("should support 5h, daily, weekly, monthly periods", async () => {
      const { LeaseWindow } = await import("@/lib/rate-limit/lease");
      const windows: (typeof LeaseWindow)[number][] = ["5h", "daily", "weekly", "monthly"];
      expect(windows).toHaveLength(4);
    });
  });

  describe("LeaseEntityType type", () => {
    it("should support key, user, provider entity types", async () => {
      const { LeaseEntityType } = await import("@/lib/rate-limit/lease");
      const types: (typeof LeaseEntityType)[number][] = ["key", "user", "provider"];
      expect(types).toHaveLength(3);
    });
  });

  describe("BudgetLease interface", () => {
    it("should contain required fields", async () => {
      const { createBudgetLease } = await import("@/lib/rate-limit/lease");

      const lease = createBudgetLease({
        entityType: "key",
        entityId: 123,
        window: "daily",
        resetMode: "fixed",
        resetTime: "18:00",
        snapshotAtMs: nowMs,
        currentUsage: 50,
        limitAmount: 100,
        remainingBudget: 2.5,
        ttlSeconds: 3600,
      });

      expect(lease.entityType).toBe("key");
      expect(lease.entityId).toBe(123);
      expect(lease.window).toBe("daily");
      expect(lease.resetMode).toBe("fixed");
      expect(lease.resetTime).toBe("18:00");
      expect(lease.snapshotAtMs).toBe(nowMs);
      expect(lease.currentUsage).toBe(50);
      expect(lease.limitAmount).toBe(100);
      expect(lease.remainingBudget).toBe(2.5);
      expect(lease.ttlSeconds).toBe(3600);
    });
  });

  describe("buildLeaseKey", () => {
    it("should build key lease key with window", async () => {
      const { buildLeaseKey } = await import("@/lib/rate-limit/lease");

      expect(buildLeaseKey("key", 123, "5h")).toBe("lease:key:123:5h");
      expect(buildLeaseKey("key", 456, "daily")).toBe("lease:key:456:daily");
      expect(buildLeaseKey("key", 789, "weekly")).toBe("lease:key:789:weekly");
      expect(buildLeaseKey("key", 101, "monthly")).toBe("lease:key:101:monthly");
    });

    it("should build provider lease key with window", async () => {
      const { buildLeaseKey } = await import("@/lib/rate-limit/lease");

      expect(buildLeaseKey("provider", 1, "5h")).toBe("lease:provider:1:5h");
      expect(buildLeaseKey("provider", 2, "daily")).toBe("lease:provider:2:daily");
    });

    it("should build user lease key with window", async () => {
      const { buildLeaseKey } = await import("@/lib/rate-limit/lease");

      expect(buildLeaseKey("user", 100, "monthly")).toBe("lease:user:100:monthly");
    });
  });

  describe("getLeaseTimeRange", () => {
    it("should return 5h rolling window range", async () => {
      const { getLeaseTimeRange } = await import("@/lib/rate-limit/lease");

      const range = getLeaseTimeRange("5h");

      expect(range.endTime.getTime()).toBe(nowMs);
      expect(range.startTime.getTime()).toBe(nowMs - 5 * 60 * 60 * 1000);
    });

    it("should return daily rolling window range (24h)", async () => {
      const { getLeaseTimeRange } = await import("@/lib/rate-limit/lease");

      const range = getLeaseTimeRange("daily", "00:00", "rolling");

      expect(range.endTime.getTime()).toBe(nowMs);
      expect(range.startTime.getTime()).toBe(nowMs - 24 * 60 * 60 * 1000);
    });

    it("should return daily fixed window range with custom reset time", async () => {
      const { getLeaseTimeRange } = await import("@/lib/rate-limit/lease");

      const range = getLeaseTimeRange("daily", "18:00", "fixed");

      // Should calculate based on fixed reset time
      expect(range.endTime.getTime()).toBe(nowMs);
      expect(range.startTime.getTime()).toBeLessThan(nowMs);
    });

    it("should return weekly natural window range", async () => {
      const { getLeaseTimeRange } = await import("@/lib/rate-limit/lease");

      const range = getLeaseTimeRange("weekly");

      expect(range.endTime.getTime()).toBe(nowMs);
      // Should start from Monday 00:00
      expect(range.startTime.getTime()).toBeLessThan(nowMs);
    });

    it("should return monthly natural window range", async () => {
      const { getLeaseTimeRange } = await import("@/lib/rate-limit/lease");

      const range = getLeaseTimeRange("monthly");

      expect(range.endTime.getTime()).toBe(nowMs);
      // Should start from 1st of month 00:00
      expect(range.startTime.getTime()).toBeLessThan(nowMs);
    });
  });

  describe("getLeaseTtlSeconds", () => {
    it("should return 5h TTL for 5h window", async () => {
      const { getLeaseTtlSeconds } = await import("@/lib/rate-limit/lease");

      const ttl = getLeaseTtlSeconds("5h");

      expect(ttl).toBe(5 * 3600);
    });

    it("should return 24h TTL for daily rolling window", async () => {
      const { getLeaseTtlSeconds } = await import("@/lib/rate-limit/lease");

      const ttl = getLeaseTtlSeconds("daily", "00:00", "rolling");

      expect(ttl).toBe(24 * 3600);
    });

    it("should return dynamic TTL for daily fixed window", async () => {
      const { getLeaseTtlSeconds } = await import("@/lib/rate-limit/lease");

      const ttl = getLeaseTtlSeconds("daily", "18:00", "fixed");

      // Should be positive and less than 24h
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(24 * 3600);
    });

    it("should return dynamic TTL for weekly window", async () => {
      const { getLeaseTtlSeconds } = await import("@/lib/rate-limit/lease");

      const ttl = getLeaseTtlSeconds("weekly");

      // Should be positive and less than 7 days
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(7 * 24 * 3600);
    });

    it("should return dynamic TTL for monthly window", async () => {
      const { getLeaseTtlSeconds } = await import("@/lib/rate-limit/lease");

      const ttl = getLeaseTtlSeconds("monthly");

      // Should be positive and less than 31 days
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(31 * 24 * 3600);
    });
  });

  describe("calculateLeaseSlice", () => {
    it("should calculate slice as percentage of limit", async () => {
      const { calculateLeaseSlice } = await import("@/lib/rate-limit/lease");

      // limit=100, percent=0.05 -> slice=5
      const slice = calculateLeaseSlice({
        limitAmount: 100,
        currentUsage: 0,
        percent: 0.05,
      });

      expect(slice).toBe(5);
    });

    it("should not exceed remaining budget (limit - usage)", async () => {
      const { calculateLeaseSlice } = await import("@/lib/rate-limit/lease");

      // limit=100, usage=98, percent=0.05 -> remaining=2, slice=min(5,2)=2
      const slice = calculateLeaseSlice({
        limitAmount: 100,
        currentUsage: 98,
        percent: 0.05,
      });

      expect(slice).toBe(2);
    });

    it("should respect capUsd if provided", async () => {
      const { calculateLeaseSlice } = await import("@/lib/rate-limit/lease");

      // limit=1000, percent=0.05 -> 50, but cap=3 -> slice=3
      const slice = calculateLeaseSlice({
        limitAmount: 1000,
        currentUsage: 0,
        percent: 0.05,
        capUsd: 3,
      });

      expect(slice).toBe(3);
    });

    it("should return 0 when usage exceeds limit", async () => {
      const { calculateLeaseSlice } = await import("@/lib/rate-limit/lease");

      const slice = calculateLeaseSlice({
        limitAmount: 100,
        currentUsage: 105,
        percent: 0.05,
      });

      expect(slice).toBe(0);
    });

    it("should return 0 when usage equals limit", async () => {
      const { calculateLeaseSlice } = await import("@/lib/rate-limit/lease");

      const slice = calculateLeaseSlice({
        limitAmount: 100,
        currentUsage: 100,
        percent: 0.05,
      });

      expect(slice).toBe(0);
    });

    it("should round to 4 decimal places", async () => {
      const { calculateLeaseSlice } = await import("@/lib/rate-limit/lease");

      const slice = calculateLeaseSlice({
        limitAmount: 33.333333,
        currentUsage: 0,
        percent: 0.05,
      });

      // 33.333333 * 0.05 = 1.6666666...
      expect(slice).toBe(1.6667);
    });
  });

  describe("serializeLease / deserializeLease", () => {
    it("should serialize lease to JSON string", async () => {
      const { createBudgetLease, serializeLease } = await import("@/lib/rate-limit/lease");

      const lease = createBudgetLease({
        entityType: "key",
        entityId: 123,
        window: "daily",
        resetMode: "fixed",
        resetTime: "18:00",
        snapshotAtMs: nowMs,
        currentUsage: 50,
        limitAmount: 100,
        remainingBudget: 2.5,
        ttlSeconds: 3600,
      });

      const json = serializeLease(lease);
      expect(typeof json).toBe("string");

      const parsed = JSON.parse(json);
      expect(parsed.entityType).toBe("key");
      expect(parsed.remainingBudget).toBe(2.5);
    });

    it("should deserialize JSON string to lease", async () => {
      const { createBudgetLease, deserializeLease, serializeLease } = await import(
        "@/lib/rate-limit/lease"
      );

      const original = createBudgetLease({
        entityType: "provider",
        entityId: 456,
        window: "weekly",
        resetMode: "fixed",
        resetTime: "00:00",
        snapshotAtMs: nowMs,
        currentUsage: 25,
        limitAmount: 200,
        remainingBudget: 10,
        ttlSeconds: 86400,
      });

      const json = serializeLease(original);
      const restored = deserializeLease(json);

      expect(restored).not.toBeNull();
      expect(restored?.entityType).toBe("provider");
      expect(restored?.entityId).toBe(456);
      expect(restored?.remainingBudget).toBe(10);
    });

    it("should return null for invalid JSON", async () => {
      const { deserializeLease } = await import("@/lib/rate-limit/lease");

      const result = deserializeLease("invalid json");
      expect(result).toBeNull();
    });

    it("should return null for incomplete lease data", async () => {
      const { deserializeLease } = await import("@/lib/rate-limit/lease");

      const result = deserializeLease(JSON.stringify({ entityType: "key" }));
      expect(result).toBeNull();
    });
  });

  describe("isLeaseExpired", () => {
    it("should return true when TTL has passed", async () => {
      const { createBudgetLease, isLeaseExpired } = await import("@/lib/rate-limit/lease");

      const lease = createBudgetLease({
        entityType: "key",
        entityId: 123,
        window: "daily",
        resetMode: "fixed",
        resetTime: "00:00",
        snapshotAtMs: nowMs - 3700 * 1000, // Created 3700s ago
        currentUsage: 50,
        limitAmount: 100,
        remainingBudget: 2.5,
        ttlSeconds: 3600, // 1 hour TTL
      });

      expect(isLeaseExpired(lease)).toBe(true);
    });

    it("should return false when TTL has not passed", async () => {
      const { createBudgetLease, isLeaseExpired } = await import("@/lib/rate-limit/lease");

      const lease = createBudgetLease({
        entityType: "key",
        entityId: 123,
        window: "daily",
        resetMode: "fixed",
        resetTime: "00:00",
        snapshotAtMs: nowMs - 1800 * 1000, // Created 1800s ago
        currentUsage: 50,
        limitAmount: 100,
        remainingBudget: 2.5,
        ttlSeconds: 3600, // 1 hour TTL
      });

      expect(isLeaseExpired(lease)).toBe(false);
    });
  });
});
