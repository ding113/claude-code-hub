import { describe, expect, test } from "vitest";
import {
  buildTemporaryKeyCreatePayloads,
  buildTemporaryKeyGroupText,
  resolveNextTemporaryKeySequence,
  resolveTemporaryGroupName,
  validateTemporaryKeyLimitsAgainstUser,
} from "@/lib/keys/temporary-key-groups";
import type { Key } from "@/types/key";

function createKey(overrides: Partial<Key> = {}): Key {
  return {
    id: 1,
    userId: 10,
    name: "base",
    key: "sk-base",
    isEnabled: true,
    expiresAt: new Date("2026-05-01T00:00:00.000Z"),
    canLoginWebUi: true,
    limit5hUsd: 3,
    limitDailyUsd: 6,
    dailyResetMode: "fixed",
    dailyResetTime: "08:00",
    limitWeeklyUsd: 12,
    limitMonthlyUsd: 24,
    limitTotalUsd: 48,
    costResetAt: null,
    limitConcurrentSessions: 2,
    providerGroup: "alpha",
    cacheTtlPreference: "5m",
    temporaryGroupName: null,
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
    updatedAt: new Date("2026-04-10T00:00:00.000Z"),
    deletedAt: undefined,
    ...overrides,
  };
}

describe("temporary key group helpers", () => {
  test("resolves user provider group as the temporary group name", () => {
    expect(resolveTemporaryGroupName("beta, alpha")).toBe("alpha,beta");
    expect(resolveTemporaryGroupName(null)).toBe("default");
  });

  test("continues numbering inside the same temporary group", () => {
    const next = resolveNextTemporaryKeySequence(
      [
        createKey({ name: "001", temporaryGroupName: "vip" }),
        createKey({ name: "tmp-vip-009", temporaryGroupName: "vip" }),
        createKey({ name: "099", temporaryGroupName: "other" }),
      ],
      "vip"
    );

    expect(next).toBe(10);
  });

  test("builds create payloads from the base key without changing provider routing", () => {
    let keyIndex = 0;
    const payloads = buildTemporaryKeyCreatePayloads({
      userId: 10,
      baseKey: createKey({ providerGroup: "beta", temporaryGroupName: null }),
      existingKeys: [createKey({ name: "002", temporaryGroupName: "vip" })],
      groupName: "vip",
      count: 2,
      customLimitTotalUsd: 20,
      createKeyString: () => `sk-created-${++keyIndex}`,
    });

    expect(payloads).toEqual([
      expect.objectContaining({
        user_id: 10,
        name: "003",
        key: "sk-created-1",
        provider_group: "beta",
        temporary_group_name: "vip",
        limit_total_usd: 20,
      }),
      expect.objectContaining({
        name: "004",
        key: "sk-created-2",
        provider_group: "beta",
        temporary_group_name: "vip",
      }),
    ]);
  });

  test("validates temporary key limits against user limits", () => {
    const error = validateTemporaryKeyLimitsAgainstUser(
      { dailyQuota: 5 },
      { limitDailyUsd: 6 },
      (key, values) => `${key}:${values?.keyLimit}/${values?.userLimit}`
    );

    expect(error).toBe("KEY_LIMIT_DAILY_EXCEEDS_USER_LIMIT:6/5");
  });

  test("exports temporary keys as newline text", () => {
    expect(buildTemporaryKeyGroupText([{ key: "sk-a" }, { key: "sk-b" }])).toBe("sk-a\nsk-b");
  });
});
