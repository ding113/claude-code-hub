import { describe, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import { scanPattern } from "@/lib/redis/scan-helper";

describe("scanPattern", () => {
  it("should collect all keys from multiple scan iterations", async () => {
    const mockRedis = {
      scan: vi
        .fn()
        .mockResolvedValueOnce(["5", ["key:1", "key:2"]])
        .mockResolvedValueOnce(["0", ["key:3"]]),
    } as unknown as Redis;

    const result = await scanPattern(mockRedis, "key:*");

    expect(result).toEqual(["key:1", "key:2", "key:3"]);
    expect(mockRedis.scan).toHaveBeenCalledTimes(2);
  });

  it("should handle empty result", async () => {
    const mockRedis = {
      scan: vi.fn().mockResolvedValueOnce(["0", []]),
    } as unknown as Redis;

    const result = await scanPattern(mockRedis, "nonexistent:*");

    expect(result).toEqual([]);
  });

  it("should use custom count parameter", async () => {
    const mockRedis = {
      scan: vi.fn().mockResolvedValueOnce(["0", ["key:1"]]),
    } as unknown as Redis;

    await scanPattern(mockRedis, "key:*", 500);

    expect(mockRedis.scan).toHaveBeenCalledWith("0", "MATCH", "key:*", "COUNT", 500);
  });
});
