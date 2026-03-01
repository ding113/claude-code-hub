import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TTLMap } from "@/lib/cache/ttl-map";

describe("TTLMap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return undefined for missing key", () => {
    const map = new TTLMap<string, number>({ ttlMs: 1000, maxSize: 10 });
    expect(map.get("missing")).toBeUndefined();
  });

  it("should store and retrieve a value", () => {
    const map = new TTLMap<string, number>({ ttlMs: 1000, maxSize: 10 });
    map.set("a", 42);
    expect(map.get("a")).toBe(42);
    expect(map.size).toBe(1);
  });

  it("should return undefined for expired key", () => {
    const map = new TTLMap<string, number>({ ttlMs: 1000, maxSize: 10 });
    map.set("a", 42);
    vi.advanceTimersByTime(1001);
    expect(map.get("a")).toBeUndefined();
  });

  it("should not return expired key via has()", () => {
    const map = new TTLMap<string, number>({ ttlMs: 1000, maxSize: 10 });
    map.set("a", 42);
    vi.advanceTimersByTime(1001);
    expect(map.has("a")).toBe(false);
  });

  it("should bump LRU order on get", () => {
    const map = new TTLMap<string, number>({ ttlMs: 10000, maxSize: 3 });
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);

    // Access "a" to bump it (it was oldest)
    map.get("a");

    // Insert "d" - should evict "b" (oldest after bump), not "a"
    map.set("d", 4);
    expect(map.has("a")).toBe(true);
    expect(map.has("b")).toBe(false);
    expect(map.has("c")).toBe(true);
    expect(map.has("d")).toBe(true);
  });

  it("should evict expired entries first when at capacity", () => {
    const map = new TTLMap<string, number>({ ttlMs: 1000, maxSize: 3 });
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);

    // Expire all entries
    vi.advanceTimersByTime(1001);

    // Should evict expired entries, making room
    map.set("d", 4);
    expect(map.size).toBe(1);
    expect(map.get("d")).toBe(4);
  });

  it("should evict oldest 10% when at capacity with no expired entries", () => {
    const map = new TTLMap<string, number>({ ttlMs: 100000, maxSize: 10 });
    for (let i = 0; i < 10; i++) {
      map.set(`key-${i}`, i);
    }
    expect(map.size).toBe(10);

    // Insert one more - should evict at least 1 (10% of 10 = 1)
    map.set("new", 99);
    expect(map.size).toBeLessThanOrEqual(10);
    expect(map.get("new")).toBe(99);
    // Oldest key should be evicted
    expect(map.has("key-0")).toBe(false);
  });

  it("should delete an existing key", () => {
    const map = new TTLMap<string, number>({ ttlMs: 1000, maxSize: 10 });
    map.set("a", 1);
    expect(map.delete("a")).toBe(true);
    expect(map.get("a")).toBeUndefined();
    expect(map.size).toBe(0);
  });

  it("should return false when deleting non-existent key", () => {
    const map = new TTLMap<string, number>({ ttlMs: 1000, maxSize: 10 });
    expect(map.delete("missing")).toBe(false);
  });

  it("should update existing key with new value and reset TTL", () => {
    const map = new TTLMap<string, number>({ ttlMs: 1000, maxSize: 10 });
    map.set("a", 1);
    vi.advanceTimersByTime(800);
    map.set("a", 2);
    vi.advanceTimersByTime(800);
    // Should still be alive (TTL was reset on second set)
    expect(map.get("a")).toBe(2);
  });

  it("clear() should remove all entries", () => {
    const map = new TTLMap<string, number>({ ttlMs: 10000, maxSize: 10 });
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    expect(map.size).toBe(3);

    map.clear();
    expect(map.size).toBe(0);
    expect(map.get("a")).toBeUndefined();
    expect(map.get("b")).toBeUndefined();
    expect(map.get("c")).toBeUndefined();
  });

  it("purgeExpired() should remove only expired entries", () => {
    const map = new TTLMap<string, number>({ ttlMs: 1000, maxSize: 10 });
    map.set("old", 1);

    vi.advanceTimersByTime(500);
    map.set("fresh", 2);

    vi.advanceTimersByTime(600); // old at 1100ms (expired), fresh at 600ms (alive)
    map.purgeExpired();

    expect(map.size).toBe(1);
    expect(map.get("old")).toBeUndefined();
    expect(map.get("fresh")).toBe(2);
  });

  it("purgeExpired() on empty map is a no-op", () => {
    const map = new TTLMap<string, number>({ ttlMs: 1000, maxSize: 10 });
    expect(() => map.purgeExpired()).not.toThrow();
    expect(map.size).toBe(0);
  });
});
