import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import type { Key } from "@/types/key";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

const getTranslationsMock = vi.fn(async () => (key: string) => key);
vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
}));

const countActiveKeysByUserMock = vi.fn();
const createKeysBatchMock = vi.fn();
const deleteKeysBatchMock = vi.fn();
const findKeyByIdMock = vi.fn();
const findKeyListMock = vi.fn();

vi.mock("@/repository/key", () => ({
  countActiveKeysByUser: countActiveKeysByUserMock,
  createKeysBatch: createKeysBatchMock,
  createKey: vi.fn(async () => ({})),
  deleteKeysBatch: deleteKeysBatchMock,
  deleteKey: vi.fn(async () => true),
  findActiveKeyByUserIdAndName: vi.fn(async () => null),
  findKeyById: findKeyByIdMock,
  findKeyList: findKeyListMock,
  findKeysWithStatistics: vi.fn(async () => []),
  resetKeyCostResetAt: vi.fn(async () => true),
  updateKey: vi.fn(async () => ({})),
}));

const findUserByIdMock = vi.fn();
vi.mock("@/repository/user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/user")>();
  return {
    ...actual,
    findUserById: findUserByIdMock,
  };
});

const syncUserProviderGroupFromKeysMock = vi.fn(async () => undefined);
vi.mock("@/actions/users", () => ({
  syncUserProviderGroupFromKeys: syncUserProviderGroupFromKeysMock,
}));

let createTemporaryKeysBatch: typeof import("@/actions/keys").createTemporaryKeysBatch;
let downloadTemporaryKeyGroup: typeof import("@/actions/keys").downloadTemporaryKeyGroup;
let removeTemporaryKeyGroup: typeof import("@/actions/keys").removeTemporaryKeyGroup;

type TestKeyRecord = Omit<Key, "expiresAt" | "deletedAt"> & {
  expiresAt: Date | null;
  deletedAt: Date | null;
};

function createAdminSession() {
  return { user: { id: 1, role: "admin" } };
}

function createUserRecord(
  overrides: Partial<{
    providerGroup: string;
  }> = {}
) {
  return {
    id: 10,
    name: "test-user",
    description: "",
    role: "user" as const,
    rpm: null,
    dailyQuota: 20,
    providerGroup: "default",
    tags: [],
    limit5hUsd: 10,
    dailyResetMode: "fixed" as const,
    dailyResetTime: "00:00",
    limitWeeklyUsd: 30,
    limitMonthlyUsd: 50,
    limitTotalUsd: 100,
    limitConcurrentSessions: 3,
    isEnabled: true,
    expiresAt: null,
    allowedClients: [],
    allowedModels: [],
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function createBaseKey(): TestKeyRecord {
  return {
    id: 100,
    userId: 10,
    key: "sk-base",
    name: "base-key",
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
    providerGroup: "default",
    cacheTtlPreference: "5m",
    temporaryGroupName: null,
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
    updatedAt: new Date("2026-04-10T00:00:00.000Z"),
    deletedAt: null,
  };
}

function createKeyRecord(
  overrides: Partial<TestKeyRecord> = {}
): TestKeyRecord {
  return {
    ...createBaseKey(),
    ...overrides,
  };
}

describe("temporary key actions", () => {
  beforeAll(async () => {
    const actions = await import("@/actions/keys");
    createTemporaryKeysBatch = actions.createTemporaryKeysBatch;
    downloadTemporaryKeyGroup = actions.downloadTemporaryKeyGroup;
    removeTemporaryKeyGroup = actions.removeTemporaryKeyGroup;
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue(createAdminSession());
    findUserByIdMock.mockResolvedValue(createUserRecord());
    findKeyByIdMock.mockResolvedValue(createBaseKey());
    findKeyListMock.mockResolvedValue([]);
    countActiveKeysByUserMock.mockResolvedValue(2);
    deleteKeysBatchMock.mockResolvedValue(0);
    createKeysBatchMock.mockImplementation(async (payload: Array<Record<string, unknown>>) =>
      payload.map((entry, index) =>
        createKeyRecord({
          id: 200 + index,
          userId: entry.user_id as number,
          name: entry.name as string,
          key: entry.key as string,
          isEnabled: entry.is_enabled as boolean,
          expiresAt: (entry.expires_at as Date | null | undefined) ?? null,
          canLoginWebUi: (entry.can_login_web_ui as boolean | undefined) ?? true,
          limit5hUsd: (entry.limit_5h_usd as number | null | undefined) ?? null,
          limitDailyUsd: (entry.limit_daily_usd as number | null | undefined) ?? null,
          dailyResetMode: (entry.daily_reset_mode as "fixed" | "rolling" | undefined) ?? "fixed",
          dailyResetTime: (entry.daily_reset_time as string | undefined) ?? "00:00",
          limitWeeklyUsd: (entry.limit_weekly_usd as number | null | undefined) ?? null,
          limitMonthlyUsd: (entry.limit_monthly_usd as number | null | undefined) ?? null,
          limitTotalUsd: (entry.limit_total_usd as number | null | undefined) ?? null,
          limitConcurrentSessions: (entry.limit_concurrent_sessions as number | undefined) ?? 0,
          providerGroup: (entry.provider_group as string | null | undefined) ?? null,
          cacheTtlPreference:
            (entry.cache_ttl_preference as "inherit" | "5m" | "1h" | null | undefined) ?? null,
          temporaryGroupName: (entry.temporary_group_name as string | null | undefined) ?? null,
          createdAt: new Date(`2026-04-17T00:00:${String(index).padStart(2, "0")}.000Z`),
          updatedAt: new Date(`2026-04-17T00:00:${String(index).padStart(2, "0")}.000Z`),
        })
      )
    );
  });

  test("管理员可批量创建临时 key，并继承基础 key 配置", async () => {
    findUserByIdMock.mockResolvedValueOnce(createUserRecord({ providerGroup: "vip" }));

    const result = await createTemporaryKeysBatch({
      userId: 10,
      baseKeyId: 100,
      groupName: "vip",
      count: 2,
      customLimitTotalUsd: 20,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.groupName).toBe("vip");
      expect(result.data.createdCount).toBe(2);
      expect(result.data.sourceKeyName).toBe("base-key");
      expect(result.data.keys).toHaveLength(2);
    }

    expect(createKeysBatchMock).toHaveBeenCalledTimes(1);
    const payload = createKeysBatchMock.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({
      user_id: 10,
      is_enabled: true,
      can_login_web_ui: true,
      limit_5h_usd: 3,
      limit_daily_usd: 6,
      limit_weekly_usd: 12,
      limit_monthly_usd: 24,
      limit_total_usd: 20,
      limit_concurrent_sessions: 2,
      provider_group: "default",
      cache_ttl_preference: "5m",
      temporary_group_name: "vip",
    });
    expect(String(payload[0]?.name)).toBe("001");
    expect(String(payload[1]?.name)).toBe("002");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  test("管理员批量创建临时 key 时应使用传入分组名，但继承基础 key 的 provider 逻辑", async () => {
    findUserByIdMock.mockResolvedValueOnce(createUserRecord({ providerGroup: "beta,alpha" }));
    findKeyByIdMock.mockResolvedValueOnce(
      createKeyRecord({
        providerGroup: "alpha",
      })
    );

    const result = await createTemporaryKeysBatch({
      userId: 10,
      baseKeyId: 100,
      groupName: "alpha,beta",
      count: 1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.groupName).toBe("alpha,beta");
    }

    const payload = createKeysBatchMock.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(payload[0]).toMatchObject({
      provider_group: "alpha",
      temporary_group_name: "alpha,beta",
    });
    expect(String(payload[0]?.name)).toBe("001");
  });

  test("管理员批量创建临时 key 时应沿用同组已有的数字编号继续递增", async () => {
    findUserByIdMock.mockResolvedValueOnce(createUserRecord({ providerGroup: "vip" }));
    findKeyListMock.mockResolvedValueOnce([
      createKeyRecord({
        id: 201,
        name: "001",
        temporaryGroupName: "vip",
      }),
      createKeyRecord({
        id: 202,
        name: "tmp-vip-abc-002",
        temporaryGroupName: "vip",
      }),
      createKeyRecord({
        id: 203,
        name: "other-group-key",
        temporaryGroupName: "其他组",
      }),
    ]);

    const result = await createTemporaryKeysBatch({
      userId: 10,
      baseKeyId: 100,
      groupName: "vip",
      count: 2,
    });

    expect(result.ok).toBe(true);

    const payload = createKeysBatchMock.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(String(payload[0]?.name)).toBe("003");
    expect(String(payload[1]?.name)).toBe("004");
  });

  test("管理员批量创建临时 key 时应跳过普通 key 已占用的数字名称", async () => {
    findUserByIdMock.mockResolvedValueOnce(createUserRecord({ providerGroup: "vip" }));
    findKeyListMock.mockResolvedValueOnce([
      createKeyRecord({
        id: 211,
        name: "001",
        temporaryGroupName: null,
      }),
      createKeyRecord({
        id: 212,
        name: "002",
        temporaryGroupName: "vip",
      }),
    ]);

    const result = await createTemporaryKeysBatch({
      userId: 10,
      baseKeyId: 100,
      groupName: "vip",
      count: 2,
    });

    expect(result.ok).toBe(true);
    const payload = createKeysBatchMock.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(String(payload[0]?.name)).toBe("003");
    expect(String(payload[1]?.name)).toBe("004");
  });

  test("管理员不可使用临时 key 作为模板继续派生", async () => {
    findKeyByIdMock.mockResolvedValueOnce(
      createKeyRecord({
        temporaryGroupName: "vip",
      })
    );

    const result = await createTemporaryKeysBatch({
      userId: 10,
      baseKeyId: 100,
      groupName: "vip",
      count: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(ERROR_CODES.NOT_FOUND);
      expect(result.error).toBe("KEY_NOT_FOUND");
    }
    expect(createKeysBatchMock).not.toHaveBeenCalled();
  });

  test("非管理员不可批量创建临时 key", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 2, role: "user" } });

    const result = await createTemporaryKeysBatch({
      userId: 10,
      baseKeyId: 100,
      groupName: "vip",
      count: 2,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(ERROR_CODES.PERMISSION_DENIED);
    }
    expect(createKeysBatchMock).not.toHaveBeenCalled();
  });

  test("管理员批量创建临时 key 时应拒绝无效的自定义总额度", async () => {
    const result = await createTemporaryKeysBatch({
      userId: 10,
      baseKeyId: 100,
      groupName: "vip",
      count: 2,
      customLimitTotalUsd: Number.NaN,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(ERROR_CODES.INVALID_FORMAT);
      expect(result.error).toBe("TEMPORARY_KEY_INVALID_TOTAL_LIMIT");
    }
    expect(createKeysBatchMock).not.toHaveBeenCalled();
  });

  test("删除临时分组时，如果会删掉最后一个启用 key，应拒绝", async () => {
    findKeyListMock.mockResolvedValueOnce([
      createKeyRecord({
        id: 301,
        name: "tmp-1",
        key: "sk-tmp-1",
        temporaryGroupName: "活动组 A",
        isEnabled: true,
      }),
    ]);
    countActiveKeysByUserMock.mockResolvedValueOnce(1);

    const result = await removeTemporaryKeyGroup({
      userId: 10,
      groupName: "活动组 A",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(ERROR_CODES.OPERATION_FAILED);
    }
    expect(deleteKeysBatchMock).not.toHaveBeenCalled();
  });

  test("删除临时分组时应批量删除整个分组并同步用户原始分组逻辑", async () => {
    findKeyListMock.mockResolvedValueOnce([
      createKeyRecord({
        id: 401,
        name: "tmp-1",
        key: "sk-tmp-1",
        temporaryGroupName: "活动组 A",
        isEnabled: true,
      }),
      createKeyRecord({
        id: 402,
        name: "tmp-2",
        key: "sk-tmp-2",
        temporaryGroupName: "活动组 A",
        isEnabled: false,
      }),
      createKeyRecord({
        id: 403,
        name: "normal-1",
        key: "sk-normal-1",
        temporaryGroupName: null,
        isEnabled: true,
      }),
    ]);
    countActiveKeysByUserMock.mockResolvedValueOnce(2);
    deleteKeysBatchMock.mockResolvedValueOnce(2);

    const result = await removeTemporaryKeyGroup({
      userId: 10,
      groupName: "活动组 A",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        deletedCount: 2,
        groupName: "活动组 A",
      });
    }
    expect(deleteKeysBatchMock).toHaveBeenCalledWith([401, 402]);
    expect(syncUserProviderGroupFromKeysMock).toHaveBeenCalledWith(10);
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  test("下载临时分组时应返回按创建时间排序的纯 key 文本", async () => {
    findKeyListMock.mockResolvedValueOnce([
      createKeyRecord({
        id: 502,
        name: "tmp-2",
        key: "sk-tmp-2",
        temporaryGroupName: "活动组 A",
        isEnabled: false,
        createdAt: new Date("2026-04-17T00:00:02.000Z"),
      }),
      createKeyRecord({
        id: 501,
        name: "tmp-1",
        key: "sk-tmp-1",
        temporaryGroupName: "活动组 A",
        isEnabled: true,
        createdAt: new Date("2026-04-17T00:00:01.000Z"),
      }),
    ]);

    const result = await downloadTemporaryKeyGroup({
      userId: 10,
      groupName: "活动组 A",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("sk-tmp-1\nsk-tmp-2");
    }
  });
});
