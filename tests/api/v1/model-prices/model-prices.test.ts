import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getModelPricesPaginatedMock = vi.hoisted(() => vi.fn());
const getAvailableModelCatalogMock = vi.hoisted(() => vi.fn());
const hasPriceTableMock = vi.hoisted(() => vi.fn());
const uploadPriceTableMock = vi.hoisted(() => vi.fn());
const checkLiteLLMSyncConflictsMock = vi.hoisted(() => vi.fn());
const syncLiteLLMPricesMock = vi.hoisted(() => vi.fn());
const upsertSingleModelPriceMock = vi.hoisted(() => vi.fn());
const deleteSingleModelPriceMock = vi.hoisted(() => vi.fn());
const pinModelPricingProviderAsManualMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/model-prices", () => ({
  getModelPricesPaginated: getModelPricesPaginatedMock,
  getAvailableModelCatalog: getAvailableModelCatalogMock,
  hasPriceTable: hasPriceTableMock,
  uploadPriceTable: uploadPriceTableMock,
  checkLiteLLMSyncConflicts: checkLiteLLMSyncConflictsMock,
  syncLiteLLMPrices: syncLiteLLMPricesMock,
  upsertSingleModelPrice: upsertSingleModelPriceMock,
  deleteSingleModelPrice: deleteSingleModelPriceMock,
  pinModelPricingProviderAsManual: pinModelPricingProviderAsManualMock,
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

const price = {
  id: 1,
  modelName: "gpt-5.4",
  priceData: { mode: "chat", input_cost_per_token: 0.000001 },
  source: "manual",
  createdAt: new Date("2026-04-28T00:00:00.000Z"),
  updatedAt: new Date("2026-04-28T00:00:00.000Z"),
};

const updateResult = {
  added: ["gpt-5.4"],
  updated: [],
  unchanged: [],
  failed: [],
  total: 1,
  skippedConflicts: [],
};

describe("v1 model price endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getModelPricesPaginatedMock.mockResolvedValue({
      ok: true,
      data: { data: [price], total: 1, page: 1, pageSize: 10, totalPages: 1 },
    });
    getAvailableModelCatalogMock.mockResolvedValue([
      { modelName: "gpt-5.4", litellmProvider: "openai", updatedAt: "2026-04-28T00:00:00.000Z" },
    ]);
    hasPriceTableMock.mockResolvedValue(true);
    uploadPriceTableMock.mockResolvedValue({ ok: true, data: updateResult });
    checkLiteLLMSyncConflictsMock.mockResolvedValue({
      ok: true,
      data: { hasConflicts: false, conflicts: [] },
    });
    syncLiteLLMPricesMock.mockResolvedValue({ ok: true, data: updateResult });
    upsertSingleModelPriceMock.mockResolvedValue({ ok: true, data: price });
    deleteSingleModelPriceMock.mockResolvedValue({ ok: true });
    pinModelPricingProviderAsManualMock.mockResolvedValue({ ok: true, data: price });
  });

  test("lists catalog and checks price table existence", async () => {
    const headers = { Authorization: "Bearer admin-token" };
    const list = await callV1Route({
      method: "GET",
      pathname: "/api/v1/model-prices?page=1&pageSize=10&search=gpt&source=manual",
      headers,
    });
    expect(list.response.status).toBe(200);
    expect(list.json).toMatchObject({
      items: [{ modelName: "gpt-5.4", updatedAt: "2026-04-28T00:00:00.000Z" }],
      total: 1,
    });
    expect(getModelPricesPaginatedMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      search: "gpt",
      source: "manual",
      litellmProvider: undefined,
    });

    const catalog = await callV1Route({
      method: "GET",
      pathname: "/api/v1/model-prices/catalog?scope=all",
      headers,
    });
    expect(catalog.response.status).toBe(200);
    expect(catalog.json).toMatchObject({ items: [{ modelName: "gpt-5.4" }] });
    expect(getAvailableModelCatalogMock).toHaveBeenCalledWith({ scope: "all" });

    const exists = await callV1Route({
      method: "GET",
      pathname: "/api/v1/model-prices/exists",
      headers,
    });
    expect(exists.response.status).toBe(200);
    expect(exists.json).toEqual({ exists: true });
  });

  test("uploads and syncs model prices", async () => {
    const headers = { Authorization: "Bearer admin-token" };
    const upload = await callV1Route({
      method: "POST",
      pathname: "/api/v1/model-prices:upload",
      headers,
      body: { content: "{}", overwriteManual: ["gpt-5.4"] },
    });
    expect(upload.response.status).toBe(200);
    expect(uploadPriceTableMock).toHaveBeenCalledWith("{}", ["gpt-5.4"]);

    const check = await callV1Route({
      method: "POST",
      pathname: "/api/v1/model-prices:syncLitellmCheck",
      headers,
    });
    expect(check.response.status).toBe(200);
    expect(check.json).toMatchObject({ hasConflicts: false });

    const sync = await callV1Route({
      method: "POST",
      pathname: "/api/v1/model-prices:syncLitellm",
      headers,
      body: { overwriteManual: ["gpt-5.4"] },
    });
    expect(sync.response.status).toBe(200);
    expect(syncLiteLLMPricesMock).toHaveBeenCalledWith(["gpt-5.4"]);
  });

  test("upserts deletes and pins one model price", async () => {
    const headers = { Authorization: "Bearer admin-token" };
    const body = {
      modelName: "gpt-5.4",
      mode: "chat",
      litellmProvider: "openai",
      inputCostPerToken: 0.000001,
    };
    const upsert = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/model-prices/gpt-5.4",
      headers,
      body,
    });
    expect(upsert.response.status).toBe(200);
    expect(upsertSingleModelPriceMock).toHaveBeenCalledWith(body);

    const pin = await callV1Route({
      method: "POST",
      pathname: "/api/v1/model-prices/gpt-5.4/pricing:pinManual",
      headers,
      body: { pricingProviderKey: "openai" },
    });
    expect(pin.response.status).toBe(200);
    expect(pinModelPricingProviderAsManualMock).toHaveBeenCalledWith({
      modelName: "gpt-5.4",
      pricingProviderKey: "openai",
    });

    const deleted = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/model-prices/gpt-5.4",
      headers,
    });
    expect(deleted.response.status).toBe(204);
    expect(deleteSingleModelPriceMock).toHaveBeenCalledWith("gpt-5.4");
  });

  test("returns problem+json for invalid writes and action failures", async () => {
    const invalid = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/model-prices/gpt-5.4",
      headers: { Authorization: "Bearer admin-token" },
      body: { modelName: "gpt-5.4", mode: "chat", inputCostPerToken: -1 },
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.response.headers.get("content-type")).toContain("application/problem+json");

    syncLiteLLMPricesMock.mockResolvedValueOnce({ ok: false, error: "无权限执行此操作" });
    const forbidden = await callV1Route({
      method: "POST",
      pathname: "/api/v1/model-prices:syncLitellm",
      headers: { Authorization: "Bearer admin-token" },
      body: {},
    });
    expect(forbidden.response.status).toBe(403);
  });

  test("documents model price REST paths", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/model-prices");
    expect(doc.paths).toHaveProperty("/api/v1/model-prices/catalog");
    expect(doc.paths).toHaveProperty("/api/v1/model-prices:upload");
    expect(doc.paths).toHaveProperty("/api/v1/model-prices:syncLitellm");
    expect(doc.paths).toHaveProperty("/api/v1/model-prices/{modelName}");
    expect(doc.paths).toHaveProperty("/api/v1/model-prices/{modelName}/pricing:pinManual");
  });
});
