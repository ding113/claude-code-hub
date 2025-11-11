import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/drizzle/schema";
import type { CreateKeyData, UpdateKeyData } from "@/types/key";
import {
  findKeyById,
  findKeyList,
  createKey,
  updateKey,
  deleteKey,
  findActiveKeyByUserIdAndName,
  findActiveKeyByKeyString,
  validateApiKeyAndGetUser,
  findKeyUsageToday,
  countActiveKeysByUser,
  findKeysWithStatistics,
} from "./key";

// Mock db module
let mockDb: ReturnType<typeof drizzle>;
let client: PGlite;

vi.mock("@/drizzle/db", () => ({
  get db() {
    return mockDb;
  },
}));

describe("Key Repository", () => {
  let testUserId: number;
  let testProviderId: number;

  beforeAll(async () => {
    // Initialize in-memory PGlite database
    client = new PGlite();
    mockDb = drizzle(client, { schema });

    // Apply migrations
    await migrate(mockDb, { migrationsFolder: "./drizzle" });

    // Create test user
    const [user] = await mockDb
      .insert(schema.users)
      .values({
        name: "Test User",
        role: "user",
        rpmLimit: 60,
        dailyLimitUsd: "100.00",
      })
      .returning({ id: schema.users.id });
    testUserId = user.id;

    // Create test provider (needed for statistics tests)
    const [provider] = await mockDb
      .insert(schema.providers)
      .values({
        name: "Test Provider",
        url: "https://api.test.com",
        key: "test-provider-key",
        isEnabled: true,
        weight: 1,
        priority: 0,
      })
      .returning({ id: schema.providers.id });
    testProviderId = provider.id;
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    // Clean up keys table before each test
    await mockDb.delete(schema.keys);
    // Clean up message_request table
    await mockDb.delete(schema.messageRequest);
  });

  describe("createKey", () => {
    it("should create a key with minimal required fields", async () => {
      const keyData: CreateKeyData = {
        user_id: testUserId,
        name: "Test Key",
        key: "sk-test-key-12345",
      };

      const key = await createKey(keyData);

      expect(key).toBeDefined();
      expect(key.id).toBeGreaterThan(0);
      expect(key.userId).toBe(testUserId);
      expect(key.name).toBe("Test Key");
      expect(key.key).toBe("sk-test-key-12345");
      expect(key.isEnabled).toBe(true);
      expect(key.canLoginWebUi).toBe(true);
      expect(key.limit5hUsd).toBeNull();
      expect(key.limitWeeklyUsd).toBeNull();
      expect(key.limitMonthlyUsd).toBeNull();
      expect(key.limitConcurrentSessions).toBe(0);
      expect(key.createdAt).toBeInstanceOf(Date);
      expect(key.updatedAt).toBeInstanceOf(Date);
    });

    it("should create a key with all optional fields", async () => {
      const expiresAt = new Date("2025-12-31");
      const keyData: CreateKeyData = {
        user_id: testUserId,
        name: "Full Key",
        key: "sk-full-key-67890",
        is_enabled: false,
        expires_at: expiresAt,
        can_login_web_ui: false,
        limit_5h_usd: 10.5,
        limit_weekly_usd: 50.25,
        limit_monthly_usd: 200.75,
        limit_concurrent_sessions: 5,
      };

      const key = await createKey(keyData);

      expect(key).toBeDefined();
      expect(key.isEnabled).toBe(false);
      expect(key.expiresAt?.toISOString()).toBe(expiresAt.toISOString());
      expect(key.canLoginWebUi).toBe(false);
      expect(key.limit5hUsd).toBe(10.5);
      expect(key.limitWeeklyUsd).toBe(50.25);
      expect(key.limitMonthlyUsd).toBe(200.75);
      expect(key.limitConcurrentSessions).toBe(5);
    });
  });

  describe("findKeyById", () => {
    it("should find key by id", async () => {
      const created = await createKey({
        user_id: testUserId,
        name: "Find Test",
        key: "sk-find-test",
      });

      const key = await findKeyById(created.id);

      expect(key).toBeDefined();
      expect(key?.id).toBe(created.id);
      expect(key?.name).toBe("Find Test");
    });

    it("should return null for non-existent key", async () => {
      const key = await findKeyById(99999);
      expect(key).toBeNull();
    });
  });

  describe("updateKey", () => {
    it("should update key fields", async () => {
      const created = await createKey({
        user_id: testUserId,
        name: "Original",
        key: "sk-update-test",
      });

      const updated = await updateKey(created.id, {
        name: "Updated",
        is_enabled: false,
      });

      expect(updated?.name).toBe("Updated");
      expect(updated?.isEnabled).toBe(false);
    });
  });

  describe("deleteKey", () => {
    it("should soft delete key", async () => {
      const created = await createKey({
        user_id: testUserId,
        name: "Delete Test",
        key: "sk-delete-test",
      });

      const result = await deleteKey(created.id);
      expect(result).toBe(true);

      const key = await findKeyById(created.id);
      expect(key).toBeNull();
    });
  });

  describe("findActiveKeyByKeyString", () => {
    it("should find active key by key string", async () => {
      await createKey({
        user_id: testUserId,
        name: "Active Key",
        key: "sk-active-key",
        is_enabled: true,
      });

      const key = await findActiveKeyByKeyString("sk-active-key");

      expect(key).toBeDefined();
      expect(key?.key).toBe("sk-active-key");
    });

    it("should return null for disabled key", async () => {
      await createKey({
        user_id: testUserId,
        name: "Disabled Key",
        key: "sk-disabled-key",
        is_enabled: false,
      });

      const key = await findActiveKeyByKeyString("sk-disabled-key");
      expect(key).toBeNull();
    });
  });

  describe("validateApiKeyAndGetUser", () => {
    it("should validate and return user with key", async () => {
      await createKey({
        user_id: testUserId,
        name: "Valid Auth Key",
        key: "sk-valid-auth",
        is_enabled: true,
      });

      const result = await validateApiKeyAndGetUser("sk-valid-auth");

      expect(result).toBeDefined();
      expect(result?.user).toBeDefined();
      expect(result?.key).toBeDefined();
      expect(result?.user.id).toBe(testUserId);
      expect(result?.key.key).toBe("sk-valid-auth");
    });

    it("should return null for disabled key", async () => {
      await createKey({
        user_id: testUserId,
        name: "Invalid Auth Key",
        key: "sk-invalid-auth",
        is_enabled: false,
      });

      const result = await validateApiKeyAndGetUser("sk-invalid-auth");
      expect(result).toBeNull();
    });
  });

  describe("countActiveKeysByUser", () => {
    it("should count all active keys for user", async () => {
      for (let i = 1; i <= 3; i++) {
        await createKey({
          user_id: testUserId,
          name: `Count Key ${i}`,
          key: `sk-count-key-${i}`,
        });
      }

      const count = await countActiveKeysByUser(testUserId);
      expect(count).toBe(3);
    });

    it("should return 0 for user with no keys", async () => {
      const count = await countActiveKeysByUser(99999);
      expect(count).toBe(0);
    });
  });
});
