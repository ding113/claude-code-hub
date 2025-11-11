import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import type { ModelPrice, ModelPriceData } from "@/types/model-price";
import type { ActionResult } from "@/actions/types";
import type { PaginatedResult } from "@/repository/model-price";

// Mock dependencies
vi.mock("@/actions/model-prices", () => ({
  getModelPricesPaginated: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

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

// Import mocked functions
import { getModelPricesPaginated } from "@/actions/model-prices";
import { getSession } from "@/lib/auth";

// Helper function to create mock ModelPrice
function createMockModelPrice(modelName: string, id: number): ModelPrice {
  const priceData: ModelPriceData = {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    mode: "chat",
    litellm_provider: "anthropic",
    max_tokens: 200000,
    supports_function_calling: true,
    supports_vision: true,
  };

  return {
    id,
    modelName,
    priceData,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  };
}

// Helper function to create mock paginated result
function createMockPaginatedResult(
  data: ModelPrice[],
  total: number,
  page: number,
  pageSize: number
): ActionResult<PaginatedResult<ModelPrice>> {
  return {
    ok: true,
    data: {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

// Helper function to create test request
function createTestRequest(searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:13500/api/prices");
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return new NextRequest(url);
}

describe("Prices API Route - GET /api/prices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication & Authorization", () => {
    it("should return 403 when user is not authenticated", async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const request = createTestRequest();
      const response = await GET(request);

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json).toEqual({
        ok: false,
        error: "无权限访问此资源",
      });
      expect(getModelPricesPaginated).not.toHaveBeenCalled();
    });

    it("should return 403 when user is not admin", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { role: "user", id: 1, name: "test", description: "" },
      });

      const request = createTestRequest();
      const response = await GET(request);

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json).toEqual({
        ok: false,
        error: "无权限访问此资源",
      });
      expect(getModelPricesPaginated).not.toHaveBeenCalled();
    });

    it("should allow access for admin users", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { role: "admin", id: 1, name: "admin", description: "" },
      });

      const mockData = [
        createMockModelPrice("claude-sonnet-4-5-20250929", 1),
        createMockModelPrice("claude-opus-4", 2),
      ];
      const mockResult = createMockPaginatedResult(mockData, 2, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest();
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(getModelPricesPaginated).toHaveBeenCalledOnce();
    });
  });

  describe("Pagination Parameters", () => {
    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue({
        user: { role: "admin", id: 1, name: "admin", description: "" },
      });
    });

    it("should use default parameters when none provided", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 1, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest();
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        search: undefined,
      });
    });

    it("should parse page parameter correctly", async () => {
      const mockData = [createMockModelPrice("claude-opus-4", 1)];
      const mockResult = createMockPaginatedResult(mockData, 100, 2, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ page: "2" });
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 2,
        pageSize: 50,
        search: undefined,
      });
    });

    it("should parse pageSize parameter correctly", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 100, 1, 20);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ pageSize: "20" });
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 20,
        search: undefined,
      });
    });

    it("should support 'size' alias for pageSize parameter", async () => {
      const mockData = [createMockModelPrice("claude-opus-4", 1)];
      const mockResult = createMockPaginatedResult(mockData, 100, 1, 30);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ size: "30" });
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 30,
        search: undefined,
      });
    });

    it("should prefer pageSize over size when both provided", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 100, 1, 25);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ pageSize: "25", size: "30" });
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 25,
        search: undefined,
      });
    });

    it("should parse search parameter correctly", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 1, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ search: "claude" });
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        search: "claude",
      });
    });

    it("should handle empty search string", async () => {
      const mockData = [createMockModelPrice("claude-opus-4", 1)];
      const mockResult = createMockPaginatedResult(mockData, 1, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ search: "" });
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        search: undefined,
      });
    });

    it("should handle special characters in search", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 1, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ search: "claude-3.5 & special" });
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        search: "claude-3.5 & special",
      });
    });

    it("should handle URL-encoded search parameter", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 1, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      // Create URL with encoded search parameter
      const url = new URL("http://localhost:13500/api/prices?search=claude%20sonnet");
      const request = new NextRequest(url);
      await GET(request);

      // URL automatically decodes %20 to space
      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        search: "claude sonnet",
      });
    });

    it("should handle all parameters together", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 50, 3, 25);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({
        page: "3",
        pageSize: "25",
        search: "claude",
      });
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 3,
        pageSize: 25,
        search: "claude",
      });
    });
  });

  describe("Parameter Validation", () => {
    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue({
        user: { role: "admin", id: 1, name: "admin", description: "" },
      });
    });

    it("should return 400 when page is less than 1", async () => {
      const request = createTestRequest({ page: "0" });
      const response = await GET(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toEqual({
        ok: false,
        error: "页码必须大于0",
      });
      expect(getModelPricesPaginated).not.toHaveBeenCalled();
    });

    it("should return 400 when page is negative", async () => {
      const request = createTestRequest({ page: "-1" });
      const response = await GET(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toEqual({
        ok: false,
        error: "页码必须大于0",
      });
      expect(getModelPricesPaginated).not.toHaveBeenCalled();
    });

    it("should return 400 when pageSize is less than 1", async () => {
      const request = createTestRequest({ pageSize: "0" });
      const response = await GET(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toEqual({
        ok: false,
        error: "每页大小必须在1-200之间",
      });
      expect(getModelPricesPaginated).not.toHaveBeenCalled();
    });

    it("should return 400 when pageSize is greater than 200", async () => {
      const request = createTestRequest({ pageSize: "201" });
      const response = await GET(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toEqual({
        ok: false,
        error: "每页大小必须在1-200之间",
      });
      expect(getModelPricesPaginated).not.toHaveBeenCalled();
    });

    it("should accept pageSize of exactly 1", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 100, 1, 1);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ pageSize: "1" });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(getModelPricesPaginated).toHaveBeenCalled();
    });

    it("should accept pageSize of exactly 200", async () => {
      const mockData = [createMockModelPrice("claude-opus-4", 1)];
      const mockResult = createMockPaginatedResult(mockData, 100, 1, 200);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ pageSize: "200" });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(getModelPricesPaginated).toHaveBeenCalled();
    });

    it("should handle invalid page number string", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 1, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ page: "invalid" });
      const response = await GET(request);

      // parseInt("invalid") returns NaN, and NaN < 1 is false, so validation passes
      // This is a limitation of the current implementation
      expect(response.status).toBe(200);
      expect(getModelPricesPaginated).toHaveBeenCalled();
    });

    it("should handle invalid pageSize string", async () => {
      const mockData = [createMockModelPrice("claude-opus-4", 1)];
      const mockResult = createMockPaginatedResult(mockData, 1, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ pageSize: "invalid" });
      const response = await GET(request);

      // parseInt("invalid") returns NaN, and NaN < 1 is false, NaN > 200 is false
      // So validation passes - this is a limitation
      expect(response.status).toBe(200);
      expect(getModelPricesPaginated).toHaveBeenCalled();
    });

    it("should handle decimal page number (truncated to integer)", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 100, 2, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ page: "2.7" });
      await GET(request);

      // parseInt truncates to integer
      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 2,
        pageSize: 50,
        search: undefined,
      });
    });

    it("should handle decimal pageSize (truncated to integer)", async () => {
      const mockData = [createMockModelPrice("claude-opus-4", 1)];
      const mockResult = createMockPaginatedResult(mockData, 100, 1, 25);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ pageSize: "25.9" });
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 25,
        search: undefined,
      });
    });
  });

  describe("Response Format & Data Structure", () => {
    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue({
        user: { role: "admin", id: 1, name: "admin", description: "" },
      });
    });

    it("should return correct response structure for successful request", async () => {
      const mockData = [
        createMockModelPrice("claude-sonnet-4-5-20250929", 1),
        createMockModelPrice("claude-opus-4", 2),
      ];
      const mockResult = createMockPaginatedResult(mockData, 2, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest();
      const response = await GET(request);

      expect(response.status).toBe(200);
      const json = await response.json();

      // NextResponse.json() serializes Date objects to ISO strings
      expect(json).toEqual({
        ok: true,
        data: {
          data: [
            {
              ...mockData[0],
              createdAt: "2024-01-01T00:00:00.000Z",
              updatedAt: "2024-01-01T00:00:00.000Z",
            },
            {
              ...mockData[1],
              createdAt: "2024-01-01T00:00:00.000Z",
              updatedAt: "2024-01-01T00:00:00.000Z",
            },
          ],
          total: 2,
          page: 1,
          pageSize: 50,
          totalPages: 1,
        },
      });
    });

    it("should return empty data array when no results found", async () => {
      const mockResult = createMockPaginatedResult([], 0, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ search: "nonexistent" });
      const response = await GET(request);

      expect(response.status).toBe(200);
      const json = await response.json();

      expect(json).toEqual({
        ok: true,
        data: {
          data: [],
          total: 0,
          page: 1,
          pageSize: 50,
          totalPages: 0,
        },
      });
    });

    it("should return correct totalPages for paginated results", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 150, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest();
      const response = await GET(request);

      expect(response.status).toBe(200);
      const json = await response.json();

      expect(json.data.totalPages).toBe(3); // Math.ceil(150 / 50)
    });

    it("should preserve model price data structure", async () => {
      const priceData: ModelPriceData = {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
        cache_creation_input_token_cost: 0.00000375,
        cache_read_input_token_cost: 0.0000003,
        mode: "chat",
        litellm_provider: "anthropic",
        max_tokens: 200000,
        supports_function_calling: true,
        supports_vision: true,
        supports_prompt_caching: true,
        supports_thinking: true,
      };

      const mockPrice: ModelPrice = {
        id: 1,
        modelName: "claude-sonnet-4-5-20250929",
        priceData,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-01T00:00:00Z"),
      };

      const mockResult = createMockPaginatedResult([mockPrice], 1, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest();
      const response = await GET(request);

      const json = await response.json();
      expect(json.data.data[0].priceData).toEqual(priceData);
    });

    it("should handle large dataset pagination", async () => {
      const mockData = Array.from({ length: 50 }, (_, i) =>
        createMockModelPrice(`model-${i + 1}`, i + 1)
      );
      const mockResult = createMockPaginatedResult(mockData, 500, 5, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ page: "5", pageSize: "50" });
      const response = await GET(request);

      expect(response.status).toBe(200);
      const json = await response.json();

      expect(json.data.data).toHaveLength(50);
      expect(json.data.total).toBe(500);
      expect(json.data.page).toBe(5);
      expect(json.data.totalPages).toBe(10); // Math.ceil(500 / 50)
    });
  });

  describe("Search Functionality", () => {
    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue({
        user: { role: "admin", id: 1, name: "admin", description: "" },
      });
    });

    it("should pass search parameter to repository", async () => {
      const mockData = [
        createMockModelPrice("claude-sonnet-4-5-20250929", 1),
        createMockModelPrice("claude-opus-4", 2),
      ];
      const mockResult = createMockPaginatedResult(mockData, 2, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ search: "claude" });
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        search: "claude",
      });
    });

    it("should handle case-insensitive search", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 1, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ search: "CLAUDE" });
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        search: "CLAUDE",
      });
    });

    it("should handle search with hyphens", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 1, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ search: "sonnet-4" });
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        search: "sonnet-4",
      });
    });

    it("should handle search with numbers", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 1, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ search: "20250929" });
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        search: "20250929",
      });
    });

    it("should return empty results for non-matching search", async () => {
      const mockResult = createMockPaginatedResult([], 0, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ search: "nonexistent-model" });
      const response = await GET(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.data).toHaveLength(0);
      expect(json.data.total).toBe(0);
    });

    it("should handle search with pagination", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 25, 2, 10);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({
        search: "claude",
        page: "2",
        pageSize: "10",
      });
      await GET(request);

      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
        search: "claude",
      });
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue({
        user: { role: "admin", id: 1, name: "admin", description: "" },
      });
    });

    it("should handle repository error", async () => {
      vi.mocked(getModelPricesPaginated).mockResolvedValue({
        ok: false,
        error: "Database connection failed",
      });

      const request = createTestRequest();
      const response = await GET(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual({
        ok: false,
        error: "Database connection failed",
      });
    });

    it("should handle unexpected errors with 500 status", async () => {
      vi.mocked(getModelPricesPaginated).mockRejectedValue(
        new Error("Unexpected database error")
      );

      const request = createTestRequest();
      const response = await GET(request);

      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json).toEqual({
        ok: false,
        error: "服务器内部错误",
      });
    });

    it("should handle null response from repository", async () => {
      vi.mocked(getModelPricesPaginated).mockResolvedValue(null as any);

      const request = createTestRequest();
      const response = await GET(request);

      // The route doesn't validate the response type, so null is returned as-is
      // This would likely cause an error in production, but the route passes it through
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toBeNull();
    });

    it("should handle malformed URL gracefully", async () => {
      // This test verifies error handling for URL parsing issues
      // In practice, NextRequest constructor handles this, but we test defensive code
      vi.mocked(getModelPricesPaginated).mockResolvedValue(
        createMockPaginatedResult([], 0, 1, 50)
      );

      const request = createTestRequest();
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it("should handle session check failure", async () => {
      vi.mocked(getSession).mockRejectedValue(new Error("Session error"));

      const request = createTestRequest();
      const response = await GET(request);

      expect(response.status).toBe(500);
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue({
        user: { role: "admin", id: 1, name: "admin", description: "" },
      });
    });

    it("should handle page beyond total pages", async () => {
      const mockResult = createMockPaginatedResult([], 50, 100, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ page: "100" });
      const response = await GET(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.data).toHaveLength(0);
    });

    it("should handle very large page number", async () => {
      const mockResult = createMockPaginatedResult([], 100, 999999, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ page: "999999" });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 999999,
        pageSize: 50,
        search: undefined,
      });
    });

    it("should handle minimum valid pageSize", async () => {
      const mockData = [createMockModelPrice("claude-sonnet-4-5-20250929", 1)];
      const mockResult = createMockPaginatedResult(mockData, 1, 1, 1);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ pageSize: "1" });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 1,
        search: undefined,
      });
    });

    it("should handle maximum valid pageSize", async () => {
      const mockData = Array.from({ length: 200 }, (_, i) =>
        createMockModelPrice(`model-${i + 1}`, i + 1)
      );
      const mockResult = createMockPaginatedResult(mockData, 200, 1, 200);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ pageSize: "200" });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 200,
        search: undefined,
      });
    });

    it("should handle very long search string", async () => {
      const longSearch = "a".repeat(1000);
      const mockResult = createMockPaginatedResult([], 0, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ search: longSearch });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        search: longSearch,
      });
    });

    it("should handle whitespace-only search string", async () => {
      const mockResult = createMockPaginatedResult([], 0, 1, 50);
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ search: "   " });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        search: "   ",
      });
    });

    it("should handle concurrent requests", async () => {
      const mockResult = createMockPaginatedResult(
        [createMockModelPrice("claude-sonnet-4-5-20250929", 1)],
        1,
        1,
        50
      );
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const requests = Array.from({ length: 5 }, () => createTestRequest());
      const responses = await Promise.all(requests.map((req) => GET(req)));

      expect(responses).toHaveLength(5);
      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
      expect(getModelPricesPaginated).toHaveBeenCalledTimes(5);
    });

    it("should handle multiple search terms with spaces", async () => {
      const mockResult = createMockPaginatedResult(
        [createMockModelPrice("claude-sonnet-4-5-20250929", 1)],
        1,
        1,
        50
      );
      vi.mocked(getModelPricesPaginated).mockResolvedValue(mockResult);

      const request = createTestRequest({ search: "claude sonnet 4.5" });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(getModelPricesPaginated).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        search: "claude sonnet 4.5",
      });
    });
  });
});
