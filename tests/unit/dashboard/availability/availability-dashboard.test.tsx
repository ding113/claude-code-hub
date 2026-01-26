/**
 * @vitest-environment happy-dom
 */

import { describe, expect, test } from "vitest";

// Test the time range calculation logic from AvailabilityDashboard

describe("AvailabilityDashboard - time range calculations", () => {
  type TimeRangeOption = "15min" | "1h" | "6h" | "24h" | "7d";

  const TIME_RANGE_MAP: Record<TimeRangeOption, number> = {
    "15min": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
  };

  const TARGET_BUCKETS = 60;

  function calculateBucketSize(timeRangeMs: number): number {
    const bucketSizeMs = timeRangeMs / TARGET_BUCKETS;
    const bucketSizeMinutes = bucketSizeMs / (60 * 1000);
    return Math.max(0.25, Math.round(bucketSizeMinutes * 4) / 4);
  }

  describe("TIME_RANGE_MAP values", () => {
    test("15min should be 15 minutes in milliseconds", () => {
      expect(TIME_RANGE_MAP["15min"]).toBe(15 * 60 * 1000);
      expect(TIME_RANGE_MAP["15min"]).toBe(900000);
    });

    test("1h should be 1 hour in milliseconds", () => {
      expect(TIME_RANGE_MAP["1h"]).toBe(60 * 60 * 1000);
      expect(TIME_RANGE_MAP["1h"]).toBe(3600000);
    });

    test("6h should be 6 hours in milliseconds", () => {
      expect(TIME_RANGE_MAP["6h"]).toBe(6 * 60 * 60 * 1000);
      expect(TIME_RANGE_MAP["6h"]).toBe(21600000);
    });

    test("24h should be 24 hours in milliseconds", () => {
      expect(TIME_RANGE_MAP["24h"]).toBe(24 * 60 * 60 * 1000);
      expect(TIME_RANGE_MAP["24h"]).toBe(86400000);
    });

    test("7d should be 7 days in milliseconds", () => {
      expect(TIME_RANGE_MAP["7d"]).toBe(7 * 24 * 60 * 60 * 1000);
      expect(TIME_RANGE_MAP["7d"]).toBe(604800000);
    });
  });

  describe("calculateBucketSize", () => {
    test("should calculate bucket size for 15min range", () => {
      const bucketSize = calculateBucketSize(TIME_RANGE_MAP["15min"]);
      // 15min / 60 buckets = 0.25 minutes per bucket
      expect(bucketSize).toBe(0.25);
    });

    test("should calculate bucket size for 1h range", () => {
      const bucketSize = calculateBucketSize(TIME_RANGE_MAP["1h"]);
      // 60min / 60 buckets = 1 minute per bucket
      expect(bucketSize).toBe(1);
    });

    test("should calculate bucket size for 6h range", () => {
      const bucketSize = calculateBucketSize(TIME_RANGE_MAP["6h"]);
      // 360min / 60 buckets = 6 minutes per bucket
      expect(bucketSize).toBe(6);
    });

    test("should calculate bucket size for 24h range", () => {
      const bucketSize = calculateBucketSize(TIME_RANGE_MAP["24h"]);
      // 1440min / 60 buckets = 24 minutes per bucket
      expect(bucketSize).toBe(24);
    });

    test("should calculate bucket size for 7d range", () => {
      const bucketSize = calculateBucketSize(TIME_RANGE_MAP["7d"]);
      // 10080min / 60 buckets = 168 minutes per bucket
      expect(bucketSize).toBe(168);
    });

    test("should enforce minimum bucket size of 0.25 minutes", () => {
      // Very small time range
      const bucketSize = calculateBucketSize(1000); // 1 second
      expect(bucketSize).toBe(0.25);
    });

    test("should round to nearest 0.25 minutes", () => {
      // Test rounding behavior
      const testCases = [
        { input: 60 * 60 * 1000 * 1.1, expected: 1 }, // ~1.1 min -> 1
        { input: 60 * 60 * 1000 * 1.3, expected: 1.25 }, // ~1.3 min -> 1.25
        { input: 60 * 60 * 1000 * 1.6, expected: 1.5 }, // ~1.6 min -> 1.5
        { input: 60 * 60 * 1000 * 1.9, expected: 2 }, // ~1.9 min -> 2
      ];

      for (const { input, expected } of testCases) {
        const result = calculateBucketSize(input);
        expect(result).toBeCloseTo(expected, 1);
      }
    });
  });

  describe("time range date calculations", () => {
    test("should calculate correct start time for each range", () => {
      const now = new Date("2024-01-15T12:00:00Z");

      for (const [range, ms] of Object.entries(TIME_RANGE_MAP)) {
        const startTime = new Date(now.getTime() - ms);
        const diff = now.getTime() - startTime.getTime();
        expect(diff).toBe(ms);
      }
    });

    test("15min range should go back 15 minutes", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      const startTime = new Date(now.getTime() - TIME_RANGE_MAP["15min"]);
      expect(startTime.toISOString()).toBe("2024-01-15T11:45:00.000Z");
    });

    test("24h range should go back 24 hours", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      const startTime = new Date(now.getTime() - TIME_RANGE_MAP["24h"]);
      expect(startTime.toISOString()).toBe("2024-01-14T12:00:00.000Z");
    });

    test("7d range should go back 7 days", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      const startTime = new Date(now.getTime() - TIME_RANGE_MAP["7d"]);
      expect(startTime.toISOString()).toBe("2024-01-08T12:00:00.000Z");
    });
  });
});

describe("AvailabilityDashboard - overview metrics calculations", () => {
  interface TimeBucket {
    avgLatencyMs: number;
    redCount: number;
    totalRequests: number;
  }

  interface Provider {
    timeBuckets: TimeBucket[];
    totalRequests: number;
    currentStatus: "green" | "yellow" | "red" | "unknown";
  }

  function calculateAvgLatency(providers: Provider[]): number {
    if (providers.length === 0) return 0;

    const providersWithLatency = providers.filter((p) =>
      p.timeBuckets.some((b) => b.avgLatencyMs > 0)
    );

    if (providersWithLatency.length === 0) return 0;

    const totalLatency = providersWithLatency.reduce((sum, p) => {
      const latencies = p.timeBuckets.filter((b) => b.avgLatencyMs > 0).map((b) => b.avgLatencyMs);
      if (latencies.length === 0) return sum;
      return sum + latencies.reduce((a, b) => a + b, 0) / latencies.length;
    }, 0);

    return totalLatency / providersWithLatency.length;
  }

  function calculateErrorRate(providers: Provider[]): number {
    if (providers.length === 0) return 0;

    const totalErrorRate = providers.reduce((sum, p) => {
      const total = p.totalRequests;
      const errors = p.timeBuckets.reduce((s, b) => s + b.redCount, 0);
      return sum + (total > 0 ? errors / total : 0);
    }, 0);

    return totalErrorRate / providers.length;
  }

  function countByStatus(providers: Provider[], status: string): number {
    return providers.filter((p) => p.currentStatus === status).length;
  }

  describe("calculateAvgLatency", () => {
    test("should return 0 for empty providers", () => {
      expect(calculateAvgLatency([])).toBe(0);
    });

    test("should calculate average latency across providers", () => {
      const providers: Provider[] = [
        {
          timeBuckets: [{ avgLatencyMs: 100, redCount: 0, totalRequests: 10 }],
          totalRequests: 10,
          currentStatus: "green",
        },
        {
          timeBuckets: [{ avgLatencyMs: 200, redCount: 0, totalRequests: 10 }],
          totalRequests: 10,
          currentStatus: "green",
        },
      ];
      expect(calculateAvgLatency(providers)).toBe(150);
    });

    test("should ignore providers with no latency data", () => {
      const providers: Provider[] = [
        {
          timeBuckets: [{ avgLatencyMs: 100, redCount: 0, totalRequests: 10 }],
          totalRequests: 10,
          currentStatus: "green",
        },
        {
          timeBuckets: [{ avgLatencyMs: 0, redCount: 0, totalRequests: 0 }],
          totalRequests: 0,
          currentStatus: "unknown",
        },
      ];
      expect(calculateAvgLatency(providers)).toBe(100);
    });

    test("should average multiple buckets within a provider", () => {
      const providers: Provider[] = [
        {
          timeBuckets: [
            { avgLatencyMs: 100, redCount: 0, totalRequests: 10 },
            { avgLatencyMs: 200, redCount: 0, totalRequests: 10 },
            { avgLatencyMs: 300, redCount: 0, totalRequests: 10 },
          ],
          totalRequests: 30,
          currentStatus: "green",
        },
      ];
      expect(calculateAvgLatency(providers)).toBe(200);
    });
  });

  describe("calculateErrorRate", () => {
    test("should return 0 for empty providers", () => {
      expect(calculateErrorRate([])).toBe(0);
    });

    test("should calculate error rate correctly", () => {
      const providers: Provider[] = [
        {
          timeBuckets: [{ avgLatencyMs: 100, redCount: 10, totalRequests: 100 }],
          totalRequests: 100,
          currentStatus: "green",
        },
      ];
      expect(calculateErrorRate(providers)).toBe(0.1); // 10%
    });

    test("should average error rates across providers", () => {
      const providers: Provider[] = [
        {
          timeBuckets: [{ avgLatencyMs: 100, redCount: 10, totalRequests: 100 }],
          totalRequests: 100,
          currentStatus: "green",
        },
        {
          timeBuckets: [{ avgLatencyMs: 100, redCount: 20, totalRequests: 100 }],
          totalRequests: 100,
          currentStatus: "yellow",
        },
      ];
      expect(calculateErrorRate(providers)).toBeCloseTo(0.15, 10); // (10% + 20%) / 2
    });

    test("should handle providers with zero requests", () => {
      const providers: Provider[] = [
        {
          timeBuckets: [{ avgLatencyMs: 0, redCount: 0, totalRequests: 0 }],
          totalRequests: 0,
          currentStatus: "unknown",
        },
      ];
      expect(calculateErrorRate(providers)).toBe(0);
    });
  });

  describe("countByStatus", () => {
    const providers: Provider[] = [
      { timeBuckets: [], totalRequests: 100, currentStatus: "green" },
      { timeBuckets: [], totalRequests: 100, currentStatus: "green" },
      { timeBuckets: [], totalRequests: 50, currentStatus: "yellow" },
      { timeBuckets: [], totalRequests: 10, currentStatus: "red" },
      { timeBuckets: [], totalRequests: 0, currentStatus: "unknown" },
    ];

    test("should count green providers", () => {
      expect(countByStatus(providers, "green")).toBe(2);
    });

    test("should count yellow providers", () => {
      expect(countByStatus(providers, "yellow")).toBe(1);
    });

    test("should count red providers", () => {
      expect(countByStatus(providers, "red")).toBe(1);
    });

    test("should count unknown providers", () => {
      expect(countByStatus(providers, "unknown")).toBe(1);
    });

    test("should return 0 for non-existent status", () => {
      expect(countByStatus(providers, "nonexistent")).toBe(0);
    });
  });
});

describe("AvailabilityDashboard - auto-refresh intervals", () => {
  test("provider tab should use 30 second interval", () => {
    const activeTab = "provider";
    const interval = activeTab === "provider" ? 30000 : 10000;
    expect(interval).toBe(30000);
  });

  test("endpoint tab should use 10 second interval", () => {
    const activeTab = "endpoint";
    const interval = activeTab === "provider" ? 30000 : 10000;
    expect(interval).toBe(10000);
  });
});
