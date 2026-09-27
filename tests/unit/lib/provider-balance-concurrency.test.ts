import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/provider-balance/concurrency";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("mapWithConcurrency", () => {
  it("保持结果顺序与输入一致", async () => {
    const result = await mapWithConcurrency([3, 1, 2], 2, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value));
      return value * 10;
    });

    expect(result).toEqual([30, 10, 20]);
  });

  it("同时执行的任务不超过并发上限", async () => {
    let running = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 12 }, (_, index) => index),
      3,
      async (value) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
        return value;
      }
    );

    expect(peak).toBe(3);
  });

  it("并发度大于任务数时按任务数执行", async () => {
    let started = 0;
    await mapWithConcurrency([1, 2], 10, async (value) => {
      started += 1;
      return value;
    });

    expect(started).toBe(2);
  });

  it("空输入不会调用 worker", async () => {
    let called = false;
    const result = await mapWithConcurrency([], 4, async () => {
      called = true;
      return 1;
    });

    expect(called).toBe(false);
    expect(result).toEqual([]);
  });

  it("一个任务未完成时不会提前返回", async () => {
    const gate = deferred<void>();
    let settled = false;

    const promise = mapWithConcurrency([1, 2], 2, async (value) => {
      if (value === 2) await gate.promise;
      return value;
    }).then((value) => {
      settled = true;
      return value;
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(false);

    gate.resolve();
    await expect(promise).resolves.toEqual([1, 2]);
  });
});
