import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const getTranslationsMock = vi.fn(async () => (key: string) => key);
vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
}));

const createKeyMock = vi.fn(async () => ({}));
const findActiveKeyByUserIdAndNameMock = vi.fn(async () => null);
const findKeyByIdMock = vi.fn();
const findKeyListMock = vi.fn(async () => []);
const updateKeyMock = vi.fn(async () => ({}));

vi.mock("@/repository/key", () => ({
  countActiveKeysByUser: vi.fn(async () => 1),
  createKey: createKeyMock,
  deleteKey: vi.fn(async () => true),
  findActiveKeyByUserIdAndName: findActiveKeyByUserIdAndNameMock,
  findKeyById: findKeyByIdMock,
  findKeyList: findKeyListMock,
  findKeysWithStatistics: vi.fn(async () => []),
  updateKey: updateKeyMock,
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

describe("keys limit validation", () => {
  let baseUser: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    baseUser = {
      id: 10,
      name: "u",
      description: "",
      role: "user",
      rpm: null,
      dailyQuota: null,
      providerGroup: "default",
      tags: [],
      limit5hUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limitConcurrentSessions: 2,
      isEnabled: true,
      expiresAt: null,
      allowedClients: [],
      allowedModels: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    findUserByIdMock.mockResolvedValue(baseUser);

    findKeyByIdMock.mockResolvedValue({
      id: 1,
      userId: 10,
      key: "sk-test",
      name: "k",
      isEnabled: true,
      expiresAt: null,
      canLoginWebUi: true,
      limit5hUsd: null,
      limitDailyUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limitConcurrentSessions: 0,
      providerGroup: "default",
      cacheTtlPreference: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });
  });

  it("addKey：key 并发超过用户并发时应拦截", async () => {
    const { addKey } = await import("@/actions/keys");

    const result = await addKey({
      userId: 10,
      name: "k1",
      limitConcurrentSessions: 3,
      providerGroup: "default",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("KEY_LIMIT_CONCURRENT_EXCEEDS_USER_LIMIT");
    }
    expect(createKeyMock).not.toHaveBeenCalled();
  });

  it("addKey：用户并发为 0 时不应限制 key 并发", async () => {
    const { addKey } = await import("@/actions/keys");

    findUserByIdMock.mockResolvedValueOnce({ ...baseUser, limitConcurrentSessions: 0 });

    const result = await addKey({
      userId: 10,
      name: "k1",
      limitConcurrentSessions: 3,
      providerGroup: "default",
    });

    expect(result.ok).toBe(true);
    expect(createKeyMock).toHaveBeenCalledTimes(1);
  });

  it("editKey：key 并发超过用户并发时应拦截", async () => {
    const { editKey } = await import("@/actions/keys");

    const result = await editKey(1, {
      name: "k1",
      providerGroup: "default",
      limitConcurrentSessions: 3,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("KEY_LIMIT_CONCURRENT_EXCEEDS_USER_LIMIT");
    }
    expect(updateKeyMock).not.toHaveBeenCalled();
  });
});
