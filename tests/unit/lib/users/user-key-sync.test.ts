import { describe, expect, test } from "vitest";
import { buildFirstSyncedKeyConfig, buildSyncedKeyConfigs } from "@/lib/users/user-key-sync";

describe("user key sync allocation", () => {
  test("single key gets the same user limits", () => {
    const firstKey = buildFirstSyncedKeyConfig({
      dailyQuota: 100,
      limit5hUsd: 10,
      limitWeeklyUsd: 200,
      limitMonthlyUsd: 500,
      limitTotalUsd: 1000,
      limitConcurrentSessions: 3,
      providerGroup: "fast",
      limit5hResetMode: "fixed",
      dailyResetMode: "rolling",
      dailyResetTime: "18:30",
    });

    expect(firstKey).toEqual({
      limit5hUsd: 10,
      limitDailyUsd: 100,
      limitWeeklyUsd: 200,
      limitMonthlyUsd: 500,
      limitTotalUsd: 1000,
      limitConcurrentSessions: 3,
      providerGroup: "fast",
      limit5hResetMode: "fixed",
      dailyResetMode: "rolling",
      dailyResetTime: "18:30",
    });
  });

  test("amount limits are averaged by cents and discard remainder", () => {
    const { configs, summary } = buildSyncedKeyConfigs({ dailyQuota: 100 }, 3);

    expect(configs.map((config) => config.limitDailyUsd)).toEqual([33.33, 33.33, 33.33]);
    expect(summary.limitDailyUsd.discarded).toBe(0.01);
  });

  test("small amount limits assign cents to early keys and null to the rest", () => {
    const { configs } = buildSyncedKeyConfigs({ dailyQuota: 0.02 }, 3);

    expect(configs.map((config) => config.limitDailyUsd)).toEqual([0.01, 0.01, null]);
  });

  test("small concurrent limits assign one session to early keys and zero to the rest", () => {
    const { configs } = buildSyncedKeyConfigs({ limitConcurrentSessions: 2 }, 3);

    expect(configs.map((config) => config.limitConcurrentSessions)).toEqual([1, 1, 0]);
  });

  test("null and non-positive values clear key limits", () => {
    const { configs } = buildSyncedKeyConfigs(
      {
        dailyQuota: null,
        limit5hUsd: 0,
        limitWeeklyUsd: -1,
        limitConcurrentSessions: 0,
      },
      2
    );

    expect(configs.map((config) => config.limitDailyUsd)).toEqual([null, null]);
    expect(configs.map((config) => config.limit5hUsd)).toEqual([null, null]);
    expect(configs.map((config) => config.limitWeeklyUsd)).toEqual([null, null]);
    expect(configs.map((config) => config.limitConcurrentSessions)).toEqual([0, 0]);
  });
});
