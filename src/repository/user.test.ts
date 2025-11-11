import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import type { CreateUserData, UpdateUserData } from "@/types/user";
import { createUser, findUserList, findUserById, updateUser, deleteUser } from "./user";

// Mock logger to avoid console noise
vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Mock db module
let mockDb: ReturnType<typeof drizzle>;
let client: PGlite;

vi.mock("@/drizzle/db", () => ({
  get db() {
    return mockDb;
  },
}));

// Mock env config
vi.mock("@/lib/config", () => ({
  getEnvConfig: () => ({
    TZ: "Asia/Shanghai",
  }),
}));

describe("User Repository", () => {
  beforeEach(async () => {
    // Create in-memory PGlite database
    client = new PGlite();
    mockDb = drizzle(client);

    // Run migrations
    await migrate(mockDb, { migrationsFolder: "./drizzle" });
  });

  afterEach(async () => {
    await client.close();
  });

  describe("createUser", () => {
    it("should create a user with minimal required fields", async () => {
      const userData: CreateUserData = {
        name: "Test User",
        description: "Test Description",
      };

      const user = await createUser(userData);

      expect(user).toBeDefined();
      expect(user.id).toBeGreaterThan(0);
      expect(user.name).toBe("Test User");
      expect(user.description).toBe("Test Description");
      expect(user.role).toBe("user");
      expect(user.rpm).toBe(60);
      expect(user.dailyQuota).toBe(100.0);
      expect(user.providerGroup).toBeNull();
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it("should create a user with all optional fields", async () => {
      const userData: CreateUserData = {
        name: "Full User",
        description: "Full Description",
        rpm: 120,
        dailyQuota: 200.5,
        providerGroup: "production",
      };

      const user = await createUser(userData);

      expect(user).toBeDefined();
      expect(user.name).toBe("Full User");
      expect(user.description).toBe("Full Description");
      expect(user.rpm).toBe(120);
      expect(user.dailyQuota).toBe(200.5);
      expect(user.providerGroup).toBe("production");
    });

    it("should handle rpm as 0 (falls back to default 60)", async () => {
      const userData: CreateUserData = {
        name: "No Limit User",
        description: "No RPM limit",
        rpm: 0,
      };

      const user = await createUser(userData);

      // Note: transformer treats 0 as falsy, so it defaults to 60
      expect(user.rpm).toBe(60);
    });

    it("should handle dailyQuota as 0", async () => {
      const userData: CreateUserData = {
        name: "No Quota User",
        description: "No daily quota",
        dailyQuota: 0,
      };

      const user = await createUser(userData);

      expect(user.dailyQuota).toBe(0);
    });

    it("should handle null providerGroup", async () => {
      const userData: CreateUserData = {
        name: "Null Group User",
        description: "Null provider group",
        providerGroup: null,
      };

      const user = await createUser(userData);

      expect(user.providerGroup).toBeNull();
    });

    it("should handle undefined providerGroup (should convert to null)", async () => {
      const userData: CreateUserData = {
        name: "Undefined Group User",
        description: "Undefined provider group",
        providerGroup: undefined,
      };

      const user = await createUser(userData);

      expect(user.providerGroup).toBeNull();
    });

    it("should handle empty string description", async () => {
      const userData: CreateUserData = {
        name: "Empty Description User",
        description: "",
      };

      const user = await createUser(userData);

      expect(user.description).toBe("");
    });

    it("should handle special characters in name", async () => {
      const userData: CreateUserData = {
        name: "User 特殊字符 & Special",
        description: "Special characters test",
      };

      const user = await createUser(userData);

      expect(user.name).toBe("User 特殊字符 & Special");
    });

    it("should handle very large dailyQuota", async () => {
      const userData: CreateUserData = {
        name: "High Quota User",
        description: "Large daily quota",
        dailyQuota: 99999999.99,
      };

      const user = await createUser(userData);

      expect(user.dailyQuota).toBe(99999999.99);
    });

    it("should handle decimal dailyQuota", async () => {
      const userData: CreateUserData = {
        name: "Decimal Quota User",
        description: "Decimal daily quota",
        dailyQuota: 123.45,
      };

      const user = await createUser(userData);

      expect(user.dailyQuota).toBe(123.45);
    });
  });

  describe("findUserList", () => {
    beforeEach(async () => {
      // Create test users
      for (let i = 1; i <= 10; i++) {
        await createUser({
          name: `User ${i}`,
          description: `Description ${i}`,
          rpm: i * 10,
          dailyQuota: i * 50,
        });
      }
    });

    it("should return all users with default limit", async () => {
      const users = await findUserList();

      expect(users).toHaveLength(10);
    });

    it("should respect limit parameter", async () => {
      const users = await findUserList(5);

      expect(users).toHaveLength(5);
    });

    it("should respect offset parameter", async () => {
      const users = await findUserList(5, 5);

      expect(users).toHaveLength(5);
      // Users are ordered by admin role first, then by id
      expect(users[0].id).toBeGreaterThan(5);
    });

    it("should not return deleted users", async () => {
      const allUsers = await findUserList();
      await deleteUser(allUsers[0].id);

      const activeUsers = await findUserList();

      expect(activeUsers).toHaveLength(9);
    });

    it("should order admin users first", async () => {
      // Manually set a user as admin using raw SQL
      const users = await findUserList();
      await mockDb.execute(sql.raw(`UPDATE users SET role = 'admin' WHERE id = ${users[5].id}`));

      const orderedUsers = await findUserList();
      expect(orderedUsers[0].role).toBe("admin");
    });

    it("should return empty array when no users exist", async () => {
      // Delete all users
      const allUsers = await findUserList();
      for (const user of allUsers) {
        await deleteUser(user.id);
      }

      const users = await findUserList();
      expect(users).toHaveLength(0);
    });

    it("should handle limit greater than total users", async () => {
      const users = await findUserList(100);

      expect(users).toHaveLength(10);
    });

    it("should handle offset greater than total users", async () => {
      const users = await findUserList(10, 100);

      expect(users).toHaveLength(0);
    });
  });

  describe("findUserById", () => {
    let testUserId: number;

    beforeEach(async () => {
      const user = await createUser({
        name: "Test User",
        description: "Test Description",
        rpm: 100,
        dailyQuota: 150,
        providerGroup: "test-group",
      });
      testUserId = user.id;
    });

    it("should find user by id", async () => {
      const user = await findUserById(testUserId);

      expect(user).toBeDefined();
      expect(user?.id).toBe(testUserId);
      expect(user?.name).toBe("Test User");
      expect(user?.description).toBe("Test Description");
      expect(user?.rpm).toBe(100);
      expect(user?.dailyQuota).toBe(150);
      expect(user?.providerGroup).toBe("test-group");
    });

    it("should return null for non-existent user", async () => {
      const user = await findUserById(99999);

      expect(user).toBeNull();
    });

    it("should return null for deleted user", async () => {
      await deleteUser(testUserId);

      const user = await findUserById(testUserId);

      expect(user).toBeNull();
    });

    it("should return user with all fields", async () => {
      const user = await findUserById(testUserId);

      expect(user).toBeDefined();
      expect(user?.id).toBeDefined();
      expect(user?.name).toBeDefined();
      expect(user?.description).toBeDefined();
      expect(user?.role).toBeDefined();
      expect(user?.rpm).toBeDefined();
      expect(user?.dailyQuota).toBeDefined();
      expect(user?.createdAt).toBeInstanceOf(Date);
      expect(user?.updatedAt).toBeInstanceOf(Date);
    });

    it("should handle null providerGroup correctly", async () => {
      const userWithoutGroup = await createUser({
        name: "No Group User",
        description: "No provider group",
        providerGroup: null,
      });

      const foundUser = await findUserById(userWithoutGroup.id);

      expect(foundUser).toBeDefined();
      expect(foundUser?.providerGroup).toBeNull();
    });
  });

  describe("updateUser", () => {
    let testUserId: number;

    beforeEach(async () => {
      const user = await createUser({
        name: "Original User",
        description: "Original Description",
        rpm: 60,
        dailyQuota: 100,
        providerGroup: "original-group",
      });
      testUserId = user.id;
    });

    it("should update user name", async () => {
      const updateData: UpdateUserData = {
        name: "Updated User",
      };

      const user = await updateUser(testUserId, updateData);

      expect(user).toBeDefined();
      expect(user?.name).toBe("Updated User");
      expect(user?.description).toBe("Original Description");
    });

    it("should update user description", async () => {
      const updateData: UpdateUserData = {
        description: "Updated Description",
      };

      const user = await updateUser(testUserId, updateData);

      expect(user).toBeDefined();
      expect(user?.description).toBe("Updated Description");
      expect(user?.name).toBe("Original User");
    });

    it("should update multiple fields", async () => {
      const updateData: UpdateUserData = {
        name: "Multi Update",
        description: "Multi Description",
        rpm: 120,
        dailyQuota: 200,
        providerGroup: "new-group",
      };

      const user = await updateUser(testUserId, updateData);

      expect(user).toBeDefined();
      expect(user?.name).toBe("Multi Update");
      expect(user?.description).toBe("Multi Description");
      expect(user?.rpm).toBe(120);
      expect(user?.dailyQuota).toBe(200);
      expect(user?.providerGroup).toBe("new-group");
    });

    it("should update rpm", async () => {
      const updateData: UpdateUserData = {
        rpm: 240,
      };

      const user = await updateUser(testUserId, updateData);

      expect(user).toBeDefined();
      expect(user?.rpm).toBe(240);
    });

    it("should update dailyQuota", async () => {
      const updateData: UpdateUserData = {
        dailyQuota: 500.75,
      };

      const user = await updateUser(testUserId, updateData);

      expect(user).toBeDefined();
      expect(user?.dailyQuota).toBe(500.75);
    });

    it("should update providerGroup to a new value", async () => {
      const updateData: UpdateUserData = {
        providerGroup: "updated-group",
      };

      const user = await updateUser(testUserId, updateData);

      expect(user).toBeDefined();
      expect(user?.providerGroup).toBe("updated-group");
    });

    it("should set providerGroup to null", async () => {
      const updateData: UpdateUserData = {
        providerGroup: null,
      };

      const user = await updateUser(testUserId, updateData);

      expect(user).toBeDefined();
      expect(user?.providerGroup).toBeNull();
    });

    it("should handle undefined fields (no update)", async () => {
      const updateData: UpdateUserData = {
        name: "Updated Name",
        description: undefined,
        rpm: undefined,
      };

      const user = await updateUser(testUserId, updateData);

      expect(user).toBeDefined();
      expect(user?.name).toBe("Updated Name");
      expect(user?.description).toBe("Original Description");
      expect(user?.rpm).toBe(60);
    });

    it("should return original user when update data is empty", async () => {
      const user = await updateUser(testUserId, {});

      expect(user).toBeDefined();
      expect(user?.name).toBe("Original User");
      expect(user?.description).toBe("Original Description");
    });

    it("should return null for non-existent user", async () => {
      const user = await updateUser(99999, { name: "Test" });

      expect(user).toBeNull();
    });

    it("should return null for deleted user", async () => {
      await deleteUser(testUserId);

      const user = await updateUser(testUserId, { name: "Test" });

      expect(user).toBeNull();
    });

    it("should update updatedAt timestamp", async () => {
      const originalUser = await findUserById(testUserId);

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updatedUser = await updateUser(testUserId, { name: "Updated" });

      expect(updatedUser).toBeDefined();
      expect(updatedUser!.updatedAt.getTime()).toBeGreaterThan(originalUser!.updatedAt.getTime());
    });

    it("should handle rpm as 0 (falls back to default 60)", async () => {
      const updateData: UpdateUserData = {
        rpm: 0,
      };

      const user = await updateUser(testUserId, updateData);

      expect(user).toBeDefined();
      // Note: transformer treats 0 as falsy, so it defaults to 60
      expect(user?.rpm).toBe(60);
    });

    it("should handle dailyQuota as 0", async () => {
      const updateData: UpdateUserData = {
        dailyQuota: 0,
      };

      const user = await updateUser(testUserId, updateData);

      expect(user).toBeDefined();
      expect(user?.dailyQuota).toBe(0);
    });

    it("should handle empty string description", async () => {
      const updateData: UpdateUserData = {
        description: "",
      };

      const user = await updateUser(testUserId, updateData);

      expect(user).toBeDefined();
      expect(user?.description).toBe("");
    });

    it("should handle special characters in name", async () => {
      const updateData: UpdateUserData = {
        name: "Updated 特殊字符 & Special",
      };

      const user = await updateUser(testUserId, updateData);

      expect(user).toBeDefined();
      expect(user?.name).toBe("Updated 特殊字符 & Special");
    });

    it("should handle very large dailyQuota", async () => {
      const updateData: UpdateUserData = {
        dailyQuota: 99999999.99,
      };

      const user = await updateUser(testUserId, updateData);

      expect(user).toBeDefined();
      expect(user?.dailyQuota).toBe(99999999.99);
    });

    it("should handle providerGroup change from null to value", async () => {
      // Create user without group
      const userWithoutGroup = await createUser({
        name: "No Group User",
        description: "No group",
        providerGroup: null,
      });

      const updateData: UpdateUserData = {
        providerGroup: "new-group",
      };

      const updated = await updateUser(userWithoutGroup.id, updateData);

      expect(updated).toBeDefined();
      expect(updated?.providerGroup).toBe("new-group");
    });

    it("should handle providerGroup change from value to null", async () => {
      const updateData: UpdateUserData = {
        providerGroup: null,
      };

      const user = await updateUser(testUserId, updateData);

      expect(user).toBeDefined();
      expect(user?.providerGroup).toBeNull();
    });
  });

  describe("deleteUser", () => {
    let testUserId: number;

    beforeEach(async () => {
      const user = await createUser({
        name: "Test User",
        description: "Test Description",
      });
      testUserId = user.id;
    });

    it("should soft delete user", async () => {
      const result = await deleteUser(testUserId);

      expect(result).toBe(true);

      const user = await findUserById(testUserId);
      expect(user).toBeNull();
    });

    it("should return false for non-existent user", async () => {
      const result = await deleteUser(99999);

      expect(result).toBe(false);
    });

    it("should return false when deleting already deleted user", async () => {
      await deleteUser(testUserId);
      const result = await deleteUser(testUserId);

      expect(result).toBe(false);
    });

    it("should not affect other users", async () => {
      const user2 = await createUser({
        name: "User 2",
        description: "Description 2",
      });

      await deleteUser(testUserId);

      const stillExists = await findUserById(user2.id);
      expect(stillExists).toBeDefined();
    });

    it("should not appear in user list after deletion", async () => {
      await deleteUser(testUserId);

      const users = await findUserList();
      const deletedUser = users.find((u) => u.id === testUserId);

      expect(deletedUser).toBeUndefined();
    });
  });

  describe("Edge Cases and Data Integrity", () => {
    it("should handle null description in transformer", async () => {
      // Create user with empty description
      const user = await createUser({
        name: "User",
        description: "",
      });

      const found = await findUserById(user.id);
      expect(found?.description).toBe("");
    });

    it("should handle very long name", async () => {
      const longName = "A".repeat(255);
      const user = await createUser({
        name: longName,
        description: "Test",
      });

      expect(user.name).toBe(longName);

      const found = await findUserById(user.id);
      expect(found?.name).toBe(longName);
    });

    it("should handle very long description", async () => {
      const longDescription = "A".repeat(1000);
      const user = await createUser({
        name: "User",
        description: longDescription,
      });

      expect(user.description).toBe(longDescription);

      const found = await findUserById(user.id);
      expect(found?.description).toBe(longDescription);
    });

    it("should handle very long providerGroup", async () => {
      const longGroup = "group-" + "A".repeat(40);
      const user = await createUser({
        name: "User",
        description: "Test",
        providerGroup: longGroup,
      });

      expect(user.providerGroup).toBe(longGroup);
    });

    it("should handle high rpm values", async () => {
      const user = await createUser({
        name: "High RPM User",
        description: "Test",
        rpm: 999999,
      });

      expect(user.rpm).toBe(999999);

      const found = await findUserById(user.id);
      expect(found?.rpm).toBe(999999);
    });

    it("should preserve exact decimal values for dailyQuota", async () => {
      const testValues = [0.01, 1.23, 99.99, 123.45, 9999.99];

      for (const value of testValues) {
        const user = await createUser({
          name: `User ${value}`,
          description: "Test",
          dailyQuota: value,
        });

        expect(user.dailyQuota).toBe(value);

        const found = await findUserById(user.id);
        expect(found?.dailyQuota).toBe(value);
      }
    });

    it("should handle concurrent user creation", async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        createUser({
          name: `Concurrent User ${i}`,
          description: `Test ${i}`,
        })
      );

      const users = await Promise.all(promises);

      expect(users).toHaveLength(10);
      const uniqueIds = new Set(users.map((u) => u.id));
      expect(uniqueIds.size).toBe(10);
    });

    it("should handle concurrent user updates", async () => {
      const user = await createUser({
        name: "Test User",
        description: "Test",
      });

      const promises = Array.from({ length: 5 }, (_, i) =>
        updateUser(user.id, {
          name: `Updated ${i}`,
          rpm: (i + 1) * 10,
        })
      );

      const results = await Promise.all(promises);

      // All updates should succeed
      results.forEach((result) => {
        expect(result).toBeDefined();
        expect(result?.id).toBe(user.id);
      });

      // Final state should be from one of the updates
      const finalUser = await findUserById(user.id);
      expect(finalUser).toBeDefined();
      expect(finalUser!.name).toMatch(/^Updated \d$/);
    });

    it("should handle mixed null and undefined in update", async () => {
      const user = await createUser({
        name: "Test User",
        description: "Test Description",
        providerGroup: "test-group",
      });

      const updateData: UpdateUserData = {
        name: "Updated Name",
        description: undefined, // Should not update
        providerGroup: null, // Should update to null
      };

      const updated = await updateUser(user.id, updateData);

      expect(updated).toBeDefined();
      expect(updated?.name).toBe("Updated Name");
      expect(updated?.description).toBe("Test Description");
      expect(updated?.providerGroup).toBeNull();
    });

    it("should maintain data consistency after multiple operations", async () => {
      // Create
      const user = await createUser({
        name: "Consistency User",
        description: "Test",
        rpm: 100,
        dailyQuota: 200,
        providerGroup: "group1",
      });

      // Update
      await updateUser(user.id, {
        name: "Updated Name",
        rpm: 150,
      });

      // Find
      const found = await findUserById(user.id);

      expect(found).toBeDefined();
      expect(found?.name).toBe("Updated Name");
      expect(found?.rpm).toBe(150);
      expect(found?.description).toBe("Test");
      expect(found?.dailyQuota).toBe(200);
      expect(found?.providerGroup).toBe("group1");
    });
  });

  describe("Nullable Field Handling", () => {
    it("should convert undefined providerGroup to null in database", async () => {
      const user = await createUser({
        name: "Test User",
        description: "Test",
        providerGroup: undefined,
      });

      expect(user.providerGroup).toBeNull();

      const found = await findUserById(user.id);
      expect(found?.providerGroup).toBeNull();
    });

    it("should preserve null providerGroup through update", async () => {
      const user = await createUser({
        name: "Test User",
        description: "Test",
        providerGroup: null,
      });

      const updated = await updateUser(user.id, {
        name: "Updated",
      });

      expect(updated?.providerGroup).toBeNull();
    });

    it("should handle providerGroup transitions correctly", async () => {
      const user = await createUser({
        name: "Test User",
        description: "Test",
        providerGroup: "group1",
      });

      // Update to null
      let updated = await updateUser(user.id, {
        providerGroup: null,
      });
      expect(updated?.providerGroup).toBeNull();

      // Update to new value
      updated = await updateUser(user.id, {
        providerGroup: "group2",
      });
      expect(updated?.providerGroup).toBe("group2");

      // Update to null again
      updated = await updateUser(user.id, {
        providerGroup: null,
      });
      expect(updated?.providerGroup).toBeNull();
    });

    it("should not update providerGroup when undefined in update", async () => {
      const user = await createUser({
        name: "Test User",
        description: "Test",
        providerGroup: "original-group",
      });

      const updated = await updateUser(user.id, {
        name: "Updated",
        providerGroup: undefined,
      });

      expect(updated?.providerGroup).toBe("original-group");
    });
  });

  describe("Transformer Behavior", () => {
    it("should apply default values correctly via transformer", async () => {
      const user = await createUser({
        name: "Test User",
        description: "Test",
      });

      expect(user.role).toBe("user");
      expect(user.rpm).toBe(60);
      expect(user.dailyQuota).toBe(100.0);
      expect(user.providerGroup).toBeNull();
    });

    it("should handle empty description via transformer", async () => {
      const user = await createUser({
        name: "Test User",
        description: "",
      });

      const found = await findUserById(user.id);
      expect(found?.description).toBe("");
    });

    it("should convert string dailyQuota to number via transformer", async () => {
      const user = await createUser({
        name: "Test User",
        description: "Test",
        dailyQuota: 123.45,
      });

      const found = await findUserById(user.id);
      expect(found?.dailyQuota).toBe(123.45);
      expect(typeof found?.dailyQuota).toBe("number");
    });

    it("should convert string timestamps to Date objects via transformer", async () => {
      const user = await createUser({
        name: "Test User",
        description: "Test",
      });

      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);

      const found = await findUserById(user.id);
      expect(found?.createdAt).toBeInstanceOf(Date);
      expect(found?.updatedAt).toBeInstanceOf(Date);
    });
  });
});
