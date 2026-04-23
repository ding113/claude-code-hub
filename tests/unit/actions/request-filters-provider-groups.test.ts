import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const selectDistinctMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@/lib/request-filter-engine", () => ({
  requestFilterEngine: {
    reload: vi.fn(async () => {}),
    getStats: vi.fn(() => ({ count: 0 })),
  },
}));

vi.mock("@/repository/request-filters", () => ({
  createRequestFilter: vi.fn(),
  deleteRequestFilter: vi.fn(),
  getAllRequestFilters: vi.fn(async () => []),
  getRequestFilterById: vi.fn(async () => null),
  updateRequestFilter: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    selectDistinct: selectDistinctMock,
  },
}));

vi.mock("@/drizzle/schema", () => ({
  providers: {
    groupTag: "providers.group_tag",
    deletedAt: "providers.deleted_at",
  },
}));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    isNull: vi.fn((value) => value),
  };
});

describe("getDistinctProviderGroupsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    selectDistinctMock.mockReturnValue({
      from: () => ({
        where: async () => [
          { groupTag: null },
          { groupTag: "   " },
          { groupTag: "default" },
          { groupTag: "premium,default" },
          { groupTag: "beta" },
        ],
      }),
    });
  });

  it("returns default first for null or blank provider group tags", async () => {
    const { getDistinctProviderGroupsAction } = await import("@/actions/request-filters");

    const result = await getDistinctProviderGroupsAction();

    expect(result).toEqual({
      ok: true,
      data: ["default", "beta", "premium"],
    });
  });
});
