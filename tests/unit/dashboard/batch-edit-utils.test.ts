import { describe, expect, test } from "vitest";
import { buildSelectedKeysExportText } from "@/app/[locale]/dashboard/_components/user/batch-edit/utils";
import type { UserDisplay } from "@/types/user";

function createUser(overrides: Partial<UserDisplay>): UserDisplay {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? "user-a",
    role: overrides.role ?? "user",
    rpm: overrides.rpm ?? null,
    dailyQuota: overrides.dailyQuota ?? null,
    providerGroup: overrides.providerGroup ?? "default",
    tags: overrides.tags ?? [],
    keys: overrides.keys ?? [],
    limit5hUsd: overrides.limit5hUsd ?? null,
    limitWeeklyUsd: overrides.limitWeeklyUsd ?? null,
    limitMonthlyUsd: overrides.limitMonthlyUsd ?? null,
    limitTotalUsd: overrides.limitTotalUsd ?? null,
    costResetAt: overrides.costResetAt ?? null,
    limitConcurrentSessions: overrides.limitConcurrentSessions ?? null,
    dailyResetMode: overrides.dailyResetMode ?? "fixed",
    dailyResetTime: overrides.dailyResetTime ?? "00:00",
    isEnabled: overrides.isEnabled ?? true,
    expiresAt: overrides.expiresAt ?? null,
    allowedClients: overrides.allowedClients ?? [],
    blockedClients: overrides.blockedClients ?? [],
    allowedModels: overrides.allowedModels ?? [],
  };
}

describe("buildSelectedKeysExportText", () => {
  test("按当前用户和 key 顺序导出选中的 key", () => {
    const users: UserDisplay[] = [
      createUser({
        id: 1,
        name: "用户甲",
        keys: [
          {
            id: 11,
            name: "key-1",
            maskedKey: "sk-***1",
            fullKey: "sk-full-1",
            canCopy: true,
            expiresAt: "永不过期",
            status: "enabled",
            todayUsage: 0,
            todayCallCount: 0,
            todayTokens: 0,
            lastUsedAt: null,
            lastProviderName: null,
            modelStats: [],
            createdAt: new Date("2026-04-20T00:00:01.000Z"),
            createdAtFormatted: "2026-04-20 00:00:01",
            canLoginWebUi: true,
            limit5hUsd: null,
            limitDailyUsd: null,
            dailyResetMode: "fixed",
            dailyResetTime: "00:00",
            limitWeeklyUsd: null,
            limitMonthlyUsd: null,
            limitTotalUsd: null,
            limitConcurrentSessions: 0,
            costResetAt: null,
            providerGroup: "default",
          },
          {
            id: 12,
            name: "key-2",
            maskedKey: "sk-***2",
            fullKey: "sk-full-2",
            canCopy: true,
            expiresAt: "永不过期",
            status: "enabled",
            todayUsage: 0,
            todayCallCount: 0,
            todayTokens: 0,
            lastUsedAt: null,
            lastProviderName: null,
            modelStats: [],
            createdAt: new Date("2026-04-20T00:00:02.000Z"),
            createdAtFormatted: "2026-04-20 00:00:02",
            canLoginWebUi: true,
            limit5hUsd: null,
            limitDailyUsd: null,
            dailyResetMode: "fixed",
            dailyResetTime: "00:00",
            limitWeeklyUsd: null,
            limitMonthlyUsd: null,
            limitTotalUsd: null,
            limitConcurrentSessions: 0,
            costResetAt: null,
            providerGroup: "default",
          },
        ],
      }),
      createUser({
        id: 2,
        name: "用户乙",
        keys: [
          {
            id: 21,
            name: "key-3",
            maskedKey: "sk-***3",
            fullKey: "sk-full-3",
            canCopy: true,
            expiresAt: "永不过期",
            status: "enabled",
            todayUsage: 0,
            todayCallCount: 0,
            todayTokens: 0,
            lastUsedAt: null,
            lastProviderName: null,
            modelStats: [],
            createdAt: new Date("2026-04-20T00:00:03.000Z"),
            createdAtFormatted: "2026-04-20 00:00:03",
            canLoginWebUi: true,
            limit5hUsd: null,
            limitDailyUsd: null,
            dailyResetMode: "fixed",
            dailyResetTime: "00:00",
            limitWeeklyUsd: null,
            limitMonthlyUsd: null,
            limitTotalUsd: null,
            limitConcurrentSessions: 0,
            costResetAt: null,
            providerGroup: "default",
          },
        ],
      }),
    ];

    const text = buildSelectedKeysExportText(users, new Set([12, 21]));

    expect(text).toBe("用户甲\nsk-full-2\n用户乙\nsk-full-3");
  });

  test("遇到缺少完整 key 的选中项时抛错", () => {
    const users: UserDisplay[] = [
      createUser({
        id: 1,
        name: "用户甲",
        keys: [
          {
            id: 11,
            name: "key-1",
            maskedKey: "sk-***1",
            fullKey: undefined,
            canCopy: false,
            expiresAt: "永不过期",
            status: "enabled",
            todayUsage: 0,
            todayCallCount: 0,
            todayTokens: 0,
            lastUsedAt: null,
            lastProviderName: null,
            modelStats: [],
            createdAt: new Date("2026-04-20T00:00:01.000Z"),
            createdAtFormatted: "2026-04-20 00:00:01",
            canLoginWebUi: true,
            limit5hUsd: null,
            limitDailyUsd: null,
            dailyResetMode: "fixed",
            dailyResetTime: "00:00",
            limitWeeklyUsd: null,
            limitMonthlyUsd: null,
            limitTotalUsd: null,
            limitConcurrentSessions: 0,
            costResetAt: null,
            providerGroup: "default",
          },
        ],
      }),
    ];

    expect(() => buildSelectedKeysExportText(users, new Set([11]))).toThrow("missing-full-key");
  });
});
