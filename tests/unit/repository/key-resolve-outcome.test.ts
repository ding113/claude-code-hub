/**
 * Regression coverage for `resolveApiKeyAuthOutcome`: the discriminated union
 * lookup must distinguish "key never existed" from "key exists but
 * disabled/expired" so the proxy auth guard can return precise errors and
 * skip the brute-force rate limiter for legitimate-but-rejected lookups.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const whereMock = vi.fn();
const innerJoinMock = vi.fn(() => ({ where: whereMock }));
const fromMock = vi.fn(() => ({ innerJoin: innerJoinMock }));
const selectMock = vi.fn(() => ({ from: fromMock }));

vi.mock("@/drizzle/db", () => ({
  db: { select: selectMock },
}));

vi.mock("@/drizzle/schema", () => ({
  keys: {
    id: "keys.id",
    userId: "keys.userId",
    key: "keys.key",
    name: "keys.name",
    isEnabled: "keys.isEnabled",
    expiresAt: "keys.expiresAt",
    canLoginWebUi: "keys.canLoginWebUi",
    limit5hUsd: "keys.limit5hUsd",
    limitDailyUsd: "keys.limitDailyUsd",
    dailyResetMode: "keys.dailyResetMode",
    dailyResetTime: "keys.dailyResetTime",
    limitWeeklyUsd: "keys.limitWeeklyUsd",
    limitMonthlyUsd: "keys.limitMonthlyUsd",
    limitTotalUsd: "keys.limitTotalUsd",
    limitConcurrentSessions: "keys.limitConcurrentSessions",
    providerGroup: "keys.providerGroup",
    cacheTtlPreference: "keys.cacheTtlPreference",
    createdAt: "keys.createdAt",
    updatedAt: "keys.updatedAt",
    deletedAt: "keys.deletedAt",
  },
  users: {
    id: "users.id",
    name: "users.name",
    description: "users.description",
    role: "users.role",
    rpmLimit: "users.rpmLimit",
    dailyLimitUsd: "users.dailyLimitUsd",
    providerGroup: "users.providerGroup",
    tags: "users.tags",
    limit5hUsd: "users.limit5hUsd",
    limit5hResetMode: "users.limit5hResetMode",
    limitWeeklyUsd: "users.limitWeeklyUsd",
    limitMonthlyUsd: "users.limitMonthlyUsd",
    limitTotalUsd: "users.limitTotalUsd",
    costResetAt: "users.costResetAt",
    limit5hCostResetAt: "users.limit5hCostResetAt",
    limitConcurrentSessions: "users.limitConcurrentSessions",
    dailyResetMode: "users.dailyResetMode",
    dailyResetTime: "users.dailyResetTime",
    isEnabled: "users.isEnabled",
    expiresAt: "users.expiresAt",
    allowedClients: "users.allowedClients",
    allowedModels: "users.allowedModels",
    createdAt: "users.createdAt",
    updatedAt: "users.updatedAt",
    deletedAt: "users.deletedAt",
  },
  messageRequest: {
    blockedBy: "messageRequest.blockedBy",
  },
  usageLedger: {
    blockedBy: "usageLedger.blockedBy",
    endpoint: "usageLedger.endpoint",
  },
  providers: {
    id: "providers.id",
  },
}));

vi.mock("drizzle-orm", () => {
  const sqlMock = (...args: unknown[]) => args;
  sqlMock.join = (...args: unknown[]) => args;
  return {
    and: (...args: unknown[]) => args,
    or: (...args: unknown[]) => args,
    eq: (...args: unknown[]) => args,
    gt: (...args: unknown[]) => args,
    gte: (...args: unknown[]) => args,
    lt: (...args: unknown[]) => args,
    isNull: (...args: unknown[]) => args,
    count: (...args: unknown[]) => args,
    desc: (...args: unknown[]) => args,
    inArray: (...args: unknown[]) => args,
    sql: sqlMock,
    sum: (...args: unknown[]) => args,
  };
});

vi.mock("@/lib/security/api-key-auth-cache", () => ({
  getCachedActiveKey: vi.fn().mockResolvedValue(null),
  getCachedUser: vi.fn().mockResolvedValue(null),
  cacheActiveKey: vi.fn().mockResolvedValue(undefined),
  cacheAuthResult: vi.fn().mockResolvedValue(undefined),
  cacheUser: vi.fn().mockResolvedValue(undefined),
  invalidateCachedKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/security/api-key-vacuum-filter", () => ({
  apiKeyVacuumFilter: {
    isDefinitelyNotPresent: vi.fn().mockReturnValue(undefined),
    noteExistingKey: vi.fn(),
  },
}));

vi.mock("@/lib/redis/pubsub", () => ({
  CHANNEL_API_KEYS_UPDATED: "channel",
  publishCacheInvalidation: vi.fn(),
}));

function activeRow(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    keyId: 1,
    keyUserId: 2,
    keyString: "sk-test",
    keyName: "k1",
    keyIsEnabled: true,
    keyExpiresAt: null,
    keyCanLoginWebUi: true,
    keyLimit5hUsd: null,
    keyLimit5hResetMode: "rolling",
    keyLimitDailyUsd: null,
    keyDailyResetMode: "fixed",
    keyDailyResetTime: "00:00",
    keyLimitWeeklyUsd: null,
    keyLimitMonthlyUsd: null,
    keyLimitTotalUsd: null,
    keyCostResetAt: null,
    keyLimitConcurrentSessions: 0,
    keyProviderGroup: null,
    keyCacheTtlPreference: null,
    keyCreatedAt: new Date("2024-01-01T00:00:00.000Z"),
    keyUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
    keyDeletedAt: null,
    userId: 2,
    userName: "u1",
    userDescription: "",
    userRole: "user",
    userRpm: null,
    userDailyQuota: null,
    userProviderGroup: null,
    userTags: [],
    userLimit5hUsd: null,
    userLimit5hResetMode: "rolling",
    userLimitWeeklyUsd: null,
    userLimitMonthlyUsd: null,
    userLimitTotalUsd: null,
    userCostResetAt: null,
    userLimit5hCostResetAt: null,
    userLimitConcurrentSessions: 0,
    userDailyResetMode: "rolling",
    userDailyResetTime: "00:00",
    userIsEnabled: true,
    userExpiresAt: null,
    userAllowedClients: [],
    userAllowedModels: [],
    userCreatedAt: new Date("2024-01-01T00:00:00.000Z"),
    userUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
    userDeletedAt: null,
  };
  return { ...base, ...overrides };
}

describe("repository/key resolveApiKeyAuthOutcome", () => {
  beforeEach(async () => {
    selectMock.mockClear();
    fromMock.mockClear();
    innerJoinMock.mockClear();
    whereMock.mockReset();

    // vitest config sets `mockReset: true` globally, which strips the
    // mockResolvedValue implementation off the hoisted cache mocks between
    // tests. Re-apply it here so success-path tests don't trip on
    // `cacheAuthResult(...).catch(...)` when the returned promise is gone.
    const cache = await import("@/lib/security/api-key-auth-cache");
    vi.mocked(cache.getCachedActiveKey).mockResolvedValue(null);
    vi.mocked(cache.getCachedUser).mockResolvedValue(null);
    vi.mocked(cache.cacheActiveKey).mockResolvedValue(undefined);
    vi.mocked(cache.cacheAuthResult).mockResolvedValue(undefined);
    vi.mocked(cache.cacheUser).mockResolvedValue(undefined);
    vi.mocked(cache.invalidateCachedKey).mockResolvedValue(undefined);
  });

  it("returns ok=true with hydrated user/key when the row is fully active", async () => {
    whereMock.mockResolvedValueOnce([activeRow()]);

    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    const outcome = await resolveApiKeyAuthOutcome("sk-test");

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.user.id).toBe(2);
      expect(outcome.key.id).toBe(1);
    }
  });

  // Regression (group-rate-limit): the cold-path key+user JOIN must select and
  // hydrate `users.tags`. When tags are dropped, the cached/authenticated user
  // carries `[]`, and tag-derived user_group model limits never resolve, so the
  // model-rate-limit guard silently skips enforcement.
  it("cold path (JOIN) hydrates user.tags from the row", async () => {
    whereMock.mockResolvedValueOnce([activeRow({ userTags: ["team-a", "vip"] })]);

    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    const outcome = await resolveApiKeyAuthOutcome("sk-tagged");

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.user.tags).toEqual(["team-a", "vip"]);
    }
  });

  it("cold path defaults user.tags to [] when the row has no tags", async () => {
    whereMock.mockResolvedValueOnce([activeRow({ userTags: null })]);

    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    const outcome = await resolveApiKeyAuthOutcome("sk-untagged");

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.user.tags).toEqual([]);
    }
  });

  it("cached path returns the cached user with its tags intact", async () => {
    const cache = await import("@/lib/security/api-key-auth-cache");
    vi.mocked(cache.getCachedActiveKey).mockResolvedValue({ id: 7, userId: 9 } as never);
    vi.mocked(cache.getCachedUser).mockResolvedValue({ id: 9, tags: ["team-b"] } as never);

    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    const outcome = await resolveApiKeyAuthOutcome("sk-cached");

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.user.tags).toEqual(["team-b"]);
      expect(outcome.key.id).toBe(7);
    }
    // Cached hit must short-circuit before the DB JOIN.
    expect(whereMock).not.toHaveBeenCalled();
  });

  it("returns not_found when the row does not exist", async () => {
    whereMock.mockResolvedValueOnce([]);

    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    const outcome = await resolveApiKeyAuthOutcome("sk-missing");

    expect(outcome).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns key_disabled when the row exists but isEnabled=false", async () => {
    whereMock.mockResolvedValueOnce([activeRow({ keyIsEnabled: false })]);

    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    const outcome = await resolveApiKeyAuthOutcome("sk-disabled");

    expect(outcome).toEqual({ ok: false, reason: "key_disabled" });
  });

  it("returns key_expired when expiresAt is in the past", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    whereMock.mockResolvedValueOnce([activeRow({ keyExpiresAt: yesterday })]);

    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    const outcome = await resolveApiKeyAuthOutcome("sk-expired");

    expect(outcome).toEqual({ ok: false, reason: "key_expired" });
  });

  it("prefers key_disabled over key_expired when both are true", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    whereMock.mockResolvedValueOnce([activeRow({ keyIsEnabled: false, keyExpiresAt: yesterday })]);

    const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
    const outcome = await resolveApiKeyAuthOutcome("sk-both");

    expect(outcome).toEqual({ ok: false, reason: "key_disabled" });
  });

  it("back-compat wrapper validateApiKeyAndGetUser returns null on any failure", async () => {
    whereMock.mockResolvedValueOnce([activeRow({ keyIsEnabled: false })]);

    const { validateApiKeyAndGetUser } = await import("@/repository/key");
    const result = await validateApiKeyAndGetUser("sk-disabled");

    expect(result).toBeNull();
  });

  // `keys.key` has no unique constraint, so multiple non-deleted rows may
  // share a key string. The classifier MUST prefer an active row to avoid
  // mis-rejecting a valid credential as disabled/expired.
  describe("deterministic classification across duplicate rows", () => {
    it("returns ok=true when at least one duplicate row is active", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      whereMock.mockResolvedValueOnce([
        // A disabled duplicate sorted before an active one — pre-fix this
        // would have returned key_disabled and locked the owner out.
        activeRow({ keyId: 10, keyIsEnabled: false }),
        activeRow({ keyId: 11, keyIsEnabled: true, keyExpiresAt: null }),
        activeRow({ keyId: 12, keyIsEnabled: true, keyExpiresAt: yesterday }),
      ]);

      const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
      const outcome = await resolveApiKeyAuthOutcome("sk-dup-mixed");

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.key.id).toBe(11);
      }
    });

    it("returns key_expired when no row is active but at least one is enabled", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      whereMock.mockResolvedValueOnce([
        activeRow({ keyId: 20, keyIsEnabled: false }),
        activeRow({ keyId: 21, keyIsEnabled: true, keyExpiresAt: yesterday }),
      ]);

      const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
      const outcome = await resolveApiKeyAuthOutcome("sk-dup-expired");

      expect(outcome).toEqual({ ok: false, reason: "key_expired" });
    });

    it("returns key_disabled when every duplicate row is disabled", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      whereMock.mockResolvedValueOnce([
        activeRow({ keyId: 30, keyIsEnabled: false }),
        activeRow({ keyId: 31, keyIsEnabled: false, keyExpiresAt: yesterday }),
      ]);

      const { resolveApiKeyAuthOutcome } = await import("@/repository/key");
      const outcome = await resolveApiKeyAuthOutcome("sk-dup-disabled");

      expect(outcome).toEqual({ ok: false, reason: "key_disabled" });
    });
  });
});
