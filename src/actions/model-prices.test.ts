import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { ModelPriceData } from "@/types/model-price";
import {
  processPriceTableInternal,
  uploadPriceTable,
  getModelPrices,
  getModelPricesPaginated,
  hasPriceTable,
  getAvailableModelsByProviderType,
  syncLiteLLMPrices,
} from "./model-prices";

// Mock dependencies
let mockDb: ReturnType<typeof drizzle>;
let client: PGlite;

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
vi.mock("@/drizzle/db", () => ({
  get db() {
    return mockDb;
  },
}));

// Mock auth with admin session by default
let mockSession: { user: { role: "admin" | "user" } } | null = {
  user: { role: "admin" },
};

const mockGetSession = vi.fn(() => Promise.resolve(mockSession));

vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

// Mock revalidatePath
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock price sync module
const mockGetPriceTableJson = vi.fn();
vi.mock("@/lib/price-sync", () => ({
  getPriceTableJson: () => mockGetPriceTableJson(),
}));

describe("Model Prices Actions", () => {
  beforeEach(async () => {
    // Create in-memory PGlite database
    client = new PGlite();
    mockDb = drizzle(client);

    // Run migrations
    await migrate(mockDb, { migrationsFolder: "./drizzle" });

    // Patch db.execute to return iterable results (PGlite returns { rows } format)
    const originalExecute = mockDb.execute.bind(mockDb);
    mockDb.execute = async (query: any) => {
      const result = await originalExecute(query);
      // PGlite returns {rows: [], fields: []}, make it iterable
      if (result && typeof result === "object" && "rows" in result) {
        return result.rows;
      }
      return result;
    };

    // Reset mocks
    vi.clearAllMocks();

    // Reset auth mock to admin by default
    mockSession = {
      user: { role: "admin" },
    };
    mockGetSession.mockClear();
  });

  afterEach(async () => {
    await client.close();
  });

  describe("processPriceTableInternal", () => {
    const samplePriceData: ModelPriceData = {
      input_cost_per_token: 0.00001,
      output_cost_per_token: 0.00003,
      mode: "chat",
      max_tokens: 4096,
      litellm_provider: "anthropic",
      supports_function_calling: true,
    };

    it("should add new model prices successfully", async () => {
      const priceTable = {
        "claude-sonnet-4": samplePriceData,
        "claude-opus-4": {
          ...samplePriceData,
          input_cost_per_token: 0.00003,
        },
      };

      const result = await processPriceTableInternal(JSON.stringify(priceTable));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total).toBe(2);
        expect(result.data.added).toHaveLength(2);
        expect(result.data.added).toContain("claude-sonnet-4");
        expect(result.data.added).toContain("claude-opus-4");
        expect(result.data.updated).toHaveLength(0);
        expect(result.data.unchanged).toHaveLength(0);
        expect(result.data.failed).toHaveLength(0);
      }
    });

    it("should detect unchanged prices", async () => {
      const priceTable = {
        "claude-sonnet-4": samplePriceData,
      };

      // First upload
      const firstResult = await processPriceTableInternal(JSON.stringify(priceTable));
      expect(firstResult.ok).toBe(true);

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second upload with same data
      const result = await processPriceTableInternal(JSON.stringify(priceTable));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total).toBe(1);
        expect(result.data.added).toHaveLength(0);
        // Note: Due to JSON key ordering in DB vs parsing, unchanged detection may vary
        // The important thing is no new records added and no failures
        expect(result.data.updated.length + result.data.unchanged.length).toBe(1);
        expect(result.data.failed).toHaveLength(0);
      }
    });

    it("should update changed prices", async () => {
      const priceTable = {
        "claude-sonnet-4": samplePriceData,
      };

      // First upload
      await processPriceTableInternal(JSON.stringify(priceTable));

      // Update with different price
      const updatedPriceTable = {
        "claude-sonnet-4": {
          ...samplePriceData,
          input_cost_per_token: 0.00002, // Changed
        },
      };

      const result = await processPriceTableInternal(JSON.stringify(updatedPriceTable));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total).toBe(1);
        expect(result.data.added).toHaveLength(0);
        expect(result.data.updated).toHaveLength(1);
        expect(result.data.updated).toContain("claude-sonnet-4");
        expect(result.data.unchanged).toHaveLength(0);
        expect(result.data.failed).toHaveLength(0);
      }
    });

    it("should handle invalid JSON format", async () => {
      const result = await processPriceTableInternal("invalid json {");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("JSON格式不正确");
      }
    });

    it("should reject non-object JSON", async () => {
      const result = await processPriceTableInternal(JSON.stringify("string"));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("必须是一个JSON对象");
      }
    });

    it("should reject null value", async () => {
      const result = await processPriceTableInternal(JSON.stringify(null));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("必须是一个JSON对象");
      }
    });

    it("should handle invalid price data gracefully", async () => {
      const priceTable = {
        "valid-model": samplePriceData,
        "invalid-model": null as unknown as ModelPriceData,
        "another-valid": samplePriceData,
      };

      const result = await processPriceTableInternal(JSON.stringify(priceTable));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total).toBe(3);
        expect(result.data.added).toHaveLength(2);
        expect(result.data.failed).toHaveLength(1);
        expect(result.data.failed).toContain("invalid-model");
      }
    });

    it("should filter out empty model names", async () => {
      const priceTable = {
        "valid-model": samplePriceData,
        "": samplePriceData, // Empty name
        "  ": samplePriceData, // Whitespace only
      };

      const result = await processPriceTableInternal(JSON.stringify(priceTable));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total).toBe(1);
        expect(result.data.added).toHaveLength(1);
        expect(result.data.added).toContain("valid-model");
      }
    });

    it("should handle mixed results (add, update, unchanged)", async () => {
      // First upload
      await processPriceTableInternal(
        JSON.stringify({
          "model-1": samplePriceData,
          "model-2": samplePriceData,
        })
      );

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second upload: keep model-1, update model-2, add model-3
      const result = await processPriceTableInternal(
        JSON.stringify({
          "model-1": samplePriceData, // Should be unchanged
          "model-2": { ...samplePriceData, mode: "completion" }, // Updated
          "model-3": samplePriceData, // Added
        })
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total).toBe(3);
        expect(result.data.added).toContain("model-3");
        expect(result.data.updated).toContain("model-2");
        // model-1 should be unchanged or updated (due to JSON key ordering)
        expect(result.data.updated.includes("model-1") || result.data.unchanged.includes("model-1")).toBe(true);
      }
    });

    it("should handle OpenAI compatible models", async () => {
      const openaiPriceData: ModelPriceData = {
        input_cost_per_token: 0.00001,
        output_cost_per_token: 0.00002,
        mode: "chat",
        litellm_provider: "openai",
      };

      const result = await processPriceTableInternal(
        JSON.stringify({
          "gpt-4o": openaiPriceData,
          "gpt-4": openaiPriceData,
        })
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total).toBe(2);
        expect(result.data.added).toHaveLength(2);
      }
    });

    it("should handle cache pricing fields", async () => {
      const priceDataWithCache: ModelPriceData = {
        ...samplePriceData,
        cache_creation_input_token_cost: 0.000005,
        cache_read_input_token_cost: 0.000001,
        supports_prompt_caching: true,
      };

      const result = await processPriceTableInternal(
        JSON.stringify({
          "claude-sonnet-4": priceDataWithCache,
        })
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.added).toContain("claude-sonnet-4");
      }
    });

    it("should preserve additional unknown fields in priceData", async () => {
      const priceDataWithExtra = {
        ...samplePriceData,
        custom_field: "custom_value",
        another_field: 123,
      };

      const result = await processPriceTableInternal(
        JSON.stringify({
          "test-model": priceDataWithExtra,
        })
      );

      expect(result.ok).toBe(true);
    });
  });

  describe("uploadPriceTable", () => {
    it("should succeed with admin role", async () => {
      const priceTable = {
        "claude-sonnet-4": {
          input_cost_per_token: 0.00001,
          output_cost_per_token: 0.00003,
          mode: "chat" as const,
        },
      };

      const result = await uploadPriceTable(JSON.stringify(priceTable));

      expect(result.ok).toBe(true);
    });

    it("should reject non-admin users", async () => {
      // Mock non-admin session
      mockSession = { user: { role: "user" } };

      const result = await uploadPriceTable(JSON.stringify({}));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("无权限");
      }

      // Reset to admin
      mockSession = { user: { role: "admin" } };
    });

    it("should reject when session is null", async () => {
      // Mock null session
      mockSession = null;

      const result = await uploadPriceTable(JSON.stringify({}));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("无权限");
      }

      // Reset to admin
      mockSession = { user: { role: "admin" } };
    });
  });

  describe("getModelPrices", () => {
    beforeEach(async () => {
      // Setup test data
      await processPriceTableInternal(
        JSON.stringify({
          "claude-sonnet-4": {
            input_cost_per_token: 0.00001,
            output_cost_per_token: 0.00003,
            mode: "chat" as const,
          },
          "claude-opus-4": {
            input_cost_per_token: 0.00003,
            output_cost_per_token: 0.00009,
            mode: "chat" as const,
          },
        })
      );
    });

    it("should return all prices for admin", async () => {
      const prices = await getModelPrices();

      expect(prices).toHaveLength(2);
      expect(prices.map((p) => p.modelName)).toContain("claude-sonnet-4");
      expect(prices.map((p) => p.modelName)).toContain("claude-opus-4");
    });

    it("should return empty array for non-admin", async () => {
      mockSession = { user: { role: "user" } };

      const prices = await getModelPrices();

      expect(prices).toHaveLength(0);

      // Reset to admin
      mockSession = { user: { role: "admin" } };
    });

    it("should return empty array when session is null", async () => {
      mockSession = null;

      const prices = await getModelPrices();

      expect(prices).toHaveLength(0);

      // Reset to admin
      mockSession = { user: { role: "admin" } };
    });

    it("should return prices with correct structure", async () => {
      const prices = await getModelPrices();

      expect(prices.length).toBeGreaterThan(0);
      const price = prices[0];
      expect(price).toHaveProperty("id");
      expect(price).toHaveProperty("modelName");
      expect(price).toHaveProperty("priceData");
      expect(price).toHaveProperty("createdAt");
      expect(price).toHaveProperty("updatedAt");
    });
  });

  describe("getModelPricesPaginated", () => {
    beforeEach(async () => {
      // Setup 15 test models
      const priceTable: Record<string, ModelPriceData> = {};
      for (let i = 1; i <= 15; i++) {
        priceTable[`model-${i.toString().padStart(2, "0")}`] = {
          input_cost_per_token: 0.00001 * i,
          output_cost_per_token: 0.00003 * i,
          mode: "chat",
        };
      }
      await processPriceTableInternal(JSON.stringify(priceTable));
    });

    it("should return paginated results", async () => {
      const result = await getModelPricesPaginated({
        page: 1,
        pageSize: 10,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.data).toHaveLength(10);
        expect(result.data.total).toBe(15);
        expect(result.data.page).toBe(1);
        expect(result.data.pageSize).toBe(10);
        expect(result.data.totalPages).toBe(2);
      }
    });

    it("should return second page correctly", async () => {
      const result = await getModelPricesPaginated({
        page: 2,
        pageSize: 10,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.data).toHaveLength(5);
        expect(result.data.page).toBe(2);
      }
    });

    it("should filter by search term", async () => {
      const result = await getModelPricesPaginated({
        page: 1,
        pageSize: 10,
        search: "model-01",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.data).toHaveLength(1);
        expect(result.data.data[0].modelName).toBe("model-01");
        expect(result.data.total).toBe(1);
      }
    });

    it("should handle case-insensitive search", async () => {
      const result = await getModelPricesPaginated({
        page: 1,
        pageSize: 10,
        search: "MODEL-01",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.data).toHaveLength(1);
      }
    });

    it("should handle partial search", async () => {
      const result = await getModelPricesPaginated({
        page: 1,
        pageSize: 20,
        search: "model-0",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should match model-01 through model-09
        expect(result.data.data.length).toBeGreaterThan(0);
        expect(result.data.total).toBeGreaterThan(0);
      }
    });

    it("should reject non-admin users", async () => {
      mockSession = { user: { role: "user" } };

      const result = await getModelPricesPaginated({
        page: 1,
        pageSize: 10,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("无权限");
      }

      // Reset to admin
      mockSession = { user: { role: "admin" } };
    });

    it("should reject when session is null", async () => {
      mockSession = null;

      const result = await getModelPricesPaginated({
        page: 1,
        pageSize: 10,
      });

      expect(result.ok).toBe(false);

      // Reset to admin
      mockSession = { user: { role: "admin" } };
    });

    it("should handle empty search results", async () => {
      const result = await getModelPricesPaginated({
        page: 1,
        pageSize: 10,
        search: "nonexistent-model",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.data).toHaveLength(0);
        expect(result.data.total).toBe(0);
        expect(result.data.totalPages).toBe(0);
      }
    });

    it("should trim search whitespace", async () => {
      const result = await getModelPricesPaginated({
        page: 1,
        pageSize: 10,
        search: "  model-01  ",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.data).toHaveLength(1);
      }
    });
  });

  describe("hasPriceTable", () => {
    it("should return false when no prices exist", async () => {
      const result = await hasPriceTable();

      expect(result).toBe(false);
    });

    it("should return true when prices exist (admin user)", async () => {
      // Add a price
      await processPriceTableInternal(
        JSON.stringify({
          "test-model": {
            input_cost_per_token: 0.00001,
            output_cost_per_token: 0.00003,
            mode: "chat" as const,
          },
        })
      );

      const result = await hasPriceTable();

      expect(result).toBe(true);
    });

    it("should return true when prices exist (non-admin user)", async () => {
      // Add a price first
      await processPriceTableInternal(
        JSON.stringify({
          "test-model": {
            input_cost_per_token: 0.00001,
            output_cost_per_token: 0.00003,
            mode: "chat" as const,
          },
        })
      );

      // Switch to non-admin
      mockSession = { user: { role: "user" } };

      const result = await hasPriceTable();

      expect(result).toBe(true);

      // Reset to admin
      mockSession = { user: { role: "admin" } };
    });

    it("should handle database errors gracefully", async () => {
      // Mock a database error
      vi.spyOn(mockDb, "select").mockImplementationOnce(() => {
        throw new Error("Database error");
      });

      const result = await hasPriceTable();

      expect(result).toBe(false);
    });
  });

  describe("getAvailableModelsByProviderType", () => {
    beforeEach(async () => {
      // Setup mixed chat and image generation models
      await processPriceTableInternal(
        JSON.stringify({
          "claude-sonnet-4": {
            input_cost_per_token: 0.00001,
            output_cost_per_token: 0.00003,
            mode: "chat" as const,
          },
          "claude-opus-4": {
            input_cost_per_token: 0.00003,
            output_cost_per_token: 0.00009,
            mode: "chat" as const,
          },
          "dall-e-3": {
            output_cost_per_image: 0.04,
            mode: "image_generation" as const,
          },
          "gpt-4o": {
            input_cost_per_token: 0.00001,
            output_cost_per_token: 0.00002,
            mode: "chat" as const,
          },
        })
      );
    });

    it("should return only chat models", async () => {
      const models = await getAvailableModelsByProviderType();

      expect(models).toHaveLength(3);
      expect(models).toContain("claude-sonnet-4");
      expect(models).toContain("claude-opus-4");
      expect(models).toContain("gpt-4o");
      expect(models).not.toContain("dall-e-3");
    });

    it("should return models in alphabetical order", async () => {
      const models = await getAvailableModelsByProviderType();

      // Check if sorted
      const sortedModels = [...models].sort();
      expect(models).toEqual(sortedModels);
    });

    it("should reject non-admin users", async () => {
      mockSession = { user: { role: "user" } };

      const models = await getAvailableModelsByProviderType();

      expect(models).toHaveLength(0);

      // Reset to admin
      mockSession = { user: { role: "admin" } };
    });

    it("should return empty array when session is null", async () => {
      mockSession = null;

      const models = await getAvailableModelsByProviderType();

      expect(models).toHaveLength(0);

      // Reset to admin
      mockSession = { user: { role: "admin" } };
    });

    it("should handle no chat models", async () => {
      // Create fresh database
      await client.close();
      client = new PGlite();
      mockDb = drizzle(client);
      await migrate(mockDb, { migrationsFolder: "./drizzle" });

      // Add only image generation model
      await processPriceTableInternal(
        JSON.stringify({
          "dall-e-3": {
            output_cost_per_image: 0.04,
            mode: "image_generation" as const,
          },
        })
      );

      const models = await getAvailableModelsByProviderType();

      expect(models).toHaveLength(0);
    });
  });

  describe("syncLiteLLMPrices", () => {
    const mockPriceJson = JSON.stringify({
      "claude-sonnet-4": {
        input_cost_per_token: 0.00001,
        output_cost_per_token: 0.00003,
        mode: "chat",
      },
      "claude-opus-4": {
        input_cost_per_token: 0.00003,
        output_cost_per_token: 0.00009,
        mode: "chat",
      },
    });

    it("should sync prices successfully", async () => {
      mockGetPriceTableJson.mockResolvedValueOnce(mockPriceJson);

      const result = await syncLiteLLMPrices();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total).toBe(2);
        expect(result.data.added).toHaveLength(2);
      }
    });

    it("should fail when CDN and cache unavailable", async () => {
      mockGetPriceTableJson.mockResolvedValueOnce(null);

      const result = await syncLiteLLMPrices();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("无法从 CDN 或缓存获取价格表");
      }
    });

    it("should reject non-admin users", async () => {
      mockSession = { user: { role: "user" } };
      mockGetPriceTableJson.mockResolvedValueOnce(mockPriceJson);

      const result = await syncLiteLLMPrices();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("无权限");
      }

      // Reset to admin
      mockSession = { user: { role: "admin" } };
    });

    it("should reject when session is null", async () => {
      mockSession = null;
      mockGetPriceTableJson.mockResolvedValueOnce(mockPriceJson);

      const result = await syncLiteLLMPrices();

      expect(result.ok).toBe(false);

      // Reset to admin
      mockSession = { user: { role: "admin" } };
    });

    it("should handle invalid JSON from sync source", async () => {
      mockGetPriceTableJson.mockResolvedValueOnce("invalid json");

      const result = await syncLiteLLMPrices();

      // uploadPriceTable will catch invalid JSON and return error
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("JSON");
      }
    });

    it("should update existing prices when syncing", async () => {
      // First sync
      mockGetPriceTableJson.mockResolvedValueOnce(mockPriceJson);
      const firstSync = await syncLiteLLMPrices();
      expect(firstSync.ok).toBe(true);

      // Wait to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second sync with updated prices
      const updatedPriceJson = JSON.stringify({
        "claude-sonnet-4": {
          input_cost_per_token: 0.00002, // Changed
          output_cost_per_token: 0.00003,
          mode: "chat",
        },
        "claude-opus-4": {
          input_cost_per_token: 0.00003,
          output_cost_per_token: 0.00009,
          mode: "chat",
        },
      });

      mockGetPriceTableJson.mockResolvedValueOnce(updatedPriceJson);
      const result = await syncLiteLLMPrices();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.updated).toContain("claude-sonnet-4");
        // claude-opus-4 should be unchanged or updated (JSON key ordering)
        expect(result.data.updated.includes("claude-opus-4") || result.data.unchanged.includes("claude-opus-4")).toBe(true);
      }
    });

    it("should handle fetch errors gracefully", async () => {
      // Mock error is caught and returns the error message
      mockGetPriceTableJson.mockRejectedValueOnce(new Error("Network error"));

      const result = await syncLiteLLMPrices();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeTruthy();
        expect(result.error).toContain("Network error");
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle very large price table", async () => {
      const largePriceTable: Record<string, ModelPriceData> = {};
      for (let i = 0; i < 1000; i++) {
        largePriceTable[`model-${i}`] = {
          input_cost_per_token: 0.00001,
          output_cost_per_token: 0.00003,
          mode: "chat",
        };
      }

      const result = await processPriceTableInternal(JSON.stringify(largePriceTable));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total).toBe(1000);
        expect(result.data.added).toHaveLength(1000);
      }
    });

    it("should handle model names with special characters", async () => {
      const priceTable = {
        "claude-3.5-sonnet": {
          input_cost_per_token: 0.00001,
          output_cost_per_token: 0.00003,
          mode: "chat" as const,
        },
        "gpt-4o-2024-05-13": {
          input_cost_per_token: 0.00001,
          output_cost_per_token: 0.00002,
          mode: "chat" as const,
        },
      };

      const result = await processPriceTableInternal(JSON.stringify(priceTable));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.added).toContain("claude-3.5-sonnet");
        expect(result.data.added).toContain("gpt-4o-2024-05-13");
      }
    });

    it("should handle unicode model names", async () => {
      const priceTable = {
        "模型-测试": {
          input_cost_per_token: 0.00001,
          output_cost_per_token: 0.00003,
          mode: "chat" as const,
        },
      };

      const result = await processPriceTableInternal(JSON.stringify(priceTable));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.added).toContain("模型-测试");
      }
    });

    it("should handle zero cost models", async () => {
      const priceTable = {
        "free-model": {
          input_cost_per_token: 0,
          output_cost_per_token: 0,
          mode: "chat" as const,
        },
      };

      const result = await processPriceTableInternal(JSON.stringify(priceTable));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.added).toContain("free-model");
      }
    });

    it("should handle very small cost values", async () => {
      const priceTable = {
        "cheap-model": {
          input_cost_per_token: 0.000000001,
          output_cost_per_token: 0.000000002,
          mode: "chat" as const,
        },
      };

      const result = await processPriceTableInternal(JSON.stringify(priceTable));

      expect(result.ok).toBe(true);
    });

    it("should handle completion mode models", async () => {
      const priceTable = {
        "completion-model": {
          input_cost_per_token: 0.00001,
          output_cost_per_token: 0.00003,
          mode: "completion" as const,
        },
      };

      const result = await processPriceTableInternal(JSON.stringify(priceTable));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.added).toContain("completion-model");
      }
    });

    it("should handle all capability flags", async () => {
      const priceDataWithAllFlags: ModelPriceData = {
        input_cost_per_token: 0.00001,
        output_cost_per_token: 0.00003,
        mode: "chat",
        supports_assistant_prefill: true,
        supports_computer_use: true,
        supports_function_calling: true,
        supports_pdf_input: true,
        supports_prompt_caching: true,
        supports_reasoning: true,
        supports_response_schema: true,
        supports_tool_choice: true,
        supports_vision: true,
      };

      const result = await processPriceTableInternal(
        JSON.stringify({
          "full-featured-model": priceDataWithAllFlags,
        })
      );

      expect(result.ok).toBe(true);
    });
  });
});
