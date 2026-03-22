import { beforeEach, describe, expect, test, vi } from "vitest";
import type { User } from "@/types/user";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const getTranslationsMock = vi.fn(async () => (key: string) => key);
const getLocaleMock = vi.fn(async () => "en");
vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
  getLocale: getLocaleMock,
}));

const findUserByIdMock = vi.fn();
const findUserListBatchMock = vi.fn();
vi.mock("@/repository/user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/user")>();
  return {
    ...actual,
    findUserById: findUserByIdMock,
    findUserListBatch: findUserListBatchMock,
  };
});

const findKeyListBatchMock = vi.fn();
const findKeyUsageTodayBatchMock = vi.fn();
const findKeysStatisticsBatchFromKeysMock = vi.fn();
vi.mock("@/repository/key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/key")>();
  return {
    ...actual,
    findKeyListBatch: findKeyListBatchMock,
    findKeyUsageTodayBatch: findKeyUsageTodayBatchMock,
    findKeysStatisticsBatchFromKeys: findKeysStatisticsBatchFromKeysMock,
  };
});

function makeUser(id: number, name = `user-${id}`): User {
  return {
    id,
    name,
    description: `${name}-desc`,
    role: "user",
    rpm: null,
    dailyQuota: null,
    providerGroup: null,
    tags: [],
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    deletedAt: undefined,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    isEnabled: true,
    expiresAt: null,
    allowedClients: [],
    blockedClients: [],
    allowedModels: [],
  };
}

describe("getUsers compatibility", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    findUserByIdMock.mockReset();
    findUserListBatchMock.mockReset();
    findKeyListBatchMock.mockReset();
    findKeyUsageTodayBatchMock.mockReset();
    findKeysStatisticsBatchFromKeysMock.mockReset();

    getSessionMock.mockResolvedValue({
      user: { id: 1, role: "admin" },
      key: { canLoginWebUi: true },
    });
    findKeyListBatchMock.mockResolvedValue(new Map());
    findKeyUsageTodayBatchMock.mockResolvedValue(new Map());
    findKeysStatisticsBatchFromKeysMock.mockResolvedValue(new Map());
  });

  test("loads all admin users instead of stopping at the first 50", async () => {
    const firstPageUsers = Array.from({ length: 200 }, (_, index) => makeUser(index + 1));
    const secondPageUser = makeUser(201, "after-first-200");

    findUserListBatchMock
      .mockResolvedValueOnce({
        users: firstPageUsers,
        nextCursor: '{"v":"2026-03-01T00:00:00.000Z","id":200}',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        users: [secondPageUser],
        nextCursor: null,
        hasMore: false,
      });

    const { getUsers } = await import("@/actions/users");

    const result = await getUsers();

    expect(findUserListBatchMock).toHaveBeenNthCalledWith(1, {
      cursor: undefined,
      searchTerm: undefined,
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      limit: 200,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(findUserListBatchMock).toHaveBeenNthCalledWith(2, {
      cursor: '{"v":"2026-03-01T00:00:00.000Z","id":200}',
      searchTerm: undefined,
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      limit: 200,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(result).toHaveLength(201);
    expect(result.at(-1)?.name).toBe("after-first-200");
  });

  test("normalizes legacy getUsers page and query params", async () => {
    findUserListBatchMock.mockResolvedValueOnce({
      users: [makeUser(51, "xiaolunanbei")],
      nextCursor: null,
      hasMore: false,
    });

    const { getUsers } = await import("@/actions/users");

    const result = await getUsers({
      page: 2,
      limit: 50,
      query: "  小鹿楠贝  ",
    });

    expect(findUserListBatchMock).toHaveBeenCalledWith({
      cursor: "50",
      limit: 50,
      searchTerm: "小鹿楠贝",
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("xiaolunanbei");
  });

  test("search-only getUsers requests keep paging until all matches are returned", async () => {
    findUserListBatchMock
      .mockResolvedValueOnce({
        users: Array.from({ length: 200 }, (_, index) => makeUser(index + 1, `match-${index + 1}`)),
        nextCursor: '{"v":"2026-03-01T00:00:00.000Z","id":200}',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        users: [makeUser(201, "match-201")],
        nextCursor: null,
        hasMore: false,
      });

    const { getUsers } = await import("@/actions/users");

    const result = await getUsers({ query: "match" });

    expect(findUserListBatchMock).toHaveBeenNthCalledWith(1, {
      cursor: undefined,
      limit: 200,
      searchTerm: "match",
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(findUserListBatchMock).toHaveBeenNthCalledWith(2, {
      cursor: '{"v":"2026-03-01T00:00:00.000Z","id":200}',
      limit: 200,
      searchTerm: "match",
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(result).toHaveLength(201);
    expect(result.at(-1)?.name).toBe("match-201");
  });

  test("normalizes legacy getUsersBatch keyword and offset params", async () => {
    findUserListBatchMock.mockResolvedValueOnce({
      users: [makeUser(88, "keyword-hit")],
      nextCursor: null,
      hasMore: false,
    });

    const { getUsersBatch } = await import("@/actions/users");

    const result = await getUsersBatch({
      offset: 75,
      limit: 25,
      keyword: "  key-word  ",
    });

    expect(findUserListBatchMock).toHaveBeenCalledWith({
      cursor: "75",
      limit: 25,
      searchTerm: "key-word",
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        users: [
          expect.objectContaining({
            id: 88,
            name: "keyword-hit",
          }),
        ],
        nextCursor: null,
        hasMore: false,
      },
    });
  });
});
