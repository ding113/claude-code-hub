import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRedisClient } from "@/lib/redis/client";
import type { CacheHitRateAlertData, CacheHitRateAlertSample } from "@/lib/webhook";
import {
  applyCacheHitRateAlertCooldownToPayload,
  buildCacheHitRateAlertCooldownKey,
} from "@/lib/notification/tasks/cache-hit-rate-alert";

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: vi.fn(),
}));

type RedisMock = {
  mget: ReturnType<typeof vi.fn>;
};

function createRedisMock(): RedisMock {
  return {
    mget: vi.fn(),
  };
}

function sample(hitRateTokens: number): CacheHitRateAlertSample {
  return {
    kind: "eligible",
    requests: 10,
    denominatorTokens: 1000,
    hitRateTokens,
  };
}

function payload(anomalies: CacheHitRateAlertData["anomalies"]): CacheHitRateAlertData {
  return {
    window: {
      mode: "5m",
      startTime: "2026-02-25T00:00:00.000Z",
      endTime: "2026-02-25T00:05:00.000Z",
      durationMinutes: 5,
    },
    anomalies,
    suppressedCount: 0,
    settings: {
      windowMode: "5m",
      checkIntervalMinutes: 5,
      historicalLookbackDays: 7,
      minEligibleRequests: 20,
      minEligibleTokens: 0,
      absMin: 0.05,
      dropRel: 0.3,
      dropAbs: 0.1,
      cooldownMinutes: 30,
      topN: 10,
    },
    generatedAt: "2026-02-25T00:05:00.000Z",
  };
}

describe("cache-hit-rate-alert cooldown dedup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds binding-scoped keys when bindingId is provided", () => {
    const globalKey = buildCacheHitRateAlertCooldownKey({
      providerId: 1,
      model: "m",
      windowMode: "5m",
    });
    const bindingKey = buildCacheHitRateAlertCooldownKey({
      providerId: 1,
      model: "m",
      windowMode: "5m",
      bindingId: 42,
    });

    expect(globalKey.split(":")).toHaveLength(5);
    expect(bindingKey.split(":").slice(0, 4)).toEqual([
      "cache-hit-rate-alert",
      "v1",
      "binding",
      "42",
    ]);
    expect(bindingKey).not.toEqual(globalKey);
  });

  it("filters suppressed anomalies per binding", async () => {
    const redis = createRedisMock();
    redis.mget.mockResolvedValueOnce(["1", null]);
    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );

    const input = payload([
      {
        providerId: 1,
        model: "m1",
        baselineSource: "prev",
        current: sample(0.5),
        baseline: sample(0.8),
        deltaAbs: -0.3,
        deltaRel: -0.375,
        dropAbs: 0.3,
        reasonCodes: ["drop_abs_rel"],
      },
      {
        providerId: 2,
        model: "m2",
        baselineSource: "prev",
        current: sample(0.5),
        baseline: sample(0.8),
        deltaAbs: -0.3,
        deltaRel: -0.375,
        dropAbs: 0.3,
        reasonCodes: ["drop_abs_rel"],
      },
    ]);

    const result = await applyCacheHitRateAlertCooldownToPayload({ payload: input, bindingId: 7 });

    expect(redis.mget).toHaveBeenCalledTimes(1);
    const passedKeys = redis.mget.mock.calls[0];
    expect(passedKeys).toHaveLength(2);
    expect(passedKeys[0]).toContain(":binding:7:");
    expect(passedKeys[1]).toContain(":binding:7:");

    expect(result.suppressedCount).toBe(1);
    expect(result.payload.suppressedCount).toBe(1);
    expect(result.payload.anomalies).toHaveLength(1);
    expect(result.payload.anomalies[0].providerId).toBe(2);

    expect(result.dedupKeysToSet).toHaveLength(1);
    expect(result.dedupKeysToSet[0]).toBe(passedKeys[1]);
  });

  it("returns all anomalies when cooldownMinutes=0 (no Redis)", async () => {
    const input = {
      ...payload([
        {
          providerId: 1,
          model: "m1",
          baselineSource: "prev",
          current: sample(0.5),
          baseline: sample(0.8),
          deltaAbs: -0.3,
          deltaRel: -0.375,
          dropAbs: 0.3,
          reasonCodes: ["drop_abs_rel"],
        },
      ]),
      settings: {
        ...payload([]).settings,
        cooldownMinutes: 0,
      },
    };

    const result = await applyCacheHitRateAlertCooldownToPayload({ payload: input, bindingId: 7 });

    expect(getRedisClient).not.toHaveBeenCalled();
    expect(result.suppressedCount).toBe(0);
    expect(result.payload.anomalies).toHaveLength(1);
    expect(result.dedupKeysToSet).toHaveLength(0);
  });

  it("returns all anomalies when Redis is unavailable (null client)", async () => {
    vi.mocked(getRedisClient).mockReturnValue(null);

    const input = payload([
      {
        providerId: 1,
        model: "m1",
        baselineSource: "prev",
        current: sample(0.5),
        baseline: sample(0.8),
        deltaAbs: -0.3,
        deltaRel: -0.375,
        dropAbs: 0.3,
        reasonCodes: ["drop_abs_rel"],
      },
    ]);

    const result = await applyCacheHitRateAlertCooldownToPayload({ payload: input, bindingId: 7 });

    expect(getRedisClient).toHaveBeenCalledTimes(1);
    expect(result.suppressedCount).toBe(0);
    expect(result.payload.anomalies).toHaveLength(1);
    expect(result.dedupKeysToSet).toHaveLength(1);
    expect(result.dedupKeysToSet[0]).toContain(":binding:7:");
  });

  it("handles empty anomalies list", async () => {
    const input = payload([]);

    const result = await applyCacheHitRateAlertCooldownToPayload({ payload: input, bindingId: 7 });

    expect(getRedisClient).not.toHaveBeenCalled();
    expect(result.suppressedCount).toBe(0);
    expect(result.payload.anomalies).toHaveLength(0);
    expect(result.dedupKeysToSet).toHaveLength(0);
  });

  it("suppresses all anomalies when Redis reports all keys present", async () => {
    const redis = createRedisMock();
    redis.mget.mockResolvedValueOnce(["1", "1"]);
    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );

    const input = payload([
      {
        providerId: 1,
        model: "m1",
        baselineSource: "prev",
        current: sample(0.5),
        baseline: sample(0.8),
        deltaAbs: -0.3,
        deltaRel: -0.375,
        dropAbs: 0.3,
        reasonCodes: ["drop_abs_rel"],
      },
      {
        providerId: 2,
        model: "m2",
        baselineSource: "prev",
        current: sample(0.5),
        baseline: sample(0.8),
        deltaAbs: -0.3,
        deltaRel: -0.375,
        dropAbs: 0.3,
        reasonCodes: ["drop_abs_rel"],
      },
    ]);

    const result = await applyCacheHitRateAlertCooldownToPayload({ payload: input, bindingId: 7 });

    expect(redis.mget).toHaveBeenCalledTimes(1);
    const passedKeys = redis.mget.mock.calls[0];
    expect(passedKeys).toHaveLength(2);
    expect(passedKeys[0]).toContain(":binding:7:");
    expect(passedKeys[1]).toContain(":binding:7:");

    expect(result.suppressedCount).toBe(2);
    expect(result.payload.suppressedCount).toBe(2);
    expect(result.payload.anomalies).toHaveLength(0);
    expect(result.dedupKeysToSet).toHaveLength(0);
  });
});
