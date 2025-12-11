/**
 * Framework Self-Tests: Database Mock
 *
 * Verifies that the database mock infrastructure works correctly:
 * - Mock data factories
 * - Data store operations
 * - Repository mock functions
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
  createMockProvider,
  createMockUser,
  createMockKey,
  createMockMessage,
  createMockErrorRule,
  createMockDataStore,
  seedMockDataStore,
  resetMockDataStore,
  resetMockIdCounter,
  createMockProviderRepository,
  createMockUserRepository,
  createMockKeyRepository,
  type MockProvider,
  type MockUser,
  type MockDataStore,
} from "../__mocks__/database.mock";

describe("Database Mock Infrastructure", () => {
  beforeEach(() => {
    resetMockIdCounter();
  });

  describe("Mock Data Factories", () => {
    describe("createMockProvider", () => {
      test("should create provider with default values", () => {
        const provider = createMockProvider();

        expect(provider.id).toBe(1);
        expect(provider.name).toBe("Provider 1");
        expect(provider.type).toBe("claude");
        expect(provider.enabled).toBe(true);
        expect(provider.weight).toBe(100);
        expect(provider.priority).toBe(1);
      });

      test("should allow overriding default values", () => {
        const provider = createMockProvider({
          name: "Custom Provider",
          type: "codex",
          weight: 50,
          priority: 2,
        });

        expect(provider.name).toBe("Custom Provider");
        expect(provider.type).toBe("codex");
        expect(provider.weight).toBe(50);
        expect(provider.priority).toBe(2);
      });

      test("should auto-increment IDs", () => {
        const provider1 = createMockProvider();
        const provider2 = createMockProvider();
        const provider3 = createMockProvider();

        expect(provider1.id).toBe(1);
        expect(provider2.id).toBe(2);
        expect(provider3.id).toBe(3);
      });

      test("should respect explicit ID override", () => {
        const provider = createMockProvider({ id: 100 });
        expect(provider.id).toBe(100);
      });
    });

    describe("createMockUser", () => {
      test("should create user with default values", () => {
        const user = createMockUser();

        expect(user.id).toBe(1);
        expect(user.name).toBe("User 1");
        expect(user.role).toBe("user");
        expect(user.enabled).toBe(true);
      });

      test("should allow creating admin users", () => {
        const admin = createMockUser({ role: "admin", name: "Admin User" });

        expect(admin.role).toBe("admin");
        expect(admin.name).toBe("Admin User");
      });

      test("should support rate limit configuration", () => {
        const user = createMockUser({
          rpmLimit: 60,
          dailyLimitUsd: "10.00",
          limit5hUsd: "5.00",
        });

        expect(user.rpmLimit).toBe(60);
        expect(user.dailyLimitUsd).toBe("10.00");
        expect(user.limit5hUsd).toBe("5.00");
      });
    });

    describe("createMockKey", () => {
      test("should create key with default values", () => {
        const key = createMockKey();

        expect(key.id).toBe(1);
        expect(key.userId).toBe(1);
        expect(key.enabled).toBe(true);
        expect(key.isPrimary).toBe(false);
      });

      test("should associate key with specific user", () => {
        const key = createMockKey({ userId: 42 });
        expect(key.userId).toBe(42);
      });

      test("should support expiration date", () => {
        const expiresAt = new Date("2025-12-31");
        const key = createMockKey({ expiresAt });
        expect(key.expiresAt).toEqual(expiresAt);
      });
    });

    describe("createMockMessage", () => {
      test("should create message with default values", () => {
        const message = createMockMessage();

        expect(message.id).toBe(1);
        expect(message.model).toBe("claude-sonnet-4-20250514");
        expect(message.inputTokens).toBe(100);
        expect(message.outputTokens).toBe(50);
      });

      test("should support cache tokens", () => {
        const message = createMockMessage({
          cacheCreationTokens: 500,
          cacheReadTokens: 200,
          cached: true,
        });

        expect(message.cacheCreationTokens).toBe(500);
        expect(message.cacheReadTokens).toBe(200);
        expect(message.cached).toBe(true);
      });
    });

    describe("createMockErrorRule", () => {
      test("should create error rule with default values", () => {
        const rule = createMockErrorRule();

        expect(rule.id).toBe(1);
        expect(rule.pattern).toBe("test.*error");
        expect(rule.enabled).toBe(true);
        expect(rule.isBuiltin).toBe(false);
      });

      test("should support builtin rules", () => {
        const rule = createMockErrorRule({
          name: "Prompt Too Long",
          pattern: "prompt is too long",
          isBuiltin: true,
        });

        expect(rule.name).toBe("Prompt Too Long");
        expect(rule.isBuiltin).toBe(true);
      });
    });
  });

  describe("Mock Data Store", () => {
    let store: MockDataStore;

    beforeEach(() => {
      store = createMockDataStore();
    });

    test("should create empty data store", () => {
      expect(store.providers.size).toBe(0);
      expect(store.users.size).toBe(0);
      expect(store.keys.size).toBe(0);
      expect(store.messages.length).toBe(0);
      expect(store.errorRules.size).toBe(0);
    });

    test("should seed providers", () => {
      const providers = [
        createMockProvider({ id: 1, name: "Provider 1" }),
        createMockProvider({ id: 2, name: "Provider 2" }),
      ];

      seedMockDataStore(store, { providers });

      expect(store.providers.size).toBe(2);
      expect(store.providers.get(1)?.name).toBe("Provider 1");
      expect(store.providers.get(2)?.name).toBe("Provider 2");
    });

    test("should seed multiple entity types", () => {
      seedMockDataStore(store, {
        providers: [createMockProvider({ id: 1 })],
        users: [createMockUser({ id: 1 }), createMockUser({ id: 2 })],
        keys: [createMockKey({ id: 1, userId: 1 })],
      });

      expect(store.providers.size).toBe(1);
      expect(store.users.size).toBe(2);
      expect(store.keys.size).toBe(1);
    });

    test("should reset data store", () => {
      seedMockDataStore(store, {
        providers: [createMockProvider()],
        users: [createMockUser()],
      });

      expect(store.providers.size).toBe(1);
      expect(store.users.size).toBe(1);

      resetMockDataStore(store);

      expect(store.providers.size).toBe(0);
      expect(store.users.size).toBe(0);
    });
  });

  describe("Mock Repository Functions", () => {
    let store: MockDataStore;

    beforeEach(() => {
      store = createMockDataStore();
    });

    describe("Provider Repository", () => {
      test("findAll should return all providers", async () => {
        seedMockDataStore(store, {
          providers: [
            createMockProvider({ id: 1 }),
            createMockProvider({ id: 2 }),
          ],
        });

        const repo = createMockProviderRepository(store);
        const providers = await repo.findAll();

        expect(providers.length).toBe(2);
      });

      test("findById should return specific provider", async () => {
        seedMockDataStore(store, {
          providers: [createMockProvider({ id: 1, name: "Test Provider" })],
        });

        const repo = createMockProviderRepository(store);
        const provider = await repo.findById(1);

        expect(provider?.name).toBe("Test Provider");
      });

      test("findById should return null for non-existent provider", async () => {
        const repo = createMockProviderRepository(store);
        const provider = await repo.findById(999);

        expect(provider).toBeNull();
      });

      test("findEnabled should filter disabled providers", async () => {
        seedMockDataStore(store, {
          providers: [
            createMockProvider({ id: 1, enabled: true }),
            createMockProvider({ id: 2, enabled: false }),
            createMockProvider({ id: 3, enabled: true }),
          ],
        });

        const repo = createMockProviderRepository(store);
        const enabled = await repo.findEnabled();

        expect(enabled.length).toBe(2);
        expect(enabled.every((p) => p.enabled)).toBe(true);
      });

      test("create should add new provider", async () => {
        const repo = createMockProviderRepository(store);
        const provider = await repo.create({
          name: "New Provider",
          type: "codex",
        });

        expect(provider.name).toBe("New Provider");
        expect(provider.type).toBe("codex");
        expect(store.providers.has(provider.id)).toBe(true);
      });

      test("update should modify existing provider", async () => {
        seedMockDataStore(store, {
          providers: [createMockProvider({ id: 1, name: "Original" })],
        });

        const repo = createMockProviderRepository(store);
        const updated = await repo.update(1, { name: "Updated" });

        expect(updated?.name).toBe("Updated");
        expect(store.providers.get(1)?.name).toBe("Updated");
      });

      test("delete should remove provider", async () => {
        seedMockDataStore(store, {
          providers: [createMockProvider({ id: 1 })],
        });

        const repo = createMockProviderRepository(store);
        await repo.delete(1);

        expect(store.providers.has(1)).toBe(false);
      });
    });

    describe("User Repository", () => {
      test("findAll should return all users", async () => {
        seedMockDataStore(store, {
          users: [createMockUser({ id: 1 }), createMockUser({ id: 2 })],
        });

        const repo = createMockUserRepository(store);
        const users = await repo.findAll();

        expect(users.length).toBe(2);
      });

      test("findEnabled should filter disabled users", async () => {
        seedMockDataStore(store, {
          users: [
            createMockUser({ id: 1, enabled: true }),
            createMockUser({ id: 2, enabled: false }),
          ],
        });

        const repo = createMockUserRepository(store);
        const enabled = await repo.findEnabled();

        expect(enabled.length).toBe(1);
        expect(enabled[0].id).toBe(1);
      });
    });

    describe("Key Repository", () => {
      test("findByUserId should return user keys", async () => {
        seedMockDataStore(store, {
          keys: [
            createMockKey({ id: 1, userId: 1 }),
            createMockKey({ id: 2, userId: 1 }),
            createMockKey({ id: 3, userId: 2 }),
          ],
        });

        const repo = createMockKeyRepository(store);
        const userKeys = await repo.findByUserId(1);

        expect(userKeys.length).toBe(2);
        expect(userKeys.every((k) => k.userId === 1)).toBe(true);
      });

      test("findByHash should return matching key", async () => {
        seedMockDataStore(store, {
          keys: [createMockKey({ id: 1, hash: "unique-hash-123" })],
        });

        const repo = createMockKeyRepository(store);
        const key = await repo.findByHash("unique-hash-123");

        expect(key?.id).toBe(1);
      });

      test("findByHash should return null for non-existent hash", async () => {
        const repo = createMockKeyRepository(store);
        const key = await repo.findByHash("non-existent");

        expect(key).toBeNull();
      });
    });
  });
});
