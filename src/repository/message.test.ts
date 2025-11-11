import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql, eq, desc, and, isNull } from "drizzle-orm";
import * as schema from "@/drizzle/schema";
import type { CreateMessageRequestData, MessageRequest } from "@/types/message";
import { toMessageRequest } from "./_shared/transformers";
import { formatCostForStorage } from "@/lib/utils/currency";
import Decimal from "decimal.js-light";

describe("Message Repository", () => {
  let pglite: PGlite;
  let testDb: ReturnType<typeof drizzle>;
  let testUserId: number;
  let testProviderId: number;
  let testKeyId: number;
  let testKey: string;

  beforeAll(async () => {
    // Initialize in-memory PGlite database
    pglite = new PGlite();
    testDb = drizzle(pglite, { schema });

    // Apply migrations
    await migrate(testDb, { migrationsFolder: "./drizzle" });

    // Create test user
    const [user] = await testDb
      .insert(schema.users)
      .values({
        name: "Test User",
        role: "user",
        rpmLimit: 60,
        dailyLimitUsd: "100.00",
      })
      .returning({ id: schema.users.id });
    testUserId = user.id;

    // Create test provider
    const [provider] = await testDb
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

    // Create test key
    testKey = "test-api-key-12345";
    const [key] = await testDb
      .insert(schema.keys)
      .values({
        userId: testUserId,
        key: testKey,
        name: "Test Key",
        isEnabled: true,
      })
      .returning({ id: schema.keys.id });
    testKeyId = key.id;
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    // Clean up message_request table before each test
    await testDb.delete(schema.messageRequest);
  });

  describe("createMessageRequest (database operations)", () => {
    it("should create a message request with minimal data", async () => {
      const data: CreateMessageRequestData = {
        provider_id: testProviderId,
        user_id: testUserId,
        key: testKey,
        model: "claude-sonnet-4-5-20250929",
        duration_ms: 1500,
        cost_usd: new Decimal("0.000123456789123456"),
      };

      const formattedCost = formatCostForStorage(data.cost_usd);
      const dbData = {
        providerId: data.provider_id,
        userId: data.user_id,
        key: data.key,
        model: data.model,
        durationMs: data.duration_ms,
        costUsd: formattedCost ?? undefined,
        costMultiplier: data.cost_multiplier?.toString() ?? undefined,
        sessionId: data.session_id,
        userAgent: data.user_agent,
        endpoint: data.endpoint,
        messagesCount: data.messages_count,
      };

      const [result] = await testDb.insert(schema.messageRequest).values(dbData).returning();
      const message = toMessageRequest(result);

      expect(message).toBeDefined();
      expect(message.id).toBeGreaterThan(0);
      expect(message.providerId).toBe(testProviderId);
      expect(message.userId).toBe(testUserId);
      expect(message.key).toBe(testKey);
      expect(message.model).toBe("claude-sonnet-4-5-20250929");
      expect(message.durationMs).toBe(1500);
      expect(message.costUsd).toBe("0.000123456789123"); // COST_SCALE = 15 decimal places
      expect(message.createdAt).toBeInstanceOf(Date);
      expect(message.updatedAt).toBeInstanceOf(Date);
    });

    it("should create a message request with all optional fields", async () => {
      const data: CreateMessageRequestData = {
        provider_id: testProviderId,
        user_id: testUserId,
        key: testKey,
        model: "claude-opus-4",
        duration_ms: 2500,
        cost_usd: new Decimal("0.0005"),
        cost_multiplier: 1.2,
        session_id: "session-123",
        user_agent: "Claude Code/1.0",
        endpoint: "/v1/messages",
        messages_count: 5,
        status_code: 200,
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 20,
        provider_chain: [
          {
            id: testProviderId,
            name: "Test Provider",
            reason: "initial_selection",
            selectionMethod: "weighted_random",
            priority: 0,
            weight: 1,
            circuitState: "closed",
          },
        ],
      };

      const formattedCost = formatCostForStorage(data.cost_usd);
      const dbData = {
        providerId: data.provider_id,
        userId: data.user_id,
        key: data.key,
        model: data.model,
        durationMs: data.duration_ms,
        costUsd: formattedCost ?? undefined,
        costMultiplier: data.cost_multiplier?.toString() ?? undefined,
        sessionId: data.session_id,
        userAgent: data.user_agent,
        endpoint: data.endpoint,
        messagesCount: data.messages_count,
        statusCode: data.status_code,
        inputTokens: data.input_tokens,
        outputTokens: data.output_tokens,
        cacheCreationInputTokens: data.cache_creation_input_tokens,
        cacheReadInputTokens: data.cache_read_input_tokens,
        providerChain: data.provider_chain,
      };

      const [result] = await testDb.insert(schema.messageRequest).values(dbData).returning();
      const message = toMessageRequest(result);

      expect(message.costMultiplier).toBe(1.2);
      expect(message.sessionId).toBe("session-123");
      expect(message.userAgent).toBe("Claude Code/1.0");
      expect(message.endpoint).toBe("/v1/messages");
      expect(message.messagesCount).toBe(5);
      expect(message.statusCode).toBe(200);
      expect(message.inputTokens).toBe(100);
      expect(message.outputTokens).toBe(50);
    });

    it("should handle null cost gracefully", async () => {
      const data: CreateMessageRequestData = {
        provider_id: testProviderId,
        user_id: testUserId,
        key: testKey,
        model: "claude-sonnet-4-5-20250929",
      };

      const formattedCost = formatCostForStorage(data.cost_usd);
      expect(formattedCost).toBeNull();

      const dbData = {
        providerId: data.provider_id,
        userId: data.user_id,
        key: data.key,
        model: data.model,
        // costUsd omitted - let it use the default value from schema (0)
      };

      const [result] = await testDb.insert(schema.messageRequest).values(dbData).returning();
      const message = toMessageRequest(result);

      // Database default is '0', which becomes '0.000000000000000' with COST_SCALE
      expect(message.costUsd).toBe("0.000000000000000");
    });
  });

  describe("updateMessageRequest operations", () => {
    it("should update duration of existing message", async () => {
      const [message] = await testDb
        .insert(schema.messageRequest)
        .values({
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-sonnet-4-5-20250929",
          durationMs: 1000,
        })
        .returning();

      // Wait 1ms to ensure updatedAt is different from createdAt
      await new Promise((resolve) => setTimeout(resolve, 1));

      await testDb
        .update(schema.messageRequest)
        .set({
          durationMs: 3000,
          updatedAt: new Date(),
        })
        .where(eq(schema.messageRequest.id, message.id));

      const [updated] = await testDb
        .select()
        .from(schema.messageRequest)
        .where(eq(schema.messageRequest.id, message.id));

      expect(updated.durationMs).toBe(3000);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(message.createdAt.getTime());
    });

    it("should update cost of existing message", async () => {
      const [message] = await testDb
        .insert(schema.messageRequest)
        .values({
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-sonnet-4-5-20250929",
          costUsd: "0.0001",
        })
        .returning();

      const newCost = formatCostForStorage(new Decimal("0.0005"));

      await testDb
        .update(schema.messageRequest)
        .set({
          costUsd: newCost!,
          updatedAt: new Date(),
        })
        .where(eq(schema.messageRequest.id, message.id));

      const [updated] = await testDb
        .select()
        .from(schema.messageRequest)
        .where(eq(schema.messageRequest.id, message.id));

      expect(updated.costUsd).toBe("0.000500000000000"); // COST_SCALE = 15 decimal places
    });

    it("should update multiple details at once", async () => {
      const [message] = await testDb
        .insert(schema.messageRequest)
        .values({
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-sonnet-4-5-20250929",
        })
        .returning();

      const updateData = {
        statusCode: 200,
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 10,
        cacheReadInputTokens: 20,
        providerChain: [{ id: testProviderId, name: "Test Provider" }],
        updatedAt: new Date(),
      };

      await testDb
        .update(schema.messageRequest)
        .set(updateData)
        .where(eq(schema.messageRequest.id, message.id));

      const [updated] = await testDb
        .select()
        .from(schema.messageRequest)
        .where(eq(schema.messageRequest.id, message.id));

      expect(updated.statusCode).toBe(200);
      expect(updated.inputTokens).toBe(100);
      expect(updated.outputTokens).toBe(50);
      expect(updated.cacheCreationInputTokens).toBe(10);
      expect(updated.cacheReadInputTokens).toBe(20);
      expect(updated.providerChain).toEqual([{ id: testProviderId, name: "Test Provider" }]);
    });
  });

  describe("findLatestMessageRequestByKey", () => {
    it("should find latest message by key", async () => {
      await testDb.insert(schema.messageRequest).values([
        {
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-sonnet-4-5-20250929",
          createdAt: new Date("2024-01-01"),
        },
        {
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-opus-4",
          createdAt: new Date("2024-01-02"),
        },
      ]);

      const [result] = await testDb
        .select()
        .from(schema.messageRequest)
        .where(and(eq(schema.messageRequest.key, testKey), isNull(schema.messageRequest.deletedAt)))
        .orderBy(desc(schema.messageRequest.createdAt))
        .limit(1);

      const message = toMessageRequest(result);

      expect(message).toBeDefined();
      expect(message.model).toBe("claude-opus-4");
      expect(message.createdAt.toISOString()).toContain("2024-01-02");
    });

    it("should return undefined when key not found", async () => {
      const results = await testDb
        .select()
        .from(schema.messageRequest)
        .where(
          and(
            eq(schema.messageRequest.key, "non-existent-key"),
            isNull(schema.messageRequest.deletedAt)
          )
        )
        .limit(1);

      expect(results.length).toBe(0);
    });

    it("should ignore soft-deleted messages", async () => {
      await testDb.insert(schema.messageRequest).values([
        {
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-sonnet-4-5-20250929",
          createdAt: new Date("2024-01-01"),
        },
        {
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-opus-4",
          createdAt: new Date("2024-01-02"),
          deletedAt: new Date(),
        },
      ]);

      const [result] = await testDb
        .select()
        .from(schema.messageRequest)
        .where(and(eq(schema.messageRequest.key, testKey), isNull(schema.messageRequest.deletedAt)))
        .orderBy(desc(schema.messageRequest.createdAt))
        .limit(1);

      const message = toMessageRequest(result);
      expect(message.model).toBe("claude-sonnet-4-5-20250929");
    });
  });

  describe("findMessageRequestBySessionId", () => {
    it("should find message by session ID", async () => {
      const sessionId = "test-session-123";

      await testDb.insert(schema.messageRequest).values([
        {
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-sonnet-4-5-20250929",
          sessionId,
          inputTokens: 100,
          outputTokens: 50,
        },
      ]);

      const [result] = await testDb
        .select()
        .from(schema.messageRequest)
        .where(
          and(
            eq(schema.messageRequest.sessionId, sessionId),
            isNull(schema.messageRequest.deletedAt)
          )
        )
        .orderBy(desc(schema.messageRequest.createdAt))
        .limit(1);

      const message = toMessageRequest(result);

      expect(message).toBeDefined();
      expect(message.sessionId).toBe(sessionId);
      expect(message.inputTokens).toBe(100);
      expect(message.outputTokens).toBe(50);
    });

    it("should return latest message for session with multiple requests", async () => {
      const sessionId = "test-session-456";

      await testDb.insert(schema.messageRequest).values([
        {
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-sonnet-4-5-20250929",
          sessionId,
          createdAt: new Date("2024-01-01"),
        },
        {
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-opus-4",
          sessionId,
          createdAt: new Date("2024-01-02"),
        },
      ]);

      const [result] = await testDb
        .select()
        .from(schema.messageRequest)
        .where(
          and(
            eq(schema.messageRequest.sessionId, sessionId),
            isNull(schema.messageRequest.deletedAt)
          )
        )
        .orderBy(desc(schema.messageRequest.createdAt))
        .limit(1);

      const message = toMessageRequest(result);
      expect(message.model).toBe("claude-opus-4");
    });
  });

  describe("aggregateSessionStats", () => {
    it("should aggregate stats for a session", async () => {
      const sessionId = "aggregate-test-session";

      await testDb.insert(schema.messageRequest).values([
        {
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-sonnet-4-5-20250929",
          sessionId,
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationInputTokens: 10,
          cacheReadInputTokens: 20,
          costUsd: "0.001",
          durationMs: 1500,
          userAgent: "Claude Code/1.0",
        },
        {
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-opus-4",
          sessionId,
          inputTokens: 200,
          outputTokens: 100,
          cacheCreationInputTokens: 20,
          cacheReadInputTokens: 40,
          costUsd: "0.002",
          durationMs: 2500,
          userAgent: "Claude Code/1.0",
        },
      ]);

      // Query aggregated stats
      const [stats] = await testDb
        .select({
          requestCount: sql<number>`count(*)::double precision`,
          totalCostUsd: sql<string>`COALESCE(sum(${schema.messageRequest.costUsd}), 0)`,
          totalInputTokens: sql<number>`COALESCE(sum(${schema.messageRequest.inputTokens})::double precision, 0::double precision)`,
          totalOutputTokens: sql<number>`COALESCE(sum(${schema.messageRequest.outputTokens})::double precision, 0::double precision)`,
          totalCacheCreationTokens: sql<number>`COALESCE(sum(${schema.messageRequest.cacheCreationInputTokens})::double precision, 0::double precision)`,
          totalCacheReadTokens: sql<number>`COALESCE(sum(${schema.messageRequest.cacheReadInputTokens})::double precision, 0::double precision)`,
          totalDurationMs: sql<number>`COALESCE(sum(${schema.messageRequest.durationMs})::double precision, 0::double precision)`,
        })
        .from(schema.messageRequest)
        .where(
          and(
            eq(schema.messageRequest.sessionId, sessionId),
            isNull(schema.messageRequest.deletedAt)
          )
        );

      expect(stats.requestCount).toBe(2);
      expect(stats.totalCostUsd).toBe("0.003000000000000"); // COST_SCALE = 15 decimal places
      expect(stats.totalInputTokens).toBe(300);
      expect(stats.totalOutputTokens).toBe(150);
      expect(stats.totalCacheCreationTokens).toBe(30);
      expect(stats.totalCacheReadTokens).toBe(60);
      expect(stats.totalDurationMs).toBe(4000);
    });

    it("should handle session with multiple providers", async () => {
      const sessionId = "multi-provider-session";

      // Create second provider
      const [provider2] = await testDb
        .insert(schema.providers)
        .values({
          name: "Test Provider 2",
          url: "https://api.test2.com",
          key: "test-provider-key-2",
          isEnabled: true,
          weight: 1,
        })
        .returning({ id: schema.providers.id });

      await testDb.insert(schema.messageRequest).values([
        {
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-sonnet-4-5-20250929",
          sessionId,
        },
        {
          providerId: provider2.id,
          userId: testUserId,
          key: testKey,
          model: "claude-opus-4",
          sessionId,
        },
      ]);

      // Query distinct providers
      const providerList = await testDb
        .selectDistinct({
          providerId: schema.messageRequest.providerId,
        })
        .from(schema.messageRequest)
        .where(
          and(
            eq(schema.messageRequest.sessionId, sessionId),
            isNull(schema.messageRequest.deletedAt)
          )
        );

      expect(providerList).toHaveLength(2);
      expect(providerList.map((p) => p.providerId)).toContain(testProviderId);
      expect(providerList.map((p) => p.providerId)).toContain(provider2.id);
    });
  });

  describe("findUsageLogs with pagination", () => {
    beforeEach(async () => {
      // Insert test data with different timestamps and models
      await testDb.insert(schema.messageRequest).values([
        {
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-sonnet-4-5-20250929",
          createdAt: new Date("2024-01-01T10:00:00Z"),
        },
        {
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-opus-4",
          createdAt: new Date("2024-01-02T10:00:00Z"),
        },
        {
          providerId: testProviderId,
          userId: testUserId,
          key: testKey,
          model: "claude-sonnet-4-5-20250929",
          createdAt: new Date("2024-01-03T10:00:00Z"),
        },
      ]);
    });

    it("should find all logs without filters", async () => {
      const results = await testDb
        .select()
        .from(schema.messageRequest)
        .where(isNull(schema.messageRequest.deletedAt))
        .orderBy(desc(schema.messageRequest.createdAt));

      const [countResult] = await testDb
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.messageRequest)
        .where(isNull(schema.messageRequest.deletedAt));

      expect(countResult.count).toBe(3);
      expect(results).toHaveLength(3);
    });

    it("should filter by model", async () => {
      const results = await testDb
        .select()
        .from(schema.messageRequest)
        .where(
          and(
            eq(schema.messageRequest.model, "claude-opus-4"),
            isNull(schema.messageRequest.deletedAt)
          )
        );

      expect(results).toHaveLength(1);
      expect(results[0].model).toBe("claude-opus-4");
    });

    it("should support pagination", async () => {
      const page1 = await testDb
        .select()
        .from(schema.messageRequest)
        .where(isNull(schema.messageRequest.deletedAt))
        .orderBy(desc(schema.messageRequest.createdAt))
        .limit(2)
        .offset(0);

      const page2 = await testDb
        .select()
        .from(schema.messageRequest)
        .where(isNull(schema.messageRequest.deletedAt))
        .orderBy(desc(schema.messageRequest.createdAt))
        .limit(2)
        .offset(2);

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it("should order by created_at DESC", async () => {
      const results = await testDb
        .select()
        .from(schema.messageRequest)
        .where(isNull(schema.messageRequest.deletedAt))
        .orderBy(desc(schema.messageRequest.createdAt));

      expect(results[0].createdAt.getTime()).toBeGreaterThanOrEqual(results[1].createdAt.getTime());
      expect(results[1].createdAt.getTime()).toBeGreaterThanOrEqual(results[2].createdAt.getTime());
    });

    it("should handle large dataset pagination efficiently", async () => {
      // Insert 100 records for pagination testing
      const largeDataset = Array.from({ length: 100 }, (_, i) => ({
        providerId: testProviderId,
        userId: testUserId,
        key: testKey,
        model: `model-${i % 5}`,
        createdAt: new Date(`2024-01-${String((i % 30) + 1).padStart(2, "0")}T10:00:00Z`),
      }));

      await testDb.insert(schema.messageRequest).values(largeDataset);

      const startTime = Date.now();
      const result = await testDb
        .select()
        .from(schema.messageRequest)
        .where(isNull(schema.messageRequest.deletedAt))
        .orderBy(desc(schema.messageRequest.createdAt))
        .limit(50)
        .offset(0);
      const endTime = Date.now();

      // PGlite in-memory database is slower than production PostgreSQL for large datasets
      // Adjust threshold to account for in-memory database performance characteristics
      expect(endTime - startTime).toBeLessThan(250);
      expect(result).toHaveLength(50);
    });

    it("should ignore soft-deleted messages", async () => {
      await testDb
        .update(schema.messageRequest)
        .set({ deletedAt: new Date() })
        .where(eq(schema.messageRequest.model, "claude-opus-4"));

      const results = await testDb
        .select()
        .from(schema.messageRequest)
        .where(isNull(schema.messageRequest.deletedAt));

      expect(results).toHaveLength(2);
      expect(results.every((log) => log.model !== "claude-opus-4")).toBe(true);
    });
  });

  describe("formatCostForStorage utility", () => {
    it("should format valid decimal cost with 15 decimal places", () => {
      const cost = new Decimal("0.000123456789123456");
      const formatted = formatCostForStorage(cost);
      expect(formatted).toBe("0.000123456789123"); // COST_SCALE = 15, rounds to 15 decimal places
    });

    it("should return null for undefined cost", () => {
      const formatted = formatCostForStorage(undefined);
      expect(formatted).toBeNull();
    });

    it("should handle zero cost with 15 decimal places", () => {
      const cost = new Decimal("0");
      const formatted = formatCostForStorage(cost);
      expect(formatted).toBe("0.000000000000000"); // COST_SCALE = 15
    });

    it("should handle very small costs within precision", () => {
      const cost = new Decimal("0.000000000000001");
      const formatted = formatCostForStorage(cost);
      expect(formatted).toBe("0.000000000000001");
    });

    it("should truncate costs beyond 15 decimal places", () => {
      const cost = new Decimal("0.0001234567891234567890");
      const formatted = formatCostForStorage(cost);
      expect(formatted).toBe("0.000123456789123"); // Rounds at 15th decimal place
    });
  });
});
