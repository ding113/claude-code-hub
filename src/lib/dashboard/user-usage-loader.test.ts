import { afterEach, describe, expect, test, vi } from "vitest";
import { loadUserUsagePagesSequentially, USER_USAGE_IDLE_DELAY_MS } from "./user-usage-loader";

interface KeyUsageData {
  todayUsage: number;
  todayCallCount: number;
  todayTokens: number;
  lastUsedAt: Date | null;
  lastProviderName: string | null;
  modelStats: Array<{
    model: string;
    callCount: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  }>;
}

function createUsage(keyId: number): Record<number, KeyUsageData> {
  return {
    [keyId]: {
      todayUsage: keyId,
      todayCallCount: keyId,
      todayTokens: keyId * 100,
      lastUsedAt: null,
      lastProviderName: null,
      modelStats: [],
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
}

describe("loadUserUsagePagesSequentially", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("waits for the idle window and fetches pages one by one", async () => {
    vi.useFakeTimers();

    const resolvers: Array<() => void> = [];
    const fetchUsagePage = vi.fn(
      (userIds: number[]) =>
        new Promise<Record<number, KeyUsageData>>((resolve) => {
          resolvers.push(() => resolve(createUsage(userIds[0])));
        })
    );
    const onPageLoaded = vi.fn();
    const controller = new AbortController();

    const task = loadUserUsagePagesSequentially({
      pageUserIds: [[11], [22]],
      signal: controller.signal,
      fetchUsagePage,
      onPageLoaded,
    });

    await vi.advanceTimersByTimeAsync(USER_USAGE_IDLE_DELAY_MS - 1);
    expect(fetchUsagePage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchUsagePage).toHaveBeenCalledTimes(1);
    expect(fetchUsagePage).toHaveBeenNthCalledWith(1, [11]);

    resolvers[0]?.();
    await flushMicrotasks();
    expect(onPageLoaded).toHaveBeenCalledWith(createUsage(11));
    expect(fetchUsagePage).toHaveBeenCalledTimes(2);
    expect(fetchUsagePage).toHaveBeenNthCalledWith(2, [22]);

    resolvers[1]?.();
    await flushMicrotasks();
    await task;

    expect(onPageLoaded).toHaveBeenNthCalledWith(2, createUsage(22));
  });

  test("stops before the next page when aborted during an in-flight request", async () => {
    vi.useFakeTimers();

    let resolveFirstPage: ((value: Record<number, KeyUsageData>) => void) | undefined;
    const fetchUsagePage = vi.fn(
      (userIds: number[]) =>
        new Promise<Record<number, KeyUsageData>>((resolve) => {
          if (userIds[0] === 11) {
            resolveFirstPage = resolve;
            return;
          }
          resolve(createUsage(userIds[0]));
        })
    );
    const onPageLoaded = vi.fn();
    const controller = new AbortController();

    const task = loadUserUsagePagesSequentially({
      pageUserIds: [[11], [22]],
      signal: controller.signal,
      fetchUsagePage,
      onPageLoaded,
    });

    await vi.advanceTimersByTimeAsync(USER_USAGE_IDLE_DELAY_MS);
    expect(fetchUsagePage).toHaveBeenCalledTimes(1);

    controller.abort();
    resolveFirstPage?.(createUsage(11));
    await flushMicrotasks();
    await task;

    expect(onPageLoaded).not.toHaveBeenCalled();
    expect(fetchUsagePage).toHaveBeenCalledTimes(1);
  });
});
