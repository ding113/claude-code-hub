import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelPrice, ModelPriceData } from "@/types/model-price";

// Mock dependencies
const getSessionMock = vi.fn();
const revalidatePathMock = vi.fn();

// Repository mocks
const findLatestPriceByModelMock = vi.fn();
const findLatestPriceByModelAndSourceMock = vi.fn();
const findAllLatestPricesMock = vi.fn();
const createModelPriceMock = vi.fn();
const upsertModelPriceMock = vi.fn();
const deleteModelPriceByNameMock = vi.fn();
const findAllManualPricesMock = vi.fn();

// Price sync mock
const fetchCloudPriceTableTomlMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => revalidatePathMock(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/repository/model-price", () => ({
  findLatestPriceByModel: () => findLatestPriceByModelMock(),
  findLatestPriceByModelAndSource: (...args: unknown[]) =>
    findLatestPriceByModelAndSourceMock(...args),
  createModelPrice: (...args: unknown[]) => createModelPriceMock(...args),
  upsertModelPrice: (...args: unknown[]) => upsertModelPriceMock(...args),
  deleteModelPriceByName: (...args: unknown[]) => deleteModelPriceByNameMock(...args),
  findAllManualPrices: () => findAllManualPricesMock(),
  findAllLatestPrices: () => findAllLatestPricesMock(),
  findAllLatestPricesPaginated: vi.fn(async () => ({
    data: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 0,
  })),
  hasAnyPriceRecords: vi.fn(async () => false),
}));

vi.mock("@/lib/price-sync/cloud-price-table", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/price-sync/cloud-price-table")>();
  return {
    ...actual,
    fetchCloudPriceTableToml: (...args: unknown[]) => fetchCloudPriceTableTomlMock(...args),
  };
});

// Helper to create mock ModelPrice
function makeMockPrice(
  modelName: string,
  priceData: Partial<ModelPriceData>,
  source: "litellm" | "manual" = "manual"
): ModelPrice {
  const now = new Date();
  return {
    id: Math.floor(Math.random() * 1000),
    modelName,
    priceData: {
      mode: "chat",
      input_cost_per_token: 0.000001,
      output_cost_per_token: 0.000002,
      ...priceData,
    },
    source,
    createdAt: now,
    updatedAt: now,
  };
}

describe("Model Price Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: admin session
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findAllLatestPricesMock.mockResolvedValue([]);
  });

  describe("getAvailableModelCatalog", () => {
    it("returns chat models only by default", async () => {
      findAllLatestPricesMock.mockResolvedValue([
        makeMockPrice("gpt-4.1", { mode: "chat" }),
        makeMockPrice("gpt-image-2", { mode: "image_generation" }),
      ]);

      const { getAvailableModelCatalog } = await import("@/actions/model-prices");
      const result = await getAvailableModelCatalog();

      expect(result.map((item) => item.modelName)).toEqual(["gpt-4.1"]);
    });

    it("returns all model types when scope is all", async () => {
      findAllLatestPricesMock.mockResolvedValue([
        makeMockPrice("gpt-image-2", { mode: "image_generation" }),
        makeMockPrice("gpt-4.1", { mode: "chat" }),
      ]);

      const { getAvailableModelCatalog } = await import("@/actions/model-prices");
      const result = await getAvailableModelCatalog({ scope: "all" });

      expect(result.map((item) => item.modelName)).toEqual(
        expect.arrayContaining(["gpt-image-2", "gpt-4.1"])
      );
    });
  });

  describe("getAvailableModelsByProviderType", () => {
    it("keeps using the chat-only catalog", async () => {
      findAllLatestPricesMock.mockResolvedValue([
        makeMockPrice("gpt-4.1", { mode: "chat" }),
        makeMockPrice("gpt-image-2", { mode: "image_generation" }),
      ]);

      const { getAvailableModelsByProviderType } = await import("@/actions/model-prices");
      const result = await getAvailableModelsByProviderType();

      expect(result).toEqual(["gpt-4.1"]);
    });
  });

  describe("upsertSingleModelPrice", () => {
    it("should create a new model price for admin", async () => {
      const mockResult = makeMockPrice("gpt-5.2-codex", {
        mode: "chat",
        input_cost_per_token: 0.000015,
        output_cost_per_token: 0.00006,
      });
      upsertModelPriceMock.mockResolvedValue(mockResult);

      const { upsertSingleModelPrice } = await import("@/actions/model-prices");
      const result = await upsertSingleModelPrice({
        modelName: "gpt-5.2-codex",
        mode: "chat",
        litellmProvider: "openai",
        inputCostPerToken: 0.000015,
        outputCostPerToken: 0.00006,
      });

      expect(result.ok).toBe(true);
      expect(result.data?.modelName).toBe("gpt-5.2-codex");
      expect(upsertModelPriceMock).toHaveBeenCalledWith(
        "gpt-5.2-codex",
        expect.objectContaining({
          mode: "chat",
          litellm_provider: "openai",
          input_cost_per_token: 0.000015,
          output_cost_per_token: 0.00006,
        })
      );
    });

    it("should reject empty model name", async () => {
      const { upsertSingleModelPrice } = await import("@/actions/model-prices");
      const result = await upsertSingleModelPrice({
        modelName: "  ",
        mode: "chat",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("模型名称");
      expect(upsertModelPriceMock).not.toHaveBeenCalled();
    });

    it("should reject non-admin users", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 2, role: "user" } });

      const { upsertSingleModelPrice } = await import("@/actions/model-prices");
      const result = await upsertSingleModelPrice({
        modelName: "test-model",
        mode: "chat",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("无权限");
      expect(upsertModelPriceMock).not.toHaveBeenCalled();
    });

    it("should handle image generation mode", async () => {
      const mockResult = makeMockPrice("dall-e-3", {
        mode: "image_generation",
        output_cost_per_image: 0.04,
      });
      upsertModelPriceMock.mockResolvedValue(mockResult);

      const { upsertSingleModelPrice } = await import("@/actions/model-prices");
      const result = await upsertSingleModelPrice({
        modelName: "dall-e-3",
        mode: "image_generation",
        litellmProvider: "openai",
        outputCostPerImage: 0.04,
      });

      expect(result.ok).toBe(true);
      expect(upsertModelPriceMock).toHaveBeenCalledWith(
        "dall-e-3",
        expect.objectContaining({
          mode: "image_generation",
          output_cost_per_image: 0.04,
        })
      );
    });

    it("should merge extra JSON fields into price data", async () => {
      const mockResult = makeMockPrice("omni-model", {
        mode: "chat",
        input_cost_per_second: 0.5,
        file_search_cost_per_1k_calls: 2,
      });
      upsertModelPriceMock.mockResolvedValue(mockResult);

      const { upsertSingleModelPrice } = await import("@/actions/model-prices");
      const result = await upsertSingleModelPrice({
        modelName: "omni-model",
        mode: "chat",
        inputCostPerToken: 0.000015,
        extraFieldsJson: JSON.stringify({
          input_cost_per_second: 0.5,
          file_search_cost_per_1k_calls: 2,
        }),
      });

      expect(result.ok).toBe(true);
      expect(upsertModelPriceMock).toHaveBeenCalledWith(
        "omni-model",
        expect.objectContaining({
          mode: "chat",
          input_cost_per_token: 0.000015,
          input_cost_per_second: 0.5,
          file_search_cost_per_1k_calls: 2,
        })
      );
    });

    it("should reject invalid extra JSON", async () => {
      const { upsertSingleModelPrice } = await import("@/actions/model-prices");
      const result = await upsertSingleModelPrice({
        modelName: "broken-model",
        mode: "chat",
        extraFieldsJson: "{invalid",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("JSON");
      expect(upsertModelPriceMock).not.toHaveBeenCalled();
    });

    it("should let managed form fields override conflicting extra JSON fields", async () => {
      const mockResult = makeMockPrice("conflict-model", {
        mode: "chat",
        input_cost_per_token: 0.000015,
      });
      upsertModelPriceMock.mockResolvedValue(mockResult);

      const { upsertSingleModelPrice } = await import("@/actions/model-prices");
      const result = await upsertSingleModelPrice({
        modelName: "conflict-model",
        mode: "chat",
        inputCostPerToken: 0.000015,
        extraFieldsJson: JSON.stringify({
          mode: "image_generation",
          input_cost_per_token: 999,
          input_cost_per_second: 0.25,
        }),
      });

      expect(result.ok).toBe(true);
      expect(upsertModelPriceMock).toHaveBeenCalledWith(
        "conflict-model",
        expect.objectContaining({
          mode: "chat",
          input_cost_per_token: 0.000015,
          input_cost_per_second: 0.25,
        })
      );
    });

    it("should handle repository errors gracefully", async () => {
      upsertModelPriceMock.mockRejectedValue(new Error("Database error"));

      const { upsertSingleModelPrice } = await import("@/actions/model-prices");
      const result = await upsertSingleModelPrice({
        modelName: "test-model",
        mode: "chat",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("deleteSingleModelPrice", () => {
    it("should delete a model price for admin", async () => {
      deleteModelPriceByNameMock.mockResolvedValue(undefined);

      const { deleteSingleModelPrice } = await import("@/actions/model-prices");
      const result = await deleteSingleModelPrice("gpt-5.2-codex");

      expect(result.ok).toBe(true);
      expect(deleteModelPriceByNameMock).toHaveBeenCalledWith("gpt-5.2-codex");
    });

    it("should reject empty model name", async () => {
      const { deleteSingleModelPrice } = await import("@/actions/model-prices");
      const result = await deleteSingleModelPrice("");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("模型名称");
      expect(deleteModelPriceByNameMock).not.toHaveBeenCalled();
    });

    it("should reject non-admin users", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 2, role: "user" } });

      const { deleteSingleModelPrice } = await import("@/actions/model-prices");
      const result = await deleteSingleModelPrice("test-model");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("无权限");
      expect(deleteModelPriceByNameMock).not.toHaveBeenCalled();
    });

    it("should handle repository errors gracefully", async () => {
      deleteModelPriceByNameMock.mockRejectedValue(new Error("Database error"));

      const { deleteSingleModelPrice } = await import("@/actions/model-prices");
      const result = await deleteSingleModelPrice("test-model");

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("checkLiteLLMSyncConflicts", () => {
    it("should return no conflicts when no manual prices exist", async () => {
      findAllManualPricesMock.mockResolvedValue(new Map());
      fetchCloudPriceTableTomlMock.mockResolvedValue({
        ok: true,
        data: ['[models."claude-3-opus"]', 'mode = "chat"', "input_cost_per_token = 0.000015"].join(
          "\n"
        ),
      });

      const { checkLiteLLMSyncConflicts } = await import("@/actions/model-prices");
      const result = await checkLiteLLMSyncConflicts();

      expect(result.ok).toBe(true);
      expect(result.data?.hasConflicts).toBe(false);
      expect(result.data?.conflicts).toHaveLength(0);
    });

    it("should detect conflicts when manual prices exist in LiteLLM", async () => {
      const manualPrice = makeMockPrice("claude-3-opus", {
        mode: "chat",
        input_cost_per_token: 0.00001,
        output_cost_per_token: 0.00002,
      });

      findAllManualPricesMock.mockResolvedValue(new Map([["claude-3-opus", manualPrice]]));

      fetchCloudPriceTableTomlMock.mockResolvedValue({
        ok: true,
        data: [
          '[models."claude-3-opus"]',
          'mode = "chat"',
          "input_cost_per_token = 0.000015",
          "output_cost_per_token = 0.00006",
        ].join("\n"),
      });

      const { checkLiteLLMSyncConflicts } = await import("@/actions/model-prices");
      const result = await checkLiteLLMSyncConflicts();

      expect(result.ok).toBe(true);
      expect(result.data?.hasConflicts).toBe(true);
      expect(result.data?.conflicts).toHaveLength(1);
      expect(result.data?.conflicts[0]?.modelName).toBe("claude-3-opus");
    });

    it("should not report conflicts for manual prices not in LiteLLM", async () => {
      const manualPrice = makeMockPrice("custom-model", {
        mode: "chat",
        input_cost_per_token: 0.00001,
      });

      findAllManualPricesMock.mockResolvedValue(new Map([["custom-model", manualPrice]]));

      fetchCloudPriceTableTomlMock.mockResolvedValue({
        ok: true,
        data: ['[models."claude-3-opus"]', 'mode = "chat"', "input_cost_per_token = 0.000015"].join(
          "\n"
        ),
      });

      const { checkLiteLLMSyncConflicts } = await import("@/actions/model-prices");
      const result = await checkLiteLLMSyncConflicts();

      expect(result.ok).toBe(true);
      expect(result.data?.hasConflicts).toBe(false);
      expect(result.data?.conflicts).toHaveLength(0);
    });

    it("should reject non-admin users", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 2, role: "user" } });

      const { checkLiteLLMSyncConflicts } = await import("@/actions/model-prices");
      const result = await checkLiteLLMSyncConflicts();

      expect(result.ok).toBe(false);
      expect(result.error).toContain("无权限");
    });

    it("should handle network errors gracefully", async () => {
      findAllManualPricesMock.mockResolvedValue(new Map());
      fetchCloudPriceTableTomlMock.mockResolvedValue({
        ok: false,
        error: "云端价格表拉取失败：mock",
      });

      const { checkLiteLLMSyncConflicts } = await import("@/actions/model-prices");
      const result = await checkLiteLLMSyncConflicts();

      expect(result.ok).toBe(false);
      expect(result.error).toContain("云端");
    });

    it("should handle invalid TOML gracefully", async () => {
      findAllManualPricesMock.mockResolvedValue(new Map());
      fetchCloudPriceTableTomlMock.mockResolvedValue({
        ok: true,
        data: "[models\ninvalid = true",
      });

      const { checkLiteLLMSyncConflicts } = await import("@/actions/model-prices");
      const result = await checkLiteLLMSyncConflicts();

      expect(result.ok).toBe(false);
      expect(result.error).toContain("TOML");
    });
  });

  describe("processPriceTableInternal - source handling", () => {
    it("should skip manual prices during sync by default", async () => {
      const manualPrice = makeMockPrice("custom-model", {
        mode: "chat",
        input_cost_per_token: 0.00001,
      });

      findAllManualPricesMock.mockResolvedValue(new Map([["custom-model", manualPrice]]));
      findAllLatestPricesMock.mockResolvedValue([manualPrice]);

      const { processPriceTableInternal } = await import("@/actions/model-prices");
      const result = await processPriceTableInternal(
        JSON.stringify({
          "custom-model": {
            mode: "chat",
            input_cost_per_token: 0.000015,
          },
        })
      );

      expect(result.ok).toBe(true);
      expect(result.data?.skippedConflicts).toContain("custom-model");
      expect(result.data?.unchanged).toContain("custom-model");
      expect(createModelPriceMock).not.toHaveBeenCalled();
    });

    it("should overwrite manual prices when specified", async () => {
      const manualPrice = makeMockPrice("custom-model", {
        mode: "chat",
        input_cost_per_token: 0.00001,
      });

      findAllManualPricesMock.mockResolvedValue(new Map([["custom-model", manualPrice]]));
      findAllLatestPricesMock.mockResolvedValue([manualPrice]);
      deleteModelPriceByNameMock.mockResolvedValue(undefined);
      createModelPriceMock.mockResolvedValue(
        makeMockPrice(
          "custom-model",
          {
            mode: "chat",
            input_cost_per_token: 0.000015,
          },
          "litellm"
        )
      );

      const { processPriceTableInternal } = await import("@/actions/model-prices");
      const result = await processPriceTableInternal(
        JSON.stringify({
          "custom-model": {
            mode: "chat",
            input_cost_per_token: 0.000015,
          },
        }),
        ["custom-model"] // Overwrite list
      );

      expect(result.ok).toBe(true);
      expect(result.data?.updated).toContain("custom-model");
      expect(deleteModelPriceByNameMock).toHaveBeenCalledWith("custom-model");
      expect(createModelPriceMock).toHaveBeenCalled();
    });

    it("should add new models with litellm source", async () => {
      findAllManualPricesMock.mockResolvedValue(new Map());
      findAllLatestPricesMock.mockResolvedValue([]);
      createModelPriceMock.mockResolvedValue(
        makeMockPrice(
          "new-model",
          {
            mode: "chat",
          },
          "litellm"
        )
      );

      const { processPriceTableInternal } = await import("@/actions/model-prices");
      const result = await processPriceTableInternal(
        JSON.stringify({
          "new-model": {
            mode: "chat",
            input_cost_per_token: 0.000001,
          },
        })
      );

      expect(result.ok).toBe(true);
      expect(result.data?.added).toContain("new-model");
      expect(createModelPriceMock).toHaveBeenCalledWith("new-model", expect.any(Object), "litellm");
    });

    it("should skip metadata fields like sample_spec", async () => {
      findAllManualPricesMock.mockResolvedValue(new Map());
      findAllLatestPricesMock.mockResolvedValue([]);

      const { processPriceTableInternal } = await import("@/actions/model-prices");
      const result = await processPriceTableInternal(
        JSON.stringify({
          sample_spec: { description: "This is metadata" },
          "real-model": { mode: "chat", input_cost_per_token: 0.000001 },
        })
      );

      expect(result.ok).toBe(true);
      expect(result.data?.total).toBe(1); // Only real-model
      expect(result.data?.failed).not.toContain("sample_spec");
    });

    it("should skip entries without mode field", async () => {
      findAllManualPricesMock.mockResolvedValue(new Map());
      findAllLatestPricesMock.mockResolvedValue([]);

      const { processPriceTableInternal } = await import("@/actions/model-prices");
      const result = await processPriceTableInternal(
        JSON.stringify({
          "invalid-model": { input_cost_per_token: 0.000001 }, // No mode
          "valid-model": { mode: "chat", input_cost_per_token: 0.000001 },
        })
      );

      expect(result.ok).toBe(true);
      expect(result.data?.failed).toContain("invalid-model");
    });

    it("should ignore dangerous keys when comparing price data", async () => {
      const existing = makeMockPrice(
        "safe-model",
        {
          mode: "chat",
          input_cost_per_token: 0.000001,
          output_cost_per_token: 0.000002,
        },
        "litellm"
      );

      findAllManualPricesMock.mockResolvedValue(new Map());
      findAllLatestPricesMock.mockResolvedValue([existing]);

      const { processPriceTableInternal } = await import("@/actions/model-prices");
      const result = await processPriceTableInternal(
        JSON.stringify({
          "safe-model": {
            mode: "chat",
            input_cost_per_token: 0.000001,
            output_cost_per_token: 0.000002,
            constructor: { prototype: { polluted: true } },
          },
        })
      );

      expect(result.ok).toBe(true);
      expect(result.data?.unchanged).toContain("safe-model");
      expect(createModelPriceMock).not.toHaveBeenCalled();
    });
  });

  describe("pinModelPricingProviderAsManual", () => {
    it("should pin a cloud provider pricing node as a local manual model price", async () => {
      findLatestPriceByModelAndSourceMock.mockResolvedValue(
        makeMockPrice(
          "gpt-5.4",
          {
            mode: "responses",
            display_name: "GPT-5.4",
            model_family: "gpt",
            pricing: {
              openrouter: {
                input_cost_per_token: 0.0000025,
                output_cost_per_token: 0.000015,
                cache_read_input_token_cost: 2.5e-7,
              },
            },
          },
          "litellm"
        )
      );
      upsertModelPriceMock.mockResolvedValue(
        makeMockPrice(
          "gpt-5.4",
          {
            mode: "responses",
            input_cost_per_token: 0.0000025,
            output_cost_per_token: 0.000015,
            cache_read_input_token_cost: 2.5e-7,
            selected_pricing_provider: "openrouter",
          },
          "manual"
        )
      );

      const { pinModelPricingProviderAsManual } = await import("@/actions/model-prices");
      const result = await pinModelPricingProviderAsManual({
        modelName: "gpt-5.4",
        pricingProviderKey: "openrouter",
      });

      expect(result.ok).toBe(true);
      expect(findLatestPriceByModelAndSourceMock).toHaveBeenCalledWith("gpt-5.4", "litellm");
      expect(upsertModelPriceMock).toHaveBeenCalledWith(
        "gpt-5.4",
        expect.objectContaining({
          mode: "responses",
          input_cost_per_token: 0.0000025,
          output_cost_per_token: 0.000015,
          cache_read_input_token_cost: 2.5e-7,
          selected_pricing_provider: "openrouter",
          selected_pricing_source_model: "gpt-5.4",
          selected_pricing_resolution: "manual_pin",
        })
      );
    });
  });
});
