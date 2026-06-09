import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn(async () => "UTC"),
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: vi.fn(async () => ({ quotaDbRefreshIntervalSeconds: 10 })),
}));

// Pipeline used by daily/weekly/monthly GET path — return null for all keys so
// nothing else writes through and we keep the spotlight on the cache-miss warm
// branch.
const makePipeline = () => {
  const calls: Array<unknown[]> = [];
  const pipeline = {
    get: vi.fn((...args: unknown[]) => {
      calls.push(["get", ...args]);
      return pipeline;
    }),
    exec: vi.fn(async () => calls.map(() => [null, null] as [Error | null, unknown])),
  };
  return pipeline;
};

const setCalls: Array<[string, ...unknown[]]> = [];
const redisClient = {
  status: "ready" as const,
  mget: vi.fn(async (..._keys: string[]) => _keys.map(() => null) as Array<string | null>),
  pipeline: vi.fn(() => makePipeline()),
  set: vi.fn(async (key: string, ...rest: unknown[]) => {
    setCalls.push([key, ...rest]);
    return "OK" as const;
  }),
};

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClient,
}));

// Deferred promise factory: capture resolve so the test controls when the
// statistics calls settle. Concurrency is asserted by checking how many
// callers are simultaneously blocked on these promises.
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
const deferred = <T>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// We count how many findEarliest calls are in-flight at any moment.
let inFlightEarliest = 0;
let maxInFlightEarliest = 0;
const earliestDeferreds: Array<Deferred<number | null>> = [];

const statisticsMock = {
  sumKeyTotalCost: vi.fn(async () => 0),
  sumUserTotalCost: vi.fn(async () => 0),
  sumUserCostInTimeRange: vi.fn(async () => 0),
  sumKeyCostInTimeRange: vi.fn(async () => 0),
  sumProviderCostInTimeRange: vi.fn(async () => 0),
  sumProviderCostBatchInTimeRange: vi.fn(async () => new Map<number, number>()),
  getProviderCostResetAtMap: vi.fn(async () => new Map<number, Date | null>()),
  findEarliestLedgerCreatedAtInWindow: vi.fn(async () => {
    const d = deferred<number | null>();
    earliestDeferreds.push(d);
    inFlightEarliest += 1;
    maxInFlightEarliest = Math.max(maxInFlightEarliest, inFlightEarliest);
    try {
      return await d.promise;
    } finally {
      inFlightEarliest -= 1;
    }
  }),
  findKeyCostEntriesInTimeRange: vi.fn(async () => []),
  findProviderCostEntriesInTimeRange: vi.fn(async () => []),
  findUserCostEntriesInTimeRange: vi.fn(async () => []),
};

vi.mock("@/repository/statistics", () => statisticsMock);

describe("getCurrentCostBatch — M1 batch warm runs in parallel", () => {
  const nowMs = 1_700_000_000_000;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    redisClient.mget.mockReset();
    redisClient.set.mockClear();
    setCalls.length = 0;
    earliestDeferreds.length = 0;
    inFlightEarliest = 0;
    maxInFlightEarliest = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fans out earliest-ledger lookups concurrently for all 5h miss providers", async () => {
    const N = 8;
    const providerIds = Array.from({ length: N }, (_, i) => 100 + i);

    // 5h cache: all miss. Daily cache: skipped because all daily configs are fixed.
    redisClient.mget.mockResolvedValueOnce(providerIds.map(() => null)); // 5h miss

    statisticsMock.sumProviderCostBatchInTimeRange.mockResolvedValueOnce(
      new Map(providerIds.map((id, i) => [id, (i + 1) * 0.5]))
    );

    const { RateLimitService } = await import("@/lib/rate-limit");

    // Switch to real timers so the awaited microtasks actually flush.
    vi.useRealTimers();

    const dailyFixed = new Map(
      providerIds.map((id) => [id, { resetTime: "00:00", resetMode: "fixed" as const }])
    );

    const inflightPromise = RateLimitService.getCurrentCostBatch(providerIds, dailyFixed);

    // Let microtasks settle until all earliest-ledger lookups have entered.
    // If the warm loop is serial, only one will ever be in flight at once.
    // If parallel (Promise.all), all N will be in flight before any resolves.
    const deadline = Date.now() + 2000;
    while (earliestDeferreds.length < N && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(earliestDeferreds.length).toBe(N);
    expect(maxInFlightEarliest).toBe(N);

    // Resolve them all and let the batch finish.
    for (const d of earliestDeferreds) d.resolve(null);
    const result = await inflightPromise;

    // sanity: every provider has its 5h cost populated from the batch DB result
    for (const id of providerIds) {
      const expected = ((id - 100 + 1) * 0.5) as number;
      expect(result.get(id)?.cost5h).toBeCloseTo(expected, 10);
    }
  });

  it("one provider's earliest-lookup error does not block warming of the others", async () => {
    const providerIds = [201, 202, 203];
    redisClient.mget.mockResolvedValueOnce(providerIds.map(() => null)); // 5h miss

    statisticsMock.sumProviderCostBatchInTimeRange.mockResolvedValueOnce(
      new Map([
        [201, 1.0],
        [202, 2.0],
        [203, 3.0],
      ])
    );

    const { RateLimitService } = await import("@/lib/rate-limit");

    vi.useRealTimers();
    const dailyFixed = new Map(
      providerIds.map((id) => [id, { resetTime: "00:00", resetMode: "fixed" as const }])
    );

    const inflightPromise = RateLimitService.getCurrentCostBatch(providerIds, dailyFixed);

    // wait for all 3 earliest lookups to be in flight
    const deadline = Date.now() + 2000;
    while (earliestDeferreds.length < 3 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(earliestDeferreds.length).toBe(3);

    // reject the middle one, resolve the others
    earliestDeferreds[0].resolve(null);
    earliestDeferreds[1].reject(new Error("transient PG hiccup"));
    earliestDeferreds[2].resolve(null);

    const result = await inflightPromise;

    // all three got the batch SUM value despite the middle one's boundary lookup failing
    expect(result.get(201)?.cost5h).toBeCloseTo(1.0, 10);
    expect(result.get(202)?.cost5h).toBeCloseTo(2.0, 10);
    expect(result.get(203)?.cost5h).toBeCloseTo(3.0, 10);

    // cache write happened for at least the two non-failing siblings
    const setKeys = setCalls.map((c) => c[0]);
    expect(setKeys).toEqual(
      expect.arrayContaining([
        "cost_cache:provider:201:5h_rolling",
        "cost_cache:provider:203:5h_rolling",
      ])
    );
  });
});
