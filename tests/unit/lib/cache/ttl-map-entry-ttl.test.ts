import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TTLMap } from "@/lib/cache/ttl-map";

describe("TTLMap per-entry TTL", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("uses the map TTL by default and the override when provided", () => {
    const map = new TTLMap<string, number>({ ttlMs: 1_000, maxSize: 10 });
    map.set("default", 1);
    map.set("long", 2, 5_000);
    map.set("ignored-zero", 3, 0);

    vi.advanceTimersByTime(1_001);
    expect(map.get("default")).toBeUndefined();
    expect(map.get("ignored-zero")).toBeUndefined();
    expect(map.get("long")).toBe(2);

    vi.advanceTimersByTime(4_000);
    expect(map.has("long")).toBe(false);
  });
});
