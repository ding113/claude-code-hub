import { describe, expect, it, vi } from "vitest";
import { withRetry } from "@/lib/webhook/utils/retry";

describe("withRetry", () => {
  it("should return result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("success");

    const result = await withRetry(fn, { maxRetries: 3 });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on failure and succeed", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");

    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 1 });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should throw after max retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fail"));

    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 1 })).rejects.toThrow("always fail");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should use exponential backoff", async () => {
    const delays: number[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: any, delay: number) => {
      delays.push(delay);
      fn();
      return 0 as any;
    });

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("success");

    await withRetry(fn, { maxRetries: 3, baseDelay: 100 });

    expect(delays).toEqual([100, 200]); // 100 * 2^0, 100 * 2^1

    vi.restoreAllMocks();
  });
});
