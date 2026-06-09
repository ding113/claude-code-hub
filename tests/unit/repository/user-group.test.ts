import { beforeEach, describe, expect, it, vi } from "vitest";

const { insertMock, updateMock, deleteMock, selectMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
    select: selectMock,
  },
}));

vi.mock("@/drizzle/schema", () => ({
  userGroups: {
    id: "userGroups.id",
    tag: "userGroups.tag",
    name: "userGroups.name",
    description: "userGroups.description",
    createdAt: "userGroups.createdAt",
    updatedAt: "userGroups.updatedAt",
  },
  users: {
    id: "users.id",
    tags: "users.tags",
    deletedAt: "users.deletedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  asc: vi.fn((col: unknown) => `asc(${col})`),
  eq: vi.fn((a: unknown, b: unknown) => `eq(${a},${b})`),
  inArray: vi.fn((col: unknown, arr: unknown[]) => `inArray(${col},[${arr}])`),
  isNull: vi.fn((col: unknown) => `isNull(${col})`),
  sql: Object.assign(
    vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => "sql_expr"),
    { join: vi.fn() }
  ),
}));

import {
  countUsersInUserGroup,
  createUserGroup,
  deleteUserGroup,
  getUserGroup,
  getUserGroupByTag,
  listUserGroups,
  listUserGroupsForTags,
  updateUserGroup,
} from "@/repository/user-group";

const now = new Date("2024-01-15T10:00:00.000Z");

const mockGroup = {
  id: 1,
  tag: "vip",
  name: "VIP Users",
  description: "High-value users",
  createdAt: now,
  updatedAt: now,
};

const mockGroup2 = {
  id: 2,
  tag: "beta",
  name: "Beta Testers",
  description: null,
  createdAt: now,
  updatedAt: now,
};

describe("user-group repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createUserGroup", () => {
    it("inserts a new group and returns the row", async () => {
      const insertValues = vi.fn(() => ({ returning: vi.fn(async () => [mockGroup]) }));
      insertMock.mockReturnValue({ values: insertValues });

      const result = await createUserGroup({
        tag: "vip",
        name: "VIP Users",
        description: "High-value users",
      });

      expect(insertMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockGroup);
    });

    it("trims the tag before inserting", async () => {
      const captor: Array<unknown> = [];
      const insertValues = vi.fn((data: unknown) => {
        captor.push(data);
        return { returning: vi.fn(async () => [mockGroup]) };
      });
      insertMock.mockReturnValue({ values: insertValues });

      await createUserGroup({ tag: "  vip  " });

      expect(captor[0]).toMatchObject({ tag: "vip" });
    });

    it("stores null name when not provided", async () => {
      const captor: Array<unknown> = [];
      const insertValues = vi.fn((data: unknown) => {
        captor.push(data);
        return { returning: vi.fn(async () => [{ ...mockGroup, name: null }]) };
      });
      insertMock.mockReturnValue({ values: insertValues });

      await createUserGroup({ tag: "vip" });

      expect(captor[0]).toMatchObject({ name: null });
    });
  });

  describe("updateUserGroup", () => {
    it("updates the row and returns the updated group", async () => {
      const updated = { ...mockGroup, name: "SUPER VIP" };
      const returningChain = vi.fn(async () => [updated]);
      const whereChain = vi.fn(() => ({ returning: returningChain }));
      const setChain = vi.fn(() => ({ where: whereChain }));
      updateMock.mockReturnValue({ set: setChain });

      const result = await updateUserGroup(1, { name: "SUPER VIP" });

      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual(updated);
    });
  });

  describe("deleteUserGroup", () => {
    it("deletes by id without returning data", async () => {
      const whereChain = vi.fn(async () => []);
      deleteMock.mockReturnValue({ where: whereChain });

      await deleteUserGroup(1);

      expect(deleteMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("listUserGroups", () => {
    it("returns all groups ordered by tag", async () => {
      const orderChain = vi.fn(async () => [mockGroup, mockGroup2]);
      const fromChain = vi.fn(() => ({ orderBy: orderChain }));
      selectMock.mockReturnValue({ from: fromChain });

      const result = await listUserGroups();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(mockGroup);
    });

    it("returns empty array when no groups", async () => {
      const orderChain = vi.fn(async () => []);
      const fromChain = vi.fn(() => ({ orderBy: orderChain }));
      selectMock.mockReturnValue({ from: fromChain });

      const result = await listUserGroups();

      expect(result).toEqual([]);
    });
  });

  describe("getUserGroup", () => {
    it("returns the group when found", async () => {
      const whereChain = vi.fn(async () => [mockGroup]);
      const fromChain = vi.fn(() => ({ where: whereChain }));
      selectMock.mockReturnValue({ from: fromChain });

      const result = await getUserGroup(1);

      expect(result).toEqual(mockGroup);
    });

    it("returns null when not found", async () => {
      const whereChain = vi.fn(async () => []);
      const fromChain = vi.fn(() => ({ where: whereChain }));
      selectMock.mockReturnValue({ from: fromChain });

      const result = await getUserGroup(999);

      expect(result).toBeNull();
    });
  });

  describe("getUserGroupByTag", () => {
    it("returns the group matching the tag", async () => {
      const whereChain = vi.fn(async () => [mockGroup]);
      const fromChain = vi.fn(() => ({ where: whereChain }));
      selectMock.mockReturnValue({ from: fromChain });

      const result = await getUserGroupByTag("vip");

      expect(result).toEqual(mockGroup);
    });

    it("returns null when tag not found", async () => {
      const whereChain = vi.fn(async () => []);
      const fromChain = vi.fn(() => ({ where: whereChain }));
      selectMock.mockReturnValue({ from: fromChain });

      const result = await getUserGroupByTag("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("listUserGroupsForTags", () => {
    it("returns empty array for empty tags input without DB call", async () => {
      const result = await listUserGroupsForTags([]);
      expect(result).toEqual([]);
      expect(selectMock).not.toHaveBeenCalled();
    });

    it("returns matching groups for given tags", async () => {
      const orderChain = vi.fn(async () => [mockGroup, mockGroup2]);
      const whereChain = vi.fn(() => ({ orderBy: orderChain }));
      const fromChain = vi.fn(() => ({ where: whereChain }));
      selectMock.mockReturnValue({ from: fromChain });

      const result = await listUserGroupsForTags(["vip", "beta"]);

      expect(result).toHaveLength(2);
    });
  });

  describe("countUsersInUserGroup", () => {
    it("returns the count of users with the tag", async () => {
      const whereChain = vi.fn(async () => [{ count: 5 }]);
      const fromChain = vi.fn(() => ({ where: whereChain }));
      selectMock.mockReturnValue({ from: fromChain });

      const result = await countUsersInUserGroup("vip");

      expect(result).toBe(5);
    });

    it("returns 0 when no users have the tag", async () => {
      const whereChain = vi.fn(async () => [{ count: 0 }]);
      const fromChain = vi.fn(() => ({ where: whereChain }));
      selectMock.mockReturnValue({ from: fromChain });

      const result = await countUsersInUserGroup("nobody");

      expect(result).toBe(0);
    });

    it("returns 0 when query returns empty result set", async () => {
      const whereChain = vi.fn(async () => []);
      const fromChain = vi.fn(() => ({ where: whereChain }));
      selectMock.mockReturnValue({ from: fromChain });

      const result = await countUsersInUserGroup("empty");

      expect(result).toBe(0);
    });
  });
});
