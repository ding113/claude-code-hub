import { describe, expect, it } from "vitest";

describe("cost-display-cache-singleflight", () => {
  it("dedupes concurrent loads for the same key into a single loader call", async () => {
    const { withRollingCostSingleflight } = await import(
      "@/lib/redis/cost-display-cache-singleflight"
    );

    let loaderCalls = 0;
    let release!: (value: number) => void;
    const pending = new Promise<number>((resolve) => {
      release = resolve;
    });

    const loader = async () => {
      loaderCalls += 1;
      return pending;
    };

    const concurrency = 100;
    const inflight = Array.from({ length: concurrency }, () =>
      withRollingCostSingleflight("cost_cache:provider:1:5h_rolling", loader)
    );

    // give microtasks a tick so all callers register against the same in-flight promise
    await Promise.resolve();
    expect(loaderCalls).toBe(1);

    release(42.5);
    const results = await Promise.all(inflight);

    expect(loaderCalls).toBe(1);
    expect(results).toHaveLength(concurrency);
    for (const r of results) expect(r).toBe(42.5);
  });

  it("isolates different keys: each key runs its own loader once", async () => {
    const { withRollingCostSingleflight } = await import(
      "@/lib/redis/cost-display-cache-singleflight"
    );

    const seen: string[] = [];
    const loader = (label: string, value: number) => async () => {
      seen.push(label);
      return value;
    };

    const promises = [
      withRollingCostSingleflight("cost_cache:provider:1:5h_rolling", loader("a", 1)),
      withRollingCostSingleflight("cost_cache:provider:1:5h_rolling", loader("a", 1)),
      withRollingCostSingleflight("cost_cache:provider:2:5h_rolling", loader("b", 2)),
      withRollingCostSingleflight("cost_cache:provider:2:5h_rolling", loader("b", 2)),
      withRollingCostSingleflight("cost_cache:user:9:daily_rolling", loader("c", 3)),
    ];

    const results = await Promise.all(promises);

    expect(results).toEqual([1, 1, 2, 2, 3]);
    expect(seen.sort()).toEqual(["a", "b", "c"]);
  });

  it("does not cache failures: a new call after a reject runs the loader again", async () => {
    const { withRollingCostSingleflight } = await import(
      "@/lib/redis/cost-display-cache-singleflight"
    );

    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return 7;
    };

    await expect(withRollingCostSingleflight("cost_cache:key:5:5h_rolling", flaky)).rejects.toThrow(
      "transient"
    );

    // second call must not see the previous rejected promise
    const value = await withRollingCostSingleflight("cost_cache:key:5:5h_rolling", flaky);
    expect(value).toBe(7);
    expect(calls).toBe(2);
  });

  it("a concurrent batch that fails propagates the same error to all awaiters", async () => {
    const { withRollingCostSingleflight } = await import(
      "@/lib/redis/cost-display-cache-singleflight"
    );

    let calls = 0;
    let rejectFn!: (e: Error) => void;
    const pending = new Promise<number>((_, reject) => {
      rejectFn = reject;
    });
    const loader = async () => {
      calls += 1;
      return pending;
    };

    const awaiters = Array.from({ length: 10 }, () =>
      withRollingCostSingleflight("cost_cache:user:99:5h_rolling", loader)
    );

    await Promise.resolve();
    expect(calls).toBe(1);

    rejectFn(new Error("db down"));

    for (const a of awaiters) {
      await expect(a).rejects.toThrow("db down");
    }

    // map is cleared on rejection too; next call recomputes
    let nextCalls = 0;
    const value = await withRollingCostSingleflight("cost_cache:user:99:5h_rolling", async () => {
      nextCalls += 1;
      return 11;
    });
    expect(value).toBe(11);
    expect(nextCalls).toBe(1);
  });
});
