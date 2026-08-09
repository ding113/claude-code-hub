import { describe, expect, it } from "vitest";
import {
  computeHealthTestModelStats,
  computeHealthTestStats,
  formatOnlineRatePercent,
  normalizeHealthTestModelStats,
  normalizeHealthTestRecentResults,
} from "@/lib/provider-health-test/stats";

describe("computeHealthTestStats", () => {
  it("returns nulls for empty window", () => {
    expect(computeHealthTestStats([])).toEqual({
      onlineRate: null,
      avgFirstByteMs: null,
      recentResults: [],
    });
  });

  it("computes online rate over window and avg first-byte from successes only", () => {
    const logs = [
      { ok: true, firstByteMs: 100, latencyMs: 200, createdAt: new Date("2026-07-20T12:04:00Z") },
      { ok: false, firstByteMs: null, latencyMs: 50, createdAt: new Date("2026-07-20T12:03:00Z") },
      { ok: true, firstByteMs: 300, latencyMs: 400, createdAt: new Date("2026-07-20T12:02:00Z") },
      { ok: true, firstByteMs: 200, latencyMs: 250, createdAt: new Date("2026-07-20T12:01:00Z") },
    ];
    const stats = computeHealthTestStats(logs, 4);
    expect(stats.onlineRate).toBeCloseTo(0.75);
    expect(stats.avgFirstByteMs).toBe(200);
    // oldest → newest
    expect(stats.recentResults.map((s) => s.ok)).toEqual([true, true, false, true]);
    expect(stats.recentResults[0]?.firstByteMs).toBe(200);
    expect(stats.recentResults[2]?.ok).toBe(false);
  });

  it("keeps independent rolling windows for interleaved models", () => {
    const logs = [
      {
        ok: true,
        firstByteMs: 100,
        model: "model-a",
        createdAt: new Date("2026-07-20T12:04:00Z"),
      },
      {
        ok: false,
        firstByteMs: null,
        model: "model-b",
        createdAt: new Date("2026-07-20T12:03:00Z"),
      },
      {
        ok: false,
        firstByteMs: null,
        model: "model-a",
        createdAt: new Date("2026-07-20T12:02:00Z"),
      },
      {
        ok: true,
        firstByteMs: 300,
        model: "model-b",
        createdAt: new Date("2026-07-20T12:01:00Z"),
      },
    ];
    const stats = computeHealthTestModelStats(logs, 2);

    expect(stats["model-a"]?.onlineRate).toBe(0.5);
    expect(stats["model-b"]?.onlineRate).toBe(0.5);
    expect(stats["model-a"]?.recentResults.map((sample) => sample.model)).toEqual([
      "model-a",
      "model-a",
    ]);
    expect(stats["model-b"]?.avgFirstByteMs).toBe(300);
  });
});

describe("normalizeHealthTestModelStats", () => {
  it("normalizes per-model snapshots and legacy sample values", () => {
    const stats = normalizeHealthTestModelStats({
      " model-a ": {
        onlineRate: "0.75",
        avgFirstByteMs: 101.6,
        recentResults: [true, false],
      },
      "": { onlineRate: 1, recentResults: [] },
      invalid: null,
    });

    expect(stats?.["model-a"]?.onlineRate).toBe(0.75);
    expect(stats?.["model-a"]?.avgFirstByteMs).toBe(102);
    expect(stats?.["model-a"]?.recentResults.map((sample) => sample.ok)).toEqual([true, false]);
    expect(stats?.invalid).toBeUndefined();
  });
});

describe("normalizeHealthTestRecentResults", () => {
  it("accepts legacy boolean arrays", () => {
    const samples = normalizeHealthTestRecentResults([true, false, true]);
    expect(samples?.map((s) => s.ok)).toEqual([true, false, true]);
  });

  it("accepts rich samples", () => {
    const samples = normalizeHealthTestRecentResults([
      {
        ok: true,
        firstByteMs: 123,
        latencyMs: 200,
        status: "green",
        model: "grok-4.5",
        source: "scheduled",
        errorType: null,
        errorMessage: null,
        httpStatusCode: 200,
        testedAt: "2026-07-20T12:00:00.000Z",
      },
    ]);
    expect(samples?.[0]?.firstByteMs).toBe(123);
    expect(samples?.[0]?.model).toBe("grok-4.5");
  });
});

describe("formatOnlineRatePercent", () => {
  it("formats percent with two decimals", () => {
    expect(formatOnlineRatePercent(0.9902)).toBe("99.02%");
    expect(formatOnlineRatePercent(null)).toBe("-");
  });
});
